function num(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function buildAI(tick={}, history=[]){
  const last = num(tick.last);
  const open = num(tick.open);
  const high = num(tick.high);
  const low = num(tick.low);
  const bid = num(tick.bid);
  const ask = num(tick.ask);
  const cumVol = num(tick.cumulativeVolume) || 0;

  let signal = "WAIT";
  let bias = "NEUTRAL";
  let confidence = 50;

  if(last !== null && open !== null){
    const range = Math.max(0.00001, (high || last) - (low || last));
    const diff = last - open;
    const strength = Math.min(35, Math.abs(diff / range) * 35);
    if(diff > 0){ signal = "BUY"; bias = "BULLISH"; confidence = Math.round(55 + strength); }
    if(diff < 0){ signal = "SELL"; bias = "BEARISH"; confidence = Math.round(55 + strength); }
  }

  const recent = Array.isArray(history) ? history.slice(-24) : [];
  const supply = recent.length ? Math.max(...recent.map(x=>num(x.high)).filter(x=>x!==null)) : high;
  const demand = recent.length ? Math.min(...recent.map(x=>num(x.low)).filter(x=>x!==null)) : low;

  return {
    signal,
    confidence,
    bias,
    structure: bias === "BULLISH" ? "BOS UP / Bullish pressure" : bias === "BEARISH" ? "BOS DOWN / Bearish pressure" : "SIDEWAY",
    liquidity: cumVol > 100 ? "ACTIVE" : "LOW",
    stopHunt: "WAIT",
    supply,
    demand,
    delta: "BASIC",
    flow: bias,
    spread: (ask!==null && bid!==null) ? Number((ask-bid).toFixed(6)) : null
  };
}

module.exports = { buildAI };