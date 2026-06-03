
const API='http://localhost:3000/api/live';
let symbol='XAUUSD';

function setSymbol(s){
 symbol=s;
}

async function load(){
 try{
  const r=await fetch(API+'?symbol='+symbol);
  const d=await r.json();

  document.getElementById('smn').innerText=d.SMN;
  document.getElementById('power').innerText=d.POWER;
  document.getElementById('delta').innerText=d.DELTA;
  document.getElementById('rsi').innerText=d.RSI;
  document.getElementById('atr').innerText=d.ATR;
  document.getElementById('phase').innerText=d.PHASE;
  document.getElementById('grade').innerText=d.GRADE;

  drawChart();
 }catch(e){
  console.log(e);
 }
}

function drawChart(){
 const c=document.getElementById('chart');
 const ctx=c.getContext('2d');

 ctx.fillStyle='#11192d';
 ctx.fillRect(0,0,c.width,c.height);

 for(let i=0;i<80;i++){
   let x=i*16+20;
   let open=Math.random()*200+100;
   let close=Math.random()*200+100;
   let high=Math.max(open,close)+Math.random()*40;
   let low=Math.min(open,close)-Math.random()*40;

   let green=close>open;

   ctx.strokeStyle=green?'#00e676':'#ff5252';
   ctx.fillStyle=green?'#00e676':'#ff5252';

   ctx.beginPath();
   ctx.moveTo(x,450-high);
   ctx.lineTo(x,450-low);
   ctx.stroke();

   ctx.fillRect(x-4,450-Math.max(open,close),8,Math.abs(open-close));
 }
}

setInterval(load,1000);
load();
