(() => {
"use strict";
const tabs=[...document.querySelectorAll("[data-cosmic-mode]")];
const reactor=document.querySelector(".hud-main"),topbar=document.querySelector(".topbar"),mobile=document.querySelector(".mobile-nav");
const chat=document.querySelector("#cosmicChatMode"),avatar=document.querySelector("#cosmicAvatarMode");
let busy=false, sessionId=localStorage.getItem("cosmic.chat.session.v1")||("chat-"+Date.now().toString(36)), lastPrompt="";
localStorage.setItem("cosmic.chat.session.v1",sessionId);
const apiBase=()=>String(window.COSMIC_API_BASE||window.location.origin).replace(/\/$/,"");
function showMode(mode){
 tabs.forEach(t=>t.classList.toggle("active",t.dataset.cosmicMode===mode));
 const isReactor=mode==="reactor";
 if(reactor)reactor.hidden=!isReactor;if(topbar)topbar.hidden=!isReactor;if(mobile)mobile.hidden=!isReactor;
 chat.hidden=mode!=="chat";avatar.hidden=mode!=="avatar";
 if(mode==="chat"&&!chat.dataset.ready){
  chat.dataset.ready="1";
  chat.innerHTML='<div class="cosmic-chat-layout"><aside class="cosmic-history" id="cosmicHistoryPanel"><div class="cosmic-history-head"><b>CHAT HISTORY</b><button id="cosmicNewChat" type="button">＋ NEW CHAT</button></div><div id="cosmicHistoryList"></div></aside><section class="cosmic-chat-main"><header class="cosmic-chat-head"><span>COSMIC / CHAT</span><span id="cosmicChatState">CORE LINK READY</span><button id="cosmicHistoryToggle" type="button" aria-expanded="true">☰ HISTORY</button></header><div class="cosmic-chat-controls"><label>PROVIDER <select id="cosmicChatProvider"><option value="auto">AUTO</option></select></label><label>MODEL <select id="cosmicChatModel"><option value="auto">AUTO</option></select></label></div><div class="cosmic-chat-log" id="cosmicChatLog"><div class="cosmic-chat-msg">COSMIC CHAT — Ask a question or give a command.</div></div><form class="cosmic-chat-compose" id="cosmicChatForm"><textarea id="cosmicChatInput" rows="2" placeholder="Message COSMIC…"></textarea><button id="cosmicVoice" type="button">VOICE</button><button type="submit">SEND ↗</button></form></section></div>';
  chat.querySelector("#cosmicChatForm").addEventListener("submit",sendChat);
  chat.querySelector("#cosmicNewChat").onclick=newChat;
  chat.querySelector("#cosmicHistoryToggle").onclick=()=>{const panel=chat.querySelector("#cosmicHistoryPanel");panel.hidden=!panel.hidden;chat.querySelector("#cosmicHistoryToggle").setAttribute("aria-expanded",String(!panel.hidden));};
  chat.querySelector("#cosmicVoice").onclick=startVoice;
  loadModels();loadChats();
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
 const message=input.value.trim();if(!message)return;lastPrompt=message;
 const add=(text,kind)=>{const el=document.createElement("div");el.className="cosmic-chat-msg "+kind;if(kind==="assistant")renderRichText(el,text);else el.textContent=text;log.append(el);log.scrollTop=log.scrollHeight;return el;};
 add(message,"user");input.value="";busy=true;state.textContent="PROCESSING…";
 const wait=add("Thinking…","assistant");
 try{
  const response=await fetch(apiBase()+"/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message,task:"chat",mode:chat.querySelector("#cosmicChatProvider")?.value==="auto"?"auto":"manual",provider:chat.querySelector("#cosmicChatProvider")?.value||"auto",model:chat.querySelector("#cosmicChatModel")?.value||"auto",session_id:sessionId})});
  const data=await response.json();if(!response.ok||data.success===false)throw new Error(data.error||data.message||"HTTP "+response.status);
  wait.replaceChildren();renderRichText(wait,data.message||data.response||data.text||"COSMIC returned an empty response.");const tools=document.createElement("div");tools.className="cosmic-message-tools";const speak=document.createElement("button");speak.type="button";speak.textContent="🔊 SPEAK";speak.onclick=()=>speakText(data.message||data.response||data.text||"");const edit=document.createElement("button");edit.type="button";edit.textContent="EDIT PROMPT";edit.onclick=()=>{input.value=lastPrompt;input.focus();};tools.append(speak,edit);if(data.provider){const tag=document.createElement("span");tag.className="cosmic-model-tag";tag.textContent=data.provider+" · "+(data.model||"");tools.append(tag);}wait.append(tools);state.textContent="CONNECTED";
 }catch(err){wait.className="cosmic-chat-msg system";wait.textContent="API ERROR: "+err.message;state.textContent="CONNECTION ERROR";}
 finally{busy=false;}
}

async function loadModels(){const p=chat.querySelector("#cosmicChatProvider"),m=chat.querySelector("#cosmicChatModel");try{const r=await fetch(apiBase()+"/api/ai/models"),d=await r.json();const all=d.models||[];[...new Set(all.map(x=>x.provider))].forEach(x=>p.add(new Option(x.toUpperCase(),x)));function fill(){m.replaceChildren(new Option("AUTOMATIC","auto"));all.filter(x=>p.value==="auto"||x.provider===p.value).forEach(x=>{const o=new Option(x.label+(x.configured?"":" (KEY MISSING)"),x.provider+":"+x.id);o.disabled=!x.configured;m.add(o);});}p.onchange=fill;fill();}catch(e){chat.querySelector("#cosmicChatState").textContent="MODEL LIST ERROR";}}
async function loadChats(){const list=chat.querySelector("#cosmicHistoryList");try{const d=await(await fetch(apiBase()+"/api/chats")).json();list.replaceChildren();(d.items||[]).forEach(x=>{const b=document.createElement("button");b.className="cosmic-history-item";b.textContent=(x.title||"Untitled").slice(0,60);b.onclick=()=>openChat(x.session_id);list.append(b);});}catch(e){list.textContent="History unavailable";}}
async function openChat(id){sessionId=id;localStorage.setItem("cosmic.chat.session.v1",id);const log=chat.querySelector("#cosmicChatLog");log.replaceChildren();try{const d=await(await fetch(apiBase()+"/api/history?session_id="+encodeURIComponent(id))).json();(d.items||[]).forEach(x=>{lastPrompt=x.message;const u=document.createElement("div");u.className="cosmic-chat-msg user";u.textContent=x.message;log.append(u);const a=document.createElement("div");a.className="cosmic-chat-msg assistant";renderRichText(a,x.response||"");log.append(a);});}catch(e){log.textContent="History load failed";}chat.querySelector("#cosmicHistoryPanel").hidden=true;}
function newChat(){sessionId="chat-"+Date.now().toString(36);localStorage.setItem("cosmic.chat.session.v1",sessionId);chat.querySelector("#cosmicChatLog").replaceChildren();}
function speakText(t){if(!window.speechSynthesis)return;window.speechSynthesis.cancel();window.speechSynthesis.speak(new SpeechSynthesisUtterance(String(t)));}
function startVoice(){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){chat.querySelector("#cosmicChatState").textContent="VOICE NOT SUPPORTED";return;}const r=new SR();r.lang=navigator.language||"en-US";r.onresult=e=>{const v=e.results[e.results.length-1][0].transcript;if(e.results[e.results.length-1].isFinal)chat.querySelector("#cosmicChatInput").value=v;};r.onerror=e=>chat.querySelector("#cosmicChatState").textContent="VOICE "+e.error;r.start();chat.querySelector("#cosmicChatState").textContent="LISTENING";}

tabs.forEach(t=>t.addEventListener("click",()=>showMode(t.dataset.cosmicMode)));
showMode("reactor");
})();