const num=v=>{const n=Number(v); return Number.isFinite(n)?n:null;};
function swingHigh(c,l=18){const a=(c||[]).slice(-l).map(x=>num(x.high)).filter(x=>x!==null);return a.length?Math.max(...a):null;}
function swingLow(c,l=18){const a=(c||[]).slice(-l).map(x=>num(x.low)).filter(x=>x!==null);return a.length?Math.min(...a):null;}
function detectSMC(tick={},state={}){
 const c=state.candles||[], r=c.slice(-20), lastC=r[r.length-1]||{}, prev=r[r.length-2]||{}, hi=swingHigh(c), lo=swingLow(c), last=num(tick.last);
 let bos="WAIT", choch="WAIT", sweep="WAIT", fvg="WAIT";
 if(last!==null&&hi!==null&&last>=hi) bos="BOS UP"; if(last!==null&&lo!==null&&last<=lo) bos="BOS DOWN";
 if(prev.close&&lastC.close){ if(prev.close<prev.open&&lastC.close>prev.high) choch="CHOCH UP"; if(prev.close>prev.open&&lastC.close<prev.low) choch="CHOCH DOWN"; }
 if(lastC.high>=hi&&lastC.close<hi) sweep="BUY SIDE SWEEP"; if(lastC.low<=lo&&lastC.close>lo) sweep="SELL SIDE SWEEP";
 const c3=r.slice(-3); if(c3.length===3){ if(c3[0].high<c3[2].low) fvg="BULLISH FVG"; if(c3[0].low>c3[2].high) fvg="BEARISH FVG"; }
 return {bos,choch,liquiditySweep:sweep,fvg,supply:hi,demand:lo,premiumDiscount:last&&hi&&lo?(last>(hi+lo)/2?"PREMIUM":"DISCOUNT"):"WAIT"};
}
function buildAI(tick={},state={},smc={}){
 const of=state.orderflow||{}, of5=state.orderflowM5||{}, last=num(tick.last), open=num(tick.open), high=num(tick.high), low=num(tick.low), bid=num(tick.bid), ask=num(tick.ask), cumVol=num(tick.cumulativeVolume)||0, c=state.candles||[];
 let signal="WAIT", bias="NEUTRAL", confidence=50;
 if(last!==null&&open!==null){ const range=Math.max(.00001,(high||last)-(low||last)), diff=last-open, strength=Math.min(24,Math.abs(diff/range)*24); if(diff>0){signal="BUY";bias="BULLISH";confidence=Math.round(55+strength);} else if(diff<0){signal="SELL";bias="BEARISH";confidence=Math.round(55+strength);} }
 if(of.imbalance>25&&of5.imbalance>=0){signal="BUY";bias="BULLISH FLOW";confidence=Math.min(93,confidence+10);} if(of.imbalance<-25&&of5.imbalance<=0){signal="SELL";bias="BEARISH FLOW";confidence=Math.min(93,confidence+10);}
 if(smc.bos==="BOS UP"){signal="BUY";bias="BOS BULLISH";confidence=Math.min(94,confidence+7);} if(smc.bos==="BOS DOWN"){signal="SELL";bias="BOS BEARISH";confidence=Math.min(94,confidence+7);}
 if(smc.liquiditySweep==="BUY SIDE SWEEP"&&of.imbalance<0){signal="SELL";bias="SWEEP REVERSAL";confidence=Math.min(92,confidence+8);} if(smc.liquiditySweep==="SELL SIDE SWEEP"&&of.imbalance>0){signal="BUY";bias="SWEEP REVERSAL";confidence=Math.min(92,confidence+8);}
 const recent=c.slice(-14); const atr=recent.reduce((s,x)=>s+Math.abs((x.high||0)-(x.low||0)),0)/Math.max(1,recent.length);
 let entry=last,tp1=null,tp2=null,sl=null; if(last!==null){ if(signal==="BUY"){tp1=last+atr*1.5;tp2=last+atr*2.5;sl=last-atr*1.3;} else if(signal==="SELL"){tp1=last-atr*1.5;tp2=last-atr*2.5;sl=last+atr*1.3;} }
 return {signal,confidence,bias,structure:bias.includes("BULL")||signal==="BUY"?"BULLISH STRUCTURE":bias.includes("BEAR")||signal==="SELL"?"BEARISH STRUCTURE":"SIDEWAY",liquidity:cumVol>100?"ACTIVE":"LOW",stopHunt:smc.liquiditySweep||"WAIT",fvg:smc.fvg,bos:smc.bos,choch:smc.choch,supply:smc.supply,demand:smc.demand,delta:of.delta??0,cvd:(state.cvd&&state.cvd.length)?state.cvd[state.cvd.length-1].value:0,flow:of.pressure||bias,imbalance:of.imbalance??0,spread:(ask!==null&&bid!==null)?Number((ask-bid).toFixed(6)):null,entry,tp1,tp2,sl,premiumDiscount:smc.premiumDiscount,realtimeMode:"PRO_FINAL_PROXY_PLUS_SMC",note:"Delta/flow hiện là proxy từ tick."};
}
function buildAlerts(ai){ const a=[]; if(ai.confidence>=80&&ai.signal!=="WAIT") a.push({type:"SIGNAL",level:"HIGH",message:`${ai.signal} ${ai.confidence}% | ${ai.flow}`,time:Date.now()}); if(ai.stopHunt&&ai.stopHunt!=="WAIT") a.push({type:"LIQUIDITY",level:"MEDIUM",message:ai.stopHunt,time:Date.now()}); if(ai.fvg&&ai.fvg!=="WAIT") a.push({type:"FVG",level:"MEDIUM",message:ai.fvg,time:Date.now()}); return a.slice(0,5);}
function buildAnalysis(tick,state){ const smc=detectSMC(tick,state); const ai=buildAI(tick,state,smc); return {smc,ai,alerts:buildAlerts(ai)}; }
module.exports={buildAnalysis};
