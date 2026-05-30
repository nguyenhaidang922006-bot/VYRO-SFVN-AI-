function num(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchJson(url){
  const r = await fetch(url, {
    headers: {
      "accept": "application/json,text/plain,*/*",
      "user-agent": "VYRO-SFVN-AI/2.0"
    }
  });
  if(!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return await r.json();
}

function deepArray(raw){
  if(Array.isArray(raw)) return raw;
  if(Array.isArray(raw?.data)) return raw.data;
  if(Array.isArray(raw?.data?.items)) return raw.data.items;
  if(Array.isArray(raw?.data?.rows)) return raw.data.rows;
  if(Array.isArray(raw?.data?.result)) return raw.data.result;
  if(Array.isArray(raw?.items)) return raw.items;
  if(Array.isArray(raw?.rows)) return raw.rows;
  if(raw?.data && typeof raw.data === "object"){
    for(const k of Object.keys(raw.data)){
      if(Array.isArray(raw.data[k])) return raw.data[k];
    }
  }
  return [];
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

function normalizeHistory(raw, tick){
  const arr = deepArray(raw);
  let out = arr.map(x=>({
    timestamp: x.timestamp || x.truncTime || x.time || x.date || Date.now(),
    open: num(x.open ?? x.o),
    high: num(x.high ?? x.h),
    low: num(x.low ?? x.l),
    close: num(x.close ?? x.last ?? x.c),
    volume: num(x.volume ?? x.v ?? x.cumulativeVolume ?? 0)
  })).filter(x => x.open!==null && x.high!==null && x.low!==null && x.close!==null);

  out = out.sort((a,b)=>Number(a.timestamp)-Number(b.timestamp));

  // fallback: nếu history không trả được mảng, vẫn tạo candle hiện tại từ tick để chart không trống
  if(out.length < 3 && tick?.last){
    const now = Date.now();
    const base = Number(tick.last);
    const o = Number(tick.open || base);
    const h = Number(tick.high || Math.max(o, base));
    const l = Number(tick.low || Math.min(o, base));
    out = [
      {timestamp:now-3600000*3, open:o, high:h, low:l, close:o, volume:0},
      {timestamp:now-3600000*2, open:o, high:h, low:l, close:(o+base)/2, volume:0},
      {timestamp:now-3600000, open:(o+base)/2, high:h, low:l, close:base, volume:tick.cumulativeVolume || 0}
    ];
  }

  return out;
}

function normalizeTrades(raw){
  const arr = deepArray(raw);
  return arr.map(x=>({
    tradeId: x.tradeId || x.id || "",
    symbol: x.symbol || "",
    side: num(x.side),
    price: num(x.price),
    qty: num(x.tradeQty ?? x.qty ?? x.volume ?? 0),
    time: x.transactTime || x.createdAt || x.updatedAt || Date.now()
  })).filter(x=>x.price!==null);
}

async function getMarketSnapshot(symbol="CP2CON26", tradeSymbol="F-XACM-NCP-202607"){
  const errors = [];
  let tickRaw = null, tick = null, history = [], trades = [];

  const tickUrl = `https://remote.sfvn-invest.com.vn/api/v1/tick/${symbol}/last`;
  const historyUrls = [
    `https://remote.sfvn-invest.com.vn/api/v2/prices/history?symbol=${symbol}&period=hour&factor=middle_ask_bid&timezone=Asia%2FJerusalem&source=ACM`,
    `https://remote.sfvn-invest.com.vn/api/v2/prices/history?symbol=${symbol}&period=day&factor=middle_ask_bid&timezone=Asia%2FJerusalem&source=ACM`
  ];
  const tradeUrls = [
    `https://remote.sfvn-invest.com.vn/api/v1/recent-trades?symbol=${tradeSymbol}&page=1&pageSize=50`,
    `https://remote.sfvn-invest.com.vn/api/v1/recent-trades?symbol=${symbol}&page=1&pageSize=50`
  ];

  try{
    tickRaw = await fetchJson(tickUrl);
    tick = normalizeTick(tickRaw, symbol);
  }catch(e){
    errors.push("tick: " + e.message);
  }

  for(const url of historyUrls){
    try{
      const raw = await fetchJson(url);
      history = normalizeHistory(raw, tick);
      if(history.length >= 3) break;
    }catch(e){
      errors.push("history: " + e.message);
    }
  }

  for(const url of tradeUrls){
    try{
      const raw = await fetchJson(url);
      trades = normalizeTrades(raw);
      if(trades.length > 0) break;
    }catch(e){
      errors.push("trades: " + e.message);
    }
  }

  return {tick, history, trades, errors};
}

module.exports = { getMarketSnapshot };