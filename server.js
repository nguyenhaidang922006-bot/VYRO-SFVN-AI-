// VYRO SFVN STANDALONE V1
// Deploy riêng GitHub + Render.
// Env bắt buộc:
//   SFVN_TOKEN=Bearer eyJ...
// Env tùy chọn:
//   SFVN_BASE=https://remote.sfvn-invest.com.vn/api/v2

const express = require("express");
const path = require("path");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

const PORT = process.env.PORT || 10000;
const SFVN_BASE = (process.env.SFVN_BASE || "https://remote.sfvn-invest.com.vn/api/v2").replace(/\/$/, "");
const SFVN_TOKEN = process.env.SFVN_TOKEN || "";

function headers() {
  return {
    "accept": "application/json, text/plain, */*",
    "authorization": SFVN_TOKEN.startsWith("Bearer ") ? SFVN_TOKEN : "Bearer " + SFVN_TOKEN,
    "user-agent": "VYRO-SFVN-STANDALONE/1.0"
  };
}

function qs(obj) {
  const p = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") p.set(k, v);
  });
  return p.toString();
}

async function sfvn(endpoint, params = {}) {
  if (!SFVN_TOKEN) throw new Error("Missing SFVN_TOKEN in Render Environment Variables");
  const url = SFVN_BASE + endpoint + (Object.keys(params).length ? "?" + qs(params) : "");
  const r = await fetch(url, { headers: headers() });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!r.ok) throw new Error(data.message || data.error || text || "SFVN API error");
  return data;
}

function unwrap(x) {
  return x && x.data !== undefined ? x.data : x;
}

function normalizeHistory(raw) {
  const d = unwrap(raw);
  const arr = Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : Array.isArray(d?.list) ? d.list : [];
  return arr.map(c => ({
    t: Number(c.timestamp || c.truncTime || c.time || c.createdAt || Date.now()),
    open: Number(c.open ?? c.o ?? c.price ?? 0),
    high: Number(c.high ?? c.h ?? c.price ?? 0),
    low: Number(c.low ?? c.l ?? c.price ?? 0),
    close: Number(c.close ?? c.c ?? c.last ?? c.price ?? 0),
    volume: Number(c.volume ?? c.v ?? c.cumulativeVolume ?? 0),
    percentChange: Number(c.percentChange ?? 0)
  })).filter(c => c.close > 0);
}

function normalizeLast(raw) {
  const d = unwrap(raw) || {};
  return {
    timestamp: Number(d.timestamp || d.time || Date.now()),
    symbol: d.symbol || "",
    open: Number(d.open || 0),
    high: Number(d.high || 0),
    low: Number(d.low || 0),
    last: Number(d.last || d.close || d.price || 0),
    bid: Number(d.bid || 0),
    ask: Number(d.ask || 0),
    volume: Number(d.volume || 0),
    cumulativeVolume: Number(d.cumulativeVolume || 0),
    percentChange: Number(d.percentChange || 0)
  };
}

function normalizeTrades(raw) {
  const d = unwrap(raw);
  const arr = Array.isArray(d) ? d : Array.isArray(d?.list) ? d.list : Array.isArray(d?.data) ? d.data : [];
  return arr.map(t => ({
    tradeId: t.tradeId || t.id || "",
    timestamp: Number(t.createdAt || t.updatedAt || t.timestamp || Date.now()),
    symbol: t.symbol || "",
    side: Number(t.side || 0),
    price: Number(t.price || 0),
    volume: Number(t.volume || t.quantity || t.qty || 1)
  })).filter(t => t.price > 0);
}

function aiEngine(candles, last, trades) {
  const price = last.last || candles.at(-1)?.close || 0;
  const prev = candles.at(-2)?.close || price;
  const slice = candles.slice(-60);
  const hi = Math.max(...slice.map(x => x.high || x.close), price);
  const lo = Math.min(...slice.map(x => x.low || x.close), price);
  const range = Math.max(hi - lo, 0.000001);

  let buyVol = 0, sellVol = 0;
  trades.slice(0, 100).forEach(t => {
    if (t.side === 1) buyVol += t.volume || 1;
    else if (t.side === 2) sellVol += t.volume || 1;
  });

  const delta = buyVol - sellVol;
  const flow = buyVol + sellVol;
  const spread = last.ask && last.bid ? last.ask - last.bid : 0;
  const structure = price >= prev ? "BULLISH" : "BEARISH";
  const bosChoch = Math.abs(price - prev) > range * 0.08 ? (price > prev ? "BOS BUY" : "BOS SELL") : "WAITING";
  const liquidity = price <= lo + range * 0.18 ? "SSL BELOW / SELL SIDE LIQUIDITY" :
                    price >= hi - range * 0.18 ? "BSL ABOVE / BUY SIDE LIQUIDITY" : "MID RANGE";
  const stopHunt = price < lo || price > hi ? "ARMED" : "WAITING";
  const signal = delta > 0 && structure === "BULLISH" ? "BUY" :
                 delta < 0 && structure === "BEARISH" ? "SELL" : "WAIT";
  const confidence = Math.min(95, Math.max(45, 55 + Math.abs(delta) * 3 + (bosChoch !== "WAITING" ? 10 : 0)));

  return {
    price, bid: last.bid, ask: last.ask, spread,
    signal, confidence, structure, trend: structure,
    bosChoch, liquidity, stopHunt,
    sellZone: hi, buyZone: lo,
    delta, flow, buyVol, sellVol,
    tp1: signal === "BUY" ? price + range * 0.25 : signal === "SELL" ? price - range * 0.25 : null,
    tp2: signal === "BUY" ? price + range * 0.45 : signal === "SELL" ? price - range * 0.45 : null,
    tp3: signal === "BUY" ? price + range * 0.70 : signal === "SELL" ? price - range * 0.70 : null,
    sl: signal === "BUY" ? lo : signal === "SELL" ? hi : null,
    risk: spread > range * 0.06 ? "High" : "Medium",
    action: signal === "WAIT" ? "Wait confirm" : "Follow setup"
  };
}

function tradeSymbol(symbol) {
  // V1: với hàng hóa SFVN hiện đang thấy recent-trades dùng F-XACM-NCP-2026.
  // Sau này map nhiều mã ở đây.
  if (symbol === "CP2CON26") return "F-XACM-NCP-2026";
  return symbol.startsWith("F-") ? symbol : "F-XACM-NCP-2026";
}

async function snapshot(symbol) {
  const [hRaw, lRaw, tRaw] = await Promise.all([
    sfvn("/prices/history", {
      symbol,
      period: "hour",
      factor: "middle_ask_bid",
      timezone: "Asia/Jerusalem",
      source: "ACM"
    }),
    sfvn("/prices/last", { symbol, source: "ACM" }),
    sfvn("/trades/recent-trades", { symbol: tradeSymbol(symbol) }).catch(() => ({ data: { list: [] } }))
  ]);

  const history = normalizeHistory(hRaw);
  const last = normalizeLast(lRaw);
  const trades = normalizeTrades(tRaw);
  const ai = aiEngine(history, last, trades);

  return {
    ok: true,
    service: "VYRO SFVN STANDALONE V1",
    mode: "REST_POLLING",
    symbol,
    time: new Date().toISOString(),
    history,
    last,
    trades,
    ai
  };
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "VYRO SFVN STANDALONE V1",
    tokenLoaded: !!SFVN_TOKEN,
    base: SFVN_BASE,
    time: new Date().toISOString()
  });
});

app.get("/api/snapshot", async (req, res) => {
  try { res.json(await snapshot(req.query.symbol || "CP2CON26")); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get("/api/stream", async (req, res) => {
  const symbol = req.query.symbol || "CP2CON26";
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  const send = async () => {
    try {
      const s = await snapshot(symbol);
      res.write("event: snapshot\\ndata: " + JSON.stringify(s) + "\\n\\n");
    } catch (e) {
      res.write("event: error\\ndata: " + JSON.stringify({ ok: false, error: e.message }) + "\\n\\n");
    }
  };

  await send();
  const timer = setInterval(send, 1500);
  req.on("close", () => clearInterval(timer));
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

app.listen(PORT, () => console.log("VYRO SFVN STANDALONE V1 running on " + PORT));
