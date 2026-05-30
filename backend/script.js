// VYRO SFVN FRONTEND FIX V1.1
// Fix: backend sends custom SSE event "snapshot", so frontend must listen to addEventListener("snapshot")

const S = {
  symbol: "CP2CON26",
  es: null,
  snap: null
};

const $ = id => document.getElementById(id);
const fmt = v => Number.isFinite(Number(v)) ? Number(v).toFixed(4) : "--";

function set(id, val) {
  const el = $(id);
  if (el && el.textContent !== String(val)) el.textContent = String(val);
}

async function connect() {
  S.symbol = ($("symbol")?.value || "CP2CON26").trim() || "CP2CON26";

  set("sym", S.symbol);
  set("status", "CONNECTING");

  if (S.es) {
    try { S.es.close(); } catch (_) {}
    S.es = null;
  }

  // 1) Load snapshot first, so the UI does not stay blank while SSE starts
  try {
    const r = await fetch(`/api/snapshot?symbol=${encodeURIComponent(S.symbol)}&t=${Date.now()}`, { cache: "no-store" });
    const s = await r.json();
    if (s && s.ok) {
      S.snap = s;
      render(s);
      set("status", "LIVE");
    } else {
      console.warn("snapshot error", s);
      set("status", "API ERROR");
    }
  } catch (e) {
    console.error("snapshot fetch failed", e);
    set("status", "API ERROR");
  }

  // 2) Realtime stream: server sends event: snapshot, NOT normal message
  S.es = new EventSource(`/api/stream?symbol=${encodeURIComponent(S.symbol)}&t=${Date.now()}`);

  S.es.addEventListener("open", () => {
    set("status", "STREAM OPEN");
  });

  S.es.addEventListener("snapshot", ev => {
    try {
      const s = JSON.parse(ev.data);
      if (s && s.ok) {
        S.snap = s;
        render(s);
        set("status", "LIVE");
      }
    } catch (e) {
      console.error("bad snapshot event", e, ev.data);
    }
  });

  S.es.addEventListener("error", ev => {
    console.error("stream error", ev);
    set("status", "STREAM ERROR");
  });
}

function render(s) {
  if (!s || !s.ok) return;

  set("updated", new Date().toLocaleTimeString("vi-VN"));

  const l = s.last || {};
  const ai = s.ai || {};

  set("sym", s.symbol || S.symbol);
  set("last", fmt(l.last || ai.price));
  set("bid", fmt(l.bid));
  set("ask", fmt(l.ask));

  set("signal", ai.signal || "WAIT");
  set("conf", ai.confidence !== undefined ? `${Math.round(ai.confidence)}%` : "--");
  set("confidence", ai.confidence !== undefined ? `${Math.round(ai.confidence)}%` : "--");

  set("structure", ai.structure || ai.trend || "--");
  set("bos", ai.bosChoch || ai.bos || "--");
  set("liq", ai.liquidity || "--");
  set("liquidity", ai.liquidity || "--");
  set("stop", ai.stopHunt || "--");
  set("stophunt", ai.stopHunt || "--");

  set("supply", fmt(ai.sellZone || ai.supply));
  set("demand", fmt(ai.buyZone || ai.demand));
  set("delta", fmt(ai.delta));
  set("flow", fmt(ai.flow));

  set("tp1", fmt(ai.tp1));
  set("tp2", fmt(ai.tp2));
  set("tp3", fmt(ai.tp3));
  set("sl", fmt(ai.sl));

  draw(s.history || [], ai);
}

function draw(candles, ai = {}) {
  const c = $("chart");
  if (!c) return;

  const ctx = c.getContext("2d");
  const box = c.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  if (c.width !== Math.floor(box.width * dpr) || c.height !== Math.floor(box.height * dpr)) {
    c.width = Math.floor(box.width * dpr);
    c.height = Math.floor(box.height * dpr);
  }

  const W = box.width;
  const H = box.height;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#08275c");
  bg.addColorStop(1, "#030715");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const view = Array.isArray(candles) ? candles.slice(-120) : [];

  if (!view.length) {
    ctx.fillStyle = "#7aa2ff";
    ctx.font = "16px Arial";
    ctx.fillText("WAITING SFVN MARKET DATA...", 30, 42);
    return;
  }

  const L = 55, R = 75, T = 35, B = 45;
  const PW = W - L - R;
  const PH = H - T - B;

  ctx.strokeStyle = "rgba(90,170,255,.18)";
  for (let i = 0; i <= 8; i++) {
    const x = L + i * PW / 8;
    ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + PH); ctx.stroke();
  }
  for (let i = 0; i <= 6; i++) {
    const y = T + i * PH / 6;
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + PW, y); ctx.stroke();
  }

  const vals = [];
  view.forEach(x => vals.push(Number(x.high), Number(x.low), Number(x.close)));
  [ai.sellZone, ai.buyZone, ai.tp1, ai.tp2, ai.tp3].forEach(x => {
    if (Number.isFinite(Number(x))) vals.push(Number(x));
  });

  let min = Math.min(...vals.filter(Number.isFinite));
  let max = Math.max(...vals.filter(Number.isFinite));
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) { min = 0; max = 1; }
  const pad = (max - min) * 0.18 || 1;
  min -= pad; max += pad;

  const y = v => T + (max - Number(v)) / (max - min) * PH;

  function level(val, color, label) {
    const n = Number(val);
    if (!Number.isFinite(n)) return;
    const yy = y(n);
    ctx.strokeStyle = color;
    ctx.setLineDash([7, 5]);
    ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(L + PW, yy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = "800 12px Arial";
    ctx.fillText(`${label} ${fmt(n)}`, L + 8, yy - 7);
  }

  level(ai.sellZone, "#ff5ca8", "SUPPLY");
  level(ai.buyZone, "#4fffd6", "DEMAND");
  level(ai.tp1, "#ffd76a", "TP1");
  level(ai.tp2, "#ffd76a", "TP2");
  level(ai.tp3, "#ffd76a", "TP3");

  const cw = Math.max(3, PW / view.length * 0.58);

  view.forEach((bar, i) => {
    const xx = L + (i + 0.5) * PW / view.length;
    const up = Number(bar.close) >= Number(bar.open);
    const col = up ? "#4fffd6" : "#ff5c9d";

    ctx.strokeStyle = col;
    ctx.fillStyle = col;

    ctx.beginPath();
    ctx.moveTo(xx, y(bar.high));
    ctx.lineTo(xx, y(bar.low));
    ctx.stroke();

    const top = Math.min(y(bar.open), y(bar.close));
    const hh = Math.max(2, Math.abs(y(bar.open) - y(bar.close)));
    ctx.fillRect(xx - cw / 2, top, cw, hh);
  });

  const last = Number(view.at(-1).close);
  const yy = y(last);

  ctx.strokeStyle = "rgba(111,255,216,.75)";
  ctx.setLineDash([5, 5]);
  ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(L + PW, yy); ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "#6fffd8";
  ctx.fillRect(L + PW + 8, yy - 13, 70, 26);
  ctx.fillStyle = "#001c24";
  ctx.font = "900 12px Arial";
  ctx.fillText(fmt(last), L + PW + 13, yy + 4);

  ctx.fillStyle = "#eaf6ff";
  ctx.font = "900 14px Arial";
  ctx.fillText(`VYRO SFVN V1.1 · ${S.symbol}`, L, T - 12);
}

$("connect").onclick = connect;
connect();
