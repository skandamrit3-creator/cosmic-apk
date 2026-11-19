/* COSMIC MYRAA voice bridge: one voice session owner. */
(()=>{
"use strict";
if(window.MYRAA_BRIDGE_READY)return;
window.MYRAA_BRIDGE_READY=true;
const live=()=>window.COSMIC_LIVE||null;
const status=(message)=>{
 const el=document.getElementById("chatStatus");
 if(el)el.textContent=message;
};
window.MYRAA={
 async start(){
  const engine=live();
  if(!engine||typeof engine.start!=="function"){
   status("Voice engine is loading. Please try again.");
   return false;
  }
  try{
   await engine.start(false);
   status("MYRAA voice · connecting");
   return true;
  }catch(error){
   status("Voice unavailable · "+(error?.message||"connection failed"));
   console.error("MYRAA voice:",error);
   return false;
  }
 },
 stop(){
  const engine=live();
  if(engine&&typeof engine.stop==="function")engine.stop();
  status("MYRAA voice · stopped");
 },
 async command(text){
  const input=document.getElementById("chatInput");
  if(!input)return false;
  input.value=String(text||"").trim();
  input.dispatchEvent(new Event("input",{bubbles:true}));
  const form=document.getElementById("chatForm");
  if(form&&input.value){form.requestSubmit();return true}
  return false;
 }
};
document.addEventListener("click",event=>{
 const mic=event.target.closest("#myraa-mic");
 if(mic){event.preventDefault();window.MYRAA.start()}
 const close=event.target.closest("#myraa-close,.myraa-back");
 if(close)window.MYRAA.stop();
});
document.addEventListener("change",event=>{
 if(event.target.id==="myraa-wake"){
  const engine=live();
  if(event.target.checked&&engine?.enableWakeWord)engine.enableWakeWord();
  else if(!event.target.checked&&engine?.disableWakeWord)engine.disableWakeWord();
 }
});
console.info("COSMIC MYRAA bridge ready");
})();
