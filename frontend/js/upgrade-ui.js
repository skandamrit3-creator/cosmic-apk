(() => {
"use strict";
const base=()=>String(window.COSMIC_API_BASE||window.location.origin).replace(/\/+$/,"");
async function get(path){const r=await fetch(base()+path,{cache:"no-store"});const d=await r.json();if(!r.ok||d.success===false)throw new Error(d.error||"HTTP "+r.status);return d;}
async function preview(path,content){const r=await fetch(base()+"/api/upgrades/preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({path,content})});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||"Preview failed");return d;}
async function apply(path,content,approved){if(approved!==true)throw new Error("A separate explicit approval is required.");const r=await fetch(base()+"/api/upgrades/apply",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({path,content,approved:true})});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||"Apply failed");return d;}
async function rollback(id,approved){if(approved!==true)throw new Error("A separate explicit approval is required.");const r=await fetch(base()+"/api/upgrades/rollback",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,approved:true})});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||"Rollback failed");return d;}
window.COSMIC_UPGRADES={status:()=>get("/api/upgrades/status"),project:()=>get("/api/upgrades/project"),history:()=>get("/api/upgrades/history"),preview,apply,rollback};
})();

/* Additional COSMIC workspace controls: isolated 2D character chat + background presets. */
function installCharacterWorkspace(){
 const nav=document.querySelector(".mode-switch");if(!nav||document.querySelector('[data-cosmic-mode="characters"]'))return;
 const tab=document.createElement("button");tab.type="button";tab.className="mode-tab";tab.dataset.cosmicMode="characters";tab.textContent="✧ CHARACTERS";nav.append(tab);
 const theme=document.createElement("select");theme.id="cosmicThemePicker";theme.className="cosmic-theme-picker";theme.setAttribute("aria-label","Background theme");
 [["nebula","NEBULA"],["aurora","AURORA"],["midnight","MIDNIGHT"],["solar","SOLAR"]].forEach(([v,l])=>theme.add(new Option(l,v)));
 nav.append(theme);theme.value=localStorage.getItem("COSMIC_BACKGROUND_THEME")||"nebula";document.documentElement.dataset.cosmicTheme=theme.value;
 theme.addEventListener("change",()=>{document.documentElement.dataset.cosmicTheme=theme.value;localStorage.setItem("COSMIC_BACKGROUND_THEME",theme.value);});
 const root=document.createElement("section");root.id="cosmicCharactersMode";root.className="cosmic-mode-view characters-mode";root.hidden=true;
 root.innerHTML='<div class="character-workspace"><header class="character-head"><div><span class="character-kicker">COSMIC · 2D COMPANION SPACE</span><h1>Character Studio</h1><p>Choose a character, add its 2D portrait, and start a conversation.</p></div><span class="character-status" id="characterStatus">READY</span></header><div class="character-layout"><aside class="character-roster"><div class="character-roster-title">YOUR CHARACTERS</div><button class="character-choice active" data-character="MYRAA"><span class="character-avatar myraa">M</span><span><b>MYRAA</b><small>Main companion</small></span></button><button class="character-choice" data-character="Anime companion"><span class="character-avatar anime">A</span><span><b>ANIME</b><small>2D companion</small></span></button><button class="character-choice" data-character="Fantasy companion"><span class="character-avatar fantasy">F</span><span><b>FANTASY</b><small>2D character</small></span></button><button class="character-choice" data-character="Sci-fi companion"><span class="character-avatar scifi">S</span><span><b>SCI-FI</b><small>2D character</small></span></button><label class="character-upload">＋ ADD / CHANGE SELECTED PORTRAIT<input id="characterPortraitInput" type="file" accept="image/png,image/jpeg,image/webp" hidden></label><p class="character-note">Add the original MYRAA picture here. This mode uses 2D portraits, not 3D models.</p></aside><section class="character-stage"><div class="character-portrait-wrap"><div class="character-portrait-placeholder" id="characterPortrait"><span id="characterInitial">M</span></div><div class="character-name" id="characterName">MYRAA</div><div class="character-caption">2D CHARACTER</div></div><div class="character-conversation" id="characterConversation"><div class="character-welcome">Hello! Choose a character and start talking.</div></div><form class="character-compose" id="characterForm"><textarea id="characterInput" rows="2" placeholder="Talk to your character…"></textarea><button type="submit">SEND ↗</button></form></section></div></div>';
 document.querySelector("#cosmic")?.append(root);
 let selected="MYRAA";const portraits={};let currentUrl="";
 const status=root.querySelector("#characterStatus"),portrait=root.querySelector("#characterPortrait"),initial=root.querySelector("#characterInitial"),name=root.querySelector("#characterName"),log=root.querySelector("#characterConversation"),input=root.querySelector("#characterInput");
 function choose(label){selected=label;root.querySelectorAll("[data-character]").forEach(b=>b.classList.toggle("active",b.dataset.character===label));name.textContent=label;portrait.replaceChildren();if(portraits[label]){const img=document.createElement("img");img.src=portraits[label];img.alt=label+" portrait";portrait.append(img);}else{const mark=document.createElement("span");mark.textContent=label[0];portrait.append(mark);}log.replaceChildren();const hello=document.createElement("div");hello.className="character-welcome";hello.textContent="You are now talking with "+label+". Add a portrait to personalise this character.";log.append(hello);}
 root.querySelectorAll("[data-character]").forEach(b=>b.addEventListener("click",()=>choose(b.dataset.character)));
 root.querySelector("#characterPortraitInput").addEventListener("change",e=>{const file=e.target.files?.[0];if(!file)return;if(!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>8*1024*1024){status.textContent="USE PNG/JPG/WEBP UNDER 8 MB";return;}if(portraits[selected])URL.revokeObjectURL(portraits[selected]);portraits[selected]=URL.createObjectURL(file);choose(selected);status.textContent="PORTRAIT LOADED";});
 root.querySelector("#characterForm").addEventListener("submit",async e=>{e.preventDefault();const message=input.value.trim();if(!message)return;const u=document.createElement("div");u.className="character-message user";u.textContent=message;log.append(u);input.value="";const wait=document.createElement("div");wait.className="character-message assistant";wait.textContent=selected+" is thinking…";log.append(wait);status.textContent="THINKING";try{const r=await fetch(base()+"/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:"You are "+selected+", a fictional 2D character companion. Stay in character, be warm, and answer naturally. User: "+message,task:"chat",mode:"auto",provider:"auto",model:"auto",session_id:"character-"+selected.toLowerCase().replace(/[^a-z0-9]+/g,"-")})});const d=await r.json();if(!r.ok||d.success===false)throw new Error(d.error||"HTTP "+r.status);wait.textContent=d.message||d.response||d.text||"No response.";status.textContent="CONNECTED";}catch(err){wait.textContent="CONNECTION ERROR · "+err.message;status.textContent="OFFLINE";}log.scrollTop=log.scrollHeight;});
 tab.addEventListener("click",()=>{tab.classList.add("active");root.hidden=false;document.querySelector("#cosmicChatMode").hidden=true;document.querySelector("#cosmicAvatarMode").hidden=true;document.querySelector(".hud-main").hidden=true;document.querySelector(".topbar").hidden=true;document.querySelector(".mobile-nav")?.setAttribute("hidden","");document.body.dataset.cosmicMode="characters";});
 document.querySelectorAll("[data-cosmic-mode]:not([data-cosmic-mode=characters])").forEach(b=>b.addEventListener("click",()=>{root.hidden=true;tab.classList.remove("active");const mobile=document.querySelector(".mobile-nav");if(mobile)mobile.hidden=false;}));
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",installCharacterWorkspace,{once:true});else installCharacterWorkspace();


function installEmptyAvatarStage(){
 const host=document.querySelector("#cosmicAvatarMode");if(!host)return;
 let pending=false;
 const watch=()=>{
  const stage=host.querySelector(".avatar-stage-v2"),canvas=host.querySelector("#cosmicAvatarCanvas");
  if(!stage||!canvas||stage.dataset.emptyStateReady)return;
  stage.dataset.emptyStateReady="1";canvas.style.visibility="hidden";
  const empty=document.createElement("div");empty.className="avatar-empty-state";
  const title=document.createElement("h2");title.textContent="YOUR 3D STAGE";
  const note=document.createElement("p");note.textContent="No model loaded. Import your own GLB, GLTF or VRM to begin.";
  const button=document.createElement("button");button.type="button";button.textContent="＋ IMPORT 3D MODEL";
  const hint=document.createElement("small");hint.textContent="Your imported model is saved in your local character library.";
  empty.append(title,note,button,hint);stage.append(empty);
  button.onclick=()=>host.querySelector("#cosmicAvatarModelFile")?.click();
  const reveal=()=>{if(!pending)return;const status=host.querySelector("#cosmicAvatarStatus");if(status&&/loaded in the 3D viewport/i.test(status.textContent)){canvas.style.visibility="visible";empty.remove();}};
  const status=host.querySelector("#cosmicAvatarStatus");if(status)new MutationObserver(reveal).observe(status,{childList:true,subtree:true,characterData:true});
  host.querySelector("#cosmicAvatarModelFile")?.addEventListener("change",e=>{if(e.target.files?.length)pending=true;});
  host.querySelector("#cosmicAvatarLibrary")?.addEventListener("click",()=>{pending=true;});
  host.querySelector("#cosmicAvatarSamples")?.addEventListener("click",()=>{pending=true;});
 };
 new MutationObserver(watch).observe(host,{childList:true,subtree:true});watch();
}
const avatarHost=document.querySelector("#cosmicAvatarMode");
if(avatarHost)new MutationObserver(()=>installEmptyAvatarStage()).observe(avatarHost,{childList:true,subtree:true});
