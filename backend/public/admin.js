function $(id){ return document.getElementById(id); }
function getPass(){ return localStorage.getItem("VYRO_ADMIN_PASS") || ""; }
async function adminFetch(path, options={}){
  const pass = getPass();
  const res = await fetch(path, {...options, headers: {"content-type":"application/json","x-admin-pass":pass, ...(options.headers||{})}});
  if(res.status === 401){
    localStorage.removeItem("VYRO_ADMIN_PASS"); $("adminPanel").classList.add("hidden"); $("adminLogin").classList.remove("hidden"); $("adminMsg").innerText = "Sai pass admin."; throw new Error("ADMIN_PASS_REQUIRED");
  }
  return await res.json();
}
function adminLogin(){ const pass = $("adminPass").value.trim(); if(!pass){ $("adminMsg").innerText = "Nhập pass admin."; return; } localStorage.setItem("VYRO_ADMIN_PASS", pass); $("adminLogin").classList.add("hidden"); $("adminPanel").classList.remove("hidden"); loadAdmin(); }
async function loadAdmin(){ const j = await adminFetch("/api/admin/config"); $("accessCodeInput").value = j.accessCode || ""; $("activeSymbolInput").value = j.activeSymbol || ""; renderSymbols(j.symbols || []); }
function renderSymbols(symbols){ const box = $("symbolsBox"); box.innerHTML = ""; symbols.forEach((s,i)=>{ const row = document.createElement("div"); row.className = "symRow"; row.innerHTML = `<input data-i="${i}" data-k="name" value="${s.name||""}"/><input data-i="${i}" data-k="symbol" value="${s.symbol||""}"/><input data-i="${i}" data-k="note" value="${s.note||""}"/>`; box.appendChild(row); }); window._symbols = symbols; }
function collectSymbols(){ const symbols = window._symbols || []; document.querySelectorAll("#symbolsBox input").forEach(inp=>{ const i = Number(inp.dataset.i), k = inp.dataset.k; symbols[i][k] = inp.value; }); return symbols; }
async function saveAdmin(){ const body = {accessCode: $("accessCodeInput").value.trim(), activeSymbol: $("activeSymbolInput").value.trim(), symbols: collectSymbols()}; await adminFetch("/api/admin/config", {method:"POST", body:JSON.stringify(body)}); alert("Đã lưu admin config"); }
async function saveSymbols(){ await saveAdmin(); }
if(getPass()){ $("adminLogin").classList.add("hidden"); $("adminPanel").classList.remove("hidden"); loadAdmin(); }