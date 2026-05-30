function num(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function buildAI(tick={}, candles=[], orderflow={}){
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
    const strength = Math.min(25, Math.abs(diff / range) * 25);
    if(diff > 0){ signal = "BUY"; bias = "BULLISH"; confidence = Math.round(56 + strength); }
    else if(diff < 0){ signal = "SELL"; bias = "BEARISH"; confidence = Math.round(56 + strength); }
  }

  if(orderflow?.imbalance > 20){
    bias = "BULLISH FLOW";
    signal = "BUY";
    confidence = Math.min(92, confidence + 8);
  }
  if(orderflow?.imbalance < -20){
    bias = "BEARISH FLOW";
    signal = "SELL";
    confidence = Math.min(92, confidence + 8);
  }

  if(first && lastC && signal === "WAIT"){
    const trendMove = lastC.close - first.open;
    if(trendMove > 0){ signal = "BUY"; bias = "BULLISH"; confidence = 58; }
    if(trendMove < 0){ signal = "SELL"; bias = "BEARISH"; confidence = 58; }
  }

  const highs = recent.map(x=>num(x.high)).filter(x=>x!==null);
  const lows = recent.map(x=>num(x.low)).filter(x=>x!==null);
  const supply = highs.length ? Math.max(...highs) : high;
  const demand = lows.length ? Math.min(...lows) : low;

  let stopHunt = "WAIT";
  if(last !== null && supply !== null && Math.abs(last - supply) <= 0.0025) stopHunt = "BSL TEST";
  if(last !== null && demand !== null && Math.abs(last - demand) <= 0.0025) stopHunt = "SSL TEST";

  let fakeBreakout = "WAIT";
  if(lastC && supply && lastC.high >= supply && lastC.close < supply) fakeBreakout = "FAKE BUY BREAK";
  if(lastC && demand && lastC.low <= demand && lastC.close > demand) fakeBreakout = "FAKE SELL BREAK";

  return {
    signal, confidence, bias,
    structure: bias.includes("BULLISH") ? "BOS UP / Bullish pressure" : bias.includes("BEARISH") ? "BOS DOWN / Bearish pressure" : "SIDEWAY",
    liquidity: cumVol > 100 ? "ACTIVE" : "LOW",
    stopHunt, fakeBreakout, supply, demand,
    delta: orderflow?.delta ?? 0,
    flow: orderflow?.pressure || bias,
    imbalance: orderflow?.imbalance ?? 0,
    spread: (ask!==null && bid!==null) ? Number((ask-bid).toFixed(6)) : null,
    candleMode: "BUILT_FROM_TICK",
    realtimeMode: "PHASE1_PROXY_ORDERFLOW"
  };
}

module.exports = { buildAI };