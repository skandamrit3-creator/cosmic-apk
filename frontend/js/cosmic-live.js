(() => {
"use strict";
if (window.COSMIC_LIVE && window.COSMIC_LIVE.version === "3.0.0") return;
const API_BASE = () => String(window.COSMIC_API_BASE || location.origin).replace(/\/+$/, "");
const MODEL = window.COSMIC_LIVE_MODEL || "gemini-3.1-flash-live-preview";
const VOICE = window.COSMIC_LIVE_VOICE || "Aoede";
const TARGET_RATE = 16000, CHUNK_SAMPLES = 1600;
let ws=null,stream=null,audioCtx=null,micSource=null,micNode=null,micGain=null,state="idle",queue=[],nextTime=0,workletUrl=null,fallbackBuffer=[],shuttingDown=false,setupTimer=null,lastOutputText="";
function jwt(v,d=0){if(d>6||!v)return"";if(typeof v==="string"){if(v.split(".").length===3)return v;try{return jwt(JSON.parse(v),d+1)}catch(_){return""}}if(typeof v==="object"){for(const[k,x]of Object.entries(v))if(/^(token|access_token|account_token|cosmic_token)$/i.test(k)){const t=jwt(x,d+1);if(t)return t}for(const x of Object.values(v)){const t=jwt(x,d+1);if(t)return t}}return""}
function accountToken(){if(window.COSMIC_ACCOUNT_TOKEN)return window.COSMIC_ACCOUNT_TOKEN;try{for(let i=0;i<localStorage.length;i++){const t=jwt(localStorage.getItem(localStorage.key(i)));if(t)return t}}catch(_){}return""}
function emit(name,detail={}){document.dispatchEvent(new CustomEvent(name,{detail}));for(const f of document.querySelectorAll("iframe")){try{if(f.contentWindow&&f.contentWindow.location.origin===location.origin)f.contentWindow.postMessage({namespace:"COSMIC_MYRAA_LIVE",event:name,detail},location.origin)}catch(_){}}}
function status(s){state=s;const n=document.getElementById("cosmicLiveStatus");if(n)n.textContent=s.toUpperCase();const b=document.getElementById("cosmicLiveButton");if(b)b.textContent=s==="connected"?"Stop MYRAA Live":s==="connecting"||s==="requesting token"?"Connecting…":"Start MYRAA Live";emit("cosmic:live-state",{state:s})}
function b64(buffer){const u=new Uint8Array(buffer);let s="";for(let i=0;i<u.length;i+=32768)s+=String.fromCharCode(...u.subarray(i,Math.min(i+32768,u.length)));return btoa(s)}
function pcm16(f){const a=new Int16Array(f.length);for(let i=0;i<f.length;i++){const v=Math.max(-1,Math.min(1,f[i]));a[i]=v<0?v*32768:v*32767}return a}
function rms(a){let s=0;for(let i=0;i<a.length;i++)s+=a[i]*a[i];return Math.sqrt(s/Math.max(1,a.length))}
function resample(a,from,to){if(from===to)return a;const ratio=from/to,n=Math.floor(a.length/ratio),o=new Float32Array(n);for(let i=0;i<n;i++){const p=i*ratio,l=Math.floor(p),r=Math.min(l+1,a.length-1),f=p-l;o[i]=a[l]*(1-f)+a[r]*f}return o}
function sendPcm(samples){if(!ws||ws.readyState!==WebSocket.OPEN||!samples?.length||ws.bufferedAmount>512000)return;const p=pcm16(samples);ws.send(JSON.stringify({realtimeInput:{audio:{mimeType:"audio/pcm;rate=16000",data:b64(p.buffer)}}}))}
function clearPlayback(){queue.forEach(n=>{try{n.stop(0)}catch(_){}});queue=[];nextTime=audioCtx?audioCtx.currentTime:0}
function playChunk(encoded,mime){if(!audioCtx||!encoded)return;const raw=atob(encoded),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);const len=bytes.length-bytes.length%2;if(!len)return;const view=new DataView(bytes.buffer,bytes.byteOffset,len),samples=new Float32Array(len/2);for(let i=0;i<samples.length;i++)samples[i]=view.getInt16(i*2,true)/32768;const m=String(mime||"").match(/rate=(\d+)/i),rate=m?Number(m[1]):24000,level=rms(samples);emit("cosmic:live-audio-level",{level:Math.min(1,level*5),rms:level,sampleRate:rate});const b=audioCtx.createBuffer(1,samples.length,rate);b.copyToChannel(samples,0);const n=audioCtx.createBufferSource();n.buffer=b;n.connect(audioCtx.destination);const t=Math.max(audioCtx.currentTime+.012,nextTime);n.start(t);nextTime=t+b.duration;queue.push(n);n.onended=()=>{queue=queue.filter(x=>x!==n)}}
function stopMic(){try{micNode?.disconnect()}catch(_){}try{micSource?.disconnect()}catch(_){}try{micGain?.disconnect()}catch(_){}micNode=micSource=micGain=null;stream?.getTracks().forEach(t=>t.stop());stream=null;if(workletUrl){URL.revokeObjectURL(workletUrl);workletUrl=null}fallbackBuffer=[]}
async function startMic(){
 stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
 micSource=audioCtx.createMediaStreamSource(stream);
 if(audioCtx.audioWorklet?.addModule){
  const workletCode=[
   "class CosmicMicProcessor extends AudioWorkletProcessor {",
   "constructor(){super();this.phase=0;this.chunk=new Float32Array(1600);this.index=0;}",
   "process(inputs,outputs){const input=inputs[0]&&inputs[0][0];const output=outputs[0]&&outputs[0][0];if(output)output.fill(0);if(!input)return true;let energy=0;for(let i=0;i<input.length;i++){const v=input[i];energy+=v*v;this.phase+=16000;if(this.phase>=sampleRate){this.phase-=sampleRate;this.chunk[this.index++]=v;if(this.index===1600){const frame=this.chunk;this.port.postMessage({pcm:frame},[frame.buffer]);this.chunk=new Float32Array(1600);this.index=0;}}}this.port.postMessage({level:Math.sqrt(energy/input.length)});return true;}}",
   "registerProcessor('cosmic-mic-processor',CosmicMicProcessor);"
  ].join("");
  workletUrl=URL.createObjectURL(new Blob([workletCode],{type:"text/javascript"}));
  await audioCtx.audioWorklet.addModule(workletUrl);
  micNode=new AudioWorkletNode(audioCtx,"cosmic-mic-processor",{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});
  micNode.port.onmessage=e=>{if(e.data?.pcm)sendPcm(e.data.pcm);if(typeof e.data?.level==="number")emit("cosmic:live-mic-level",{level:Math.min(1,e.data.level*8)})};
  micSource.connect(micNode);micNode.connect(audioCtx.destination);
 }else{
  micNode=audioCtx.createScriptProcessor(2048,1,1);micGain=audioCtx.createGain();micGain.gain.value=0;
  micNode.onaudioprocess=e=>{if(state!=="connected"||!ws||ws.readyState!==1)return;const input=e.inputBuffer.getChannelData(0);emit("cosmic:live-mic-level",{level:Math.min(1,rms(input)*8)});const converted=resample(input,audioCtx.sampleRate,TARGET_RATE);for(const v of converted)fallbackBuffer.push(v);while(fallbackBuffer.length>=CHUNK_SAMPLES)sendPcm(new Float32Array(fallbackBuffer.splice(0,CHUNK_SAMPLES)))};
  micSource.connect(micNode);micNode.connect(micGain);micGain.connect(audioCtx.destination);
 }
}
async function start(){
 if(["connected","connecting","requesting token"].includes(state)){stop();return}
 if(!navigator.mediaDevices?.getUserMedia||!window.WebSocket){status("microphone unavailable");alert("Live microphone access requires HTTPS or the COSMIC Android app.");return}
 const account=accountToken();if(!account){alert("Sign in to your COSMIC account first.");return}
 shuttingDown=false;
 try{
  status("requesting token");
  const r=await fetch(API_BASE()+"/api/assistant/live-token",{method:"POST",credentials:"include",headers:{Authorization:"Bearer "+account,"Content-Type":"application/json"},body:JSON.stringify({model:MODEL})});
  const d=await r.json().catch(()=>({}));if(!r.ok||!d.success||!d.token)throw Error(d.error||"Gemini Live token provisioning failed.");
  audioCtx=new(window.AudioContext||window.webkitAudioContext)({latencyHint:"interactive"});await audioCtx.resume();await startMic();status("connecting");
  ws=new WebSocket("wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token="+encodeURIComponent(d.token));
  ws.onopen=()=>{const setup={model:"models/"+(d.model||MODEL),generationConfig:{responseModalities:["AUDIO"],temperature:.7,speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:VOICE}}}},systemInstruction:{parts:[{text:"You are MYRAA, the natural, intelligent voice assistant inside COSMIC. Speak conversationally and directly. Keep answers concise unless detail is requested. Respond in the language the user speaks. Use natural spoken phrasing."}]},inputAudioTranscription:{},outputAudioTranscription:{},sessionResumption:{}};ws.send(JSON.stringify({setup}));clearTimeout(setupTimer);setupTimer=setTimeout(()=>{if(state==="connecting"){status("setup timeout");stop()}},15000)};
  ws.onmessage=e=>{try{const m=JSON.parse(e.data);if(m.setupComplete){clearTimeout(setupTimer);status("connected");emit("cosmic:live-ready",{model:d.model||MODEL,voice:VOICE})}if(m.serverContent?.interrupted){clearPlayback();emit("cosmic:live-interrupted",{})}for(const p of m.serverContent?.modelTurn?.parts||[]){const a=p.inlineData||p.inline_data;if(a?.data&&String(a.mimeType||a.mime_type||"").includes("audio"))playChunk(a.data,a.mimeType||a.mime_type);if(p.text)emit("cosmic:live-text",{text:p.text})}const input=m.serverContent?.inputTranscription?.text||m.inputTranscription?.text;if(input)emit("cosmic:live-input",{text:input});const output=m.serverContent?.outputTranscription?.text||m.outputTranscription?.text;if(output){lastOutputText=output;emit("cosmic:live-output",{text:output})}if(m.sessionResumptionUpdate?.newHandle)emit("cosmic:live-session-resumption",{handle:m.sessionResumptionUpdate.newHandle});if(m.goAway){status("session ending soon");emit("cosmic:live-go-away",{})}if(m.serverContent?.turnComplete)emit("cosmic:live-turn-complete",{text:lastOutputText})}catch(err){console.warn("Gemini Live message error",err)}};
  ws.onerror=()=>status("websocket error");
  ws.onclose=e=>{clearTimeout(setupTimer);const reason=(e.reason?" "+e.reason:"")+" ["+e.code+"]";cleanup(false);if(!shuttingDown)status("disconnected"+reason)};
 }catch(e){cleanup(true);status("error");alert("MYRAA Live: "+e.message)}
}
function cleanup(closeSocket=true){clearTimeout(setupTimer);stopMic();clearPlayback();if(closeSocket&&ws){const s=ws;ws=null;try{s.close(1000,"client stopped")}catch(_){}}else ws=null;if(audioCtx){const c=audioCtx;audioCtx=null;try{c.close()}catch(_){}}}
function stop(){shuttingDown=true;cleanup(true);emit("cosmic:live-ended",{});status("stopped")}
function install(){if(document.getElementById("cosmicLiveButton"))return;const b=document.createElement("button");b.id="cosmicLiveButton";b.type="button";b.textContent="Start MYRAA Live";b.style.cssText="position:fixed;bottom:20px;right:20px;z-index:99999;border-radius:999px;padding:13px 18px;background:#6d55ff;color:white;border:0;font-weight:700;box-shadow:0 4px 18px #0005;cursor:pointer";b.addEventListener("click",start);const s=document.createElement("div");s.id="cosmicLiveStatus";s.textContent="LIVE STANDBY";s.style.cssText="position:fixed;bottom:76px;right:20px;z-index:99999;color:inherit;font:12px sans-serif;background:#0008;padding:6px 10px;border-radius:8px";document.body.append(b,s)}
window.COSMIC_LIVE=Object.freeze({start,stop,get state(){return state},version:"3.0.0"});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install,{once:true});else install();
})();