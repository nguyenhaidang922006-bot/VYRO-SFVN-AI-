let config = {
  accessCode: process.env.ACCESS_CODE || "VYRO-8888",
  adminPass: process.env.ADMIN_PASS || "ADMIN-2026",
  activeSymbol: process.env.SFVN_SYMBOL || "CP2CON26",
  users: [{ code:"VYRO-8888", plan:"PRO", active:true, note:"Default code" }],
  symbols: [
    { key:"COPPER", name:"Đồng / Copper", symbol:"CP2CON26", note:"Đã test tick public" },
    { key:"SILVER", name:"Bạc / Silver", symbol:"SILVER_SYMBOL_HERE", note:"Sửa đúng mã bạc SFVN" },
    { key:"GOLD", name:"Vàng / Gold", symbol:"GOLD_SYMBOL_HERE", note:"Sửa đúng mã vàng SFVN" },
    { key:"COFFEE", name:"Cà phê / Coffee", symbol:"COFFEE_SYMBOL_HERE", note:"Sửa đúng mã cafe SFVN" },
    { key:"OIL", name:"Dầu / Oil", symbol:"OIL_SYMBOL_HERE", note:"Tùy chọn" },
    { key:"CORN", name:"Ngô / Corn", symbol:"CORN_SYMBOL_HERE", note:"Tùy chọn" },
    { key:"SOYBEAN", name:"Đậu nành / Soybean", symbol:"SOYBEAN_SYMBOL_HERE", note:"Tùy chọn" }
  ]
};
function getConfig(){ return config; }
function isValidCode(code){
  const c = String(code || "").trim();
  if(c === config.accessCode) return true;
  return config.users.some(u => u.active && u.code === c);
}
function updateConfig(patch={}){
  if(typeof patch.accessCode === "string" && patch.accessCode.trim()) config.accessCode = patch.accessCode.trim();
  if(typeof patch.activeSymbol === "string" && patch.activeSymbol.trim()) config.activeSymbol = patch.activeSymbol.trim();
  if(Array.isArray(patch.symbols)) config.symbols = patch.symbols;
  if(Array.isArray(patch.users)) config.users = patch.users;
  return config;
}
module.exports = { getConfig, updateConfig, isValidCode };
