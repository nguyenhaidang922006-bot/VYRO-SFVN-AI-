
function enterAccess(){
  const code=document.getElementById("accessCode").value;

  if(code==="VYRO-8888"){
      localStorage.setItem("vyro_access","ok");

      document.getElementById("loginScreen").style.display="none";
      document.getElementById("app").style.display="block";
  }else{
      alert("Sai mã truy cập");
  }
}

window.onload=function(){
  if(localStorage.getItem("vyro_access")==="ok"){
      const login=document.getElementById("loginScreen");
      const app=document.getElementById("app");

      if(login) login.style.display="none";
      if(app) app.style.display="block";
  }
}
