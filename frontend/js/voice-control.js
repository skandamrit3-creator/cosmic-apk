(() => {
"use strict";
const button=document.querySelector("#voiceButton");
const input=document.querySelector("#messageInput");
const api=()=>window.Capacitor?.Plugins?.CosmicVoice;
const locales=[
 ["English (India)","en-IN"],["Hindi","hi-IN"],["Telugu","te-IN"],["Tamil","ta-IN"],
 ["Bengali","bn-IN"],["Marathi","mr-IN"],["Urdu","ur-IN"],["Kannada","kn-IN"],
 ["Malayalam","ml-IN"],["Gujarati","gu-IN"],["English (US)","en-US"]
];
let listening=false,recognition=null,nativeLoop=false,loopGeneration=0;
function setStatus(text){const el=document.querySelector("#sessionState");if(el)el.textContent=text;}
function languageSelect(){
 let select=document.querySelector("#cosmicVoiceLanguage");
 if(select)return select;
 select=document.createElement("select");select.id="cosmicVoiceLanguage";select.setAttribute("aria-label","Voice recognition language");
 select.className="cosmic-voice-language";
 const saved=localStorage.getItem("COSMIC_VOICE_LANGUAGE")||"en-IN";
 locales.forEach(([label,value])=>select.add(new Option(label,value)));
 select.value=saved;select.addEventListener("change",()=>localStorage.setItem("COSMIC_VOICE_LANGUAGE",select.value));
 const actions=document.querySelector(".command-actions");
 if(actions)actions.insertBefore(select,button);
 return select;
}
async function command(text){
 const value=String(text||"").trim();if(!value)return;
 if(input)input.value=value;
 const lower=value.toLowerCase();
 if(/^(stop listening|stop voice|turn off microphone|mute cosmic)$/i.test(lower)){stop();return;}
 if(/^(open|show|switch to) (avatar|avatar studio|3d avatar)$/i.test(lower)){document.querySelector('[data-cosmic-mode="avatar"]')?.click();return;}
 if(/^(open|show|switch to) (chat|chat mode)$/i.test(lower)){document.querySelector('[data-cosmic-mode="chat"]')?.click();return;}
 if(/^(open|show|switch to) (reactor|home|command core)$/i.test(lower)){document.querySelector('[data-cosmic-mode="reactor"]')?.click();return;}
 if(/^(close|hide) (avatar|chat)$/i.test(lower)){document.querySelector('[data-cosmic-mode="reactor"]')?.click();return;}
 if(window.COSMIC_BRAIN?.handle&&await window.COSMIC_BRAIN.handle(value)){
  document.dispatchEvent(new CustomEvent("cosmic:voice-command",{detail:{text:value,handled:true}}));return;
 }
 window.COSMIC?.executeCommand?.();
}
function stop(){
 if(window.COSMIC_LIVE?.listening)window.COSMIC_LIVE.stop();
 listening=false;nativeLoop=false;loopGeneration++;
 try{recognition?.stop();}catch(_){}recognition=null;
 if(button){button.disabled=false;button.setAttribute("aria-pressed","false");button.title="Start live voice control";button.innerHTML="<span>◌</span>";}
 setStatus("STANDBY");
}
async function runNativeLoop(generation){
 const plugin=api(),language=languageSelect()?.value||"en-IN";
 while(listening&&generation===loopGeneration){
  try{
   setStatus("LISTENING · "+language);
   const result=await plugin.listen({language});
   if(!listening||generation!==loopGeneration)break;
   if(result?.text)await command(result.text);
  }catch(error){
   if(!listening||generation!==loopGeneration)break;
   setStatus("VOICE ERROR");
   const log=document.querySelector("#responseStream");
   if(log){const item=document.createElement("div");item.className="stream-item system-message";item.textContent="VOICE: "+(error?.message||"Recognition failed");log.append(item);}
   break;
  }
  await new Promise(resolve=>setTimeout(resolve,280));
 }
 if(generation===loopGeneration&&listening)stop();
}
function startBrowserRecognition(){
 const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!Speech)return false;
 const rec=new Speech();recognition=rec;rec.lang=languageSelect()?.value||"en-IN";rec.continuous=true;rec.interimResults=false;rec.maxAlternatives=1;
 rec.onresult=async event=>{for(let i=event.resultIndex;i<event.results.length;i++){if(event.results[i].isFinal){const value=event.results[i][0]?.transcript||"";await command(value);}}};
 rec.onerror=event=>{if(event.error!=="no-speech"&&event.error!=="aborted")setStatus("VOICE ERROR · "+event.error);};
 rec.onend=()=>{if(listening&&recognition===rec){try{rec.start();}catch(_){stop();}}};
 try{rec.start();return true;}catch(_){recognition=null;return false;}
}
function start(){
 if(listening)return;
 listening=true;loopGeneration++;const generation=loopGeneration;
 if(window.COSMIC_LIVE){
  languageSelect();
  if(button){button.disabled=false;button.setAttribute("aria-pressed","true");button.title="Stop Gemini Live voice";button.innerHTML="<span>■</span>";}
  window.COSMIC_LIVE.start();return;
 }
 if(button){button.disabled=false;button.setAttribute("aria-pressed","true");button.title="Stop live voice control";button.innerHTML="<span>■</span>";}
 languageSelect();
 if(api()?.listen){nativeLoop=true;runNativeLoop(generation);return;}
 if(startBrowserRecognition())return;
 stop();setStatus("VOICE NOT AVAILABLE");
 alert("Voice recognition is not available. Install/enable an Android speech-recognition service or use Chrome with microphone permission.");
}
if(button){
 button.addEventListener("click",event=>{event.preventDefault();if(listening)stop();else start();});
 languageSelect();
}
document.addEventListener("cosmic:live-state",event=>{
 const mode=event.detail?.state;
 if(mode==="live"||mode==="connecting"){listening=true;if(button){button.setAttribute("aria-pressed","true");button.innerHTML="<span>■</span>";}}
 else if(mode==="idle"||mode==="error"){listening=false;if(button){button.setAttribute("aria-pressed","false");button.innerHTML="<span>◌</span>";}}
});
document.addEventListener("cosmic:live-transcript",event=>{
 if(event.detail?.role!=="user")return;
 const text=String(event.detail.text||"").trim();
 if(/^(stop listening|stop voice|turn off microphone|mute cosmic)$/i.test(text))window.COSMIC_LIVE?.stop();
});
document.addEventListener("cosmic:reply",event=>{
 const text=event.detail?.text;if(text&&api()?.speak)api().speak({text}).catch(()=>{});
});
window.COSMIC_VOICE={start,stop,get listening(){return listening;}};
console.log("COSMIC multilingual voice loop ready (foreground, user-started).");
})();