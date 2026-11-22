(()=>{"use strict";
if(window.COSMIC_MYRAA_VVA)return;
const css=`
#cosmic2DStage{background:radial-gradient(ellipse at 50% 40%,#29254a,#080a13)!important}
#cosmic2DStage canvas{width:100%!important;height:100%!important}
#cosmic2DStage .cosmic-vva-top{position:absolute;top:env(safe-area-inset-top,0);left:0;right:0;display:flex;justify-content:space-between;align-items:center;padding:18px 20px;color:#fff;font:600 14px system-ui;letter-spacing:.16em;z-index:3}
#cosmic2DStage .cosmic-vva-top button,#cosmic2DStage .cosmic-vva-controls button{border:1px solid #ffffff28;background:#17172dcc;color:#fff;border-radius:28px;padding:12px 18px;font:500 14px system-ui}
#cosmic2DStage .cosmic-vva-caption{position:absolute;bottom:calc(115px + env(safe-area-inset-bottom));left:5%;right:5%;max-height:25vh;overflow:auto;color:#fff;text-align:center;font:16px/1.5 system-ui;background:#111827aa;border:1px solid #ffffff20;border-radius:20px;padding:16px;z-index:3;backdrop-filter:blur(16px)}
#cosmic2DStage .cosmic-vva-controls{position:absolute;bottom:calc(24px + env(safe-area-inset-bottom));left:0;right:0;display:flex;justify-content:center;gap:12px;z-index:3}
#cosmic2DStage .cosmic-vva-controls #cosmicVvaTalk{background:linear-gradient(135deg,#8d68ff,#4d65d9);border:0;min-width:140px;font-weight:700}
#cosmic2DStage .cosmic-vva-controls #cosmicVvaTalk[data-live="true"]{background:linear-gradient(135deg,#db547d,#9d3863)}
#cosmic2DStage .cosmic-vva-status{position:absolute;top:72px;left:0;right:0;text-align:center;color:#d4c9ff;font:11px system-ui;letter-spacing:.12em;z-index:3}
#cosmic2DStage .cosmic-vva-caption:empty{display:none}
#cosmic2DStage #cosmic2DAction,#cosmic2DStage [data-act],#cosmic2DStage #cosmic2DExit{display:none!important}
#cosmic2DToggle{display:none!important}
@media(max-width:480px){#cosmic2DStage .cosmic-vva-caption{font-size:14px;bottom:calc(105px + env(safe-area-inset-bottom))}#cosmic2DStage .cosmic-vva-controls button{padding:13px 22px}}
`;
function init(){
 const stage=document.getElementById("cosmic2DStage");if(!stage)return;
 if(!document.getElementById("cosmicVvaCss")){const st=document.createElement("style");st.id="cosmicVvaCss";st.textContent=css;document.head.append(st)}
 stage.querySelector("#cosmic2DAction")?.remove();
 stage.querySelector("#cosmic2DExit")?.remove();
 stage.querySelectorAll("[data-act]").forEach(x=>x.remove());
 const top=document.createElement("div");top.className="cosmic-vva-top";top.innerHTML='<span>COSMIC <span style="opacity:.6">· MYRAA</span></span><button id="cosmicVvaClose">⌄ Minimize</button>';
 const status=document.createElement("div");status.className="cosmic-vva-status";status.id="cosmicVvaStatus";status.textContent="READY";
 const caption=document.createElement("div");caption.className="cosmic-vva-caption";caption.id="cosmicVvaCaption";
 const controls=document.createElement("div");controls.className="cosmic-vva-controls";controls.innerHTML='<button id="cosmicVvaTalk">Start conversation</button>';
 stage.append(top,status,caption,controls);
 top.querySelector("#cosmicVvaClose").onclick=()=>window.COSMIC_2D?.hide();
 const talk=controls.querySelector("#cosmicVvaTalk");
 talk.onclick=()=>{if(talk.dataset.live==="true"){window.COSMIC_LIVE?.stop();talk.dataset.live="false";talk.textContent="Start conversation";status.textContent="STANDBY"}else{if(!window.COSMIC_LIVE){caption.textContent="Live voice module unavailable.";return}status.textContent="CONNECTING";talk.textContent="Stop conversation";talk.dataset.live="true";window.COSMIC_LIVE.start()}};
 document.addEventListener("cosmic:live-input",e=>{caption.textContent=e.detail?.text||"Listening…";status.textContent="LISTENING"});
 document.addEventListener("cosmic:live-output",e=>{if(e.detail?.text)caption.textContent=e.detail.text;status.textContent="MYRAA SPEAKING"});
 document.addEventListener("cosmic:live-text",e=>{if(e.detail?.text)caption.textContent=e.detail.text});
 document.addEventListener("cosmic:live-ended",()=>{talk.dataset.live="false";talk.textContent="Start conversation";status.textContent="STANDBY"});
 document.addEventListener("cosmic:live-audio-level",e=>{if((e.detail?.level||0)>.08)status.textContent="YOU ARE SPEAKING"});
 const oldShow=window.COSMIC_2D?.show;if(oldShow&&!window.COSMIC_MYRAA_SHOW_PATCHED){window.COSMIC_2D.show=()=>{oldShow();stage.style.display="block"};window.COSMIC_MYRAA_SHOW_PATCHED=true}
 window.COSMIC_MYRAA_VVA={open:()=>window.COSMIC_2D?.show(),close:()=>window.COSMIC_2D?.hide(),start:()=>talk.click(),stop:()=>window.COSMIC_LIVE?.stop()};
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>setTimeout(init,100),{once:true});else setTimeout(init,100);
})();
