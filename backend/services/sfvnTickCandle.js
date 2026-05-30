let candles = [];
const MAX_CANDLES = 300;
const TF_MS = Number(process.env.CANDLE_TF_MS || 60000);

function num(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchJson(url){
  const r = await fetch(url, {
    headers: {
      "accept": "application/json,text/plain,*/*",
      "user-agent": "VYRO-SFVN-AI/5.0"
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

function buildCandle(tick){
  if(!tick || tick.last === null) return;
  const now = Date.now();
  const bucket = Math.floor(now / TF_MS) * TF_MS;
  const price = Number(tick.last);
  let c = candles[candles.length - 1];

  if(!c || c.timestamp !== bucket){
    const prevClose = c ? c.close : (tick.open || price);
    c = {timestamp:bucket,open:prevClose,high:price,low:price,close:price,volume:tick.cumulativeVolume||0,source:"tick-built"};
    candles.push(c);
    if(candles.length > MAX_CANDLES) candles.shift();
  }else{
    c.high = Math.max(c.high, price);
    c.low = Math.min(c.low, price);
    c.close = price;
    c.volume = tick.cumulativeVolume || c.volume || 0;
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
        volume: tick.cumulativeVolume || 0,
        source: "seed"
      });
    }
  }
}

function getCandles(){ return candles; }
function resetCandles(){ candles = []; }

module.exports = { fetchTick, buildCandle, getCandles, resetCandles };