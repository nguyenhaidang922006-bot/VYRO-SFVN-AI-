const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

const SYMBOL = process.env.SFVN_SYMBOL || "CP2CON26";
const HISTORY_URL = `https://remote.sfvn-invest.com.vn/api/v2/prices/history?symbol=${SYMBOL}&period=hour&factor=middle_ask_bid&timezone=Asia%2FJerusalem&source=ACM`;
const TICK_URL = `https://remote.sfvn-invest.com.vn/api/v1/tick/${SYMBOL}/last`;

let cache = {
  tick: null,
  history: [],
  ai: null,
  updatedAt: null,
  errors: []
};

function n(v){ const x = Number(v); return Number.isFinite(x) ? x : null; }

function calcAI(tick, history){
  const d = tick?.data || tick || {};
  const last = n(d.last);
  const open = n(d.open);
  const high = n(d.high);
  const low = n(d.low);
  const bid = n(d.bid);
  const ask = n(d.ask);
  const cv = n(d.cumulativeVolume) || 0;

  let signal = "WAIT";
  let confidence = 50;
  let bias = "NEUTRAL";

  if(last !== null && open !== null){
    const diff = last - open;
    const range = Math.max(0.00001, (high || last) - (low || last));
    const strength = Math.min(35, Math.abs(diff / range) * 35);

    if(diff > 0){
      signal = "BUY";
      bias = "BULLISH";
      confidence = Math.round(55 + strength);
    } else if(diff < 0){
      signal = "SELL";
      bias = "BEARISH";
      confidence = Math.round(55 + strength);
    }
  }

  const spread = (ask !== null && bid !== null) ? +(ask - bid).toFixed(6) : null;

  return {
    signal,
    confidence,
    bias,
    structure: bias === "BULLISH" ? "Higher pressure" : bias === "BEARISH" ? "Lower pressure" : "Sideway",
    liquidity: cv > 100 ? "ACTIVE" : "LOW",
    stopHunt: "WAIT",
    supply: high || null,
    demand: low || null,
    delta: "basic",
    flow: bias,
    spread
  };
}

async function pullSFVN(){
  const errors = [];

  try{
    const r = await fetch(TICK_URL, {headers: {"user-agent":"VYRO-SFVN-AI/2.0"}});
    cache.tick = await r.json();
  }catch(e){
    errors.push("tick: " + e.message);
  }

  try{
    const r = await fetch(HISTORY_URL, {headers: {"user-agent":"VYRO-SFVN-AI/2.0"}});
    const j = await r.json();
    cache.history = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
  }catch(e){
    errors.push("history: " + e.message);
  }

  cache.ai = calcAI(cache.tick, cache.history);
  cache.updatedAt = new Date().toISOString();
  cache.errors = errors;
}

pullSFVN();
setInterval(pullSFVN, 2000);

app.get("/health", (req,res)=>{
  res.json({ok:true, name:"VYRO SFVN AI Backend", updatedAt:cache.updatedAt, symbol:SYMBOL});
});

app.get("/api/tick", (req,res)=>res.json(cache.tick || {status:"loading"}));
app.get("/api/history", (req,res)=>res.json({statusCode:200,status:"OK",data:cache.history}));
app.get("/api/ai", (req,res)=>res.json({ok:true, data:cache.ai, updatedAt:cache.updatedAt, errors:cache.errors}));
app.get("/api/market", (req,res)=>{
  res.json({
    ok:true,
    symbol:SYMBOL,
    tick:cache.tick?.data || cache.tick,
    history:cache.history,
    ai:cache.ai,
    updatedAt:cache.updatedAt,
    errors:cache.errors
  });
});

app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req,res)=>{
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log("VYRO SFVN AI running on port", PORT));