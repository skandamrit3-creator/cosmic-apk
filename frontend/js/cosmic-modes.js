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
 if(reactor)reactor.hidden=!isReactor;if(topbar)topbar.hidden=!isReactor;if(mobile)mobile.hidden=false;
 chat.hidden=mode!=="chat";avatar.hidden=mode!=="avatar";
 if(mode==="chat"&&!chat.dataset.ready){
  chat.dataset.ready="1";
  chat.innerHTML='<div class="cosmic-chat-layout"><aside class="cosmic-history" id="cosmicHistoryPanel"><div class="cosmic-history-head"><b>CHAT HISTORY</b><button id="cosmicNewChat" type="button">＋ NEW CHAT</button></div><div id="cosmicHistoryList"></div></aside><section class="cosmic-chat-main"><header class="cosmic-chat-head"><div class="cosmic-chat-brand"><span class="cosmic-chat-mark">✦</span><div><b>COSMIC</b><small>PERSONAL AI</small></div></div><span id="cosmicChatState">CONNECTING…</span><div class="cosmic-chat-head-actions"><button id="cosmicHistoryToggle" type="button" aria-expanded="false">HISTORY</button><button id="cosmicApiSetup" type="button">SETTINGS</button></div></header><div class="cosmic-chat-controls"><label>PROVIDER <select id="cosmicChatProvider"><option value="auto">AUTO</option></select></label><label>MODEL <select id="cosmicChatModel"><option value="auto">AUTO</option></select></label></div><div class="cosmic-chat-log" id="cosmicChatLog"><div class="cosmic-chat-msg">COSMIC CHAT — Ask a question or give a command.</div></div><form class="cosmic-chat-compose" id="cosmicChatForm"><textarea id="cosmicChatInput" rows="2" placeholder="Message COSMIC…"></textarea><button type="submit">SEND ↗</button></form></section></div>';
  chat.querySelector("#cosmicChatForm").addEventListener("submit",sendChat);
  chat.querySelector("#cosmicNewChat").onclick=newChat;
  chat.querySelector("#cosmicHistoryToggle").onclick=()=>{const panel=chat.querySelector("#cosmicHistoryPanel");panel.hidden=!panel.hidden;chat.querySelector("#cosmicHistoryToggle").setAttribute("aria-expanded",String(!panel.hidden));if(!panel.hidden)loadChats();};
  chat.querySelector("#cosmicApiSetup").onclick=()=>openQuick("settings");
  chat.querySelector("#cosmicHistoryPanel").hidden=true;
  loadModels();
 }
 if(mode==="avatar"&&!avatar.dataset.ready){avatar.dataset.ready="1";avatar.innerHTML="<div class=\"avatar-mount-placeholder\"></div>";}
 }

async function auditProviders(){
 const root=document.querySelector("#providerAuditResults");if(!root)return;
 root.textContent="Testing provider API endpoints…";
 try{
  const r=await fetch(apiBase()+"/api/ai/provider-status",{cache:"no-store"});const d=await r.json();
  if(!r.ok||!d.success)throw new Error(d.error||"HTTP "+r.status);
  root.replaceChildren();
  (d.providers||[]).forEach(p=>{const row=document.createElement("div");row.className="provider-audit-row";const label=document.createElement("b");label.textContent=p.provider.toUpperCase();const status=document.createElement("span");status.textContent=p.status.replaceAll("_"," ").toUpperCase()+(p.http_status?" · HTTP "+p.http_status:"");status.dataset.status=p.status;row.append(label,status);if(p.detail){const detail=document.createElement("small");detail.textContent=p.detail;row.append(detail);}root.append(row);});
 }catch(e){root.textContent="API AUDIT FAILED: "+e.message;}
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
 add(message,"user");window.COSMIC_AVATAR_COMMAND?.(message);input.value="";busy=true;state.textContent="PROCESSING…";
 const wait=add("Thinking…","assistant");
 try{
  if(/\b(?:make|create|generate|draw|design|render)\b.{0,70}\b(?:image|picture|photo|illustration|wallpaper|logo|poster|artwork)\b/i.test(message)){
   try{
    state.textContent="CREATING IMAGE…";
    const r=await fetch(apiBase()+"/api/images/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:message})});
    const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||"Image generation failed · HTTP "+r.status);
    wait.replaceChildren();
    const image=document.createElement("img");image.className="cosmic-generated-image";image.alt="Image generated by COSMIC";image.loading="lazy";image.src=apiBase()+d.url;
    const actions=document.createElement("div");actions.className="cosmic-message-tools";
    const download=document.createElement("a");download.href=image.src;download.download=d.filename||"cosmic-generated-image.png";download.textContent="DOWNLOAD IMAGE";
    const model=document.createElement("span");model.className="cosmic-model-tag";model.textContent=d.model||"Gemini image generation";
    wait.append(image,actions);actions.append(download,model);state.textContent="IMAGE CREATED";return;
   }catch(error){wait.className="cosmic-chat-msg system";wait.textContent="IMAGE ERROR: "+error.message;state.textContent="IMAGE ERROR";return;}
  }
  if(window.COSMIC_BRAIN?.handle&&await window.COSMIC_BRAIN.handle(message)){
   wait.className="cosmic-chat-msg system";wait.textContent="DEVICE ACTION · "+(window.COSMIC_BRAIN.state.lastAction||"Command processed");state.textContent="DEVICE ACTION";return;
  }
  if(window.COSMIC_LIVE?.active){
   if(!await window.COSMIC_LIVE.sendText(message,true))throw new Error("Gemini Live session is not ready.");
   wait.remove();state.textContent="GEMINI LIVE · SENT";return;
  }
  const providerSelect=chat.querySelector("#cosmicChatProvider");const modelSelect=chat.querySelector("#cosmicChatModel");const selectedModel=modelSelect?.value||"auto";const modelParts=selectedModel.includes(":")?selectedModel.split(":"):[];const selectedProvider=modelParts[0]||providerSelect?.value||"auto";const selectedModelId=modelParts[1]||selectedModel;const response=await fetch(apiBase()+"/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message,task:"chat",mode:selectedProvider==="auto"?"auto":"manual",provider:selectedProvider,model:selectedModelId,session_id:sessionId})});
  const data=await response.json();if(!response.ok||data.success===false)throw new Error(data.error||data.message||"HTTP "+response.status);
  wait.replaceChildren();renderRichText(wait,data.message||data.response||data.text||"COSMIC returned an empty response.");const tools=document.createElement("div");tools.className="cosmic-message-tools";const speak=document.createElement("button");speak.type="button";speak.textContent="🔊 SPEAK";speak.onclick=()=>speakText(data.message||data.response||data.text||"");const edit=document.createElement("button");edit.type="button";edit.textContent="EDIT PROMPT";edit.onclick=()=>{input.value=lastPrompt;input.focus();};tools.append(speak,edit);if(data.provider){const tag=document.createElement("span");tag.className="cosmic-model-tag";tag.textContent=data.provider+" · "+(data.model||"");tools.append(tag);}wait.append(tools);state.textContent="CONNECTED";
 }catch(err){wait.className="cosmic-chat-msg system";wait.textContent="API ERROR: "+err.message;state.textContent="CONNECTION ERROR";}
 finally{busy=false;}
}

async function loadModels(){if(!chat||!chat.dataset.ready)return;const p=chat.querySelector("#cosmicChatProvider"),m=chat.querySelector("#cosmicChatModel");if(!p||!m)return;try{const r=await fetch(apiBase()+"/api/ai/models",{cache:"no-store"}),d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||"HTTP "+r.status);const all=d.models||[];const chatModels=all.filter(x=>x.chat_compatible!==false&&x.status!=="retired");const selected=localStorage.getItem("COSMIC_CHAT_PROVIDER")||p.value; p.replaceChildren(new Option("AUTO","auto"));[...new Set(all.map(x=>x.provider))].forEach(x=>p.add(new Option(x.toUpperCase(),x)));p.value=[...p.options].some(o=>o.value===selected)?selected:"auto";function fill(){m.replaceChildren(new Option("AUTOMATIC","auto"));chatModels.filter(x=>p.value==="auto"||x.provider===p.value).forEach(x=>{const o=new Option(x.label+(x.configured?"":" (KEY MISSING)"),x.provider+":"+x.id);o.disabled=!x.configured;m.add(o);});}p.onchange=fill;fill();const configured=[...new Set(all.filter(x=>x.configured).map(x=>x.provider))];chat.querySelector("#cosmicChatState").textContent=configured.length?"READY · "+configured.map(x=>x.toUpperCase()).join(", "):"API KEY REQUIRED";chat.querySelector("#cosmicApiSetup").classList.toggle("needs-setup",!configured.length);}catch(e){chat.querySelector("#cosmicChatState").textContent="MODEL LIST ERROR · "+e.message;}}
async function loadChats(){const list=chat.querySelector("#cosmicHistoryList");try{const d=await(await fetch(apiBase()+"/api/chats")).json();list.replaceChildren();(d.items||[]).forEach(x=>{const b=document.createElement("button");b.className="cosmic-history-item";b.textContent=(x.title||"Untitled").slice(0,60);b.onclick=()=>openChat(x.session_id);list.append(b);});}catch(e){list.textContent="History unavailable";}}
async function openChat(id){sessionId=id;localStorage.setItem("cosmic.chat.session.v1",id);const log=chat.querySelector("#cosmicChatLog");log.replaceChildren();try{const d=await(await fetch(apiBase()+"/api/history?session_id="+encodeURIComponent(id))).json();(d.items||[]).forEach(x=>{lastPrompt=x.message;const u=document.createElement("div");u.className="cosmic-chat-msg user";u.textContent=x.message;log.append(u);const a=document.createElement("div");a.className="cosmic-chat-msg assistant";renderRichText(a,x.response||"");log.append(a);});}catch(e){log.textContent="History load failed";}chat.querySelector("#cosmicHistoryPanel").hidden=true;}
function newChat(){sessionId="chat-"+Date.now().toString(36);localStorage.setItem("cosmic.chat.session.v1",sessionId);chat.querySelector("#cosmicChatLog").replaceChildren();}
let cosmicSpeechAudio=null;async function speakText(t){const text=String(t||"").trim();if(!text)return;if(cosmicSpeechAudio){try{cosmicSpeechAudio.pause();URL.revokeObjectURL(cosmicSpeechAudio.src);}catch(_){}cosmicSpeechAudio=null;}try{const r=await fetch(apiBase()+"/api/ai/speech",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text,voice:localStorage.getItem("COSMIC_TTS_VOICE")||"Kore",model:localStorage.getItem("COSMIC_TTS_MODEL")||(text.length>400?"gemini-3.8-flash-tts":"gemini-3.8-flash-lite-tts")})});if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.error||"TTS HTTP "+r.status);}const url=URL.createObjectURL(await r.blob());const audio=new Audio(url);cosmicSpeechAudio=audio;audio.onended=()=>{URL.revokeObjectURL(url);if(cosmicSpeechAudio===audio)cosmicSpeechAudio=null;};await audio.play();return;}catch(error){console.warn("COSMIC Gemini TTS fallback:",error.message);}const native=window.Capacitor?.Plugins?.CosmicVoice;if(typeof native?.speak==="function"){try{await native.speak({text});return;}catch(_){}}if(window.speechSynthesis){window.speechSynthesis.cancel();window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));}}
async function startVoice(){
 const state=chat.querySelector("#cosmicChatState");
 try{
  if(!window.COSMIC_LIVE?.start)throw new Error("Gemini Live controller is unavailable.");
  if(window.COSMIC_LIVE.active){await window.COSMIC_LIVE.stop();state.textContent="VOICE OFF";}
  else{state.textContent="CONNECTING TO GEMINI LIVE…";await window.COSMIC_LIVE.start();state.textContent="GEMINI LIVE · LISTENING";}
 }catch(error){state.textContent="LIVE VOICE ERROR · "+(error?.message||error);}
}

function ensureQuickPanel(){
 let panel=document.querySelector("#cosmicQuickPanel");
 if(panel)return panel;
 panel=document.createElement("section");panel.id="cosmicQuickPanel";panel.className="cosmic-quick-panel";panel.hidden=true;
 panel.innerHTML='<div class="cosmic-quick-card"><header class="cosmic-quick-head"><h2 id="cosmicQuickTitle">COSMIC</h2><button type="button" id="cosmicQuickClose">CLOSE</button></header><div id="cosmicQuickBody" class="cosmic-quick-body"></div></div>';
 document.body.append(panel);panel.addEventListener("click",e=>{if(e.target===panel)panel.hidden=true;});panel.querySelector("#cosmicQuickClose").onclick=()=>panel.hidden=true;
 return panel;
}
function addQuickText(root,value,tag="p"){const el=document.createElement(tag);el.textContent=String(value??"");root.append(el);return el;}
function addQuickButton(root,label,handler){const b=document.createElement("button");b.type="button";b.textContent=label;b.onclick=handler;root.append(b);return b;}
async function openQuick(view){
 const panel=ensureQuickPanel(),title=panel.querySelector("#cosmicQuickTitle"),body=panel.querySelector("#cosmicQuickBody");body.replaceChildren();panel.hidden=false;
 const labels={models:"MODEL LIBRARY",memory:"MEMORY",tools:"TOOLS",settings:"CONNECTION SETTINGS",updates:"UPGRADE CENTER",research:"RESEARCH",devices:"DEVICE BRIDGE"};
 title.textContent=labels[view]||String(view).toUpperCase();
 if(view==="command"){panel.hidden=true;showMode("reactor");return;}
 if(view==="models"){
  addQuickText(body,"Live model catalog from the connected COSMIC backend.");
  try{const d=await(await fetch(apiBase()+"/api/ai/models",{cache:"no-store"})).json();(d.models||[]).forEach(m=>{const row=document.createElement("div");row.className="quick-row";const name=document.createElement("b");name.textContent=m.label;const sub=document.createElement("span");const state=m.status==="retired"?"RETIRED · NOT SELECTABLE":m.status==="deprecated"?"DEPRECATED · MIGRATE":m.status==="legacy"?"LEGACY MODEL":m.status==="preview"?"PREVIEW · ACCESS MAY VARY":(m.configured?"KEY CONFIGURED":"KEY MISSING");const wired=m.integration==="catalog"?"CATALOG ONLY":m.integration==="retired"?"NOT CONNECTED":m.integration==="chat"?"CHAT ROUTED":m.integration==="live"?"LIVE VOICE WIRED":m.integration==="tts"?"NATURAL TTS WIRED":m.integration==="image"?"IMAGE GENERATION WIRED":"SPECIALIST";sub.textContent=m.provider.toUpperCase()+" · "+String(m.task||"chat").toUpperCase()+" · "+state+" · "+wired;row.append(name,sub);body.append(row);});if(!d.models?.length)addQuickText(body,"No models returned by backend.");}catch(e){addQuickText(body,"Model list unavailable: "+e.message);}return;
 }
 if(view==="memory"){
  addQuickText(body,"Recent saved conversations and memory count.");
  try{const count=await(await fetch(apiBase()+"/api/memory/count")).json();addQuickText(body,"Stored conversation records: "+(count.count??"unknown"));const d=await(await fetch(apiBase()+"/api/memory/page?limit=20")).json();(d.items||[]).forEach(x=>{const row=document.createElement("div");row.className="quick-row";const b=document.createElement("b");b.textContent=(x.message||"Memory").slice(0,88);const s=document.createElement("span");s.textContent=(x.created_at||"")+" · "+String(x.response||"").slice(0,130);row.append(b,s);body.append(row);});}catch(e){addQuickText(body,"Memory endpoint unavailable: "+e.message);}return;
 }
 if(view==="tools"){
  addQuickText(body,"Quick actions currently connected to this build.");
  addQuickButton(body,"VOICE INPUT",()=>{panel.hidden=true;document.querySelector("#voiceButton")?.click();});
  addQuickButton(body,"ATTACH FILE",()=>{panel.hidden=true;document.querySelector("#attachButton")?.click();});
  addQuickButton(body,"3D AVATAR STUDIO",()=>{panel.hidden=true;showMode("avatar");});
  addQuickButton(body,"CHECK UPDATES",()=>openQuick("updates"));
  addQuickText(body,"Device actions require their Android bridge and permissions. COSMIC will report unsupported actions instead of pretending they ran.");return;
 }
 if(view==="settings"){
  addQuickText(body,"AI PROVIDER KEYS · saved only in this device's private COSMIC app storage. Never paste keys into chat.");
  const status=document.createElement("p");status.className="cosmic-key-status";status.textContent="Checking configured providers…";body.append(status);
  const grid=document.createElement("div");grid.className="cosmic-key-grid";body.append(grid);
  const providers=[["gemini","Google Gemini"],["openai","OpenAI GPT"],["groq","Groq"],["mistral","Mistral"],["openrouter","OpenRouter"]];
  const fields={};
  providers.forEach(([id,label])=>{
   const row=document.createElement("label");row.className="cosmic-key-row";
   const name=document.createElement("span");name.textContent=label;row.append(name);
   const input=document.createElement("input");input.type="password";input.autocomplete="off";input.spellcheck=false;input.placeholder="Paste "+label+" API key";input.setAttribute("aria-label",label+" API key");fields[id]=input;row.append(input);
   const state=document.createElement("small");state.dataset.provider=id;state.textContent="Checking…";row.append(state);
   const clear=document.createElement("button");clear.type="button";clear.textContent="REMOVE";clear.onclick=async()=>{
    clear.disabled=true;try{const r=await fetch(apiBase()+"/api/ai/provider-keys",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({clear:[id]})});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||"HTTP "+r.status);state.textContent="NOT CONFIGURED";status.textContent=label+" key removed from this device.";await loadModels();window.COSMIC_REFRESH_MODELS?.();}catch(e){status.textContent="Could not remove key: "+e.message;}finally{clear.disabled=false;}
   };row.append(clear);grid.append(row);
  });
  const actions=document.createElement("div");actions.className="cosmic-key-actions";body.append(actions);
  const save=addQuickButton(actions,"SAVE API KEYS",async()=>{
   const keys={};for(const [id,input] of Object.entries(fields)){if(input.value.trim())keys[id]=input.value.trim();}
   if(!Object.keys(keys).length){status.textContent="Paste at least one API key before saving.";return;}
   save.disabled=true;status.textContent="Saving keys to this device…";
   try{const r=await fetch(apiBase()+"/api/ai/provider-keys",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({keys})});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||"HTTP "+r.status);Object.values(fields).forEach(input=>input.value="");status.textContent="Saved. Refreshing models and starting Gemini Live…";await refreshStatus();await loadModels();window.COSMIC_REFRESH_MODELS?.();const geminiSaved=Boolean(keys.gemini);if(geminiSaved){localStorage.setItem("COSMIC_LIVE_AUTO","true");window.COSMIC_LIVE?.start(true);}}
   catch(e){status.textContent="SAVE FAILED: "+e.message;}finally{save.disabled=false;}
  });
  const test=addQuickButton(actions,"RUN REAL COMPLETION TESTS",async()=>{test.disabled=true;try{const kr=await fetch(apiBase()+"/api/ai/provider-keys",{cache:"no-store"});const kd=await kr.json();if(!kr.ok||!kd.success)throw new Error(kd.error||"Could not read key status");const configured=(kd.providers||[]).filter(x=>x.configured).map(x=>x.provider);if(!configured.length){status.textContent="No provider keys configured. Save at least one key first.";return;}let passed=0;for(const id of configured){const el=grid.querySelector('[data-provider="'+id+'"]');if(el)el.textContent="RUNNING REAL COMPLETION…";status.textContent="Testing "+id.toUpperCase()+" with a real chat completion…";try{const r=await fetch(apiBase()+"/api/ai/test-provider",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({provider:id})});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||"HTTP "+r.status);if(el)el.textContent="WORKING · "+(d.model||"MODEL");passed++;}catch(e){if(el)el.textContent="FAILED · "+e.message;}}status.textContent="REAL TESTS COMPLETE · "+passed+"/"+configured.length+" providers returned a valid completion.";}catch(e){status.textContent="TEST FAILED: "+e.message;}finally{test.disabled=false;}});
  const liveTest=addQuickButton(actions,"TEST GEMINI LIVE",async()=>{
   liveTest.disabled=true;status.textContent="Requesting a short-lived Gemini Live token…";
   try{
    const r=await fetch(apiBase()+"/api/ai/live-token",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
    const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||"HTTP "+r.status);
    status.textContent="GEMINI LIVE TOKEN READY · Start the floating Live control to begin speaking.";
   }catch(e){status.textContent="GEMINI LIVE TEST FAILED: "+e.message;}
   finally{liveTest.disabled=false;}
  });
  async function refreshStatus(){try{const r=await fetch(apiBase()+"/api/ai/provider-keys",{cache:"no-store"});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||"HTTP "+r.status);(d.providers||[]).forEach(p=>{const el=grid.querySelector('[data-provider="'+p.provider+'"]');if(el)el.textContent=p.configured?"KEY SAVED · NOT YET TESTED":"KEY MISSING";});status.textContent="Add your own provider keys, then test them. COSMIC does not include free API credits."; }catch(e){status.textContent="KEY SETTINGS UNAVAILABLE: "+e.message;}}
  refreshStatus();
  addQuickText(body,"A provider needs its own API key and may charge or enforce free-tier limits. Keys are not supplied by the APK.");
  addQuickButton(body,"BACKEND CONNECTION",()=>{panel.hidden=true;document.querySelector("#systemMenu")?.click();});
  return;
 }
 if(view==="updates"){
  addQuickText(body,"COSMIC FEATURE CENTER · Download verified frontend updates inside the app. Native Android changes still require an in-place app update.");
  const featureStatus=document.createElement("p");featureStatus.className="cosmic-key-status";featureStatus.textContent="Checking feature updater…";body.append(featureStatus);
  addQuickButton(body,"CHECK FEATURE UPDATES",async()=>{
   featureStatus.textContent="Checking signed-official GitHub release assets and SHA-256 manifest…";
   try{const result=await window.COSMIC_FEATURE_UPDATER.check();featureStatus.textContent=result.updateAvailable?"FEATURE UPDATE AVAILABLE · "+result.version+" · "+result.files+" files": "UP TO DATE · "+result.installed+" · "+result.files+" files";featureStatus.dataset.state=result.updateAvailable?"available":"current";}
   catch(error){featureStatus.textContent="FEATURE CHECK · "+error.message;}
  });
  addQuickButton(body,"DOWNLOAD & INSTALL FEATURE PACK",async()=>{
   featureStatus.textContent="Downloading and verifying every file…";
   try{const result=await window.COSMIC_FEATURE_UPDATER.install();featureStatus.textContent="INSTALLED "+result.version+" · "+result.files+" files · CLOSE AND REOPEN COSMIC TO APPLY";}
   catch(error){featureStatus.textContent="FEATURE INSTALL FAILED · "+error.message;}
  });
  addQuickButton(body,"ROLL BACK FRONTEND FEATURES",async()=>{
   try{await window.COSMIC_FEATURE_UPDATER.rollback();featureStatus.textContent="FEATURE OVERRIDES REMOVED · REOPEN COSMIC TO RESTORE BUILT-IN FILES";}
   catch(error){featureStatus.textContent="ROLLBACK FAILED · "+error.message;}
  });
  addQuickText(body,"Feature packs are restricted to frontend JavaScript/CSS paths, size-limited, fetched from this COSMIC GitHub repository over HTTPS, and SHA-256 verified before activation. They cannot update native Android permissions or services.");
  addQuickText(body,"Backend project update history (developer tools):");

  for(const [name,path] of [["STATUS","/api/upgrades/status"],["PROJECT","/api/upgrades/project"],["HISTORY","/api/upgrades/history"]]){
   try{const d=await(await fetch(apiBase()+path,{cache:"no-store"})).json();const row=document.createElement("div");row.className="quick-row";const b=document.createElement("b");b.textContent=name;const s=document.createElement("span");s.textContent=JSON.stringify(d).slice(0,900);row.append(b,s);body.append(row);}catch(e){addQuickText(body,name+" check failed: "+e.message);}
  }return;
 }
 if(view==="research"){
  addQuickText(body,"Write a research request. COSMIC sends it through the configured chat backend; it does not claim live web browsing unless a research provider is connected.");
  const input=document.createElement("textarea");input.rows=3;input.placeholder="Research topic…";input.style.cssText="width:100%;padding:12px;border-radius:10px;background:#0a1726;color:#fff;border:1px solid var(--c-line);";body.append(input);
  addQuickButton(body,"SEND TO COSMIC",()=>{document.querySelector("#messageInput").value="Research: "+input.value;panel.hidden=true;window.COSMIC?.executeCommand?.();});return;
 }
 if(view==="devices"){
  addQuickText(body,"Android bridge status");
  const s=document.querySelector("#brainStatus");addQuickText(body,s?.textContent||"Brain status panel is not mounted.");
  addQuickButton(body,"OPEN PERMISSION CONTROLS",()=>{panel.hidden=true;document.querySelector("#brainEnabled")?.scrollIntoView({behavior:"smooth",block:"center"});});
 }
}
function wireNavigation(){
 document.querySelectorAll(".rail-item[data-view],.mobile-nav-item[data-view]").forEach(button=>button.addEventListener("click",()=>{
  const view=button.dataset.view||"command";document.querySelectorAll(".rail-item,.mobile-nav-item").forEach(x=>x.classList.toggle("active",x.dataset.view===view));
  if(view==="command"){ensureQuickPanel().hidden=true;showMode("reactor");}else openQuick(view);
 }));
}

wireNavigation();
tabs.forEach(t=>t.addEventListener("click",()=>showMode(t.dataset.cosmicMode)));
showMode("reactor");
})();