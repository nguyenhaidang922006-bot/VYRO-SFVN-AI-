let candles = [], tape = [], heatmap = [], cvd = [];
let lastTick = null;
let cumulativeDelta = 0;
const TF = 60000;

const num = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function fetchTick(symbol="CP2CON26"){
  const url = `https://remote.sfvn-invest.com.vn/api/v1/tick/${encodeURIComponent(symbol)}/last`;
  const r = await fetch(url, {headers: {"accept":"application/json", "user-agent":"VYRO/8.0"}});
  if(!r.ok) throw new Error(`tick ${r.status}`);
  const raw = await r.json();
  const d = raw.data || raw || {};
  return {
    symbol: d.symbol || symbol,
    timestamp: Date.now(),
    open: num(d.open),
    high: num(d.high),
    low: num(d.low),
    last: num(d.last ?? d.close),
    close: num(d.close ?? d.last),
    bid: num(d.bid),
    ask: num(d.ask),
    cumulativeVolume: num(d.cumulativeVolume),
    volume: num(d.volume),
    percentChange: num(d.percentChange)
  };
}

function sideOf(t){
  if(!lastTick || lastTick.last === null || t.last === null) return "NEUTRAL";
  if(t.last > lastTick.last) return "BUY";
  if(t.last < lastTick.last) return "SELL";
  return "NEUTRAL";
}

function processTick(t){
  if(!t || t.last === null) return;
  const now = Date.now();
  const bucket = Math.floor(now / TF) * TF;
  const price = Number(t.last);
  const side = sideOf(t);
  let qty = 1;

  if(lastTick && t.cumulativeVolume !== null && lastTick.cumulativeVolume !== null){
    qty = Math.max(0, Number(t.cumulativeVolume) - Number(lastTick.cumulativeVolume));
    if(qty === 0) qty = 1;
  }

  const signedDelta = side === "BUY" ? qty : side === "SELL" ? -qty : 0;
  cumulativeDelta += signedDelta;

  let c = candles[candles.length - 1];
  if(!c || c.timestamp !== bucket){
    const prev = c ? c.close : (t.open || price);
    c = {timestamp:bucket, open:prev, high:price, low:price, close:price, volume:qty, buyVolume:side==="BUY"?qty:0, sellVolume:side==="SELL"?qty:0, delta:signedDelta};
    candles.push(c);
    if(candles.length > 420) candles.shift();
  }else{
    c.high = Math.max(c.high, price);
    c.low = Math.min(c.low, price);
    c.close = price;
    c.volume += qty;
    if(side === "BUY") c.buyVolume += qty;
    if(side === "SELL") c.sellVolume += qty;
    c.delta += signedDelta;
  }

  while(candles.length < 30){
    candles.unshift({timestamp:bucket - TF*(30-candles.length), open:t.open||price, high:t.high||price, low:t.low||price, close:price, volume:0, buyVolume:0, sellVolume:0, delta:0});
  }

  tape.unshift({time:now, side, price, qty, delta:signedDelta, cvd:cumulativeDelta});
  if(tape.length > 80) tape.pop();

  cvd.push({time:now, value:cumulativeDelta});
  if(cvd.length > 200) cvd.shift();

  heatmap.unshift({time:now, price, intensity:Math.min(100, Math.abs(signedDelta)*12 + (t.cumulativeVolume||0)/5), side});
  if(heatmap.length > 60) heatmap.pop();

  lastTick = {...t};
}

function getOrderflow(){
  const a = candles.slice(-30);
  const buyVolume = a.reduce((s,c)=>s+(c.buyVolume||0),0);
  const sellVolume = a.reduce((s,c)=>s+(c.sellVolume||0),0);
  const delta = buyVolume - sellVolume;
  const volume = buyVolume + sellVolume;
  const imbalance = volume ? Math.round(delta / volume * 100) : 0;
  return {buyVolume, sellVolume, delta, volume, imbalance, pressure: imbalance>20 ? "BUY PRESSURE" : imbalance<-20 ? "SELL PRESSURE" : "NEUTRAL"};
}

function getState(){ return {candles, tape, heatmap, cvd, orderflow:getOrderflow()}; }
function resetState(){ candles=[]; tape=[]; heatmap=[]; cvd=[]; lastTick=null; cumulativeDelta=0; }

module.exports = {fetchTick, processTick, getState, resetState};