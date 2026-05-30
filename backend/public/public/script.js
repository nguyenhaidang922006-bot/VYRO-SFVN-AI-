const el = id => document.getElementById(id);
const fmt = v => (v===null || v===undefined || v==="") ? "--" : (typeof v==="number" ? v.toFixed(4) : v);

function candleData(history){
  if(!Array.isArray(history)) return [];
  return history.map(x=>({
    t:x.timestamp || x.truncTime || x.time,
    o:Number(x.open),
    h:Number(x.high),
    l:Number(x.low),
    c:Number(x.close ?? x.last),
    v:Number(x.volume || x.cumulativeVolume || 0)
  })).filter(x=>Number.isFinite(x.o)&&Number.isFinite(x.h)&&Number.isFinite(x.l)&&Number.isFinite(x.c));
}

function drawChart(history, tick){
  const canvas = el("chart");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);
  const data = candleData(history).slice(-80);

  ctx.fillStyle = "rgba(0,0,0,.12)";
  ctx.fillRect(0,0,W,H);

  if(data.length < 2){
    ctx.fillStyle = "#9ecbff";
    ctx.font = "22px Arial";
    ctx.fillText("WAITING SFVN API CANDLE FEED", 40, 70);
    return;
  }

  const max = Math.max(...data.map(d=>d.h));
  const min = Math.min(...data.map(d=>d.l));
  const pad = 40;
  const xStep = (W-pad*2)/data.length;
  const y = p => H-pad - ((p-min)/(max-min || 1))*(H-pad*2);

  ctx.strokeStyle = "rgba(255,255,255,.08)";
  ctx.lineWidth = 1;
  for(let i=0;i<6;i++){
    const yy = pad + i*(H-pad*2)/5;
    ctx.beginPath(); ctx.moveTo(pad,yy); ctx.lineTo(W-pad,yy); ctx.stroke();
  }

  data.forEach((d,i)=>{
    const x = pad + i*xStep + xStep/2;
    const up = d.c >= d.o;
    ctx.strokeStyle = up ? "#4fffd6" : "#ff5f8f";
    ctx.fillStyle = up ? "#4fffd6" : "#ff5f8f";
    ctx.beginPath(); ctx.moveTo(x,y(d.h)); ctx.lineTo(x,y(d.l)); ctx.stroke();
    const top = y(Math.max(d.o,d.c));
    const bot = y(Math.min(d.o,d.c));
    ctx.fillRect(x-xStep*.28, top, xStep*.56, Math.max(2, bot-top));
  });

  const last = Number(tick?.last);
  if(Number.isFinite(last)){
    const yy = y(last);
    ctx.setLineDash([6,6]);
    ctx.strokeStyle = "#ffe66d";
    ctx.beginPath(); ctx.moveTo(pad,yy); ctx.lineTo(W-pad,yy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#ffe66d";
    ctx.font = "18px Arial";
    ctx.fillText(last.toFixed(4), W-120, yy-8);
  }
}

async function loadMarket(){
  try{
    const r = await fetch("/api/market", {cache:"no-store"});
    const j = await r.json();
    const tick = j.tick?.data || j.tick || {};
    const ai = j.ai || {};

    el("status").innerText = j.ok ? "LIVE" : "ERROR";
    el("updated").innerText = j.updatedAt ? new Date(j.updatedAt).toLocaleTimeString() : "--";
    el("last").innerText = fmt(Number(tick.last));
    el("bid").innerText = fmt(Number(tick.bid));
    el("ask").innerText = fmt(Number(tick.ask));

    el("signal").innerText = ai.signal || "WAIT";
    el("confidence").innerText = ai.confidence ? ai.confidence + "%" : "--";
    el("structure").innerText = ai.structure || "--";
    el("bias").innerText = ai.bias || "--";
    el("liquidity").innerText = ai.liquidity || "--";
    el("stopHunt").innerText = ai.stopHunt || "--";
    el("supply").innerText = fmt(ai.supply);
    el("demand").innerText = fmt(ai.demand);
    el("delta").innerText = ai.delta || "--";
    el("flow").innerText = ai.flow || "--";

    drawChart(j.history || [], tick);
  }catch(e){
    el("status").innerText = "ERROR";
    console.error(e);
  }
}

loadMarket();
setInterval(loadMarket, 2000);