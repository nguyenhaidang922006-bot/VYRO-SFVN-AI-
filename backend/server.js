
const express = require("express");
const path = require("path");
const app = express();

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req,res)=>{
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/tick", async(req,res)=>{
  try{
    const r = await fetch("https://remote.sfvn-invest.com.vn/api/v1/tick/CP2CON26/last");
    const j = await r.json();
    res.json(j);
  }catch(e){
    res.json({error:e.message});
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log("VYRO running on", PORT));
