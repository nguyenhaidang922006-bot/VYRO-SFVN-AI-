let config = {
  accessCode: process.env.ACCESS_CODE || "VYRO-8888",
  adminPass: process.env.ADMIN_PASS || "ADMIN-2026",
  activeSymbol: process.env.SFVN_SYMBOL || "CP2CON26",
  symbols: [
    { key:"COPPER", name:"Đồng / Copper", symbol:"CP2CON26", note:"Đã test tick public" },
    { key:"SILVER", name:"Bạc / Silver", symbol:"SILVER_SYMBOL_HERE", note:"Đổi đúng mã bạc SFVN trong admin" },
    { key:"GOLD", name:"Vàng / Gold", symbol:"GOLD_SYMBOL_HERE", note:"Đổi đúng mã vàng SFVN trong admin" },
    { key:"COFFEE", name:"Cà phê / Coffee", symbol:"COFFEE_SYMBOL_HERE", note:"Đổi đúng mã cafe SFVN trong admin" },
    { key:"OIL", name:"Dầu / Oil", symbol:"OIL_SYMBOL_HERE", note:"Tùy chọn" },
    { key:"CORN", name:"Ngô / Corn", symbol:"CORN_SYMBOL_HERE", note:"Tùy chọn" },
    { key:"SOYBEAN", name:"Đậu nành / Soybean", symbol:"SOYBEAN_SYMBOL_HERE", note:"Tùy chọn" }
  ]
};

function getConfig(){ return config; }

function updateConfig(patch={}){
  if(typeof patch.accessCode === "string" && patch.accessCode.trim()) config.accessCode = patch.accessCode.trim();
  if(typeof patch.activeSymbol === "string" && patch.activeSymbol.trim()) config.activeSymbol = patch.activeSymbol.trim();
  if(Array.isArray(patch.symbols)) config.symbols = patch.symbols;
  return config;
}

function findSymbol(symbol){
  return config.symbols.find(x => x.symbol === symbol || x.key === symbol) || null;
}

module.exports = { getConfig, updateConfig, findSymbol };