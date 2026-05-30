const express=require("express"), cors=require("cors"), path=require("path");
const {getConfig,updateConfig,isValidCode}=require("./services/configStore");
const {fetchTick,processTick,getState,resetState}=require("./services/realtimeEngine");
const {buildAnalysis}=require("./services/proAnalysisEngine");
const app=express(); app.use(cors()); app.use(express.json({limit:"2mb"}));
let cache={ok:true,version:"V7_PRO_FINAL",symbol:getConfig().activeSymbol,tick:null,candles:[],m5:[],m15:[],tape:[],orderflow:null,heatmap:[],cvd:[],smc:null,ai:null,alerts:[],updatedAt:null,errors:[]};
function checkAccess(req,res,next){const code=req.headers["x-vyro-code"]||req.query.code||""; if(!isValidCode(code)) return res.status(401).json({ok:false,message:"ACCESS_CODE_REQUIRED"}); next();}
function checkAdmin(req,res,next){const pass=req.headers["x-admin-pass"]||req.query.pass||""; if(String(pass).trim()!==getConfig().adminPass) return res.status(401).json({ok:false,message:"ADMIN_PASS_REQUIRED"}); next();}
async function refresh(){try{const cfg=getConfig(); if(cache.symbol!==cfg.activeSymbol){cache.symbol=cfg.activeSymbol; resetState();} const tick=await fetchTick(cfg.activeSymbol); processTick(tick); const st=getState(); const an=buildAnalysis(tick,st); Object.assign(cache,{tick,candles:st.candles,m5:st.m5,m15:st.m15,tape:st.tape,orderflow:st.orderflow,heatmap:st.heatmap,cvd:st.cvd,smc:an.smc,ai:an.ai,alerts:an.alerts,updatedAt:new Date().toISOString(),errors:[]});}catch(e){cache.errors=[e.message]; cache.updatedAt=new Date().toISOString();}}
refresh(); setInterval(refresh,2000);
app.get("/health",(req,res)=>res.json({ok:true,name:"VYRO SFVN PRO FINAL Backend",version:cache.version,symbol:cache.symbol,updatedAt:cache.updatedAt,candles:cache.candles.length,tape:cache.tape.length,errors:cache.errors}));
app.get("/api/config",checkAccess,(req,res)=>{const c=getConfig();res.json({ok:true,activeSymbol:c.activeSymbol,symbols:c.symbols});});
app.get("/api/market",checkAccess,(req,res)=>res.json({...cache,ok:true}));
app.get("/api/tick",checkAccess,(req,res)=>res.json({ok:true,data:cache.tick,updatedAt:cache.updatedAt,errors:cache.errors}));
app.get("/api/history",checkAccess,(req,res)=>res.json({ok:true,count:cache.candles.length,data:cache.candles,updatedAt:cache.updatedAt,errors:cache.errors}));
app.get("/api/orderflow",checkAccess,(req,res)=>res.json({ok:true,data:cache.orderflow,heatmap:cache.heatmap,cvd:cache.cvd,updatedAt:cache.updatedAt,errors:cache.errors}));
app.get("/api/smc",checkAccess,(req,res)=>res.json({ok:true,data:cache.smc,ai:cache.ai,alerts:cache.alerts,updatedAt:cache.updatedAt,errors:cache.errors}));
app.get("/api/admin/config",checkAdmin,(req,res)=>{const c=getConfig();res.json({ok:true,accessCode:c.accessCode,activeSymbol:c.activeSymbol,symbols:c.symbols,users:c.users,cache:{updatedAt:cache.updatedAt,candles:cache.candles.length,tape:cache.tape.length,errors:cache.errors}});});
app.post("/api/admin/config",checkAdmin,(req,res)=>{const before=getConfig().activeSymbol; const c=updateConfig(req.body||{}); if(before!==c.activeSymbol) resetState(); res.json({ok:true,config:{accessCode:c.accessCode,activeSymbol:c.activeSymbol,symbols:c.symbols,users:c.users}});});
app.use(express.static(path.join(__dirname,"public")));
app.get("/admin-secret",(req,res)=>res.sendFile(path.join(__dirname,"public","admin.html")));
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
const PORT=process.env.PORT||3000; app.listen(PORT,()=>console.log("VYRO SFVN PRO FINAL running on port",PORT));
