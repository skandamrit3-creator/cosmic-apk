(() => {
"use strict";
const tabs=[...document.querySelectorAll("[data-cosmic-mode]")];
const reactor=document.querySelector(".hud-main");
const topbar=document.querySelector(".topbar");
const mobile=document.querySelector(".mobile-nav");
const chat=document.querySelector("#cosmicChatMode");
const avatar=document.querySelector("#cosmicAvatarMode");
let busy=false;
function showMode(mode){
 tabs.forEach(t=>t.classList.toggle("active",t.dataset.cosmicMode===mode));
 const isReactor=mode==="reactor";
 if(reactor) reactor.hidden=!isReactor;
 if(topbar) topbar.hidden=!isReactor;
 if(mobile) mobile.hidden=!isReactor;
 chat.hidden=mode!=="chat"; avatar.hidden=mode!=="avatar";
 if(mode==="chat"&&!chat.dataset.ready){
  chat.dataset.ready="1";
  chat.innerHTML='<header class="cosmic-chat-head"><span>COSMIC / CONVERSATION</span><span id="cosmicChatState">CORE LINK READY</span></header><div class="cosmic-chat-log" id="cosmicChatLog"><div class="cosmic-chat-msg">COSMIC CHAT<br>Ask a question or give a command. Responses use your existing /api/chat backend.</div></div><form class="cosmic-chat-compose" id="cosmicChatForm"><textarea id="cosmicChatInput" rows="2" placeholder="Message COSMIC…"></textarea><button type="submit">SEND ↗</button></form>';
  chat.querySelector("#cosmicChatForm").addEventListener("submit",sendChat);
 }
 if(mode==="avatar"&&!avatar.dataset.ready){
  avatar.dataset.ready="1";
  avatar.innerHTML='<div class="avatar-card"><div class="cosmic-chat-head">COSMIC / AVATAR MODE <span>PREVIEW</span></div><div class="avatar-orb" aria-hidden="true"></div><h2>AVATAR INTERFACE</h2><p>The Avatar workspace is established. A realistic animated 3D human, facial expressions and live lip-sync still require a compatible 3D model, animation rig and live-audio connection. This preview does not pretend those systems are active.</p></div>';
 }
}
async function sendChat(e){
 e.preventDefault(); if(busy)return;
 const input=chat.querySelector("#cosmicChatInput"),log=chat.querySelector("#cosmicChatLog"),state=chat.querySelector("#cosmicChatState");
 const message=input.value.trim(); if(!message)return;
 const add=(text,kind)=>{const el=document.createElement("div");el.className="cosmic-chat-msg "+kind;el.textContent=text;log.append(el);log.scrollTop=log.scrollHeight;return el;};
 add(message,"user");input.value="";busy=true;state.textContent="PROCESSING…";
 const wait=add("Thinking…","assistant");
 try{
  const response=await fetch((window.COSMIC_API_BASE||"")+"/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message,task:"chat",mode:"auto",provider:"auto",model:"auto"})});
  const data=await response.json();if(!response.ok||data.success===false)throw new Error(data.error||data.message||"HTTP "+response.status);
  wait.textContent=data.message||data.response||data.text||"COSMIC returned an empty response.";
  state.textContent="CONNECTED";
 }catch(err){wait.className="cosmic-chat-msg system";wait.textContent="API ERROR: "+err.message;state.textContent="CONNECTION ERROR";}
 finally{busy=false;}
}
tabs.forEach(t=>t.addEventListener("click",()=>showMode(t.dataset.cosmicMode)));
showMode("reactor");
})();