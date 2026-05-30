function num(v){ const n = Number(v); return Number.isFinite(n) ? n : null; }

function buildAnalysis(tick={}, state={}){
  const candles = state.candles || [];
  const of = state.orderflow || {};
  const last = num(tick.last);
  const open = num(tick.open);

  const highs = candles.slice(-18).map(x=>num(x.high)).filter(x=>x!==null);
  const lows = candles.slice(-18).map(x=>num(x.low)).filter(x=>x!==null);
  const supply = highs.length ? Math.max(...highs) : tick.high;
  const demand = lows.length ? Math.min(...lows) : tick.low;

  let signal = "WAIT";
  let bias = "NEUTRAL";
  let confidence = 50;

  if(last !== null && open !== null){
    if(last > open){ signal = "BUY"; bias = "BULLISH"; confidence = 65; }
    if(last < open){ signal = "SELL"; bias = "BEARISH"; confidence = 65; }
  }
  if(of.imbalance > 20){ signal = "BUY"; bias = "BULLISH FLOW"; confidence = 79; }
  if(of.imbalance < -20){ signal = "SELL"; bias = "BEARISH FLOW"; confidence = 79; }

  const bos = last >= supply ? "BOS UP" : last <= demand ? "BOS DOWN" : "WAIT";
  const cvd = state.cvd && state.cvd.length ? state.cvd[state.cvd.length-1].value : 0;

  const atr = candles.slice(-14).reduce((s,x)=>s+Math.abs((x.high||0)-(x.low||0)),0) / Math.max(1, candles.slice(-14).length);
  const ai = {
    signal, confidence, bias,
    structure: signal==="BUY" ? "BULLISH STRUCTURE" : signal==="SELL" ? "BEARISH STRUCTURE" : "SIDEWAY",
    bos, choch:"WAIT", fvg:"WAIT", stopHunt:"WAIT",
    supply, demand, delta:of.delta||0, cvd, flow:of.pressure,
    entry:last,
    sl: signal==="BUY" ? last-atr*1.3 : signal==="SELL" ? last+atr*1.3 : null,
    tp1: signal==="BUY" ? last+atr*1.5 : signal==="SELL" ? last-atr*1.5 : null,
    tp2: signal==="BUY" ? last+atr*2.5 : signal==="SELL" ? last-atr*2.5 : null,
    realtimeMode:"ADMIN_FIXED_FULL"
  };
  const alerts = ai.confidence >= 75 ? [{type:"SIGNAL", level:"HIGH", message:`${ai.signal} ${ai.confidence}% | ${ai.flow}`, time:Date.now()}] : [];
  return {ai, smc:{bos, supply, demand}, alerts};
}
module.exports = {buildAnalysis};