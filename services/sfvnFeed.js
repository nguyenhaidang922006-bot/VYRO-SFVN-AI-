// VYRO SFVN API Feed Service
// Fetches realtime tick + OHLC history from SFVN public API

const SFVN = {
  LAST_URL: 'https://remote.sfvn-invest.com.vn/api/v1/tick/CP2CON26/last',
  HISTORY_URL: 'https://remote.sfvn-invest.com.vn/api/v2/prices/history?symbol=CP2CON26&period=hour&factor=middle_ask_bid&timezone=Asia%2FJerusalem&source=ACM',
  RECENT_TRADES_URL: 'https://remote.sfvn-invest.com.vn/api/v1/recent-trades?symbol=CP2CON26&page=1&pageSize=50'
};

async function safeJson(url) {
  const res = await fetch(url, {
    headers: {
      'accept': 'application/json,text/plain,*/*',
      'user-agent': 'VYRO-SFVN-AI/1.0'
    }
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (_) { json = { raw: text }; }
  if (!res.ok) throw new Error(`SFVN API ${res.status}: ${text.slice(0, 200)}`);
  return json;
}

async function getLastTick() {
  const json = await safeJson(SFVN.LAST_URL);
  const d = json.data || json;
  return {
    symbol: d.symbol || 'CP2CON26',
    timestamp: Number(d.timestamp || Date.now()),
    open: Number(d.open),
    high: Number(d.high),
    low: Number(d.low),
    last: Number(d.last ?? d.close),
    close: Number(d.last ?? d.close),
    ask: Number(d.ask),
    bid: Number(d.bid),
    volume: Number(d.volume || 0),
    cumulativeVolume: Number(d.cumulativeVolume || 0),
    percentChange: Number(d.percentChange || 0)
  };
}

async function getHistory() {
  const json = await safeJson(SFVN.HISTORY_URL);
  const arr = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);
  return arr.map(c => ({
    timestamp: Number(c.timestamp || c.truncTime || c.time),
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close ?? c.last),
    volume: Number(c.volume || c.cumulativeVolume || 0)
  })).filter(c => Number.isFinite(c.close));
}

async function getRecentTrades() {
  try {
    const json = await safeJson(SFVN.RECENT_TRADES_URL);
    const arr = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);
    return arr.map(t => ({
      symbol: t.symbol,
      side: Number(t.side || 0),
      price: Number(t.price),
      qty: Number(t.tradeQty || t.qty || 0),
      time: Number(t.transactTime || t.createdAt || Date.now())
    })).filter(t => Number.isFinite(t.price));
  } catch (err) {
    // recent-trades may require exact broker symbol/auth; don't break realtime feed
    return { error: err.message, trades: [] };
  }
}

module.exports = { SFVN, getLastTick, getHistory, getRecentTrades };
