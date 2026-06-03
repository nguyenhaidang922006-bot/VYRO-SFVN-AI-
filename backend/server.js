
const express = require("express");
const cors = require("cors");
const path = require("path");
const WebSocket = require("ws");

const app = express();
app.use(cors());
app.use(express.json());

const DISPLAY_SYMBOL = process.env.DISPLAY_SYMBOL || "F-XACM-NSI-202607";
const PRODUCT_NAME = process.env.PRODUCT_NAME || "Nano Silver 07/2026";
const FEED_SYMBOLS = (process.env.FEED_SYMBOLS || "F-XACM-NSI-202607,SI5CON26")
  .split(",").map(s => s.trim()).filter(Boolean);
const PRICE_WS = process.env.SFVN_PRICE_WS || "wss://client-uat.mapsinfotech.com/v2/ws/maps/price";

const TF_MS = { M1: 60000, M5: 300000, M15: 900000 };
const MAX_CANDLES = 360;
const SIGNAL_COOLDOWN_BARS = 4;

let ws = null;
let wsStatus = "BOOTING";
let lastError = "";
let startedAt = Date.now();
let msgCounter = 0;
let msgPerSec = 0;

let live = {
  displaySymbol: DISPLAY_SYMBOL,
  feedSymbol: "",
  productName: PRODUCT_NAME,
  price: null,
  bid: null,
  ask: null,
  spread: null,
  open: null,
  high: null,
  low: null,
  vol: 0,
  cVol: 0,
  pct: 0,
  ts: null,
  updatedAt: null
};

let candles = { M1: [], M5: [], M15: [] };
let lastPrice = null;
let globalCvd = 0;
let lastSignal = {};
let lastSignalBar = {};

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function decodeBase64Json(s) {
  try { return JSON.parse(Buffer.from(s, "base64").toString("utf8")); }
  catch { return null; }
}

function parseWsPayload(raw) {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return []; }
  const p = msg.payload;
  if (typeof p === "string") {
    const d = decodeBase64Json(p);
    return d ? [d] : [];
  }
  if (Array.isArray(p)) {
    return p.map(x => typeof x === "string" ? decodeBase64Json(x) : x).filter(Boolean);
  }
  if (p && typeof p === "object") return [p];
  return [];
}

function isAcceptedSymbol(s) {
  if (!s) return false;
  return FEED_SYMBOLS.includes(s) || String(s).includes("NSI") || String(s).includes("SI5");
}

function subscribe() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  for (const sym of FEED_SYMBOLS) {
    ws.send(JSON.stringify({
      key: { domainName: "", prefix: "", messageName: "subscribe", suffix: "v1", messageType: "tick_price" },
      payload: `ticker@${sym}`
    }));
  }

  // miniTicker backup, filter inside backend
  ws.send(JSON.stringify({
    key: { domainName: "", prefix: "", messageName: "subscribe", suffix: "v1", messageType: "tick_price" },
    payload: "miniTicker"
  }));
}

function updateCandle(tf, ts, price, tickVol, signedVol, bid, ask) {
  const bucket = Math.floor(ts / TF_MS[tf]) * TF_MS[tf];
  const arr = candles[tf];
  let c = arr[arr.length - 1];

  if (!c || c.time !== bucket) {
    c = {
      time: bucket,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: Math.max(1, tickVol),
      delta: signedVol,
      bid,
      ask
    };
    arr.push(c);
    if (arr.length > MAX_CANDLES) arr.shift();
    return;
  }

  c.high = Math.max(c.high, price);
  c.low = Math.min(c.low, price);
  c.close = price;
  c.volume += Math.max(1, tickVol);
  c.delta += signedVol;
  c.bid = bid;
  c.ask = ask;
}

function applyTick(tick) {
  if (!isAcceptedSymbol(tick.s)) return;

  const price = n(tick.lt ?? tick.c ?? tick.price ?? tick.last, NaN);
  if (!Number.isFinite(price) || price <= 0) return;

  const bid = n(tick.b ?? tick.bid, price);
  const ask = n(tick.a ?? tick.ask, price);
  const spread = Math.max(0, ask - bid);

  // Reject obvious wrong-scale ticks if current session is already around 70-80
  if (lastPrice && lastPrice > 40 && price < 20) return;
  if (lastPrice && lastPrice < 20 && price > 40) return;

  const open = n(tick.o, price);
  const high = n(tick.h, price);
  const low = n(tick.l, price);
  const cVol = n(tick.cVol ?? tick.q, 0);
  const volRaw = n(tick.vol ?? tick.v, 0);
  const pct = n(tick.p, 0);
  const rawT = Number(tick.t);
  const ts = Number.isFinite(rawT) && rawT > 1e15 ? Math.floor(rawT / 1e6) : Date.now();

  const direction = lastPrice == null ? 0 : price > lastPrice ? 1 : price < lastPrice ? -1 : 0;
  const tickVol = volRaw > 0 ? Math.min(volRaw, 5000) : 1;
  const signedVol = direction * tickVol;
  globalCvd += signedVol;
  lastPrice = price;

  live = {
    displaySymbol: DISPLAY_SYMBOL,
    feedSymbol: tick.s || "",
    productName: PRODUCT_NAME,
    price, bid, ask, spread,
    open, high, low,
    vol: tickVol,
    cVol,
    pct,
    ts,
    updatedAt: new Date().toISOString()
  };

  Object.keys(TF_MS).forEach(tf => updateCandle(tf, ts, price, tickVol, signedVol, bid, ask));
}

function calcEMA(vals, period = 21) {
  if (!vals.length) return 0;
  const k = 2 / (period + 1);
  let e = vals[0];
  for (let i = 1; i < vals.length; i++) e = vals[i] * k + e * (1 - k);
  return e;
}

function calcRSI(vals, period = 14) {
  if (vals.length < period + 1) return 50;
  const arr = vals.slice(-period - 1);
  let gain = 0, loss = 0;
  for (let i = 1; i < arr.length; i++) {
    const d = arr[i] - arr[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  if (loss === 0) return 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

function calcATR(c, period = 14) {
  if (c.length < period + 1) return 0;
  const arr = c.slice(-period - 1);
  const tr = [];
  for (let i = 1; i < arr.length; i++) {
    const cur = arr[i], prev = arr[i - 1];
    tr.push(Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close)));
  }
  return tr.reduce((a, b) => a + b, 0) / tr.length;
}

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a,b)=>a+b,0)/arr.length;
}

function stdev(arr) {
  if (arr.length < 2) return 0;
  const m = avg(arr);
  return Math.sqrt(avg(arr.map(x => (x-m)*(x-m))));
}

function buildIndicators(tf = "M5") {
  const c = candles[tf] || [];
  const len = c.length;
  const closes = c.map(x => x.close);
  const highs = c.map(x => x.high);
  const lows = c.map(x => x.low);
  const deltas = c.map(x => x.delta);
  const vols = c.map(x => x.volume);
  const last = c[len - 1];

  if (!last || len < 5) {
    return {
      tf, signal: "WAIT", reason: "WAITING REALTIME CANDLES",
      score: 0, smn: 0, power: 0, delta: 0, rsi: 50, atr: 0, phase: "RANGING",
      sideway: true, grade: "WAIT", tp: null, sl: null, candles: len, globalCvd
    };
  }

  const rsi = calcRSI(closes);
  const atr = calcATR(c);
  const delta = last.delta;
  const smn = c.slice(-60).reduce((s,x)=>s+x.delta,0);
  const emaDelta = calcEMA(deltas.slice(-80), 21);
  const powerRaw = delta - emaDelta;

  const recentRanges = c.slice(-20).map(x => Math.max(0, x.high - x.low));
  const avgRange = avg(recentRanges);
  const avgVol = Math.max(1, avg(vols.slice(-30)));
  const volRatio = last.volume / avgVol;
  const deltaStd = Math.max(1, stdev(deltas.slice(-60)));
  const powerNorm = Math.min(1, Math.abs(powerRaw) / (deltaStd * 1.8));
  const deltaNorm = Math.min(1, Math.abs(delta) / (deltaStd * 1.3));
  const volNorm = Math.min(1, Math.max(0, volRatio - 0.7) / 1.4);
  const rsiNorm = Math.min(1, Math.abs(rsi - 50) / 22);

  const atrPct = live.price ? atr / live.price : 0;
  const sideway = len < 20 || atrPct < 0.00018 || avgRange < Math.max(live.spread || 0, 0.0001) * 1.6;

  let phase = "RANGING";
  if (!sideway && smn > deltaStd * 2 && powerRaw > 0) phase = "ACCUMULATION";
  if (!sideway && smn < -deltaStd * 2 && powerRaw < 0) phase = "DISTRIBUTION";
  if (!sideway && Math.abs(powerRaw) > deltaStd * 1.5) phase = powerRaw > 0 ? "MARKUP" : "MARKDOWN";

  const baseScore = (powerNorm * 0.36 + deltaNorm * 0.28 + volNorm * 0.18 + rsiNorm * 0.18) * 100;
  const score = sideway ? Math.min(35, baseScore) : Math.round(Math.max(0, Math.min(92, baseScore)));

  let candidate = "WAIT";
  let reason = "WAITING FOR CONFIRM";

  const buyOK = !sideway && score >= 64 && powerRaw > 0 && delta > 0 && smn >= 0 && rsi >= 51 && rsi <= 72;
  const sellOK = !sideway && score >= 64 && powerRaw < 0 && delta < 0 && smn <= 0 && rsi <= 49 && rsi >= 28;

  if (buyOK) {
    candidate = "BUY";
    reason = "SMN + POWER + DELTA BUY CONFIRM";
  } else if (sellOK) {
    candidate = "SELL";
    reason = "SMN + POWER + DELTA SELL CONFIRM";
  } else if (sideway) {
    reason = "SIDEWAY / ATR LOW — NO TRADE";
  } else if ((powerRaw > 0 && delta < 0) || (powerRaw < 0 && delta > 0)) {
    reason = "FLOW / DELTA NGƯỢC CHIỀU";
  } else if (score < 64) {
    reason = "AI POWER CHƯA ĐỦ MẠNH";
  }

  const barKey = last.time;
  const prevSignal = lastSignal[tf] || "WAIT";
  const prevBar = lastSignalBar[tf] || 0;
  let signal = candidate;

  // Anti-spam: only allow reversal or new signal after cooldown bars.
  const currentIndex = c.length - 1;
  const lastIndex = c.findIndex(x => x.time === prevBar);
  const barsSince = lastIndex >= 0 ? currentIndex - lastIndex : 999;

  if (candidate !== "WAIT") {
    if (prevSignal !== "WAIT" && prevSignal !== candidate && barsSince < SIGNAL_COOLDOWN_BARS) {
      signal = "WAIT";
      reason = `COOLDOWN ${SIGNAL_COOLDOWN_BARS - barsSince} BAR — CHỐNG ĐẢO LỆNH`;
    } else {
      lastSignal[tf] = candidate;
      lastSignalBar[tf] = barKey;
    }
  } else if (prevSignal !== "WAIT" && barsSince >= SIGNAL_COOLDOWN_BARS) {
    lastSignal[tf] = "WAIT";
  }

  const price = live.price || 0;
  const tp = signal === "BUY" ? price + atr * 2 : signal === "SELL" ? price - atr * 2 : null;
  const sl = signal === "BUY" ? price - atr * 1.2 : signal === "SELL" ? price + atr * 1.2 : null;
  const grade = score >= 80 ? "A STRONG" : score >= 64 ? "B GOOD" : score >= 45 ? "C WATCH" : "WAIT";

  return {
    tf, signal, rawSignal: candidate, reason,
    score,
    smn: Number(smn.toFixed(2)),
    power: Number(powerRaw.toFixed(2)),
    delta: Number(delta.toFixed(2)),
    rsi: Number(rsi.toFixed(1)),
    atr: Number(atr.toFixed(4)),
    phase, sideway, grade,
    tp: tp == null ? null : Number(tp.toFixed(4)),
    sl: sl == null ? null : Number(sl.toFixed(4)),
    candles: len,
    globalCvd: Number(globalCvd.toFixed(2)),
    volRatio: Number(volRatio.toFixed(2)),
    barsSinceSignal: barsSince
  };
}

function connect() {
  wsStatus = "CONNECTING";
  ws = new WebSocket(PRICE_WS);

  ws.on("open", () => {
    wsStatus = "LIVE";
    lastError = "";
    subscribe();
    console.log("[VYRO V34] SFVN connected", PRICE_WS, FEED_SYMBOLS);
  });

  ws.on("message", raw => {
    msgCounter++;
    parseWsPayload(raw).forEach(applyTick);
  });

  ws.on("error", err => {
    wsStatus = "ERROR";
    lastError = err.message;
    console.error("[VYRO V34] WS error", err.message);
  });

  ws.on("close", (code, reason) => {
    wsStatus = "RECONNECTING";
    lastError = `closed ${code} ${reason || ""}`;
    console.warn("[VYRO V34] WS closed", code, reason.toString());
    setTimeout(connect, 3000);
  });
}

setInterval(() => {
  msgPerSec = msgCounter;
  msgCounter = 0;
}, 1000);

connect();

app.get("/api/health", (req,res) => {
  res.json({ok:true, status:wsStatus, msgPerSec, uptime:Math.floor((Date.now()-startedAt)/1000), lastError, feedSymbols:FEED_SYMBOLS});
});

app.get("/api/live", (req,res) => {
  const tf = String(req.query.tf || "M5").toUpperCase();
  const safeTf = TF_MS[tf] ? tf : "M5";
  res.json({
    status: wsStatus,
    msgPerSec,
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    live,
    indicators: buildIndicators(safeTf),
    lastError
  });
});

app.get("/api/candles", (req,res) => {
  const tf = String(req.query.tf || "M5").toUpperCase();
  res.json(candles[TF_MS[tf] ? tf : "M5"]);
});

app.use(express.static(path.join(__dirname, "../frontend")));
app.get("*", (req,res) => res.sendFile(path.join(__dirname, "../frontend/index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("[VYRO V34] running on", PORT));
