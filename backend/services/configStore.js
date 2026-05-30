let config = {
  accessCode: process.env.ACCESS_CODE || "VYRO-8888",
  adminPass: process.env.ADMIN_PASS || "pass-admin-cua-anh",
  activeSymbol: process.env.SFVN_SYMBOL || "CP2CON26",
  symbols: [
    {name:"Đồng / Copper", symbol:"CP2CON26", note:"Đã test"},
    {name:"Bạc / Silver", symbol:"SILVER_SYMBOL_HERE", note:"Sửa đúng mã SFVN"},
    {name:"Vàng / Gold", symbol:"GOLD_SYMBOL_HERE", note:"Sửa đúng mã SFVN"},
    {name:"Cà phê / Coffee", symbol:"COFFEE_SYMBOL_HERE", note:"Sửa đúng mã SFVN"}
  ],
  users: [{code:"VYRO-8888", plan:"PRO", active:true, note:"Default"}]
};

function getConfig(){ return config; }
function isValidCode(code){
  const c = String(code || "").trim();
  if(c === config.accessCode) return true;
  return config.users.some(u => u.active && u.code === c);
}
function updateConfig(patch={}){
  if(patch.accessCode) config.accessCode = String(patch.accessCode).trim();
  if(patch.activeSymbol) config.activeSymbol = String(patch.activeSymbol).trim();
  if(Array.isArray(patch.symbols)) config.symbols = patch.symbols;
  if(Array.isArray(patch.users)) config.users = patch.users;
  return config;
}
module.exports = {getConfig, isValidCode, updateConfig};