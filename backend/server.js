
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
const MICRO_MS = { M1: 5000, M5: 10000, M15: 15000 }; // warm-up chart bars from realtime ticks
const MAX_CANDLES = 360;
const MAX_TICK_JUMP = Number(process.env.MAX_TICK_JUMP || 4.0);
const SIGNAL_COOLDOWN_BARS = 4;

// Nano Silver SFVN calibration
const NSI = {
  point: 0.001,
  decimals: 3,
  atrMinTrade: 0.030,
  atrStrong: 0.150,
  deltaMedium: 5,
  deltaStrong: 9,
  smnMedium: 12,
  smnStrong: 25,
  powerMedium: 6,
  powerBreakout: 10,
  powerStrong: 16,
  rsiBuy: 53,
  rsiSell: 47,
  scalpTpMin: 0.080,
  scalpTpMax: 0.180,
  trendTpMax: 0.400,
  slMin: 0.050,
  slMax: 0.150
};

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
let tickTape = [];
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

// V42: Always use mid(Bid/Ask) first. SFVN last/lt can be stale.
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

function validateTick(tick, price) {
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
    c = { time: bucket, open: price, high: price, low: price, close: price, volume: Math.max(1, tickVol), delta: signedVol, bid, ask, real: true };
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
  const check = validateTick(tick, price);

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

  tickTape.push({ ts, price, bid: safeBid, ask: safeAsk, volume: tickVol, delta: signedVol });
  if (tickTape.length > 1200) tickTape.shift();

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

// Build live micro bars so chart/indicators run immediately before full M5 candle history exists.
function buildMicroCandles(tf = "M5") {
  const ms = MICRO_MS[tf] || 10000;
  const map = new Map();

  for (const t of tickTape) {
    const bucket = Math.floor(t.ts / ms) * ms;
    let c = map.get(bucket);
    if (!c) {
      c = { time: bucket, open: t.price, high: t.price, low: t.price, close: t.price, volume: t.volume, delta: t.delta, bid: t.bid, ask: t.ask, real: false };
      map.set(bucket, c);
    } else {
      c.high = Math.max(c.high, t.price);
      c.low = Math.min(c.low, t.price);
      c.close = t.price;
      c.volume += t.volume;
      c.delta += t.delta;
      c.bid = t.bid;
      c.ask = t.ask;
    }
  }

  let arr = Array.from(map.values()).sort((a, b) => a.time - b.time);

  // If market is slow and only one or two ticks exist, seed tiny flat bars from the first live price.
  if (arr.length < 12 && live.price) {
    const now = Date.now();
    const seed = [];
    for (let i = 16; i >= 1; i--) {
      const p = live.price;
      seed.push({
        time: now - i * ms,
        open: p,
        high: p,
        low: p,
        close: p,
        volume: 1,
        delta: 0,
        bid: live.bid || p,
        ask: live.ask || p,
        real: false
      });
    }
    arr = [...seed, ...arr];
  }

  return arr.slice(-120);
}

function getDisplayCandles(tf = "M5") {
  const real = candles[tf] || [];
  // Need enough bars for chart and indicators. Until enough real candles exist, use live micro bars.
  if (real.length >= 6) return real;
  return buildMicroCandles(tf);
}

function ema(vals, period = 21) {
  if (!vals.length) return 0;
  const k = 2 / (period + 1);
  let e = vals[0];
  for (let i = 1; i < vals.length; i++) e = vals[i] * k + e * (1 - k);
  return e;
}

function rsi(vals, period = 14) {
  if (vals.length < 2) return 50;
  const arr = vals.slice(-(period + 1));
  let gain = 0, loss = 0;
  for (let i = 1; i < arr.length; i++) {
    const d = arr[i] - arr[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  if (gain === 0 && loss === 0) return 50;
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

function atr(c, period = 14) {
  if (c.length < 2) return 0;
  const arr = c.slice(-(period + 1));
  const trs = [];
  for (let i = 1; i < arr.length; i++) {
    const cur = arr[i], prev = arr[i - 1];
    trs.push(Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close)));
  }
  return trs.length ? trs.reduce((a, b) => a + b, 0) / trs.length : 0;
}

function avg(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function stdev(a) {
  if (a.length < 2) return 0;
  const m = avg(a);
  return Math.sqrt(avg(a.map(x => (x - m) * (x - m))));
}


function swingHigh(c, lookback = 8) {
  if (c.length < lookback + 2) return null;
  const arr = c.slice(-lookback - 1, -1);
  return Math.max(...arr.map(x => x.high));
}

function swingLow(c, lookback = 8) {
  if (c.length < lookback + 2) return null;
  const arr = c.slice(-lookback - 1, -1);
  return Math.min(...arr.map(x => x.low));
}


function emaSeries(values, period) {
  const out = [];
  if (!values.length) return out;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 0; i < values.length; i++) {
    if (i === 0) e = values[i];
    else e = values[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}

function emaTrendContext(closes) {
  // Nano Silver SFVN: EMA 8 / EMA 21 reacts better than slow forex EMA.
  const fastP = 8;
  const slowP = 21;
  const fast = emaSeries(closes, fastP);
  const slow = emaSeries(closes, slowP);
  const n = closes.length;

  if (n < 3 || fast.length < 3 || slow.length < 3) {
    return {
      fastPeriod: fastP, slowPeriod: slowP,
      fast: fast[n - 1] || closes[n - 1] || 0,
      slow: slow[n - 1] || closes[n - 1] || 0,
      trend: "NEUTRAL",
      cross: "NONE",
      confirmBuy: false,
      confirmSell: false
    };
  }

  const f0 = fast[n - 1], f1 = fast[n - 2];
  const s0 = slow[n - 1], s1 = slow[n - 2];

  let trend = "NEUTRAL";
  if (f0 > s0) trend = "BULLISH";
  if (f0 < s0) trend = "BEARISH";

  let cross = "NONE";
  if (f1 <= s1 && f0 > s0) cross = "BULLISH CROSS";
  if (f1 >= s1 && f0 < s0) cross = "BEARISH CROSS";

  return {
    fastPeriod: fastP,
    slowPeriod: slowP,
    fast: Number(f0.toFixed(3)),
    slow: Number(s0.toFixed(3)),
    trend,
    cross,
    confirmBuy: trend === "BULLISH" || cross === "BULLISH CROSS",
    confirmSell: trend === "BEARISH" || cross === "BEARISH CROSS"
  };
}


function smartMoneyContext(c, live, delta, pwr, smn, atrVal) {
  const last = c[c.length - 1];
  const prev = c[c.length - 2] || last;
  const sh = swingHigh(c, 10);
  const sl = swingLow(c, 10);

  let bos = "NONE";
  let choch = "NONE";
  let liquidity = "NONE";
  let fakeBreakout = false;
  let stopHunt = "NONE";

  if (sh != null && last.close > sh) bos = "BULLISH BOS";
  if (sl != null && last.close < sl) bos = "BEARISH BOS";

  const prevDir = prev.close >= prev.open ? "UP" : "DOWN";
  const curDir = last.close >= last.open ? "UP" : "DOWN";
  if (prevDir === "DOWN" && curDir === "UP" && delta > 0 && pwr > 0) choch = "BULLISH CHOCH";
  if (prevDir === "UP" && curDir === "DOWN" && delta < 0 && pwr < 0) choch = "BEARISH CHOCH";

  if (sh != null && last.high > sh && last.close < sh) {
    liquidity = "BUY SIDE SWEEP";
    stopHunt = "SELL REVERSAL HUNT";
  }
  if (sl != null && last.low < sl && last.close > sl) {
    liquidity = "SELL SIDE SWEEP";
    stopHunt = "BUY REVERSAL HUNT";
  }

  const spread = live.spread || 0;
  const body = Math.abs(last.close - last.open);
  const range = Math.max(last.high - last.low, NSI.point);
  const weakBody = body / range < 0.35;
  const spreadWide = spread > Math.max(atrVal * 0.65, 0.060);

  if ((bos.includes("BULLISH") && (delta < NSI.deltaMedium || weakBody || spreadWide)) ||
      (bos.includes("BEARISH") && (delta > -NSI.deltaMedium || weakBody || spreadWide))) {
    fakeBreakout = true;
  }

  let bias = "NEUTRAL";
  if ((bos.includes("BULLISH") || choch.includes("BULLISH")) && smn > 0 && pwr > 0) bias = "BULLISH";
  if ((bos.includes("BEARISH") || choch.includes("BEARISH")) && smn < 0 && pwr < 0) bias = "BEARISH";

  return { bos, choch, liquidity, fakeBreakout, stopHunt, bias, swingHigh: sh, swingLow: sl };
}


function buildIndicators(tf = "M5") {
  const c = getDisplayCandles(tf);
  const realCount = (candles[tf] || []).length;
  const len = c.length;
  const last = c[len - 1];

  if (!last || !live.price) {
    return {
      tf, signal: "WAIT", rawSignal: "WAIT", reason: "WAITING REALTIME DATA",
      score: 0, smn: 0, power: 0, delta: 0, rsi: 50, atr: 0, phase: "RANGING",
      sideway: true, grade: "WAIT", tp: null, sl: null, candles: realCount,
      displayCandles: len, globalCvd, acceptedTicks, rejectedTicks, lastRejectReason,
      nsiMode: true
    };
  }

  const closes = c.map(x => x.close);
  const emaTrend = emaTrendContext(closes);
  const deltas = c.map(x => x.delta);
  const vols = c.map(x => x.volume);
  const ranges = c.slice(-20).map(x => Math.max(0, x.high - x.low));

  const r = rsi(closes);
  const atrRaw = atr(c);
  const avgRange = avg(ranges);
  const fallbackAtr = Math.max(live.spread || 0, avgRange, NSI.point * 8);
  const a = atrRaw > 0 ? atrRaw : fallbackAtr;

  const delta = last.delta;
  const smn = c.slice(-40).reduce((s, x) => s + x.delta, 0);
  const pwr = delta - ema(deltas.slice(-50), 13);

  const avgVol = Math.max(1, avg(vols.slice(-25)));
  const volRatio = last.volume / avgVol;

  // Silver-specific score. Values are small but meaningful.
  const atrScore = Math.min(100, (a / NSI.atrStrong) * 100);
  const deltaScore = Math.min(100, (Math.abs(delta) / NSI.deltaStrong) * 100);
  const powerScore = Math.min(100, (Math.abs(pwr) / NSI.powerStrong) * 100);
  const smnScore = Math.min(100, (Math.abs(smn) / NSI.smnStrong) * 100);
  const rsiScore = Math.min(100, Math.abs(r - 50) / 18 * 100);
  const volumeScore = Math.min(100, Math.max(0, volRatio - 0.8) / 1.2 * 100);

  const sideway = len < 12 || a < NSI.atrMinTrade || (Math.abs(pwr) < NSI.powerMedium && Math.abs(delta) < NSI.deltaMedium);
  const rawScore = atrScore * 0.20 + deltaScore * 0.22 + powerScore * 0.26 + smnScore * 0.16 + rsiScore * 0.08 + volumeScore * 0.08;
  const score = sideway ? Math.min(48, Math.round(rawScore)) : Math.round(Math.max(0, Math.min(96, rawScore)));

  let phase = "RANGING";
  if (!sideway && smn > NSI.smnMedium && pwr > NSI.powerMedium) phase = "ACCUMULATION";
  if (!sideway && smn < -NSI.smnMedium && pwr < -NSI.powerMedium) phase = "DISTRIBUTION";
  if (!sideway && Math.abs(pwr) >= NSI.powerBreakout && Math.abs(delta) >= NSI.deltaMedium) {
    phase = pwr > 0 ? "MARKUP" : "MARKDOWN";
  }

  const smc = smartMoneyContext(c, live, delta, pwr, smn, a);

  let candidate = "WAIT";
  let reason = "WAITING FOR CONFIRM";

  const buyOK =
    !sideway &&
    score >= 62 &&
    pwr >= NSI.powerBreakout &&
    delta >= NSI.deltaMedium &&
    smn >= NSI.smnMedium &&
    r >= NSI.rsiBuy &&
    r <= 72 &&
    emaTrend.confirmBuy &&
    !smc.fakeBreakout &&
    smc.bias !== "BEARISH";

  const sellOK =
    !sideway &&
    score >= 62 &&
    pwr <= -NSI.powerBreakout &&
    delta <= -NSI.deltaMedium &&
    smn <= -NSI.smnMedium &&
    r <= NSI.rsiSell &&
    r >= 28 &&
    emaTrend.confirmSell &&
    !smc.fakeBreakout &&
    smc.bias !== "BULLISH";

  if (smc.fakeBreakout) {
    candidate = "WAIT";
    reason = "FAKE BREAKOUT FILTER — NO TRADE";
  } else if (buyOK) {
    candidate = "BUY";
    reason = smc.bos.includes("BULLISH") ? "NSI BUY: BULLISH BOS + FLOW CONFIRM" : "NSI BUY: POWER + DELTA + SMN CONFIRM";
  } else if (sellOK) {
    candidate = "SELL";
    reason = smc.bos.includes("BEARISH") ? "NSI SELL: BEARISH BOS + FLOW CONFIRM" : "NSI SELL: POWER + DELTA + SMN CONFIRM";
  } else if (sideway) {
    reason = realCount < 6 ? "LIVE WARMUP — ĐANG GOM NẾN" : "NSI SIDEWAY / ATR LOW — NO TRADE";
  } else if (pwr > 0 && !emaTrend.confirmBuy) {
    reason = "EMA CHƯA XÁC NHẬN BUY";
  } else if (pwr < 0 && !emaTrend.confirmSell) {
    reason = "EMA CHƯA XÁC NHẬN SELL";
  } else if (Math.abs(pwr) < NSI.powerBreakout) {
    reason = "NSI POWER CHƯA ĐỦ BREAKOUT";
  } else if (Math.abs(delta) < NSI.deltaMedium) {
    reason = "NSI DELTA CHƯA ĐỦ MẠNH";
  } else if ((pwr > 0 && delta < 0) || (pwr < 0 && delta > 0)) {
    reason = "FLOW / DELTA NGƯỢC CHIỀU";
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
  const tpDistRaw = Math.max(NSI.scalpTpMin, Math.min(a * 2.0, phase === "MARKUP" || phase === "MARKDOWN" ? NSI.trendTpMax : NSI.scalpTpMax));
  const slDistRaw = Math.max(NSI.slMin, Math.min(a * 1.2, NSI.slMax));

  const tp = signal === "BUY" ? price + tpDistRaw : signal === "SELL" ? price - tpDistRaw : null;
  const sl = signal === "BUY" ? price - slDistRaw : signal === "SELL" ? price + slDistRaw : null;

  const grade = score >= 80 ? "A STRONG" : score >= 62 ? "B GOOD" : score >= 45 ? "C WATCH" : "WAIT";

  return {
    tf, signal, rawSignal: candidate, reason,
    score,
    confidence: score,
    emaTrend,
    emaFast: emaTrend.fast,
    emaSlow: emaTrend.slow,
    emaCross: emaTrend.cross,
    emaBias: emaTrend.trend,
    emaConfirmBuy: emaTrend.confirmBuy,
    emaConfirmSell: emaTrend.confirmSell,
    smc,
    bos: smc.bos,
    choch: smc.choch,
    liquidity: smc.liquidity,
    fakeBreakout: smc.fakeBreakout,
    stopHunt: smc.stopHunt,
    smartBias: smc.bias,
    swingHigh: smc.swingHigh == null ? null : Number(smc.swingHigh.toFixed(3)),
    swingLow: smc.swingLow == null ? null : Number(smc.swingLow.toFixed(3)),
    smn: Number(smn.toFixed(2)),
    power: Number(pwr.toFixed(2)),
    delta: Number(delta.toFixed(2)),
    rsi: Number(r.toFixed(1)),
    atr: Number(a.toFixed(3)),
    phase, sideway, grade,
    tp: tp == null ? null : Number(tp.toFixed(3)),
    sl: sl == null ? null : Number(sl.toFixed(3)),
    tpDist: Number(tpDistRaw.toFixed(3)),
    slDist: Number(slDistRaw.toFixed(3)),
    candles: realCount,
    displayCandles: len,
    globalCvd: Number(globalCvd.toFixed(2)),
    volRatio: Number(volRatio.toFixed(2)),
    barsSinceSignal: barsSince,
    acceptedTicks,
    rejectedTicks,
    lastRejectReason,
    nsiMode: true,
    point: NSI.point,
    decimals: NSI.decimals
  };
}

function connect() {
  wsStatus = "CONNECTING";
  ws = new WebSocket(PRICE_WS);

  ws.on("open", () => {
    wsStatus = "LIVE";
    lastError = "";
    subscribe();
    console.log("[VYRO V42] connected:", FEED_SYMBOL);
  });

  ws.on("message", raw => {
    msgCounter++;
    parseWsPayload(raw).forEach(applyTick);
  });

  ws.on("error", err => {
    wsStatus = "ERROR";
    lastError = err.message;
    console.error("[VYRO V42] WS error:", err.message);
  });

  ws.on("close", (code, reason) => {
    wsStatus = "RECONNECTING";
    lastError = `closed ${code} ${reason || ""}`;
    console.warn("[VYRO V42] WS closed", code, reason.toString());
    setTimeout(connect, 3000);
  });
}

setInterval(() => {
  msgPerSec = msgCounter;
  msgCounter = 0;
}, 1000);

connect();


function enrichCandlesWithEMA(arr) {
  const closes = arr.map(x => x.close);
  const fast = emaSeries(closes, 8);
  const slow = emaSeries(closes, 21);
  return arr.map((c, i) => ({
    ...c,
    emaFast: fast[i] == null ? null : Number(fast[i].toFixed(3)),
    emaSlow: slow[i] == null ? null : Number(slow[i].toFixed(3))
  }));
}


app.get("/api/health", (req, res) => {
  res.json({
    ok: true, status: wsStatus, msgPerSec,
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    displaySymbol: DISPLAY_SYMBOL, feedSymbol: FEED_SYMBOL,
    lastError, acceptedTicks, rejectedTicks, lastRejectReason,
    tickTape: tickTape.length
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
  const safeTf = TF_MS[tf] ? tf : "M5";
  res.json(enrichCandlesWithEMA(getDisplayCandles(safeTf)));
});

app.use(express.static(path.join(__dirname, "../frontend")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "../frontend/index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("[VYRO V42] running on", PORT));
