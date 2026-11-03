/* COSMIC voice control — Gemini Live streaming audio only.
   No Android SpeechRecognizer, Google Keyboard dictation, or browser SpeechRecognition fallback. */
(() => {
 "use strict";
 const button=document.querySelector("#voiceButton");
 const input=document.querySelector("#messageInput");
 let listening=false,starting=false;
 const setStatus=value=>{const el=document.querySelector("#sessionState");if(el)el.textContent=value;};
 function paint(active){
  if(!button)return;
  button.disabled=false;button.setAttribute("aria-pressed",String(active));
  button.title=active?"Stop COSMIC Live voice":"Start COSMIC Live voice";
  button.innerHTML=active?"<span>■</span>":"<span>◌</span>";
 }
 function stop(){
  listening=false;starting=false;
  try{window.COSMIC_LIVE?.stop();}catch(error){console.warn("COSMIC Live stop:",error);}
  paint(false);setStatus("VOICE OFF");
 }
 function start(){
  if(listening||starting)return;
  if(!window.COSMIC_LIVE?.start){setStatus("GEMINI LIVE NOT AVAILABLE");return;}
  starting=true;paint(true);setStatus("CONNECTING · GEMINI LIVE");
  Promise.resolve(window.COSMIC_LIVE.start()).then(()=>{
   starting=false;listening=true;paint(true);
  }).catch(error=>{
   starting=false;listening=!!window.COSMIC_LIVE?.listening;paint(listening);
   setStatus("LIVE VOICE ERROR · "+(error?.message||"Connection failed"));
  });
 }
 function selectProvider(provider){
  const select=document.querySelector("#cosmicChatProvider");
  if(!select)return false;
  const option=[...select.options].find(item=>item.value===provider);
  if(!option){setStatus(provider.toUpperCase()+" PROVIDER NOT AVAILABLE");return true;}
  select.value=provider;select.dispatchEvent(new Event("change",{bubbles:true}));
  const model=document.querySelector("#cosmicChatModel");
  if(model){model.value="auto";model.dispatchEvent(new Event("change",{bubbles:true}));}
  localStorage.setItem("COSMIC_CHAT_PROVIDER",provider);
  setStatus("CHAT ROUTED TO "+provider.toUpperCase());
  return true;
 }
 function routeControlPhrase(raw){
  const value=String(raw||"").trim().replace(/[.!?]+$/,"");
  const lower=value.toLowerCase().replace(/^(?:hey|ok|okay)\s+cosmic[, ]*/,"").trim();
  if(/^(speak|speak to me|speak and tell|talk to me|answer aloud|turn on voice replies|enable spoken replies)$/i.test(lower)){
   localStorage.setItem("COSMIC_SPEAK_REPLIES","true");
   const last=window.COSMIC_LAST_RESPONSE||"Spoken replies are now enabled. I will speak my answers aloud.";
   if(!window.COSMIC_LIVE?.active)window.COSMIC_SPEAK_TEXT?.(last);
   setStatus("SPOKEN REPLIES ON");
   return true;
  }
  if(/^(stop speaking|mute replies|turn off spoken replies|disable voice replies)$/i.test(lower)){
   localStorage.setItem("COSMIC_SPEAK_REPLIES","false");
   window.COSMIC_STOP_SPEAKING?.();
   setStatus("SPOKEN REPLIES OFF");
   return true;
  }
  if(/^(read last response|repeat your last answer|say that again)$/i.test(lower)){
   window.COSMIC_SPEAK_TEXT?.(window.COSMIC_LAST_RESPONSE||"There is no previous answer to read.");
   return true;
  }
  if(/^(stop listening|stop voice|turn off microphone|mute cosmic|go to sleep)$/i.test(lower)){stop();return true;}
  let m=lower.match(/^(?:switch|go) to (chat|avatar|reactor)(?: mode)?$|^(?:open|show) (chat|avatar|reactor)(?: mode)?$/i);
  if(m){const mode=(m[1]||m[2]).toLowerCase();document.querySelector('[data-cosmic-mode="'+mode+'"]')?.click();setStatus("SWITCHED TO "+mode.toUpperCase());return true;}
  m=lower.match(/^(?:use|switch to|change to|select) (gemini|openai|gpt|groq|mistral|openrouter)(?: model)?$/i);
  if(m){selectProvider(m[1].toLowerCase()==="gpt"?"openai":m[1].toLowerCase());return true;}
  m=lower.match(/^(?:use|switch to|change to|select) (?:model )?(.+)$/i);
  if(m&&/\b(gemini|gpt-4|gpt oss|llama|deepseek|mistral)\b/i.test(m[1])){
   const model=document.querySelector("#cosmicChatModel");
   if(model){const q=m[1].toLowerCase();const option=[...model.options].find(item=>(item.textContent+" "+item.value).toLowerCase().includes(q));if(option&&!option.disabled){model.value=option.value;model.dispatchEvent(new Event("change",{bubbles:true}));setStatus("MODEL SELECTED · "+option.textContent);return true;}}
  }
  return false;
 }
 async function handleTranscript(raw){
  const value=String(raw||"").trim();
  if(!value)return;
  if(routeControlPhrase(value))return;
  const withoutWake=value.replace(/^(?:hey|ok|okay)\s+cosmic[, ]*/i,"").trim();
  if(/^(open|launch|start|visit|download|go back)\b/i.test(withoutWake)){
   if(window.COSMIC_BRAIN?.handle&&await window.COSMIC_BRAIN.handle(withoutWake))return;
  }
 }
 if(button)button.addEventListener("click",event=>{event.preventDefault();if(listening||starting)stop();else start();});
 document.addEventListener("cosmic:live-state",event=>{
  const mode=event.detail?.state;
  if(mode==="live"){listening=true;starting=false;paint(true);setStatus("LIVE · LISTENING");}
  else if(mode==="connecting"){starting=true;paint(true);setStatus("CONNECTING · GEMINI LIVE");}
  else if(mode==="idle"){listening=false;starting=false;paint(false);setStatus("VOICE OFF");}
  else if(mode==="error"){listening=false;starting=false;paint(false);setStatus("LIVE VOICE ERROR");}
 });
 document.addEventListener("cosmic:live-transcript",event=>{
  if(event.detail?.role==="user")handleTranscript(event.detail.text).catch(error=>setStatus("VOICE COMMAND ERROR · "+error.message));
 });
 window.COSMIC_VOICE={start,stop,get listening(){return listening||starting;}};
 paint(false);
 console.log("COSMIC voice control ready · Gemini Live streaming only · no speech-recognition fallback.");
})();