(() => {
"use strict";
const tabs=[...document.querySelectorAll("[data-cosmic-mode]")];
const reactor=document.querySelector(".hud-main"),topbar=document.querySelector(".topbar"),mobile=document.querySelector(".mobile-nav");
const chat=document.querySelector("#cosmicChatMode"),avatar=document.querySelector("#cosmicAvatarMode");
let busy=false;
function showMode(mode){
 tabs.forEach(t=>t.classList.toggle("active",t.dataset.cosmicMode===mode));
 const isReactor=mode==="reactor";
 if(reactor)reactor.hidden=!isReactor;if(topbar)topbar.hidden=!isReactor;if(mobile)mobile.hidden=!isReactor;
 chat.hidden=mode!=="chat";avatar.hidden=mode!=="avatar";
 if(mode==="chat"&&!chat.dataset.ready){
  chat.dataset.ready="1";
  chat.innerHTML='<header class="cosmic-chat-head"><span>COSMIC / CONVERSATION</span><span id="cosmicChatState">CORE LINK READY</span></header><div class="cosmic-chat-log" id="cosmicChatLog"><div class="cosmic-chat-msg">COSMIC CHAT — Ask a question or give a command.</div></div><form class="cosmic-chat-compose" id="cosmicChatForm"><textarea id="cosmicChatInput" rows="2" placeholder="Message COSMIC…"></textarea><button type="submit">SEND ↗</button></form>';
  chat.querySelector("#cosmicChatForm").addEventListener("submit",sendChat);
 }
 if(mode==="avatar"&&!avatar.dataset.ready){
  avatar.dataset.ready="1";
  avatar.innerHTML='<div class="avatar-card"><div class="cosmic-chat-head">COSMIC / AVATAR MODE <span>PREVIEW</span></div><div class="avatar-orb" aria-hidden="true"></div><h2>AVATAR INTERFACE</h2><p>The Avatar workspace is ready for 3D integration. Realistic human animation, facial expressions and lip-sync require a rigged 3D model and live-audio connection; these are not yet active.</p></div>';
 }
}
function renderRichText(root,source){
 const lines=String(source).replace(/\r/g,"").split("\n");let paragraph=[];
 const flush=()=>{if(!paragraph.length)return;const p=document.createElement("p");renderInline(p,paragraph.join(" "));root.append(p);paragraph=[];};
 const renderInline=(parent,value)=>{const re=/\*\*(.+?)\*\*|`([^`]+)`|\*(.+?)\*/g;let last=0,m;while((m=re.exec(value))){parent.append(document.createTextNode(value.slice(last,m.index)));const node=document.createElement(m[1]?"strong":m[2]?"code":"em");node.textContent=m[1]||m[2]||m[3];parent.append(node);last=re.lastIndex;}parent.append(document.createTextNode(value.slice(last)));};
 for(let i=0;i<lines.length;i++){
  const line=lines[i];
  if(line.startsWith("```")){flush();const lang=line.slice(3).trim()||"code",code=[];while(++i<lines.length&&!lines[i].startsWith("```"))code.push(lines[i]);const wrap=document.createElement("section");wrap.className="cosmic-code-block";const head=document.createElement("header");head.append(document.createTextNode(lang.toUpperCase()));const copy=document.createElement("button");copy.type="button";copy.textContent="COPY CODE";copy.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(code.join("\n"));copy.textContent="COPIED";}catch(_){copy.textContent="COPY FAILED";}});head.append(copy);const pre=document.createElement("pre"),codeEl=document.createElement("code");codeEl.textContent=code.join("\n");pre.append(codeEl);wrap.append(head,pre);root.append(wrap);continue;}
  if(!line.trim()){flush();continue;}
  if(/^#{1,3} /.test(line)){flush();const n=line.match(/^#+/)[0].length,h=document.createElement("h"+n);renderInline(h,line.slice(n+1));root.append(h);continue;}
  if(/^[-*] /.test(line)){flush();let list=root.lastElementChild;if(!list||list.tagName!=="UL"){list=document.createElement("ul");root.append(list);}const li=document.createElement("li");renderInline(li,line.slice(2));list.append(li);continue;}
  paragraph.push(line);
 }
 flush();
}
async function sendChat(e){
 e.preventDefault();if(busy)return;
 const input=chat.querySelector("#cosmicChatInput"),log=chat.querySelector("#cosmicChatLog"),state=chat.querySelector("#cosmicChatState");
 const message=input.value.trim();if(!message)return;
 const add=(text,kind)=>{const el=document.createElement("div");el.className="cosmic-chat-msg "+kind;if(kind==="assistant")renderRichText(el,text);else el.textContent=text;log.append(el);log.scrollTop=log.scrollHeight;return el;};
 add(message,"user");input.value="";busy=true;state.textContent="PROCESSING…";
 const wait=add("Thinking…","assistant");
 try{
  const response=await fetch((window.COSMIC_API_BASE||"")+"/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message,task:"chat",mode:"auto",provider:"auto",model:"auto"})});
  const data=await response.json();if(!response.ok||data.success===false)throw new Error(data.error||data.message||"HTTP "+response.status);
  wait.replaceChildren();renderRichText(wait,data.message||data.response||data.text||"COSMIC returned an empty response.");state.textContent="CONNECTED";
 }catch(err){wait.className="cosmic-chat-msg system";wait.textContent="API ERROR: "+err.message;state.textContent="CONNECTION ERROR";}
 finally{busy=false;}
}
tabs.forEach(t=>t.addEventListener("click",()=>showMode(t.dataset.cosmicMode)));
showMode("reactor");
})();