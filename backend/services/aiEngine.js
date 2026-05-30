function num(v){ const n = Number(v); return Number.isFinite(n) ? n : null; }

function buildAI(tick={}, history=[], trades=[]){
  const last = num(tick.last);
  const open = num(tick.open);
  const high = num(tick.high);
  const low = num(tick.low);
  const bid = num(tick.bid);
  const ask = num(tick.ask);
  const cumVol = num(tick.cumulativeVolume) || 0;

  let buyVol = 0, sellVol = 0;
  for(const t of trades || []){
    const q = num(t.qty) || 1;
    if(t.side === 1) buyVol += q;
    else if(t.side === 2) sellVol += q;
  }
  const delta = buyVol - sellVol;

  let signal = "WAIT";
  let bias = "NEUTRAL";
  let confidence = 50;

  if(last !== null && open !== null){
    const range = Math.max(0.00001, (high || last) - (low || last));
    const diff = last - open;
    const strength = Math.min(30, Math.abs(diff / range) * 30);
    if(diff > 0){ signal = "BUY"; bias = "BULLISH"; confidence = Math.round(58 + strength); }
    if(diff < 0){ signal = "SELL"; bias = "BEARISH"; confidence = Math.round(58 + strength); }
  }

  if(delta > 5){ bias = "BULLISH FLOW"; if(signal==="WAIT") signal="BUY"; confidence = Math.min(92, confidence+7); }
  if(delta < -5){ bias = "BEARISH FLOW"; if(signal==="WAIT") signal="SELL"; confidence = Math.min(92, confidence+7); }

  const recent = Array.isArray(history) ? history.slice(-24) : [];
  const highs = recent.map(x=>num(x.high)).filter(x=>x!==null);
  const lows = recent.map(x=>num(x.low)).filter(x=>x!==null);
  const supply = highs.length ? Math.max(...highs) : high;
  const demand = lows.length ? Math.min(...lows) : low;

  let stopHunt = "WAIT";
  if(last !== null && high !== null && last < high && Math.abs(high-last) <= 0.005) stopHunt = "BSL TEST";
  if(last !== null && low !== null && last > low && Math.abs(last-low) <= 0.005) stopHunt = "SSL TEST";

  return {
    signal,
    confidence,
    bias,
    structure: bias.includes("BULLISH") ? "BOS UP / Bullish pressure" : bias.includes("BEARISH") ? "BOS DOWN / Bearish pressure" : "SIDEWAY",
    liquidity: cumVol > 100 ? "ACTIVE" : "LOW",
    stopHunt,
    supply,
    demand,
    delta,
    flow: delta > 0 ? "BUY FLOW" : delta < 0 ? "SELL FLOW" : bias,
    spread: (ask!==null && bid!==null) ? Number((ask-bid).toFixed(6)) : null,
    buyVol,
    sellVol
  };
}

module.exports = { buildAI };