let candles = [];
let tape = [];
let heatmap = [];
let lastTick = null;

const MAX_CANDLES = 300;
const MAX_TAPE = 60;
const MAX_HEAT = 40;
const TF_MS = Number(process.env.CANDLE_TF_MS || 60000);

function num(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchJson(url){
  const r = await fetch(url, {
    headers: {
      "accept": "application/json,text/plain,*/*",
      "user-agent": "VYRO-SFVN-AI/6.0"
    }
  });
  if(!r.ok) throw new Error(`tick ${r.status} ${r.statusText}`);
  return await r.json();
}

async function fetchTick(symbol="CP2CON26"){
  const url = `https://remote.sfvn-invest.com.vn/api/v1/tick/${encodeURIComponent(symbol)}/last`;
  const raw = await fetchJson(url);
  const d = raw?.data || raw || {};
  return {
    symbol: d.symbol || symbol,
    timestamp: Number(d.timestamp ? String(d.timestamp).slice(0,13) : Date.now()),
    open: num(d.open),
    high: num(d.high),
    low: num(d.low),
    last: num(d.last ?? d.close),
    close: num(d.close ?? d.last),
    volume: num(d.volume),
    bid: num(d.bid),
    ask: num(d.ask),
    cumulativeVolume: num(d.cumulativeVolume),
    percentChange: num(d.percentChange)
  };
}

function getSide(tick){
  if(!lastTick || lastTick.last === null || tick.last === null) return "NEUTRAL";
  if(tick.last > lastTick.last) return "BUY";
  if(tick.last < lastTick.last) return "SELL";
  if(tick.last >= (tick.ask || tick.last)) return "BUY";
  if(tick.last <= (tick.bid || tick.last)) return "SELL";
  return "NEUTRAL";
}

function processTick(tick){
  if(!tick || tick.last === null) return;

  const now = Date.now();
  const bucket = Math.floor(now / TF_MS) * TF_MS;
  const price = Number(tick.last);
  const side = getSide(tick);

  let qty = 1;
  if(lastTick && tick.cumulativeVolume !== null && lastTick.cumulativeVolume !== null){
    qty = Math.max(0, Number(tick.cumulativeVolume) - Number(lastTick.cumulativeVolume));
    if(qty === 0) qty = 1;
  }

  const signedDelta = side === "BUY" ? qty : side === "SELL" ? -qty : 0;

  let c = candles[candles.length - 1];
  if(!c || c.timestamp !== bucket){
    const prevClose = c ? c.close : (tick.open || price);
    c = {
      timestamp: bucket,
      open: prevClose,
      high: price,
      low: price,
      close: price,
      volume: qty,
      buyVolume: side === "BUY" ? qty : 0,
      sellVolume: side === "SELL" ? qty : 0,
      delta: signedDelta,
      source: "tick-built"
    };
    candles.push(c);
    if(candles.length > MAX_CANDLES) candles.shift();
  }else{
    c.high = Math.max(c.high, price);
    c.low = Math.min(c.low, price);
    c.close = price;
    c.volume += qty;
    if(side === "BUY") c.buyVolume += qty;
    if(side === "SELL") c.sellVolume += qty;
    c.delta += signedDelta;
  }

  if(candles.length < 16){
    const base = price;
    while(candles.length < 16){
      const i = 16 - candles.length;
      candles.unshift({
        timestamp: bucket - TF_MS * i,
        open: tick.open || base,
        high: tick.high || base,
        low: tick.low || base,
        close: base,
        volume: 0,
        buyVolume: 0,
        sellVolume: 0,
        delta: 0,
        source: "seed"
      });
    }
  }

  const tapeItem = {
    time: now,
    symbol: tick.symbol,
    side,
    price,
    qty,
    bid: tick.bid,
    ask: tick.ask,
    delta: signedDelta
  };
  tape.unshift(tapeItem);
  if(tape.length > MAX_TAPE) tape.pop();

  heatmap.unshift({
    time: now,
    price,
    intensity: Math.min(100, Math.abs(signedDelta) * 12 + (tick.cumulativeVolume || 0) / 5),
    side
  });
  if(heatmap.length > MAX_HEAT) heatmap.pop();

  lastTick = {...tick};
}

function getOrderflow(){
  const recentCandles = candles.slice(-20);
  const buyVolume = recentCandles.reduce((s,c)=>s+(c.buyVolume||0),0);
  const sellVolume = recentCandles.reduce((s,c)=>s+(c.sellVolume||0),0);
  const delta = buyVolume - sellVolume;
  const volume = buyVolume + sellVolume;
  const imbalance = volume ? Math.round((delta / volume) * 100) : 0;

  let pressure = "NEUTRAL";
  if(imbalance > 20) pressure = "BUY PRESSURE";
  if(imbalance < -20) pressure = "SELL PRESSURE";

  return {buyVolume, sellVolume, delta, volume, imbalance, pressure};
}

function getState(){
  return {
    candles,
    tape,
    heatmap,
    orderflow: getOrderflow()
  };
}

function resetState(){
  candles = [];
  tape = [];
  heatmap = [];
  lastTick = null;
}

module.exports = { fetchTick, processTick, getState, resetState };