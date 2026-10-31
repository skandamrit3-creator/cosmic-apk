/* COSMIC Live dock: one persistent, user-controlled Gemini Live switch. */
(() => {
  "use strict";
  const native = () => window.Capacitor?.Plugins?.CosmicVoice;
  const state = { active:false, starting:false, listener:null, lastState:"READY" };
  const dock = document.createElement("aside");
  dock.id = "cosmicLiveDock";
  dock.innerHTML = '<span class="cosmic-live-indicator" aria-hidden="true"></span><div class="cosmic-live-copy"><b id="cosmicLiveTitle">COSMIC LIVE</b><small id="cosmicLiveStatus">VOICE OFF · READY</small></div><button id="cosmicLiveShare" type="button" hidden>SHARE SCREEN</button><button id="cosmicLiveToggle" type="button" aria-pressed="false">START LIVE</button>';
  document.body.append(dock);
  const title=dock.querySelector("#cosmicLiveTitle"), status=dock.querySelector("#cosmicLiveStatus"), button=dock.querySelector("#cosmicLiveToggle"), share=dock.querySelector("#cosmicLiveShare");
  function paint(message, active=state.active) {
    state.lastState=message||"READY"; state.active=active;
    dock.classList.toggle("is-live",active);
    dock.classList.toggle("is-starting",state.starting);
    button.textContent=state.starting?"CONNECTING…":active?"STOP LIVE":"START LIVE";
    button.setAttribute("aria-pressed",String(active));
    share.hidden=!active||!native()?.startScreenShare;
    status.textContent=state.lastState;
    title.textContent=active?"COSMIC IS LISTENING":"COSMIC LIVE";
  }
  function appendTranscript(text, role) {
    const log=document.querySelector("#cosmicChatLog");
    if(!log||!text)return;
    let el=log.querySelector(role==="assistant"?".cosmic-live-current-assistant":".cosmic-live-current-user");
    if(!el){el=document.createElement("div");el.className="cosmic-chat-msg "+(role==="assistant"?"assistant cosmic-live-current-assistant":"user cosmic-live-current-user");log.append(el);}
    el.textContent+=(el.textContent?" ":"")+text;
    log.scrollTop=log.scrollHeight;
  }
  function onEvent(event) {
    const type=event?.type||"", message=event?.message||"";
    if(type==="state") {
      const live=/LISTENING|CONNECTED|RECONNECTING/i.test(message);
      const active=live||(/STOPPED/.test(message)?false:state.active);
      state.starting=/Starting|RECONNECTING/i.test(message);
      paint(message,active);
    } else if(type==="error") {
      state.starting=false;paint("ERROR · "+message,false);
    } else if(type==="transcript") {
      if(message)appendTranscript(message,"assistant");
    } else if(type==="user_transcript") {
      if(message)appendTranscript(message,"user");
    } else if(type==="audio_level") {
      window.COSMIC_AVATAR_AUDIO_LEVEL?.(Number(message)||0);
    } else if(type==="audio_start") {
      window.COSMIC_AVATAR_TALK?.(true);
      document.documentElement.classList.add("cosmic-live-speaking");
    } else if(type==="audio_end"||type==="turn_complete") {
      window.COSMIC_AVATAR_TALK?.(false);
      document.documentElement.classList.remove("cosmic-live-speaking");
    }
    document.dispatchEvent(new CustomEvent("cosmic:live-event",{detail:event}));
  }
  async function start() {
    const plugin=native();
    if(!plugin||typeof plugin.startLive!=="function") {
      paint("GEMINI LIVE NEEDS ANDROID APP",false);
      if(window.COSMIC_VOICE?.start) {
        status.textContent="DESKTOP VOICE FALLBACK";
        window.COSMIC_VOICE.start();
      }
      return;
    }
    state.starting=true;paint("REQUESTING MICROPHONE…",false);
    try {
      await plugin.startLive();
      state.starting=true;paint("CONNECTING TO GEMINI…",false);
    } catch(error) {
      state.starting=false;paint("START FAILED · "+(error?.message||error),false);
    }
  }
  async function stop() {
    try { await native()?.stopLive?.(); } catch(error) { paint("STOP ERROR · "+(error?.message||error),false); }
    state.starting=false;paint("VOICE OFF · STOPPED",false);
    window.COSMIC_AVATAR_TALK?.(false);
    document.documentElement.classList.remove("cosmic-live-speaking");
  }
  button.addEventListener("click",()=>state.active||state.starting?stop():start());
  share.addEventListener("click",async()=>{
    const plugin=native();
    if(!plugin?.startScreenShare){paint("SCREEN SHARING IS ANDROID ONLY",state.active);return;}
    share.disabled=true;
    try{await plugin.startScreenShare();share.textContent="SCREEN SHARING";status.textContent="LIVE · SCREEN SHARING";}
    catch(error){status.textContent="SCREEN SHARE ERROR · "+(error?.message||error);}
    finally{share.disabled=false;}
  });
  window.COSMIC_LIVE={
    start,stop,
    toggle(){return state.active||state.starting?stop():start();},
    async shareScreen(){const plugin=native();if(!plugin?.startScreenShare)throw new Error("Screen sharing requires the Android app.");return plugin.startScreenShare();},
    async stopScreenShare(){return native()?.stopScreenShare?.();},
    get active(){return state.active||state.starting;},
    async sendText(text){const plugin=native();if(!plugin?.sendLiveText)throw new Error("Native Gemini Live is unavailable.");return plugin.sendLiveText({text:String(text||"")});},
    onEvent
  };
  if(native()?.addListener) {
    native().addListener("liveEvent",onEvent).then(handle=>{state.listener=handle;}).catch(()=>{});
  }
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&state.active)paint("LIVE · SESSION RUNNING",true);});
  paint("VOICE OFF · READY",false);
})();
