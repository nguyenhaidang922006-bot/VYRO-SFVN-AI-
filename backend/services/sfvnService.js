function num(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchJson(url){
  const r = await fetch(url, {
    headers: {
      "accept": "application/json,text/plain,*/*",
      "user-agent": "VYRO-SFVN-AI/1.0"
    }
  });
  if(!r.ok) throw new Error(`${r.status} ${r.statusText} ${url}`);
  return await r.json();
}

function normalizeTick(raw, symbol){
  const d = raw?.data || raw || {};
  return {
    symbol: d.symbol || symbol,
    timestamp: d.timestamp || Date.now(),
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

function normalizeHistory(raw){
  const arr = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
  return arr.map(x=>({
    timestamp: x.timestamp || x.truncTime || x.time || Date.now(),
    open: num(x.open),
    high: num(x.high),
    low: num(x.low),
    close: num(x.close ?? x.last),
    volume: num(x.volume ?? x.cumulativeVolume ?? 0)
  })).filter(x => x.open!==null && x.high!==null && x.low!==null && x.close!==null);
}

async function getMarketSnapshot(symbol="CP2CON26"){
  const errors = [];
  let tick = null;
  let history = [];

  const tickUrl = `https://remote.sfvn-invest.com.vn/api/v1/tick/${symbol}/last`;
  const historyUrl = `https://remote.sfvn-invest.com.vn/api/v2/prices/history?symbol=${symbol}&period=hour&factor=middle_ask_bid&timezone=Asia%2FJerusalem&source=ACM`;

  try{
    tick = normalizeTick(await fetchJson(tickUrl), symbol);
  }catch(e){
    errors.push("tick: " + e.message);
  }

  try{
    history = normalizeHistory(await fetchJson(historyUrl));
  }catch(e){
    errors.push("history: " + e.message);
  }

  return {tick, history, errors};
}

module.exports = { getMarketSnapshot };