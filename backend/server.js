
const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json({ limit: "8mb" }));

const PORT = process.env.PORT || 3000;
const BRIDGE_KEY = process.env.VYRO_BRIDGE_KEY || "vyro-local-bridge-key";

let startedAt = Date.now();
let currentTimeframe = "M1";
let packets = 0;
let lastBridgeAt = 0;

let chartState = {
  status: "WAITING_BRIDGE",
  source: "MT5_CHART_ONLY_DEBUG",
  symbol: "NONE",
  timeframe: "M1",
  mode: "WAITING",
  candles: [],
  candleCount: 0,
  lastCandle: null,
  lastError: "",
  updatedAt: null
};

function auth(req, res, next) {
  const key = req.headers["x-vyro-key"] || req.query.key;
  if (BRIDGE_KEY && key !== BRIDGE_KEY) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
}

app.get("/api/timeframe", (req, res) => {
  res.json({ ok: true, timeframe: currentTimeframe });
});

app.post("/api/timeframe", (req, res) => {
  const tf = String((req.body && req.body.timeframe) || "M1").toUpperCase();
  const allowed = ["M1", "M5", "M15", "H1"];
  if (!allowed.includes(tf)) return res.status(400).json({ ok: false, error: "invalid timeframe" });
  currentTimeframe = tf;
  chartState.timeframe = tf;
  chartState.status = "SWITCHING_TIMEFRAME";
  chartState.candles = [];
  chartState.candleCount = 0;
  chartState.lastCandle = null;
  res.json({ ok: true, timeframe: currentTimeframe });
});

app.post("/api/bridge/chart", auth, (req, res) => {
  const p = req.body || {};
  packets++;
  lastBridgeAt = Date.now();

  if (p.timeframe) currentTimeframe = String(p.timeframe).toUpperCase();

  const candles = Array.isArray(p.candles) ? p.candles : [];
  const lastCandle = candles.length ? candles[candles.length - 1] : null;

  chartState = {
    status: "LIVE",
    source: "MT5_CHART_ONLY_DEBUG",
    symbol: p.symbol || "UNKNOWN",
    timeframe: p.timeframe || currentTimeframe,
    mode: p.mode || "MT5",
    candles,
    candleCount: candles.length,
    lastCandle,
    lastError: p.error || "",
    updatedAt: new Date().toISOString()
  };

  res.json({ ok: true, packets, timeframe: currentTimeframe });
});

app.get("/api/live", (req, res) => {
  const ageMs = lastBridgeAt ? Date.now() - lastBridgeAt : null;
  res.json({
    ok: true,
    mode: "V62_CHART_ONLY_DEBUG",
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    serverTime: new Date().toISOString(),
    timeframe: currentTimeframe,
    bridge: {
      packets,
      status: ageMs != null && ageMs < 15000 ? "LIVE" : "STALE",
      ageMs
    },
    chart: chartState
  });
});

app.use(express.static(path.join(__dirname, "../frontend")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "../frontend/index.html")));

app.listen(PORT, () => console.log("[VYRO V62] Chart Only Debug running", PORT));
