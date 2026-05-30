// Drop this in frontend and call connectVYRO('wss://YOUR-RENDER-APP.onrender.com/ws')

function connectVYRO(wsUrl) {
  const ws = new WebSocket(wsUrl);
  ws.onopen = () => console.log('VYRO SFVN stream open');
  ws.onmessage = (ev) => {
    const data = JSON.parse(ev.data);
    if (!data.ai) return;
    window.VYRO_STATE = data;

    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val ?? '--';
    };

    set('vyro-symbol', data.ai.symbol);
    set('vyro-bid', data.ai.bid);
    set('vyro-ask', data.ai.ask);
    set('vyro-price', data.ai.price);
    set('vyro-signal', data.ai.signal);
    set('vyro-confidence', data.ai.confidence + '%');
    set('vyro-structure', data.ai.structure);
    set('vyro-boschoch', data.ai.bosChoch);
    set('vyro-liquidity', data.ai.liquidity);
    set('vyro-stophunt', data.ai.stopHunt);
    set('vyro-supply', data.ai.supply);
    set('vyro-demand', data.ai.demand);
    set('vyro-delta', data.ai.delta);
    set('vyro-flow', data.ai.flow);
    set('vyro-update', data.updatedAt);
  };
  ws.onerror = err => console.error('VYRO WS error', err);
  ws.onclose = () => setTimeout(() => connectVYRO(wsUrl), 3000);
}

window.connectVYRO = connectVYRO;
