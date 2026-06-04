
const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json({ limit: "12mb" }));

const PORT = process.env.PORT || 3000;
const BRIDGE_KEY = process.env.VYRO_BRIDGE_KEY || "vyro-local-bridge-key";

let startedAt = Date.now();
let currentTimeframe = "M1";
let packets = 0;
let lastBridgeAt = 0;

let state = {
  status: "WAITING_BRIDGE",
  source: "MT5_FULL_CORE",
  symbol: "NONE",
  timeframe: "M1",
  mode: "WAITING",
  candles: [],
  volume: [],
  ema8: [],
  ema21: [],
  ema50: [],
  vpHistogram: [],
  vpoc: null,
  vah: null,
  val: null,
  hvn: null,
  lvn: null,
  lastCandle: null,
  metrics: {
    trend: "NEUTRAL",
    pressure: "NEUTRAL",
    signal: "WAIT",
    action: "WAIT CONFIRM",
    confidence: 0,
    rsi: 50,
    atr: 0,
    smn: 0,
    power: 0,
    delta: 0,
    vpBias: "NEUTRAL",
    grade: "WAIT",
    reason: "Waiting Python bridge"
  },
  lastError: "",
  updatedAt: null
};

function auth(req, res, next) {
  const key = req.headers["x-vyro-key"] || req.query.key;
  if (BRIDGE_KEY && key !== BRIDGE_KEY) return res.status(401).json({ ok: false, error: "unauthorized" });
  next();
}

app.get("/api/timeframe", (req, res) => res.json({ ok: true, timeframe: currentTimeframe }));

app.post("/api/timeframe", (req, res) => {
  const tf = String((req.body && req.body.timeframe) || "M1").toUpperCase();
  const allowed = ["M1", "M5", "M15", "H1"];
  if (!allowed.includes(tf)) return res.status(400).json({ ok: false, error: "invalid timeframe" });
  currentTimeframe = tf;
  state.timeframe = tf;
  state.status = "SWITCHING_TIMEFRAME";
  state.candles = [];
  state.volume = [];
  state.ema8 = [];
  state.ema21 = [];
  state.ema50 = [];
  state.vpHistogram = [];
  state.lastCandle = null;
  res.json({ ok: true, timeframe: currentTimeframe });
});

app.post("/api/bridge/chart", auth, (req, res) => {
  const p = req.body || {};
  packets++;
  lastBridgeAt = Date.now();
  if (p.timeframe) currentTimeframe = String(p.timeframe).toUpperCase();

  const candles = Array.isArray(p.candles) ? p.candles : [];

  // DATA GUARD:
  // Khi MT5 vừa bật/reconnect, copy_rates có thể trả rỗng hoặc rất ít nến.
  // Không cho packet rỗng ghi đè làm mất chart đang có.
  if (candles.length < 50) {
    state.status = state.candles && state.candles.length ? "LIVE_HOLD_LAST_GOOD" : "WAITING_DATA";
    state.lastError = p.error || `ignored short packet: ${candles.length} candles`;
    state.updatedAt = new Date().toISOString();
    return res.json({ ok: true, ignored: true, reason: "short_or_empty_candles", candles: candles.length, packets, timeframe: currentTimeframe });
  }

  state = {
    status: "LIVE",
    source: "SFVN_AI_AGENT_FULL_CORE",
    symbol: p.symbol || "NANO SILVER",
    timeframe: p.timeframe || currentTimeframe,
    mode: p.mode || "LIVE",
    candles,
    volume: Array.isArray(p.volume) ? p.volume : [],
    ema8: Array.isArray(p.ema8) ? p.ema8 : [],
    ema21: Array.isArray(p.ema21) ? p.ema21 : [],
    ema50: Array.isArray(p.ema50) ? p.ema50 : [],
    vpHistogram: Array.isArray(p.vpHistogram) ? p.vpHistogram : [],
    vpoc: p.vpoc ?? null,
    vah: p.vah ?? null,
    val: p.val ?? null,
    hvn: p.hvn ?? null,
    lvn: p.lvn ?? null,
    lastCandle: candles.length ? candles[candles.length - 1] : null,
    metrics: p.metrics || state.metrics,
    lastError: p.error || "",
    updatedAt: new Date().toISOString()
  };
  res.json({ ok: true, packets, timeframe: currentTimeframe, candles: candles.length });
});

app.get("/api/live", (req, res) => {
  const ageMs = lastBridgeAt ? Date.now() - lastBridgeAt : null;
  res.json({
    ok: true,
    mode: "SFVN_AI_AGENT_V65",
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    serverTime: new Date().toISOString(),
    timeframe: currentTimeframe,
    bridge: { packets, status: ageMs != null && ageMs < 15000 ? "LIVE" : "STALE", ageMs },
    chart: state
  });
});

app.use(express.static(path.join(__dirname, "../frontend")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "../frontend/index.html")));
app.listen(PORT, () => console.log("[SFVN AI AGENT V65] Data Guard running", PORT));
