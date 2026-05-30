let candles=[],m5=[],m15=[],tape=[],heatmap=[],cvd=[],lastTick=null,cumulativeDelta=0;
const MAX=420, MAX_TAPE=80, MAX_HEAT=60, TF=Number(process.env.CANDLE_TF_MS||60000);
const num=v=>{const n=Number(v); return Number.isFinite(n)?n:null;};
async function fetchTick(symbol="CP2CON26"){
  const url=`https://remote.sfvn-invest.com.vn/api/v1/tick/${encodeURIComponent(symbol)}/last`;
  const r=await fetch(url,{headers:{"accept":"application/json,text/plain,*/*","user-agent":"VYRO-SFVN-PRO-FINAL/7.0"}});
  if(!r.ok) throw new Error(`tick ${r.status} ${r.statusText}`);
  const raw=await r.json(); const d=raw?.data||raw||{};
  return {symbol:d.symbol||symbol,timestamp:Number(d.timestamp?String(d.timestamp).slice(0,13):Date.now()),open:num(d.open),high:num(d.high),low:num(d.low),last:num(d.last??d.close),close:num(d.close??d.last),volume:num(d.volume),bid:num(d.bid),ask:num(d.ask),cumulativeVolume:num(d.cumulativeVolume),percentChange:num(d.percentChange)};
}
function sideOf(t){ if(!lastTick||lastTick.last===null||t.last===null) return "NEUTRAL"; if(t.last>lastTick.last) return "BUY"; if(t.last<lastTick.last) return "SELL"; const mid=t.bid&&t.ask?(t.bid+t.ask)/2:t.last; return t.last>=mid?"BUY":"SELL"; }
function addC(arr,bucket,t,price,side,qty,sd,tf){
  let c=arr[arr.length-1];
  if(!c||c.timestamp!==bucket){ const prev=c?c.close:(t.open||price); c={timestamp:bucket,open:prev,high:price,low:price,close:price,volume:qty,buyVolume:side==="BUY"?qty:0,sellVolume:side==="SELL"?qty:0,delta:sd,source:"tick-built",tf}; arr.push(c); if(arr.length>MAX) arr.shift(); }
  else{ c.high=Math.max(c.high,price); c.low=Math.min(c.low,price); c.close=price; c.volume+=qty; if(side==="BUY") c.buyVolume+=qty; if(side==="SELL") c.sellVolume+=qty; c.delta+=sd; }
}
function seed(arr,t,tfMs,bucket,count,tf){ if(arr.length>=count) return; const base=Number(t.last); while(arr.length<count){ const i=count-arr.length; arr.unshift({timestamp:bucket-tfMs*i,open:t.open||base,high:t.high||base,low:t.low||base,close:base,volume:0,buyVolume:0,sellVolume:0,delta:0,source:"seed",tf}); } }
function processTick(t){
  if(!t||t.last===null) return; const now=Date.now(), price=Number(t.last), side=sideOf(t);
  let qty=1; if(lastTick&&t.cumulativeVolume!==null&&lastTick.cumulativeVolume!==null){ qty=Math.max(0,Number(t.cumulativeVolume)-Number(lastTick.cumulativeVolume)); if(qty===0) qty=1; }
  const sd=side==="BUY"?qty:side==="SELL"?-qty:0; cumulativeDelta+=sd;
  const b1=Math.floor(now/TF)*TF, b5=Math.floor(now/(TF*5))*(TF*5), b15=Math.floor(now/(TF*15))*(TF*15);
  addC(candles,b1,t,price,side,qty,sd,"M1"); addC(m5,b5,t,price,side,qty,sd,"M5"); addC(m15,b15,t,price,side,qty,sd,"M15");
  seed(candles,t,TF,b1,30,"M1"); seed(m5,t,TF*5,b5,20,"M5"); seed(m15,t,TF*15,b15,16,"M15");
  tape.unshift({time:now,symbol:t.symbol,side,price,qty,bid:t.bid,ask:t.ask,delta:sd,cvd:cumulativeDelta}); if(tape.length>MAX_TAPE) tape.pop();
  cvd.push({time:now,value:cumulativeDelta}); if(cvd.length>200) cvd.shift();
  heatmap.unshift({time:now,price,intensity:Math.min(100,Math.abs(sd)*12+(t.cumulativeVolume||0)/5),side}); if(heatmap.length>MAX_HEAT) heatmap.pop();
  lastTick={...t};
}
function of(list){ const a=list.slice(-30); const buyVolume=a.reduce((s,c)=>s+(c.buyVolume||0),0), sellVolume=a.reduce((s,c)=>s+(c.sellVolume||0),0), delta=buyVolume-sellVolume, volume=buyVolume+sellVolume, imbalance=volume?Math.round(delta/volume*100):0; let pressure="NEUTRAL"; if(imbalance>20) pressure="BUY PRESSURE"; if(imbalance<-20) pressure="SELL PRESSURE"; return {buyVolume,sellVolume,delta,volume,imbalance,pressure};}
function getState(){ return {candles,m5,m15,tape,heatmap,cvd,orderflow:of(candles),orderflowM5:of(m5),orderflowM15:of(m15)}; }
function resetState(){ candles=[];m5=[];m15=[];tape=[];heatmap=[];cvd=[];lastTick=null;cumulativeDelta=0; }
module.exports={fetchTick,processTick,getState,resetState};
