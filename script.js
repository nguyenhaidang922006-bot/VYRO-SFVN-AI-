const S = {
  symbol: 'CP2CON26',
  es: null,
  snap: null
};

const $ = id => document.getElementById(id);

const fmt = v =>
  Number.isFinite(Number(v))
    ? Number(v).toFixed(4)
    : '--';

function set(id, val) {
  if ($(id)) $(id).innerText = val;
}

async function connect() {

  S.symbol = $('symbol').value.trim() || 'CP2CON26';

  set('sym', S.symbol);
  set('status', 'CONNECTING');

  if (S.es) {
    S.es.close();
  }

  // SNAPSHOT
  try {

    const r = await fetch(`/api/snapshot?symbol=${S.symbol}`);
    const s = await r.json();

    if (s.ok) {
      render(s);
      draw(s.history || []);
      set('status', 'LIVE');
    }

  } catch (e) {
    console.log(e);
    set('status', 'ERROR');
  }

  // REALTIME STREAM
  S.es = new EventSource(`/api/stream?symbol=${S.symbol}`);

  S.es.onmessage = ev => {
    try {

      const s = JSON.parse(ev.data);

      render(s);

      if (s.history) {
        draw(s.history);
      }

    } catch (e) {
      console.log(e);
    }
  };

  S.es.onerror = () => {
    set('status', 'RECONNECT...');
  };
}

function render(s) {

  if (!s || !s.ok) return;

  set('updated', new Date().toLocaleTimeString('vi-VN'));

  const l = s.last || {};

  set('bid', fmt(l.bid));
  set('ask', fmt(l.ask));
  set('last', fmt(l.last));
  set('vol', l.volume || 0);

  const ai = s.ai || {};

  set('signal', ai.signal || 'WAIT');
  set('confidence', ai.confidence || '--');
  set('structure', ai.structure || '--');
  set('bos', ai.bos || '--');
  set('liquidity', ai.liquidity || '--');
  set('stophunt', ai.stopHunt || '--');
  set('supply', ai.supply || '--');
  set('demand', ai.demand || '--');
  set('delta', ai.delta || '--');
  set('flow', ai.flow || '--');
}

function draw(candles) {

  const c = $('chart');

  if (!c) return;

  const ctx = c.getContext('2d');

  const box = c.getBoundingClientRect();

  const dpr = window.devicePixelRatio || 1;

  if (c.width !== Math.floor(box.width * dpr)) {
    c.width = Math.floor(box.width * dpr);
    c.height = Math.floor(box.height * dpr);
  }

  ctx.scale(dpr, dpr);

  const W = box.width;
  const H = box.height;

  ctx.clearRect(0, 0, W, H);

  if (!candles || !candles.length) {

    ctx.fillStyle = '#7aa2ff';
    ctx.font = '16px Arial';
    ctx.fillText('WAITING MARKET DATA...', 30, 40);

    return;
  }

  const max = Math.max(...candles.map(x => x.high));
  const min = Math.min(...candles.map(x => x.low));

  const pad = 20;

  const cw = (W - pad * 2) / candles.length;

  candles.forEach((k, i) => {

    const x = pad + i * cw;

    const yH = H - ((k.high - min) / (max - min)) * (H - 40);
    const yL = H - ((k.low - min) / (max - min)) * (H - 40);
    const yO = H - ((k.open - min) / (max - min)) * (H - 40);
    const yC = H - ((k.close - min) / (max - min)) * (H - 40);

    const up = k.close >= k.open;

    ctx.strokeStyle = up ? '#00ff88' : '#ff4d6d';
    ctx.fillStyle = up ? '#00ff88' : '#ff4d6d';

    ctx.beginPath();
    ctx.moveTo(x + cw / 2, yH);
    ctx.lineTo(x + cw / 2, yL);
    ctx.stroke();

    ctx.fillRect(
      x,
      Math.min(yO, yC),
      cw * 0.7,
      Math.max(2, Math.abs(yC - yO))
    );
  });
}

$('connect').onclick = connect;

connect();
