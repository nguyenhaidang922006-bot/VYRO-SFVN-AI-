// VYRO SFVN AI Backend update
// Install: npm i express cors ws
// Run: node server.js

const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
const { getLastTick, getHistory, getRecentTrades } = require('./services/sfvnFeed');
const { analyze } = require('./services/aiEngine');

const PORT = process.env.PORT || 10000;
const app = express();
app.use(cors());
app.use(express.json());

let cache = {
  tick: null,
  candles: [],
  trades: [],
  ai: null,
  error: null,
  updatedAt: null
};

async function refresh() {
  try {
    const [tick, candles, tradeResult] = await Promise.all([
      getLastTick(),
      getHistory(),
      getRecentTrades()
    ]);
    const trades = Array.isArray(tradeResult) ? tradeResult : [];
    const ai = analyze({ tick, candles, trades });
    cache = { tick, candles, trades, ai, error: tradeResult?.error || null, updatedAt: new Date().toISOString() };
    broadcast({ type: 'VYRO_SFVN_REALTIME', ...cache });
  } catch (err) {
    cache.error = err.message;
    cache.updatedAt = new Date().toISOString();
    broadcast({ type: 'VYRO_SFVN_ERROR', error: err.message, updatedAt: cache.updatedAt });
  }
}

app.get('/', (_, res) => res.json({ ok: true, name: 'VYRO SFVN AI Backend', cacheUpdatedAt: cache.updatedAt }));
app.get('/api/sfvn/last', (_, res) => res.json(cache.tick || {}));
app.get('/api/sfvn/history', (_, res) => res.json(cache.candles || []));
app.get('/api/sfvn/recent-trades', (_, res) => res.json(cache.trades || []));
app.get('/api/vyro/realtime', (_, res) => res.json(cache));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'VYRO_SFVN_REALTIME', ...cache }));
});

refresh();
setInterval(refresh, 1000);

server.listen(PORT, () => console.log(`VYRO SFVN AI Backend running on ${PORT}`));
