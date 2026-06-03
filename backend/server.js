
const express = require("express");
const cors = require("cors");
const path = require("path");
const WebSocket = require("ws");

const app = express();
app.use(cors());
app.use(express.json());

// ===== VYRO NSI CONFIG =====
// Main display symbol is the real terminal symbol.
// Some feeds may push the short exchange symbol SI5CON26, so we subscribe both internally.
// UI still shows one product only: Nano Silver 07/2026.
const DISPLAY_SYMBOL = process.env.DISPLAY_SYMBOL || "F-XACM-NSI-202607";
const FEED_SYMBOLS = (process.env.FEED_SYMBOLS || "F-XACM-NSI-202607,SI5CON26")
  .split(",").map(s => s.trim()).filter(Boolean);
const PRODUCT_NAME = process.env.PRODUCT_NAME || "Nano Silver 07/2026";
const PRICE_WS = process.env.SFVN_PRICE_WS || "wss://client-uat.mapsinfotech.com/v2/ws/maps/price";

const MAX_CANDLES = 600;
const TF_MS = { M1: 60_000, M5: 300_000, M15: 900_000 };

let ws = null;
let wsStatus = "BOOTING";
let reconnectTimer = null;
let msgPerSec = 0;
let msgCounter = 0;
let lastError = "";
let startTime = Date.now();

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
let tickTape = [];
let cvd = 0;
let lastPrice = null;

function decodeBase64Json(base64Str) {
  try {
    return JSON.parse(Buffer.from(base64Str, "base64").toString("utf8"));
  } catch (e) {
    return null;
  }
}

function decodeSocketMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch (e) {
    return [];
  }

  const payload = msg.payload;

  if (typeof payload === "string") {
    const decoded = decodeBase64Json(payload);
    return decoded ? [decoded] : [];
  }

  if (Array.isArray(payload)) {
    return payload.map(x => typeof x === "string" ? decodeBase64Json(x) : x).filter(Boolean);
  }

  if (payload && typeof payload === "object") return [payload];
  return [];
}

function subscribe(ws) {
  for (const sym of FEED_SYMBOLS) {
    ws.send(JSON.stringify({
      key: {
        domainName: "",
        prefix: "",
        messageName: "subscribe",
        suffix: "v1",
        messageType: "tick_price"
      },
      payload: `ticker@${sym}`
    }));
  }

  // Also subscribe miniTicker as a backup; backend filters accepted silver symbols only.
  ws.send(JSON.stringify({
    key: {
      domainName: "",
      prefix: "",
      messageName: "subscribe",
      suffix: "v1",
      messageType: "tick_price"
    },
    payload: "miniTicker"
  }));
}

function isAcceptedSymbol(s) {
  if (!s) return false;
  return FEED_SYMBOLS.includes(s) || s.includes("NSI") || s.includes("SI5");
}

function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function applyTick(tick) {
  if (!isAcceptedSymbol(tick.s)) return;

  const price = toNumber(tick.lt ?? tick.c ?? tick.price ?? tick.last);
  const bid = toNumber(tick.b ?? tick.bid, price);
  const ask = toNumber(tick.a ?? tick.ask, price);
  const vol = Math.max(0, toNumber(tick.vol ?? tick.v, 0));
  const cVol = Math.max(0, toNumber(tick.cVol ?? tick.q, 0));
  const pct = toNumber(tick.p, 0);
  const open = toNumber(tick.o, price);
  const high = toNumber(tick.h, price);
  const low = toNumber(tick.l, price);
  const tsNano = Number(tick.t);
  const ts = Number.isFinite(tsNano) && tsNano > 1e15 ? Math.floor(tsNano / 1e6) : Date.now();

  const direction = lastPrice == null ? 0 : price > lastPrice ? 1 : price < lastPrice ? -1 : 0;
  const signedVol = direction * (vol || 1);
  cvd += signedVol;

  live = {
    displaySymbol: DISPLAY_SYMBOL,
    feedSymbol: tick.s,
    productName: PRODUCT_NAME,
    price,
    bid,
    ask,
    spread: Math.max(0, ask - bid),
    open,
    high,
    low,
    vol,
    cVol,
    pct,
    ts,
    updatedAt: new Date().toISOString()
  };

  lastPrice = price;

  const tapeItem = {
    ts,
    price,
    bid,
    ask,
    vol: vol || 1,
    signedVol,
    cvd
  };
  tickTape.push(tapeItem);
  if (tickTape.length > 1000) tickTape.shift();

  for (const tf of Object.keys(TF_MS)) {
    updateCandle(tf, ts, price, vol || 1, signedVol, bid, ask);
  }
}

function updateCandle(tf, ts, price, vol, signedVol, bid, ask) {
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
      volume: vol,
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
  c.volume += vol;
  c.delta += signedVol;
  c.bid = bid;
  c.ask = ask;
}

function rsi(values, period = 14) {
  if (values.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function atr(c, period = 14) {
  if (c.length < period + 1) return 0;
  const recent = c.slice(-period - 1);
  let trs = [];
  for (let i = 1; i < recent.length; i++) {
    const cur = recent[i], prev = recent[i - 1];
    trs.push(Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close)));
  }
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

function ema(values, period = 21) {
  if (!values.length) return 0;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function buildIndicators(tf = "M1") {
  const c = candles[tf] || [];
  const closes = c.map(x => x.close);
  const deltas = c.map(x => x.delta);
  const volumes = c.map(x => x.volume);
  const cur = c[c.length - 1];

  const currentRsi = rsi(closes);
  const currentAtr = atr(c);
  const delta = cur ? cur.delta : 0;
  const smn = c.slice(-80).reduce((s, x) => s + x.delta, 0);
  const emaDelta = ema(deltas, 21);
  const power = delta - emaDelta;
  const avgVol = volumes.length ? volumes.slice(-30).reduce((s, v) => s + v, 0) / Math.min(30, volumes.length) : 1;
  const volRatio = cur ? cur.volume / Math.max(avgVol, 1) : 0;

  let phase = "RANGING";
  if (smn > 0 && power > 0 && volRatio > 1.1) phase = "ACCUMULATION";
  if (smn < 0 && power < 0 && volRatio > 1.1) phase = "DISTRIBUTION";
  if (Math.abs(power) > Math.max(3, avgVol * 0.25)) phase = power > 0 ? "MARKUP" : "MARKDOWN";

  let signal = "WAIT";
  let reason = "WAITING FOR CONFIRM";
  if (power > 0 && delta > 0 && currentRsi < 72 && phase !== "DISTRIBUTION") {
    signal = "BUY";
    reason = "SMN + POWER + DELTA BUY CONFIRM";
  } else if (power < 0 && delta < 0 && currentRsi > 28 && phase !== "ACCUMULATION") {
    signal = "SELL";
    reason = "SMN + POWER + DELTA SELL CONFIRM";
  }

  const score = Math.max(0, Math.min(100,
    Math.abs(power) * 8 + Math.abs(delta) * 3 + Math.abs(currentRsi - 50) * 1.2 + volRatio * 12
  ));

  const price = live.price || 0;
  const tp = signal === "BUY" ? price + currentAtr * 2 : signal === "SELL" ? price - currentAtr * 2 : null;
  const sl = signal === "BUY" ? price - currentAtr * 1.2 : signal === "SELL" ? price + currentAtr * 1.2 : null;
  const grade = score > 75 ? "A STRONG" : score > 60 ? "B GOOD" : score > 45 ? "C WATCH" : "WAIT";

  return {
    tf,
    signal,
    reason,
    score: Number(score.toFixed(0)),
    smn: Number(smn.toFixed(2)),
    power: Number(power.toFixed(2)),
    delta: Number(delta.toFixed(2)),
    rsi: Number(currentRsi.toFixed(1)),
    atr: Number(currentAtr.toFixed(4)),
    phase,
    grade,
    tp: tp == null ? null : Number(tp.toFixed(4)),
    sl: sl == null ? null : Number(sl.toFixed(4)),
    candles: c.length,
    tape: tickTape.length
  };
}

function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  wsStatus = "CONNECTING";
  ws = new WebSocket(PRICE_WS);

  ws.on("open", () => {
    wsStatus = "LIVE";
    lastError = "";
    subscribe(ws);
    console.log("[VYRO] SFVN WS connected:", PRICE_WS, "symbols:", FEED_SYMBOLS.join(","));
  });

  ws.on("message", raw => {
    msgCounter++;
    const ticks = decodeSocketMessage(raw);
    ticks.forEach(applyTick);
  });

  ws.on("error", err => {
    lastError = err.message;
    wsStatus = "ERROR";
    console.error("[VYRO] WS error:", err.message);
  });

  ws.on("close", (code, reason) => {
    wsStatus = "RECONNECTING";
    lastError = `closed ${code} ${reason || ""}`;
    console.warn("[VYRO] WS closed:", code, reason.toString());
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 3000);
  });
}

setInterval(() => {
  msgPerSec = msgCounter;
  msgCounter = 0;
}, 1000);

connect();

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    status: wsStatus,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    msgPerSec,
    displaySymbol: DISPLAY_SYMBOL,
    feedSymbols: FEED_SYMBOLS,
    lastError
  });
});

app.get("/api/live", (req, res) => {
  const tf = String(req.query.tf || "M1").toUpperCase();
  res.json({
    status: wsStatus,
    msgPerSec,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    live,
    indicators: buildIndicators(TF_MS[tf] ? tf : "M1"),
    lastError
  });
});

app.get("/api/candles", (req, res) => {
  const tf = String(req.query.tf || "M1").toUpperCase();
  res.json(candles[TF_MS[tf] ? tf : "M1"]);
});

app.use(express.static(path.join(__dirname, "../frontend")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[VYRO] NSI realtime server running on ${PORT}`));
