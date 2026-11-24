/* COSMIC VVA bridge. Parent/child message transport for authenticated COSMIC APIs. */
(()=>{"use strict";
 if(window.COSMIC_VVA_BOOT)return;window.COSMIC_VVA_BOOT=true;
 const iframe=()=>document.getElementById("cosmic-vva-frame");
 const shell=()=>document.getElementById("cosmic-vva-shell")||document.getElementById("cosmic-vva-overlay");
 const session="myraa-vva";
 async function api(path,opts={}){const r=await fetch("/api"+path,{credentials:"include",headers:{"Content-Type":"application/json"},...opts});const d=await r.json().catch(()=>({}));if(!r.ok||d.success===false)throw Error(d.error||"COSMIC backend request failed");return d;}
 const chat=(message,options={})=>api("/chat",{method:"POST",body:JSON.stringify({message:String(message||""),session_id:options.sessionId||session,provider:options.provider||"auto",model:options.model||"auto",mode:options.mode||"auto"})});
 const history=(limit=100)=>api("/history?session_id="+encodeURIComponent(session)+"&limit="+Math.min(200,Math.max(1,Number(limit)||100)));
 const liveToken=(model)=>api("/live/token",{method:"POST",body:JSON.stringify({model:model||undefined})});
 const pending=new Map();let seq=0;
 function requestFromFrame(action,payload={}){const f=iframe();if(!f?.contentWindow)return Promise.reject(Error("MYRAA frame unavailable"));const id="vva-"+(++seq);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error("COSMIC bridge timeout"));},30000);pending.set(id,{resolve,reject,timer});f.contentWindow.postMessage({namespace:"COSMIC_VVA_BRIDGE",requestId:id,action,...payload},location.origin);});}
 window.addEventListener("message",async e=>{const f=iframe();if(!f||e.source!==f.contentWindow||e.origin!==location.origin)return;const d=e.data;if(!d||d.namespace!=="COSMIC_VVA_BRIDGE_RESULT"||!pending.has(d.requestId))return;const p=pending.get(d.requestId);pending.delete(d.requestId);clearTimeout(p.timer);d.success?p.resolve(d.result):p.reject(Error(d.error||"Bridge error"));});
 const ready=()=>{const f=iframe();f?.contentWindow?.postMessage({namespace:"COSMIC_VVA_BRIDGE_READY"},location.origin);};
 if(iframe())iframe().addEventListener("load",ready);
 // Avoid duplicate launcher overlays if the main HTML already contains its own launcher.
 const launch=document.getElementById("cosmic-vva-launcher")||document.getElementById("cosmic-vva-launch");
 const overlay=shell();if(launch&&overlay){launch.addEventListener("click",()=>{overlay.classList.add("open");overlay.setAttribute("aria-hidden","false");ready();});}
 const close=document.getElementById("cosmic-vva-close");if(close&&overlay)close.addEventListener("click",()=>{overlay.classList.remove("open");overlay.setAttribute("aria-hidden","true");});
 window.COSMIC_VVA=Object.freeze({chat,history,liveToken,requestFromFrame,version:"2.0.0",sessionId:session});
})();