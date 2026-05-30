// Lightweight VYRO AI Engine v1
// Uses tick + OHLC to produce WAIT/BUY/SELL and basic SMC-style fields

function analyze({ tick, candles = [], trades = [] }) {
  const last = Number(tick?.last || tick?.close || 0);
  const bid = Number(tick?.bid || 0);
  const ask = Number(tick?.ask || 0);
  const pct = Number(tick?.percentChange || 0);
  const recent = candles.slice(-20);
  const highs = recent.map(c => Number(c.high)).filter(Number.isFinite);
  const lows = recent.map(c => Number(c.low)).filter(Number.isFinite);
  const closes = recent.map(c => Number(c.close)).filter(Number.isFinite);
  const resistance = highs.length ? Math.max(...highs) : null;
  const support = lows.length ? Math.min(...lows) : null;
  const avgClose = closes.length ? closes.reduce((a,b)=>a+b,0) / closes.length : last;

  let buyVol = 0, sellVol = 0;
  if (Array.isArray(trades)) {
    for (const t of trades) {
      if (Number(t.side) === 1) buyVol += Number(t.qty || 0);
      else if (Number(t.side) === 2) sellVol += Number(t.qty || 0);
    }
  }
  const delta = buyVol - sellVol;

  let signal = 'WAIT';
  let confidence = 45;
  const aboveAvg = last > avgClose;
  const nearSupport = support && last <= support + (resistance - support) * 0.25;
  const nearResistance = resistance && last >= support + (resistance - support) * 0.75;

  if (aboveAvg && pct > 0 && delta >= 0) { signal = 'BUY'; confidence = 62; }
  if (!aboveAvg && pct < 0 && delta <= 0) { signal = 'SELL'; confidence = 62; }
  if (nearSupport && delta >= 0) { signal = 'BUY'; confidence = Math.max(confidence, 68); }
  if (nearResistance && delta <= 0) { signal = 'SELL'; confidence = Math.max(confidence, 68); }

  const structure = last > avgClose ? 'BULLISH' : last < avgClose ? 'BEARISH' : 'RANGE';
  const liquidity = resistance && support ? `High ${resistance.toFixed(4)} / Low ${support.toFixed(4)}` : '--';
  const stopHunt = resistance && last > resistance ? 'SWEEP HIGH' : support && last < support ? 'SWEEP LOW' : '--';

  return {
    signal,
    confidence,
    symbol: tick?.symbol || 'CP2CON26',
    price: last,
    bid,
    ask,
    percentChange: pct,
    structure,
    bosChoch: structure,
    liquidity,
    stopHunt,
    supply: resistance ? resistance.toFixed(4) : '--',
    demand: support ? support.toFixed(4) : '--',
    delta,
    flow: delta > 0 ? 'BUY FLOW' : delta < 0 ? 'SELL FLOW' : 'NEUTRAL',
    updatedAt: new Date().toISOString()
  };
}

module.exports = { analyze };
