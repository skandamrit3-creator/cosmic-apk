import {state,update} from "./state.js";
const clean=value=>String(value||"").trim().replace(/\/+$/,"");
export function baseUrl(){return clean(state.backendUrl)||clean(window.COSMIC_API_BASE)||"http://127.0.0.1:8059";}
export async function request(path,options={}){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),options.timeout||12000);try{const response=await fetch(baseUrl()+path,{...options,signal:controller.signal,cache:"no-store",headers:{...(options.body?{"Content-Type":"application/json"}:{}),...(options.headers||{})}});let data;const type=response.headers.get("content-type")||"";data=type.includes("application/json")?await response.json():await response.text();if(!response.ok)throw new Error((data&&data.error)||("HTTP "+response.status));return data;}finally{clearTimeout(timer);}}
export async function checkHealth(){const started=performance.now();try{const d=await request("/api/health",{timeout:5000});if(d.status!=="healthy"&&d.success!==true)throw new Error("Unexpected health response");const latency=Math.round(performance.now()-started);update({connection:"connected",latency});return d;}catch(e){update({connection:"offline",latency:null});throw e;}}
export async function getTelemetry(){return request("/api/reactor/telemetry",{timeout:7000});}
export async function getModels(){return request("/api/ai/models",{timeout:10000});}
export async function sendChat(message){return request("/api/chat",{method:"POST",timeout:120000,body:JSON.stringify({message,session_id:state.sessionId,provider:state.provider,model:state.model,mode:state.routing})});}
export async function getAvatarStatus(){return request("/api/avatar/3d/status",{timeout:7000});}
