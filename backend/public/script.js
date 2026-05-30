
const $=id=>document.getElementById(id);
const fmt=v=>(v===null||v===undefined||Number.isNaN(Number(v)))?"--":Number(v).toFixed(4);
function setText(id,val){$(id).innerText=val??"--"}

function drawChart(history,tick){
 const c=$("chart"),ctx=c.getContext("2d"),W=c.width,H=c.height;
 ctx.clearRect(0,0,W,H);
 const data=(Array.isArray(history)?history:[]).slice(-80);
 ctx.fillStyle="rgba(0,0,0,.14)";ctx.fillRect(0,0,W,H);
 if(data.length<3){ctx.fillStyle="#b7d7ff";ctx.font="bold 24px Arial";ctx.fillText("WAITING SFVN API CANDLE FEED",40,72);return}
 const max=Math.max(...data.map(d=>Number(d.high))),min=Math.min(...data.map(d=>Number(d.low)));
 const pad=45,plotW=W-pad*2,plotH=H-pad*2;
 const y=p=>H-pad-((Number(p)-min)/(max-min||1))*plotH,xStep=plotW/data.length;
 ctx.strokeStyle="rgba(255,255,255,.08)";
 for(let i=0;i<=6;i++){const yy=pad+i*plotH/6;ctx.beginPath();ctx.moveTo(pad,yy);ctx.lineTo(W-pad,yy);ctx.stroke()}
 data.forEach((d,i)=>{const x=pad+i*xStep+xStep/2,o=Number(d.open),h=Number(d.high),l=Number(d.low),cl=Number(d.close),up=cl>=o;ctx.strokeStyle=up?"#4fffd6":"#ff5f8f";ctx.fillStyle=up?"#4fffd6":"#ff5f8f";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x,y(h));ctx.lineTo(x,y(l));ctx.stroke();const top=y(Math.max(o,cl)),bot=y(Math.min(o,cl));ctx.fillRect(x-xStep*.28,top,Math.max(3,xStep*.56),Math.max(3,bot-top))});
 const last=Number(tick?.last);
 if(Number.isFinite(last)){const yy=y(last);ctx.setLineDash([6,6]);ctx.strokeStyle="#ffe66d";ctx.beginPath();ctx.moveTo(pad,yy);ctx.lineTo(W-pad,yy);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle="#ffe66d";ctx.font="bold 18px Arial";ctx.fillText(last.toFixed(4),W-130,yy-8)}
}

async function loadMarket(){
 try{
  const res=await fetch("/api/market",{cache:"no-store"}),j=await res.json(),t=j.tick||{},ai=j.ai||{};
  setText("status",j.ok?"LIVE":"ERROR"); setText("updated",j.updatedAt?new Date(j.updatedAt).toLocaleTimeString():"--");
  setText("hcount",(j.history||[]).length); setText("tcount",(j.trades||[]).length);
  setText("last",fmt(t.last)); setText("bid",fmt(t.bid)); setText("ask",fmt(t.ask));
  setText("signal",ai.signal||"WAIT"); setText("confidence",ai.confidence?ai.confidence+"%":"--");
  setText("structure",ai.structure||"--"); setText("bias",ai.bias||"--"); setText("liquidity",ai.liquidity||"--");
  setText("stopHunt",ai.stopHunt||"--"); setText("supply",fmt(ai.supply)); setText("demand",fmt(ai.demand));
  setText("delta",ai.delta??"--"); setText("flow",ai.flow||"--");
  drawChart(j.history||[],t);
 }catch(e){console.error(e);setText("status","ERROR")}
}
$("connectBtn").addEventListener("click",loadMarket);loadMarket();setInterval(loadMarket,2000);
