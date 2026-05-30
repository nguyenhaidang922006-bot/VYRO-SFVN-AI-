const express = require("express");
const cors = require("cors");
const path = require("path");
const { fetchTick, buildCandle, getCandles } = require("./services/sfvnTickCandle");
const { buildAI } = require("./services/aiEngine");

const app = express();
app.use(cors());
app.use(express.json());

const SYMBOL = process.env.SFVN_SYMBOL || "CP2CON26";

let cache = {
  ok: true,
  symbol: SYMBOL,
  tick: null,
  candles: [],
  ai: null,
  updatedAt: null,
  errors: []
};

async function refresh(){
  const errors = [];
  try{
    const tick = await fetchTick(SYMBOL);
    buildCandle(tick);
    const candles = getCandles();
    const ai = buildAI(tick, candles);

    cache.tick = tick;
    cache.candles = candles;
    cache.ai = ai;
    cache.updatedAt = new Date().toISOString();
    cache.errors = [];
  }catch(e){
    errors.push(e.message);
    cache.errors = errors;
    cache.updatedAt = new Date().toISOString();
  }
}

refresh();
setInterval(refresh, 2000);

app.get("/health", (req,res)=>res.json({
  ok:true,
  name:"VYRO SFVN AI Backend V3 Tick Candle Engine",
  symbol:SYMBOL,
  updatedAt:cache.updatedAt,
  candles:cache.candles.length,
  errors:cache.errors
}));

app.get("/api/tick", (req,res)=>res.json({ok:true,data:cache.tick,updatedAt:cache.updatedAt,errors:cache.errors}));
app.get("/api/history", (req,res)=>res.json({ok:true,count:cache.candles.length,data:cache.candles,updatedAt:cache.updatedAt,errors:cache.errors}));
app.get("/api/market", (req,res)=>res.json(cache));

app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req,res)=>{
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log("VYRO SFVN V3 running on port", PORT));