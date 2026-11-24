(()=>{"use strict";if(window.COSMIC_VVA_BOOT)return;window.COSMIC_VVA_BOOT=true;
const css=`
#cosmic-vva-launch{position:fixed;z-index:99998;right:18px;bottom:calc(18px + env(safe-area-inset-bottom));border:1px solid #8b5cf6;background:linear-gradient(135deg,#25204a,#111827);color:#fff;border-radius:999px;padding:13px 18px;font:600 14px system-ui;box-shadow:0 8px 32px #0008;cursor:pointer}
#cosmic-vva-shell{position:fixed;inset:0;z-index:99999;background:#05050b;display:none;flex-direction:column}
#cosmic-vva-shell.open{display:flex}
#cosmic-vva-bar{height:54px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 14px;color:white;background:#111827;border-bottom:1px solid #333}
#cosmic-vva-frame{border:0;width:100%;height:100%;flex:1;background:#030306}
#cosmic-vva-close{border:0;border-radius:12px;padding:8px 14px;background:#31264f;color:white;font-size:15px}
`;
const style=document.createElement("style");style.textContent=css;document.head.appendChild(style);
const launch=document.createElement("button");launch.id="cosmic-vva-launch";launch.textContent="✦ MYRAA · VVA";launch.setAttribute("aria-label","Open MYRAA virtual voice assistant");document.body.appendChild(launch);
const shell=document.createElement("div");shell.id="cosmic-vva-shell";shell.innerHTML='<div id="cosmic-vva-bar"><span>✦ COSMIC · MYRAA VVA</span><button id="cosmic-vva-close" type="button">Close</button></div><iframe id="cosmic-vva-frame" title="MYRAA virtual voice assistant" allow="microphone; camera; autoplay; fullscreen; display-capture" src="/frontend/MYRAA_Ultra_Fast.html"></iframe>';document.body.appendChild(shell);
const open=()=>{shell.classList.add("open");launch.style.display="none";document.body.style.overflow="hidden"};
const close=()=>{shell.classList.remove("open");launch.style.display="";document.body.style.overflow=""};
launch.addEventListener("click",open);shell.querySelector("#cosmic-vva-close").addEventListener("click",close);
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&shell.classList.contains("open"))close()});
window.COSMIC_VVA={open,close,version:"1.0.0",source:"frontend/MYRAA_Ultra_Fast.html"};
})();