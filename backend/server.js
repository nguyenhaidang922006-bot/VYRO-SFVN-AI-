const express = require("express");
const cors = require("cors");
const path = require("path");
const { getMarketSnapshot } = require("./services/sfvnService");
const { buildAI } = require("./services/aiEngine");

const app = express();
app.use(cors());
app.use(express.json());

let cache = {
  symbol: process.env.SFVN_SYMBOL || "CP2CON26",
  tick: null,
  history: [],
  ai: null,
  updatedAt: null,
  errors: []
};

async function refreshMarket(){
  try{
    const data = await getMarketSnapshot(cache.symbol);
    cache.tick = data.tick;
    cache.history = data.history;
    cache.ai = buildAI(data.tick, data.history);
    cache.updatedAt = new Date().toISOString();
    cache.errors = data.errors || [];
  }catch(e){
    cache.errors = [e.message];
    cache.updatedAt = new Date().toISOString();
  }
}

refreshMarket();
setInterval(refreshMarket, 2000);

app.get("/health", (req,res)=>{
  res.json({ok:true,name:"VYRO SFVN AI Backend",symbol:cache.symbol,updatedAt:cache.updatedAt,errors:cache.errors});
});

app.get("/api/tick", (req,res)=>res.json({ok:true,data:cache.tick,updatedAt:cache.updatedAt,errors:cache.errors}));
app.get("/api/history", (req,res)=>res.json({ok:true,data:cache.history,updatedAt:cache.updatedAt,errors:cache.errors}));
app.get("/api/ai", (req,res)=>res.json({ok:true,data:cache.ai,updatedAt:cache.updatedAt,errors:cache.errors}));
app.get("/api/market", (req,res)=>res.json({...cache,ok:true}));

app.use(express.static(path.join(__dirname,"public")));

app.get("*",(req,res)=>{
  res.sendFile(path.join(__dirname,"public","index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log("VYRO SFVN AI Terminal running on port",PORT));