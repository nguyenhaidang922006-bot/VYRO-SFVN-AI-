const express = require("express");
const cors = require("cors");
const path = require("path");
const { getConfig, updateConfig } = require("./services/configStore");
const { fetchTick, processTick, getState, resetState } = require("./services/realtimeEngine");
const { buildAI } = require("./services/aiEngine");

const app = express();
app.use(cors());
app.use(express.json({limit:"1mb"}));

let cache = {
  ok: true,
  symbol: getConfig().activeSymbol,
  tick: null,
  candles: [],
  tape: [],
  orderflow: null,
  heatmap: [],
  ai: null,
  updatedAt: null,
  errors: []
};

function checkAccess(req, res, next){
  const code = req.headers["x-vyro-code"] || req.query.code || "";
  if(String(code).trim() !== getConfig().accessCode){
    return res.status(401).json({ok:false, message:"ACCESS_CODE_REQUIRED"});
  }
  next();
}

function checkAdmin(req, res, next){
  const pass = req.headers["x-admin-pass"] || req.query.pass || "";
  if(String(pass).trim() !== getConfig().adminPass){
    return res.status(401).json({ok:false, message:"ADMIN_PASS_REQUIRED"});
  }
  next();
}

async function refresh(){
  try{
    const cfg = getConfig();
    if(cache.symbol !== cfg.activeSymbol){
      cache.symbol = cfg.activeSymbol;
      resetState();
    }

    const tick = await fetchTick(cfg.activeSymbol);
    processTick(tick);
    const state = getState();
    const ai = buildAI(tick, state.candles, state.orderflow);

    cache.tick = tick;
    cache.candles = state.candles;
    cache.tape = state.tape;
    cache.orderflow = state.orderflow;
    cache.heatmap = state.heatmap;
    cache.ai = ai;
    cache.updatedAt = new Date().toISOString();
    cache.errors = [];
  }catch(e){
    cache.errors = [e.message];
    cache.updatedAt = new Date().toISOString();
  }
}

refresh();
setInterval(refresh, 2000);

app.get("/health", (req,res)=>res.json({
  ok:true,
  name:"VYRO SFVN AI Backend V6 Realtime Pro",
  symbol:cache.symbol,
  updatedAt:cache.updatedAt,
  candles:cache.candles.length,
  tape:cache.tape.length,
  access:"enabled",
  admin:"hidden:/admin-secret",
  errors:cache.errors
}));

app.get("/api/config", checkAccess, (req,res)=>{
  const cfg = getConfig();
  res.json({ok:true, activeSymbol:cfg.activeSymbol, symbols:cfg.symbols});
});

app.get("/api/market", checkAccess, (req,res)=>res.json({...cache,ok:true}));
app.get("/api/tick", checkAccess, (req,res)=>res.json({ok:true,data:cache.tick,updatedAt:cache.updatedAt,errors:cache.errors}));
app.get("/api/history", checkAccess, (req,res)=>res.json({ok:true,count:cache.candles.length,data:cache.candles,updatedAt:cache.updatedAt,errors:cache.errors}));
app.get("/api/tape", checkAccess, (req,res)=>res.json({ok:true,count:cache.tape.length,data:cache.tape,updatedAt:cache.updatedAt,errors:cache.errors}));
app.get("/api/orderflow", checkAccess, (req,res)=>res.json({ok:true,data:cache.orderflow,heatmap:cache.heatmap,updatedAt:cache.updatedAt,errors:cache.errors}));

app.get("/api/admin/config", checkAdmin, (req,res)=>{
  const cfg = getConfig();
  res.json({
    ok:true,
    accessCode:cfg.accessCode,
    activeSymbol:cfg.activeSymbol,
    symbols:cfg.symbols,
    cache:{updatedAt:cache.updatedAt,candles:cache.candles.length,tape:cache.tape.length,errors:cache.errors}
  });
});

app.post("/api/admin/config", checkAdmin, (req,res)=>{
  const before = getConfig().activeSymbol;
  const cfg = updateConfig(req.body || {});
  if(before !== cfg.activeSymbol) resetState();
  res.json({ok:true, config:{accessCode:cfg.accessCode, activeSymbol:cfg.activeSymbol, symbols:cfg.symbols}});
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/admin-secret", (req,res)=>{
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("*", (req,res)=>res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log("VYRO SFVN V6 Realtime Pro running on port", PORT));