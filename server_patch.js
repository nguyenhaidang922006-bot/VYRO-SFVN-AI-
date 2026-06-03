
// V37 MID PRICE FIX
// Replace old live.price logic with this

function getMidPrice(bid, ask, fallback){
  if(Number.isFinite(bid) && Number.isFinite(ask)){
    return Number(((bid + ask) / 2).toFixed(4));
  }
  return fallback;
}

// example realtime tick parse
function parseTick(tick){
  const bid = Number(tick.bid);
  const ask = Number(tick.ask);

  const fallback =
    Number(tick.lt ?? tick.c ?? tick.price ?? tick.last);

  const price = getMidPrice(bid, ask, fallback);

  return {
    bid,
    ask,
    price
  };
}
