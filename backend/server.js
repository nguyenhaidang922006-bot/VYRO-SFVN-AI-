
const express = require("express");
const cors = require("cors");
const path = require("path");
const WebSocket = require("ws");

const app = express();
app.use(cors());
app.use(express.json());

const DISPLAY_SYMBOL = process.env.DISPLAY_SYMBOL || "F-XACM-NSI-202607";
const FEED_SYMBOL = process.env.FEED_SYMBOL || "F-XACM-NSI-202607";
const PRODUCT_NAME = process.env.PRODUCT_NAME || "Nano Silver 07/2026";
const PRICE_WS = process.env.SFVN_PRICE_WS || "wss://client-uat.mapsinfotech.com/v2/ws/maps/price";

const TF_MS = { M1: 60000, M5: 300000, M15: 900000 };
const MAX_CANDLES = 360;
const MAX_TICK_JUMP = Number(process.env.MAX_TICK_JUMP || 4.0);
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
let priceWindow = [];
let lastAcceptedPrice = null;
let globalCvd = 0;
let rejectedTicks = 0;
let acceptedTicks = 0;
let lastRejectReason = "";
let lastSignal = {};
let lastSignalBar = {};

function num(v, fallback = NaN) {
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

function acceptedSymbol(s) {
  return String(s || "") === FEED_SYMBOL;
}

function subscribe() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    key: {
      domainName: "",
      prefix: "",
      messageName: "subscribe",
      suffix: "v1",
      messageType: "tick_price"
    },
    payload: `ticker@${FEED_SYMBOL}`
  }));
}

function median(arr) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// IMPORTANT V37:
// Do NOT use lt/last as display price for SFVN NSI.
// Use bid/ask mid price because lt can be stale or from another internal feed.
function normalizeTick(tick) {
  const bid = num(tick.b ?? tick.bid);
  const ask = num(tick.a ?? tick.ask);
  const last = num(tick.lt ?? tick.c ?? tick.price ?? tick.last);

  let price = NaN;
  if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 20 && ask > 20) {
    price = (bid + ask) / 2;
  } else if (Number.isFinite(last) && last > 20) {
    price = last;
  }

  return { price, bid, ask, last };
}

function validateTick(tick, price, bid, ask) {
  if (!acceptedSymbol(tick.s)) return { ok: false, reason: "symbol_mismatch" };
  if (!Number.isFinite(price) || price <= 0) return { ok: false, reason: "bad_price" };

  if (price < 20) return { ok: false, reason: "wrong_scale_low" };
  if (price > 200) return { ok: false, reason: "wrong_scale_high" };

  const med = median(priceWindow);
  if (med !== null && priceWindow.length >= 8 && Math.abs(price - med) > MAX_TICK_JUMP) {
    return { ok: false, reason: "jump_vs_median" };
  }

  if (lastAcceptedPrice !== null && Math.abs(price - lastAcceptedPrice) > MAX_TICK_JUMP) {
    return { ok: false, reason: "jump_vs_last" };
  }

  return { ok: true, reason: "" };
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
  const { price, bid, ask, last } = normalizeTick(tick);
  const check = validateTick(tick, price, bid, ask);

  if (!check.ok) {
    rejectedTicks++;
    lastRejectReason = `${check.reason}: ${tick.s || ""} price=${Number.isFinite(price) ? price : "NaN"} last=${Number.isFinite(last) ? last : "NaN"}`;
    lastError = `reject ${lastRejectReason}`;
    return;
  }

  acceptedTicks++;
  lastError = "";

  const safeBid = Number.isFinite(bid) && bid > 0 ? bid : price;
  const safeAsk = Number.isFinite(ask) && ask > 0 ? ask : price;
  const open = num(tick.o, price);
  const high = num(tick.h, price);
  const low = num(tick.l, price);
  const cVol = num(tick.cVol ?? tick.q, 0);
  const volRaw = num(tick.vol ?? tick.v, 0);
  const pct = num(tick.p, 0);
  const rawT = Number(tick.t);
  const ts = Number.isFinite(rawT) && rawT > 1e15 ? Math.floor(rawT / 1e6) : Date.now();

  const direction = lastAcceptedPrice == null ? 0 : price > lastAcceptedPrice ? 1 : price < lastAcceptedPrice ? -1 : 0;
  const tickVol = Number.isFinite(volRaw) && volRaw > 0 ? Math.min(volRaw, 5000) : 1;
  const signedVol = direction * tickVol;
  globalCvd += signedVol;
  lastAcceptedPrice = price;

  priceWindow.push(price);
  if (priceWindow.length > 30) priceWindow.shift();

  live = {
    displaySymbol: DISPLAY_SYMBOL,
    feedSymbol: tick.s || "",
    productName: PRODUCT_NAME,
    price,
    bid: safeBid,
    ask: safeAsk,
    spread: Math.abs(safeAsk - safeBid),
    open: Number.isFinite(open) ? open : price,
    high: Number.isFinite(high) ? high : price,
    low: Number.isFinite(low) ? low : price,
    vol: tickVol,
    cVol: Number.isFinite(cVol) ? cVol : 0,
    pct: Number.isFinite(pct) ? pct : 0,
    ts,
    updatedAt: new Date().toISOString()
  };

  Object.keys(TF_MS).forEach(tf => updateCandle(tf, ts, price, tickVol, signedVol, safeBid, safeAsk));
}

function ema(vals, period = 21) {
  if (!vals.length) return 0;
  const k = 2 / (period + 1);
  let e = vals[0];
  for (let i = 1; i < vals.length; i++) e = vals[i] * k + e * (1 - k);
  return e;
}

function rsi(vals, period = 14) {
  if (vals.length < period + 1) return 50;
  const arr = vals.slice(-period - 1);
  let gain = 0, loss = 0;
  for (let i = 1; i < arr.length; i++) {
    const d = arr[i] - arr[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

function atr(c, period = 14) {
  if (c.length < period + 1) return 0;
  const arr = c.slice(-period - 1);
  const trs = [];
  for (let i = 1; i < arr.length; i++) {
    const cur = arr[i], prev = arr[i - 1];
    trs.push(Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close)));
  }
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

function avg(a) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

function stdev(a) {
  if (a.length < 2) return 0;
  const m = avg(a);
  return Math.sqrt(avg(a.map(x => (x - m) * (x - m))));
}

function buildIndicators(tf = "M5") {
  const c = candles[tf] || [];
  const len = c.length;
  const last = c[len - 1];

  if (!last || len < 5) {
    return {
      tf, signal: "WAIT", rawSignal: "WAIT", reason: "WAITING REALTIME CANDLES",
      score: 0, smn: 0, power: 0, delta: 0, rsi: 50, atr: 0, phase: "RANGING",
      sideway: true, grade: "WAIT", tp: null, sl: null, candles: len, globalCvd,
      acceptedTicks, rejectedTicks, lastRejectReason
    };
  }

  const closes = c.map(x => x.close);
  const deltas = c.map(x => x.delta);
  const vols = c.map(x => x.volume);
  const ranges = c.slice(-20).map(x => Math.max(0, x.high - x.low));

  const r = rsi(closes);
  const a = atr(c);
  const delta = last.delta;
  const smn = c.slice(-60).reduce((s, x) => s + x.delta, 0);
  const pwr = delta - ema(deltas.slice(-80), 21);

  const deltaStd = Math.max(1, stdev(deltas.slice(-60)));
  const avgVol = Math.max(1, avg(vols.slice(-30)));
  const volRatio = last.volume / avgVol;
  const avgRange = avg(ranges);

  const powerNorm = Math.min(1, Math.abs(pwr) / (deltaStd * 1.8));
  const deltaNorm = Math.min(1, Math.abs(delta) / (deltaStd * 1.3));
  const volNorm = Math.min(1, Math.max(0, volRatio - 0.7) / 1.4);
  const rsiNorm = Math.min(1, Math.abs(r - 50) / 22);

  const atrPct = live.price ? a / live.price : 0;
  const sideway = len < 20 || atrPct < 0.00018 || avgRange < Math.max(live.spread || 0, 0.0001) * 1.2;

  let phase = "RANGING";
  if (!sideway && smn > deltaStd * 2 && pwr > 0) phase = "ACCUMULATION";
  if (!sideway && smn < -deltaStd * 2 && pwr < 0) phase = "DISTRIBUTION";
  if (!sideway && Math.abs(pwr) > deltaStd * 1.5) phase = pwr > 0 ? "MARKUP" : "MARKDOWN";

  const rawScore = (powerNorm * 0.36 + deltaNorm * 0.28 + volNorm * 0.18 + rsiNorm * 0.18) * 100;
  const score = sideway ? Math.min(35, Math.round(rawScore)) : Math.round(Math.max(0, Math.min(92, rawScore)));

  let candidate = "WAIT";
  let reason = "WAITING FOR CONFIRM";

  const buyOK = !sideway && score >= 64 && pwr > 0 && delta > 0 && smn >= 0 && r >= 51 && r <= 72;
  const sellOK = !sideway && score >= 64 && pwr < 0 && delta < 0 && smn <= 0 && r <= 49 && r >= 28;

  if (buyOK) {
    candidate = "BUY";
    reason = "SMN + POWER + DELTA BUY CONFIRM";
  } else if (sellOK) {
    candidate = "SELL";
    reason = "SMN + POWER + DELTA SELL CONFIRM";
  } else if (sideway) {
    reason = "SIDEWAY / ATR LOW — NO TRADE";
  } else if ((pwr > 0 && delta < 0) || (pwr < 0 && delta > 0)) {
    reason = "FLOW / DELTA NGƯỢC CHIỀU";
  } else if (score < 64) {
    reason = "AI POWER CHƯA ĐỦ MẠNH";
  }

  const barKey = last.time;
  const prevSignal = lastSignal[tf] || "WAIT";
  const prevBar = lastSignalBar[tf] || 0;
  const currentIndex = c.length - 1;
  const lastIndex = c.findIndex(x => x.time === prevBar);
  const barsSince = lastIndex >= 0 ? currentIndex - lastIndex : 999;

  let signal = candidate;
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
  const tp = signal === "BUY" ? price + a * 2 : signal === "SELL" ? price - a * 2 : null;
  const sl = signal === "BUY" ? price - a * 1.2 : signal === "SELL" ? price + a * 1.2 : null;
  const grade = score >= 80 ? "A STRONG" : score >= 64 ? "B GOOD" : score >= 45 ? "C WATCH" : "WAIT";

  return {
    tf, signal, rawSignal: candidate, reason,
    score,
    smn: Number(smn.toFixed(2)),
    power: Number(pwr.toFixed(2)),
    delta: Number(delta.toFixed(2)),
    rsi: Number(r.toFixed(1)),
    atr: Number(a.toFixed(4)),
    phase, sideway, grade,
    tp: tp == null ? null : Number(tp.toFixed(4)),
    sl: sl == null ? null : Number(sl.toFixed(4)),
    candles: len,
    globalCvd: Number(globalCvd.toFixed(2)),
    volRatio: Number(volRatio.toFixed(2)),
    barsSinceSignal: barsSince,
    acceptedTicks,
    rejectedTicks,
    lastRejectReason
  };
}

function connect() {
  wsStatus = "CONNECTING";
  ws = new WebSocket(PRICE_WS);

  ws.on("open", () => {
    wsStatus = "LIVE";
    lastError = "";
    subscribe();
    console.log("[VYRO V37 FULL] connected:", FEED_SYMBOL);
  });

  ws.on("message", raw => {
    msgCounter++;
    parseWsPayload(raw).forEach(applyTick);
  });

  ws.on("error", err => {
    wsStatus = "ERROR";
    lastError = err.message;
    console.error("[VYRO V37 FULL] WS error:", err.message);
  });

  ws.on("close", (code, reason) => {
    wsStatus = "RECONNECTING";
    lastError = `closed ${code} ${reason || ""}`;
    console.warn("[VYRO V37 FULL] WS closed", code, reason.toString());
    setTimeout(connect, 3000);
  });
}

setInterval(() => {
  msgPerSec = msgCounter;
  msgCounter = 0;
}, 1000);

connect();

app.get("/api/health", (req, res) => {
  res.json({
    ok: true, status: wsStatus, msgPerSec,
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    displaySymbol: DISPLAY_SYMBOL, feedSymbol: FEED_SYMBOL,
    lastError, acceptedTicks, rejectedTicks, lastRejectReason
  });
});

app.get("/api/live", (req, res) => {
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

app.get("/api/candles", (req, res) => {
  const tf = String(req.query.tf || "M5").toUpperCase();
  res.json(candles[TF_MS[tf] ? tf : "M5"]);
});

app.use(express.static(path.join(__dirname, "../frontend")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "../frontend/index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("[VYRO V37 FULL] running on", PORT));
