
const express = require("express");
const cors = require("cors");
const path = require("path");
const WebSocket = require("ws");

const app = express();
app.use(cors());
app.use(express.json({limit:"2mb"}));

const PORT = process.env.PORT || 3000;
const DISPLAY_SYMBOL = process.env.DISPLAY_SYMBOL || "F-XACM-NSI-202607";
const FEED_SYMBOL = process.env.FEED_SYMBOL || "F-XACM-NSI-202607";
const PRODUCT_NAME = process.env.PRODUCT_NAME || "Nano Silver 07/2026";
const PRICE_WS = process.env.SFVN_PRICE_WS || "wss://client-uat.mapsinfotech.com/v2/ws/maps/price";
const BRIDGE_KEY = process.env.VYRO_BRIDGE_KEY || "vyro-local-bridge-key";

let startedAt = Date.now();
let sfvnStatus = "BOOTING";
let sfvnMsgCounter = 0;
let sfvnMsgPerSec = 0;
let lastSfvnError = "";
let acceptedPriceTicks = 0;
let rejectedPriceTicks = 0;
let bridgePackets = 0;
let lastBridgeAt = 0;
let currentTimeframe = "M1";

let sfvnPrice = {
  displaySymbol: DISPLAY_SYMBOL,
  productName: PRODUCT_NAME,
  priceSource: "SFVN_BID_ASK",
  price: null,
  bid: null,
  ask: null,
  spread: null,
  updatedAt: null
};

let ai = {
  source:"MARKET_FLOW_ENGINE",
  status:"WAITING_BRIDGE",
  signal:"WAIT",
  action:"WAIT CONFIRM",
  confidence:0,
  score:0,
  reason:"Waiting CMD Python bridge",
  trend:"NEUTRAL",
  pressure:"NEUTRAL",
  marketMode:"RANGING",
  grade:"WAIT",
  smn:0,power:0,delta:0,rsi:50,atr:0,
  emaTrend:"NEUTRAL",emaCross:"NONE",emaStack:"NEUTRAL",emaSlope:0,
  bos:"NONE",choch:"NONE",liquidity:"NONE",stopHunt:"NONE",fakeBreakout:false,smartBias:"NEUTRAL",
  vpoc:null,vah:null,val:null,hvn:null,lvn:null,volumeProfileBias:"NEUTRAL",
  entryZone:null,tp1:null,tp2:null,tp3:null,sl:null,rr:null,
  updatedAt:null,candles:0,ticks:0
};

function num(v,f=NaN){const n=Number(v);return Number.isFinite(n)?n:f}
function round(v,d=3){const n=Number(v);return Number.isFinite(n)?Number(n.toFixed(d)):null}
function decode(s){try{return JSON.parse(Buffer.from(s,"base64").toString("utf8"))}catch{return null}}
function parse(raw){
  let msg; try{msg=JSON.parse(raw.toString())}catch{return[]}
  const p=msg.payload;
  if(typeof p==="string"){const d=decode(p);return d?[d]:[]}
  if(Array.isArray(p))return p.map(x=>typeof x==="string"?decode(x):x).filter(Boolean);
  if(p&&typeof p==="object")return[p];
  return[];
}
function applyTick(t){
  if(String(t.s||"")!==FEED_SYMBOL)return;
  const bid=num(t.b??t.bid), ask=num(t.a??t.ask), last=num(t.lt??t.c??t.price??t.last);
  let price=NaN;
  if(Number.isFinite(bid)&&bid>20&&bid<200)price=bid;
  else if(Number.isFinite(ask)&&ask>20&&ask<200)price=ask;
  else if(Number.isFinite(last)&&last>20&&last<200)price=last;
  if(!Number.isFinite(price)){rejectedPriceTicks++;return}
  const b=Number.isFinite(bid)?bid:price, a=Number.isFinite(ask)?ask:price;
  acceptedPriceTicks++;
  sfvnPrice={displaySymbol:DISPLAY_SYMBOL,productName:PRODUCT_NAME,priceSource:"SFVN_BID_SELL",price,bid:b,ask:a,spread:Math.abs(a-b),updatedAt:new Date().toISOString()};
}
function connect(){
  sfvnStatus="CONNECTING";
  const ws=new WebSocket(PRICE_WS);
  ws.on("open",()=>{sfvnStatus="LIVE";lastSfvnError="";ws.send(JSON.stringify({key:{domainName:"",prefix:"",messageName:"subscribe",suffix:"v1",messageType:"tick_price"},payload:`ticker@${FEED_SYMBOL}`}));console.log("[V52] SFVN connected")});
  ws.on("message",raw=>{sfvnMsgCounter++;parse(raw).forEach(applyTick)});
  ws.on("error",e=>{sfvnStatus="ERROR";lastSfvnError=e.message});
  ws.on("close",()=>{sfvnStatus="RECONNECTING";setTimeout(connect,3000)});
}
setInterval(()=>{sfvnMsgPerSec=sfvnMsgCounter;sfvnMsgCounter=0},1000);
connect();

function auth(req,res,next){
  const k=req.headers["x-vyro-key"]||req.query.key;
  if(BRIDGE_KEY&&k!==BRIDGE_KEY)return res.status(401).json({ok:false,error:"unauthorized"});
  next();
}
function action(signal,pressure,trend){
  if(signal==="BUY")return"BUY READY";
  if(signal==="SELL")return"SELL READY";
  if(pressure&&pressure.includes("BUY")&&trend==="BULLISH")return"WAIT RETEST BUY";
  if(pressure&&pressure.includes("SELL")&&trend==="BEARISH")return"WAIT RETEST SELL";
  return"WAIT CONFIRM";
}

app.get("/api/timeframe", (req,res)=>{
  res.json({ok:true, timeframe:currentTimeframe});
});

app.post("/api/timeframe", (req,res)=>{
  const tf = String((req.body && req.body.timeframe) || "M1").toUpperCase();
  const allowed = ["M1","M5","M15","H1"];
  if(!allowed.includes(tf)) return res.status(400).json({ok:false,error:"invalid timeframe"});
  currentTimeframe = tf;
  ai.tf = tf;
  res.json({ok:true,timeframe:currentTimeframe});
});

app.post("/api/bridge/mt5", auth, (req,res)=>{
  const p=req.body||{}, now=Date.now();
  bridgePackets++; lastBridgeAt=now;
  if (p.tf) currentTimeframe = String(p.tf).toUpperCase();
  const signal=p.signal||"WAIT";
  const trend=p.trend||p.emaTrend||"NEUTRAL";
  const pressure=p.pressure||(Number(p.power||0)>0?"BUY PRESSURE":Number(p.power||0)<0?"SELL PRESSURE":"NEUTRAL");
  const confidence=Math.max(0,Math.min(100,Math.round(num(p.confidence??p.score,0))));
  ai={
    source:"MARKET_FLOW_ENGINE",status:"LIVE",symbol:p.symbol||"NSI",tf:p.tf||"M1",
    signal,action:p.action||action(signal,pressure,trend),score:confidence,confidence,reason:p.reason||"AI update",
    trend,pressure,momentum:p.momentum||"NEUTRAL",marketMode:p.marketMode||p.phase||"RANGING",grade:p.grade||"WAIT",
    smn:round(p.smn,2)??0,power:round(p.power,2)??0,delta:round(p.delta,2)??0,rsi:round(p.rsi,1)??50,atr:round(p.atr,3)??0,
    emaFast:round(p.emaFast,3),emaSlow:round(p.emaSlow,3),emaLong:round(p.emaLong??p.ema50,3),emaTrend:p.emaTrend||trend,emaCross:p.emaCross||"NONE",emaStack:p.emaStack||"NEUTRAL",emaSlope:round(p.emaSlope,2)??0,
    bos:p.bos||"NONE",choch:p.choch||"NONE",liquidity:p.liquidity||"NONE",stopHunt:p.stopHunt||"NONE",fakeBreakout:!!p.fakeBreakout,smartBias:p.smartBias||trend,
    vpoc:round(p.vpoc,3),vah:round(p.vah,3),val:round(p.val,3),hvn:round(p.hvn,3),lvn:round(p.lvn,3),volumeProfileBias:p.volumeProfileBias||"NEUTRAL", vpQuality:p.vpQuality||"MT5_TICK_VOLUME", vpLookback:Number(p.vpLookback||0), vpBuckets:Number(p.vpBuckets||0),
    entryZone:p.entryZone||null,tp1:round(p.tp1??p.tp,3),tp2:round(p.tp2,3),tp3:round(p.tp3,3),sl:round(p.sl,3),rr:round(p.rr,2),
    updatedAt:new Date().toISOString(),bridgeLatencyMs:p.clientTime?now-Number(p.clientTime):null,candles:Number(p.candles||0),ticks:Number(p.ticks||0)
  };
  res.json({ok:true,packets:bridgePackets});
});

function buildVolumeProfilePlan(price, ai){
  const p = Number(price);
  const poc = Number(ai.vpoc);
  const vah = Number(ai.vah);
  const val = Number(ai.val);
  const atr = Math.max(Number(ai.atr || 0), 0.01);
  const trend = ai.trend || "NEUTRAL";
  const bias = ai.volumeProfileBias || "NEUTRAL";

  const safePrice = Number.isFinite(p) ? p : null;
  const safePoc = Number.isFinite(poc) ? poc : null;
  const safeVah = Number.isFinite(vah) ? vah : null;
  const safeVal = Number.isFinite(val) ? val : null;

  const levels = [
    {label:"STRUCT SELL ZONE", value:safeVah ? safeVah + atr*2.2 : null, note:"Kháng cự trên — bot dễ rút khỏi đây", type:"sell"},
    {label:"DANGER RETEST", value:safeVah ? safeVah + atr*0.8 : null, note:"Giá hiện tại gần vùng nguy hiểm", type:"danger"},
    {label:"VAH", value:safeVah, note:"Hỗ trợ/kháng cự trên — cần giữ lại", type:"vah"},
    {label:"POC", value:safePoc, note:"Nam châm mạnh nhất — vùng thanh khoản lớn", type:"poc"},
    {label:"VAL", value:safeVal, note:"Vùng BUY an toàn thứ 2 — đáy Value Area", type:"val"},
    {label:"LVN", value:safeVal ? safeVal - atr*0.9 : null, note:"Ít giao dịch, có thể xuyên nhanh", type:"lvn"},
    {label:"FAR SUPPORT", value:safeVal ? safeVal - atr*2.0 : null, note:"Hỗ trợ xa — SL tốt nếu phá VAL", type:"support"}
  ];

  let zoneA = null;
  let zoneB = null;
  if (safePoc && safeVal && safeVah) {
    if (trend === "BULLISH" || ai.pressure?.includes("BUY")) {
      zoneA = {
        title:"Zone A — BUY tại POC (ưu tiên)",
        entry:`${(safePoc-atr*0.35).toFixed(3)} – ${(safePoc+atr*0.20).toFixed(3)}`,
        sl:(safeVal-atr*0.7).toFixed(3),
        tp1:(safeVah).toFixed(3),
        tp2:(safeVah+atr*0.9).toFixed(3),
        tp3:(safeVah+atr*1.6).toFixed(3),
        rr:"1 : 2.3"
      };
      zoneB = {
        title:"Zone B — BUY tại VAL (dự phòng)",
        entry:`${(safeVal-atr*0.20).toFixed(3)} – ${(safeVal+atr*0.35).toFixed(3)}`,
        sl:(safeVal-atr*1.2).toFixed(3),
        tp1:(safePoc).toFixed(3),
        tp2:(safeVah).toFixed(3),
        tp3:(safeVah+atr*1.2).toFixed(3),
        rr:"1 : 2.5"
      };
    } else if (trend === "BEARISH" || ai.pressure?.includes("SELL")) {
      zoneA = {
        title:"Zone A — SELL tại POC (ưu tiên)",
        entry:`${(safePoc-atr*0.20).toFixed(3)} – ${(safePoc+atr*0.35).toFixed(3)}`,
        sl:(safeVah+atr*0.7).toFixed(3),
        tp1:(safeVal).toFixed(3),
        tp2:(safeVal-atr*0.9).toFixed(3),
        tp3:(safeVal-atr*1.6).toFixed(3),
        rr:"1 : 2.3"
      };
      zoneB = {
        title:"Zone B — SELL tại VAH (dự phòng)",
        entry:`${(safeVah-atr*0.35).toFixed(3)} – ${(safeVah+atr*0.20).toFixed(3)}`,
        sl:(safeVah+atr*1.2).toFixed(3),
        tp1:(safePoc).toFixed(3),
        tp2:(safeVal).toFixed(3),
        tp3:(safeVal-atr*1.2).toFixed(3),
        rr:"1 : 2.5"
      };
    }
  }

  return {
    price:safePrice,
    bias,
    summary: trend === "BULLISH" ? "TÓM TẮT KẾ HOẠCH BUY — 2 VÙNG ENTRY" : trend === "BEARISH" ? "TÓM TẮT KẾ HOẠCH SELL — 2 VÙNG ENTRY" : "TÓM TẮT KẾ HOẠCH — CHỜ XÁC NHẬN",
    levels,
    zoneA,
    zoneB
  };
}

app.get("/api/live", (req,res)=>{
  const age=lastBridgeAt?Date.now()-lastBridgeAt:null;
  const bridgeStatus=age!=null&&age<15000?"LIVE":"STALE";
  const display={symbol:DISPLAY_SYMBOL,productName:PRODUCT_NAME,price:sfvnPrice.price,bid:sfvnPrice.bid,ask:sfvnPrice.ask,spread:sfvnPrice.spread};
  const volumeProfilePlan=buildVolumeProfilePlan(sfvnPrice.price, ai);
  res.json({
    ok:true,mode:"MT5_VOLUME_PROFILE_ENGINE", timeframe:currentTimeframe,
    uptime:Math.floor((Date.now()-startedAt)/1000),
    sfvn:{status:sfvnStatus,msgPerSec:sfvnMsgPerSec,lastError:lastSfvnError,acceptedPriceTicks,rejectedPriceTicks,price:sfvnPrice},
    bridge:{status:bridgeStatus,packets:bridgePackets,ageMs:age},
    display, ai, volumeProfilePlan
  });
});

app.use(express.static(path.join(__dirname,"../frontend")));
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"../frontend/index.html")));
app.listen(PORT,()=>console.log("[VYRO V52] MT5 Volume Profile Engine running",PORT));
