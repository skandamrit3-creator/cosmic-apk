(() => {
"use strict";
const base=()=>String(window.COSMIC_API_BASE||window.location.origin).replace(/\/+$/,"");
async function check(){
 const badge=document.querySelector("#connection");if(badge){badge.textContent="CHECKING BACKEND…";badge.style.color="#a9c1d4";}
 try{
  const health=await fetch(base()+"/api/health",{cache:"no-store"});if(!health.ok)throw new Error("Health HTTP "+health.status);
  const data=await health.json();if(!data.success||data.status!=="healthy")throw new Error("Backend did not report healthy");
  const models=await fetch(base()+"/api/ai/models",{cache:"no-store"});if(!models.ok)throw new Error("Model endpoint HTTP "+models.status);
  const payload=await models.json();if(!payload.success||!Array.isArray(payload.models))throw new Error("Invalid model catalog");
  if(badge){badge.textContent="BACKEND ONLINE";badge.style.color="#a5ddca";}
  document.dispatchEvent(new CustomEvent("cosmic:backend-status",{detail:{online:true,version:data.version,models:payload.models.length,base:base()}}));
  return {success:true,version:data.version,models:payload.models.length};
 }catch(error){
  if(badge){badge.textContent="BACKEND OFFLINE";badge.style.color="#eab6c5";}
  document.dispatchEvent(new CustomEvent("cosmic:backend-status",{detail:{online:false,error:error.message,base:base()}}));
  return {success:false,error:error.message};
 }
}
window.COSMIC_INTEGRATIONS={checkBackend:check,getBackendUrl:base};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",check,{once:true});else check();
window.addEventListener("online",check);
window.addEventListener("focus",()=>{if(document.visibilityState==="visible")check();});
})();