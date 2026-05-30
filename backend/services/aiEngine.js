function num(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function buildAI(tick={}, candles=[]){
  const last = num(tick.last);
  const open = num(tick.open);
  const high = num(tick.high);
  const low = num(tick.low);
  const bid = num(tick.bid);
  const ask = num(tick.ask);
  const cumVol = num(tick.cumulativeVolume) || 0;

  const recent = Array.isArray(candles) ? candles.slice(-20) : [];
  const first = recent[0];
  const lastC = recent[recent.length - 1];

  let signal = "WAIT";
  let bias = "NEUTRAL";
  let confidence = 50;

  if(last !== null && open !== null){
    const range = Math.max(0.00001, (high || last) - (low || last));
    const diff = last - open;
    const strength = Math.min(30, Math.abs(diff / range) * 30);

    if(diff > 0){
      signal = "BUY";
      bias = "BULLISH";
      confidence = Math.round(58 + strength);
    }else if(diff < 0){
      signal = "SELL";
      bias = "BEARISH";
      confidence = Math.round(58 + strength);
    }
  }

  if(first && lastC){
    const trendMove = lastC.close - first.open;
    if(trendMove > 0 && signal === "WAIT") { signal = "BUY"; bias = "BULLISH"; confidence = 58; }
    if(trendMove < 0 && signal === "WAIT") { signal = "SELL"; bias = "BEARISH"; confidence = 58; }
  }

  const highs = recent.map(x=>num(x.high)).filter(x=>x!==null);
  const lows = recent.map(x=>num(x.low)).filter(x=>x!==null);
  const supply = highs.length ? Math.max(...highs) : high;
  const demand = lows.length ? Math.min(...lows) : low;

  let stopHunt = "WAIT";
  if(last !== null && supply !== null && Math.abs(last - supply) <= 0.0025) stopHunt = "BSL TEST";
  if(last !== null && demand !== null && Math.abs(last - demand) <= 0.0025) stopHunt = "SSL TEST";

  const spread = (ask!==null && bid!==null) ? Number((ask-bid).toFixed(6)) : null;

  return {
    signal,
    confidence,
    bias,
    structure: bias === "BULLISH" ? "BOS UP / Bullish pressure" : bias === "BEARISH" ? "BOS DOWN / Bearish pressure" : "SIDEWAY",
    liquidity: cumVol > 100 ? "ACTIVE" : "LOW",
    stopHunt,
    supply,
    demand,
    delta: "TICK MODE",
    flow: bias,
    spread,
    candleMode: "BUILT_FROM_TICK"
  };
}

module.exports = { buildAI };