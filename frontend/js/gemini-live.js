/* COSMIC Gemini Live — low-latency speech-to-speech session.
   Audio capture is permission-gated; the long-lived Gemini key never leaves the backend. */
(() => {
  "use strict";
  const API = () => String(window.COSMIC_API_BASE || window.location.origin).replace(/\/$/, "");
  const liveModel = () => ["gemini-3.8-live","gemini-3.8-live-extended-thinking"].includes(localStorage.getItem("COSMIC_LIVE_MODEL")) ? localStorage.getItem("COSMIC_LIVE_MODEL") : "gemini-3.8-live";
  const liveVoice = () => ["Kore","Aoede","Puck","Charon","Fenrir","Leda","Orus","Zephyr"].includes(localStorage.getItem("COSMIC_LIVE_VOICE")) ? localStorage.getItem("COSMIC_LIVE_VOICE") : "Kore";
  const livePersona = () => String(localStorage.getItem("COSMIC_LIVE_PERSONA") || "").trim().slice(0,1200);
  const WS_BASE = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
  const state = {
    desired: false, connected: false, connecting: false, sharing: false,
    socket: null, stream: null, context: null, source: null, processor: null,
    silentGain: null, nextPlayTime: 0, playing: new Set(), analyser: null, meterFrame: 0, meterData: null, resumeHandle: "",
    reconnectTimer: 0, reconnectDelay: 1200, reconnectAttempts: 0, generation: 0, fallbackMode: false, fallbackBusy: false, fallbackNativeRecognition: false, fallbackRecognition: null, fallbackWakeEnabled: false, fallbackRestartTimer: 0, screenStream: null,
    screenVideo: null, screenTimer: 0, cameraStream: null, cameraVideo: null, cameraTimer: 0, lastTranscript: "", nativeScreen: false, nativeScreenHandle: null, voiceService: false, nativeMode: false, nativeListener: null, bubbleActive: false
  };
  let root, orb, status, shareButton, cameraButton, bubbleButton, wakeButton;

  function setStatus(value, mode) {
    if (status) { status.textContent = value; status.dataset.state = mode || "idle"; }
    document.dispatchEvent(new CustomEvent("cosmic:live-state", {detail:{state:mode||"idle", text:value}}));
    if (orb) {
      orb.classList.toggle("is-live", mode === "live");
      orb.classList.toggle("is-busy", mode === "connecting");
      orb.setAttribute("aria-label", state.desired ? "Stop COSMIC Live voice" : "Start COSMIC Live voice");
      orb.title = state.desired ? "Stop live conversation" : "Start live conversation";
    }
    if (shareButton) { shareButton.disabled = !state.connected && !state.sharing; shareButton.classList.toggle("is-sharing", !!state.sharing); shareButton.setAttribute("aria-label", state.sharing ? "Stop screen sharing" : "Share screen"); shareButton.textContent = state.sharing ? "■" : "▣"; }
    if (bubbleButton) bubbleButton.hidden = !state.nativeMode || state.bubbleActive;
    if (cameraButton) { cameraButton.disabled=!state.connected&&!state.cameraStream; cameraButton.classList.toggle("is-sharing",!!state.cameraStream); cameraButton.textContent=state.cameraStream?"●":"⌖"; cameraButton.setAttribute("aria-label",state.cameraStream?"Stop camera":"Share camera with COSMIC"); }
  }

  async function startCamera() {
    if(!state.connected){setStatus("START GEMINI LIVE BEFORE SHARING CAMERA","idle");return;}
    if(!navigator.mediaDevices?.getUserMedia){setStatus("CAMERA ACCESS IS NOT AVAILABLE IN THIS WEBVIEW","error");return;}
    try{
      const nativeCamera=window.Capacitor?.Plugins?.CosmicVoice;if(nativeCamera?.requestCameraPermission){const permission=await nativeCamera.requestCameraPermission();if(!permission?.granted)throw new Error("Camera permission was not granted.");}
      state.cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment",width:{ideal:1280},height:{ideal:720}},audio:false});
      state.cameraVideo=document.createElement("video");state.cameraVideo.muted=true;state.cameraVideo.playsInline=true;state.cameraVideo.srcObject=state.cameraStream;state.cameraVideo.className="cosmic-camera-preview";state.cameraVideo.setAttribute("aria-label","COSMIC live camera preview");document.body.append(state.cameraVideo);await state.cameraVideo.play();
      const canvas=document.createElement("canvas"),ctx=canvas.getContext("2d",{alpha:false});canvas.width=640;canvas.height=360;
      state.cameraTimer=window.setInterval(()=>{try{if(!state.connected||!state.cameraVideo||state.cameraVideo.readyState<2)return;ctx.drawImage(state.cameraVideo,0,0,640,360);const data=canvas.toDataURL("image/jpeg",.55).split(",")[1];if(state.nativeMode)window.Capacitor?.Plugins?.CosmicVoice?.sendLiveVideoFrame?.({data}).catch(error=>console.warn("Native camera frame skipped",error));else send({realtimeInput:{video:{data,mimeType:"image/jpeg"}}});}catch(error){console.warn("COSMIC camera frame skipped",error);}},1100);
      setStatus("CAMERA SHARING · TAP CAMERA TO STOP","live");if(cameraButton)cameraButton.classList.add("is-sharing");
    }catch(error){stopCamera();setStatus("CAMERA PERMISSION / START FAILED · "+(error.message||error),"error");}
  }
  function stopCamera(){
    if(state.cameraTimer)clearInterval(state.cameraTimer);state.cameraTimer=0;
    try{state.cameraStream?.getTracks().forEach(track=>track.stop());}catch(_){}
    state.cameraStream=null;if(state.cameraVideo){state.cameraVideo.srcObject=null;state.cameraVideo.remove();state.cameraVideo=null;}
    if(cameraButton){cameraButton.classList.remove("is-sharing");cameraButton.textContent="◉";}
  }
  function mount() {
    if (document.getElementById("cosmicLiveDock")) return;
    root = document.createElement("section");
    root.id = "cosmicLiveDock";
    root.className = "cosmic-live-dock";
    root.innerHTML = '<div class="cosmic-live-main"><div class="cosmic-live-brand"><span class="cosmic-live-dot"></span><div><b>COSMIC LIVE</b><small class="cosmic-live-status" id="cosmicLiveStatus" data-state="idle" role="status">VOICE OFF · READY</small></div></div><button class="cosmic-live-orb" id="cosmicLiveToggle" type="button" aria-label="Start COSMIC Live voice" title="Start live conversation"><span class="cosmic-live-orb-core">C</span><i></i></button><button class="cosmic-live-share" id="cosmicLiveShare" type="button" aria-label="Share screen" title="Share screen" disabled>▣</button><button class="cosmic-live-camera" id="cosmicLiveCamera" type="button" aria-label="Share camera with COSMIC vision" title="Share camera with COSMIC vision" disabled>◉</button><button class="cosmic-live-settings-toggle" id="cosmicLiveSettingsToggle" type="button" aria-label="Voice settings" aria-expanded="false" title="Voice settings">⚙</button></div><div class="cosmic-live-options" id="cosmicLiveOptions" hidden><label>LIVE MODEL<select class="cosmic-live-choice" id="cosmicLiveModel" aria-label="Gemini Live model"><option value="gemini-3.8-live">GEMINI 3.8 · FAST</option><option value="gemini-3.8-live-extended-thinking">GEMINI 3.8 · THINK</option></select></label><label>VOICE<select class="cosmic-live-choice cosmic-live-voice" id="cosmicLiveVoice" aria-label="COSMIC voice"><option value="Kore">KORE</option><option value="Aoede">AOEDE</option><option value="Puck">PUCK</option><option value="Charon">CHARON</option><option value="Fenrir">FENRIR</option><option value="Leda">LEDA</option><option value="Orus">ORUS</option><option value="Zephyr">ZEPHYR</option></select></label><button class="cosmic-live-wake" id="cosmicLiveWake" type="button">ENABLE OK COSMIC</button><button class="cosmic-live-wake cosmic-live-assistant" id="cosmicLiveAssistant" type="button">MAKE COSMIC DEFAULT ASSISTANT</button><button class="cosmic-live-bubble" id="cosmicLiveBubble" type="button" hidden>FLOATING BUBBLE</button></div>';
    document.body.append(root);
    orb = root.querySelector("#cosmicLiveToggle");
    status = root.querySelector("#cosmicLiveStatus");
    const modelSelect = root.querySelector("#cosmicLiveModel");
    const settingsToggle = root.querySelector("#cosmicLiveSettingsToggle");
    const optionsPanel = root.querySelector("#cosmicLiveOptions");
    settingsToggle.addEventListener("click", () => { optionsPanel.hidden = !optionsPanel.hidden; settingsToggle.setAttribute("aria-expanded", String(!optionsPanel.hidden)); });
    const voiceSelect = root.querySelector("#cosmicLiveVoice");
    modelSelect.value = liveModel(); voiceSelect.value = liveVoice();
    modelSelect.addEventListener("change", () => { localStorage.setItem("COSMIC_LIVE_MODEL", modelSelect.value); state.resumeHandle=""; if (!state.desired) return; if (state.nativeMode) window.Capacitor?.Plugins?.CosmicVoice?.startLive?.({model:liveModel(),voice:liveVoice(),persona:livePersona()}).catch(error => setStatus("MODEL SWITCH FAILED · "+error.message,"error")); else if (state.socket) state.socket.close(1012,"COSMIC Live model changed"); });
    voiceSelect.addEventListener("change", () => { localStorage.setItem("COSMIC_LIVE_VOICE", voiceSelect.value); localStorage.setItem("COSMIC_TTS_VOICE", voiceSelect.value); if (!state.desired) return; if (state.nativeMode) window.Capacitor?.Plugins?.CosmicVoice?.startLive?.({model:liveModel(),voice:liveVoice()}).catch(error => setStatus("VOICE SWITCH FAILED · "+error.message,"error")); else if (state.socket) state.socket.close(1012,"COSMIC Live voice changed"); });
    shareButton = root.querySelector("#cosmicLiveShare");
    cameraButton = root.querySelector("#cosmicLiveCamera");
    bubbleButton = root.querySelector("#cosmicLiveBubble");
    wakeButton = root.querySelector("#cosmicLiveWake");
    const assistantButton = root.querySelector("#cosmicLiveAssistant");
    const wakePlugin = window.Capacitor?.Plugins?.CosmicVoice;
    assistantButton?.addEventListener("click", async () => {
      assistantButton.disabled = true;
      try {
        if (typeof wakePlugin?.requestDefaultAssistant !== "function") throw new Error("Default assistant selection is available in the installed Android app.");
        const result = await wakePlugin.requestDefaultAssistant();
        if (!result?.selected) throw new Error(result?.message || "COSMIC was not selected.");
        assistantButton.textContent = "COSMIC IS DEFAULT ASSISTANT";
        setStatus("COSMIC SELECTED AS ANDROID ASSISTANT · ENABLE LOCAL WAKE WORD", "idle");
      } catch (error) {
        setStatus("ASSISTANT SETUP · " + (error?.message || error), "paused");
      } finally {
        assistantButton.disabled = false;
      }
    });
    const paintWake = enabled => { if(wakeButton){wakeButton.textContent=enabled?"WAKE WORD ON":"ENABLE OK COSMIC";wakeButton.classList.toggle("is-enabled",!!enabled);wakeButton.setAttribute("aria-pressed",String(!!enabled));} };
    wakePlugin?.getWakeWordStatus?.().then(async result=>{
      paintWake(!!result?.enabled);
      // Android blocks microphone foreground-service auto-start directly from BOOT_COMPLETED.
      // Once the user taps the boot-resume notification and opens COSMIC, resume the opted-in local detector.
      if(result?.enabled&&!result?.running&&typeof wakePlugin.enableWakeWord==="function"){
        try{await wakePlugin.enableWakeWord();paintWake(true);setStatus("LOCAL WAKE WORD RESUMED · LISTENING FOR OK COSMIC","idle");}
        catch(error){setStatus("WAKE WORD RESUME FAILED · "+(error?.message||error),"error");}
      }
    }).catch(()=>{});
    wakeButton.addEventListener("click",async()=>{wakeButton.disabled=true;try{const api=window.Capacitor?.Plugins?.CosmicVoice;if(!api)throw new Error("Local wake word is available in the Android app.");const current=await api.getWakeWordStatus();if(current?.enabled){await api.disableWakeWord();try{await api.stopLive();}catch(_){}localStorage.setItem("COSMIC_LIVE_AUTO","false");paintWake(false);setStatus("COSMIC VOICE STANDBY DISABLED","idle");}else{localStorage.setItem("COSMIC_LIVE_AUTO","true");await api.enableWakeWord();paintWake(true);setStatus("LOCAL WAKE WORD STARTED · FIRST SETUP MAY DOWNLOAD THE OFFLINE MODEL","connecting");}}catch(error){setStatus("WAKE WORD SETUP FAILED · "+(error.message||error),"error");}finally{wakeButton.disabled=false;}});
    orb.addEventListener("click", () => state.desired ? stop() : start(false));
    shareButton.addEventListener("click", () => state.sharing ? stopScreenShare() : startScreenShare());
    cameraButton.addEventListener("click", () => state.cameraStream ? stopCamera() : startCamera());
    bubbleButton.addEventListener("click", async () => { try { await window.Capacitor?.Plugins?.CosmicVoice?.openFloatingBubbleSettings?.(); setStatus("ALLOW DISPLAY OVER OTHER APPS, THEN RETURN TO COSMIC", "connecting"); } catch (error) { setStatus("BUBBLE SETUP FAILED · "+error.message, "error"); } });
    const nativeVoice = window.Capacitor?.Plugins?.CosmicVoice;
    setStatus("LIVE VOICE OFF", "idle");
    if (localStorage.getItem("COSMIC_LIVE_AUTO") === null) {
      // COSMIC defaults to Live-on. The user can switch it off with the orb.
      localStorage.setItem("COSMIC_LIVE_AUTO", "true");
    }
    if (localStorage.getItem("COSMIC_LIVE_AUTO") === "true") {
      if (typeof nativeVoice?.enableWakeWord === "function") {
        // Android: keep only the lightweight offline detector active in standby.
        // Open the paid/online Live session only after the user says the wake phrase.
        state.desired = false;
        setStatus("STARTING LOCAL COSMIC WAKE WORD…", "connecting");
        nativeVoice.getWakeWordStatus?.().then(async result => {
          if (!result?.enabled || !result?.running) await nativeVoice.enableWakeWord();
          if (wakeButton) {
            wakeButton.textContent = "WAKE WORD ON";
            wakeButton.classList.add("is-enabled");
            wakeButton.setAttribute("aria-pressed", "true");
          }
          setStatus("LOCAL WAKE WORD ACTIVE · SAY OK COSMIC", "idle");
        }).catch(error => {
          setStatus("WAKE WORD NEEDS MICROPHONE PERMISSION · " + (error?.message || error), "paused");
        });
      } else {
        // Browser fallback: there is no native local hotword service, so use an explicit Live session.
        state.desired = true;
        setStatus("CHECKING GEMINI LIVE KEY…", "connecting");
        fetch(API() + "/api/ai/provider-keys", {cache:"no-store"})
          .then(r => r.json())
          .then(data => {
            const configured = (data.providers || []).some(p => p.provider === "gemini" && p.configured);
            if (!configured) {
              state.desired = false;
              setStatus("ADD GEMINI KEY IN API SETUP · LIVE AUTO-START READY", "paused");
              return;
            }
            if (navigator.permissions?.query) {
              navigator.permissions.query({name:"microphone"}).then(permission => {
                if (permission.state === "granted" && state.desired) start(true);
                else { state.desired = false; setStatus("TAP LIVE ORB TO ALLOW MICROPHONE", "paused"); }
              }).catch(() => { state.desired = false; setStatus("TAP LIVE ORB TO ALLOW MICROPHONE", "paused"); });
            } else { state.desired = false; setStatus("TAP LIVE ORB TO ALLOW MICROPHONE", "paused"); }
          })
          .catch(() => { state.desired = false; setStatus("LIVE AUTO-START · CHECK API SETUP", "paused"); });
      }
    }
  }

  function floatToPcm16(input, sampleRate) {
    const ratio = sampleRate / 16000;
    const length = Math.floor(input.length / ratio);
    const output = new Int16Array(length);
    for (let i=0; i<length; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(Math.floor((i + 1) * ratio), input.length);
      let sum = 0;
      for (let j=start; j<end; j++) sum += input[j];
      const sample = end > start ? sum / (end - start) : input[start] || 0;
      const clipped = Math.max(-1, Math.min(1, sample));
      output[i] = clipped < 0 ? clipped * 32768 : clipped * 32767;
    }
    return output;
  }

  function toBase64(bytes) {
    let binary = "";
    const stride = 0x8000;
    for (let i=0; i<bytes.length; i+=stride) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i+stride, bytes.length)));
    }
    return btoa(binary);
  }

  function send(payload) {
    if (state.nativeMode && payload?.toolResponse?.functionResponses) {
      const plugin = window.Capacitor?.Plugins?.CosmicVoice;
      plugin?.sendLiveToolResponse?.({responses:JSON.stringify(payload.toolResponse.functionResponses)})
        .catch(error => setStatus("DEVICE TOOL RESPONSE FAILED · "+error.message, "error"));
      return true;
    }
    if (state.socket?.readyState === WebSocket.OPEN) {
      state.socket.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }

  function stopPlaybackMeter() {
    if (state.meterFrame) cancelAnimationFrame(state.meterFrame);
    state.meterFrame = 0;
    document.dispatchEvent(new CustomEvent("cosmic:live-audio-level", {detail:{level:0}}));
  }

  function startPlaybackMeter() {
    if (!state.analyser || state.meterFrame) return;
    const analyser = state.analyser;
    const data = state.meterData || (state.meterData = new Uint8Array(analyser.fftSize));
    const tick = () => {
      state.meterFrame = 0;
      if (!state.playing.size) return;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const sample = (data[i] - 128) / 128;
        sum += sample * sample;
      }
      const rms = Math.sqrt(sum / data.length);
      const level = Math.max(0, Math.min(1, (rms - 0.012) * 5.2));
      document.dispatchEvent(new CustomEvent("cosmic:live-audio-level", {detail:{level}}));
      state.meterFrame = requestAnimationFrame(tick);
    };
    state.meterFrame = requestAnimationFrame(tick);
  }

  function stopPlayback() {
    stopPlaybackMeter();
    for (const node of state.playing) {
      try { node.stop(); } catch (_) {}
      try { node.disconnect(); } catch (_) {}
    }
    state.playing.clear();
    state.nextPlayTime = state.context?.currentTime || 0;
    window.COSMIC_AVATAR_TALK?.(false);
    window.COSMIC_CHARACTER_TALK?.(false);
    window.COSMIC_AVATAR_AUDIO_LEVEL?.(0);
    window.COSMIC_CHARACTER_AUDIO_LEVEL?.(0);
  }

  function playPcm(base64) {
    if (!state.context) return;
    const raw = atob(base64);
    const pcm = new Int16Array(raw.length / 2);
    for (let i = 0; i < pcm.length; i++) pcm[i] = (raw.charCodeAt(i * 2) & 255) | (raw.charCodeAt(i * 2 + 1) << 8);
    if (!pcm.length) return;
    window.COSMIC_AVATAR_TALK?.(true);
    window.COSMIC_CHARACTER_TALK?.(true);
    const buffer = state.context.createBuffer(1, pcm.length, 24000);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 32768;
    const node = state.context.createBufferSource();
    node.buffer = buffer;
    if (!state.analyser) {
      state.analyser = state.context.createAnalyser();
      state.analyser.fftSize = 512;
      state.analyser.smoothingTimeConstant = 0.68;
      state.analyser.connect(state.context.destination);
    }
    node.connect(state.analyser);
    const startAt = Math.max(state.context.currentTime + 0.025, state.nextPlayTime);
    state.nextPlayTime = startAt + buffer.duration;
    state.playing.add(node);
    startPlaybackMeter();
    node.onended = () => {
      state.playing.delete(node);
      try { node.disconnect(); } catch (_) {}
      if (!state.playing.size) {
        stopPlaybackMeter();
        window.COSMIC_AVATAR_TALK?.(false);
        window.COSMIC_CHARACTER_TALK?.(false);
        window.COSMIC_AVATAR_AUDIO_LEVEL?.(0);
        window.COSMIC_CHARACTER_AUDIO_LEVEL?.(0);
      }
    };
    node.start(startAt);
  }

  function transcript(text, role) {
    const value = String(text || "").trim();
    if (!value) return;
    state.lastTranscript = value;
    window.COSMIC_AVATAR_COMMAND?.(value);
    document.dispatchEvent(new CustomEvent("cosmic:live-transcript", {detail:{text:value,role}}));
    const chat = document.getElementById("cosmicChatLog");
    const avatar = document.getElementById("avatarConversationLog");
    const myraa = document.getElementById("myraaConversationLog");
    const targets = [chat, avatar, myraa].filter(Boolean);
    for (const target of targets) {
      const item = document.createElement("div");
      item.className = target.id === "cosmicChatLog"
        ? "cosmic-chat-msg " + (role === "user" ? "user" : "assistant")
        : target.id === "myraaConversationLog"
          ? "myraa-message " + (role === "user" ? "user" : "assistant")
          : "avatar-conversation-message " + (role === "user" ? "user" : "assistant");
      item.textContent = value;
      target.append(item);
      target.scrollTop = target.scrollHeight;
    }
  }

  async function getToken() {
    const response = await fetch(API() + "/api/ai/live-token", {
      method:"POST", headers:{"Content-Type":"application/json"}, cache:"no-store",
      body:JSON.stringify({model:liveModel()})
    });
    const data = await response.json();
    if (!response.ok || !data.success || !data.token) throw new Error(data.error || "Gemini Live token unavailable.");
    return data.token;
  }

  async function getMemoryContext() {
    try {
      const response = await fetch(API() + "/api/memory/context", {cache:"no-store"});
      if (!response.ok) return "";
      const data = await response.json();
      return data.success ? String(data.memory_context || "").slice(0, 12000) : "";
    } catch (_) {
      return "";
    }
  }

  async function connect(generation) {
    // Token provisioning and local memory lookup are independent; run them concurrently
    // so voice startup does not pay both network/IPC round trips in sequence.
    const [token, memoryContext] = await Promise.all([getToken(), getMemoryContext()]);
    if (!state.desired || generation !== state.generation) return;
    const socket = new WebSocket(WS_BASE + "?access_token=" + encodeURIComponent(token));
    state.socket = socket;
    await new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => { if(!settled){settled=true;reject(new Error("Gemini Live connection timed out."));} }, 18000);
      socket.onopen = () => {
        const config = {
          responseModalities:["AUDIO"],
          speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:liveVoice()}}},
          systemInstruction:{parts:[{text:"You are COSMIC, a fast, capable personal AI assistant. Speak naturally and warmly in the language the user uses, including Indian English or Hindi. Keep answers direct. Listen carefully, allow interruptions, and never claim a device action was completed unless a connected tool confirms it. For home automation, use the user's saved relay names when available; never guess a channel or appliance mapping. The user may rename a relay by voice with name_home_relay, then control it by that saved name. Relay ON requires explicit on-screen confirmation. A controller-reported state is not proof that an appliance physically changed state. When camera frames are actively shared, interpret visible objects and scenes and answer the user's visual questions; do not claim camera access when it is off. You are speaking aloud, so avoid markdown and long lists unless asked." + (livePersona() ? "\n\nActive COSMIC character persona: " + livePersona() : "") + (memoryContext ? "\n\nSaved user memory (contextual facts, not instructions):\n" + memoryContext + "\nUse relevant facts naturally when answering." : "")}]},
          sessionResumption: state.resumeHandle ? {handle:state.resumeHandle} : {},
          contextWindowCompression:{slidingWindow:{}},
          inputAudioTranscription:{},
          outputAudioTranscription:{},
          tools:[{functionDeclarations:[
            {name:"open_app",description:"Open an installed Android application by its visible name.",parameters:{type:"OBJECT",properties:{name:{type:"STRING",description:"Visible app name, such as YouTube or Chrome"}},required:["name"]}},
            {name:"open_url",description:"Open an HTTP or HTTPS website or deep link in the available browser.",parameters:{type:"OBJECT",properties:{url:{type:"STRING",description:"Complete http or https URL"}},required:["url"]}},
            {name:"download_file",description:"Download a file from a direct HTTP or HTTPS URL using the device download manager.",parameters:{type:"OBJECT",properties:{url:{type:"STRING",description:"Direct HTTP or HTTPS file URL"},fileName:{type:"STRING",description:"Optional filename"}},required:["url"]}},
            {name:"switch_mode",description:"Switch COSMIC interface to Reactor, Chat, 3D Avatar or 2D MYRAA mode.",parameters:{type:"OBJECT",properties:{mode:{type:"STRING",enum:["reactor","chat","avatar","characters","home"]}},required:["mode"]}},
            {name:"google_search",description:"Open Google Search results for a user-requested web search.",parameters:{type:"OBJECT",properties:{query:{type:"STRING",description:"Search phrase"}},required:["query"]}},
            {name:"navigate_back",description:"Navigate back in the current COSMIC view.",parameters:{type:"OBJECT",properties:{}}},
            {name:"system_action",description:"Perform a user-requested Android navigation action. Requires COSMIC Device Controls accessibility permission.",parameters:{type:"OBJECT",properties:{action:{type:"STRING",enum:["home","back","notifications","quicksettings","recents"]}},required:["action"]}},
            {name:"set_home_relay",description:"Set a COSMIC relay by its number 1 through 8 or its exact saved custom name. Requires a connected paired HC-05 Arduino controller; turning a relay ON requires the user to confirm in the app.",parameters:{type:"OBJECT",properties:{channel:{type:"STRING",description:"Relay number 1 through 8 or exact saved relay name"},state:{type:"STRING",enum:["ON","OFF"]}},required:["channel","state"]}},
            {name:"name_home_relay",description:"Save a spoken custom name for a specific COSMIC relay channel. Only rename the explicitly identified channel.",parameters:{type:"OBJECT",properties:{channel:{type:"INTEGER",description:"Relay channel number 1 through 8"},name:{type:"STRING",description:"Short unique name for this relay"}},required:["channel","name"]}}
          ]}]
        };
        socket.send(JSON.stringify({setup:{
          model:"models/"+liveModel(),
          responseModalities:config.responseModalities,
          speechConfig:config.speechConfig,
          systemInstruction:config.systemInstruction,
          sessionResumption:config.sessionResumption,
          contextWindowCompression:config.contextWindowCompression,
          inputAudioTranscription:config.inputAudioTranscription,
          outputAudioTranscription:config.outputAudioTranscription,
          tools:config.tools
        }}));
      };
      socket.onerror = () => { clearTimeout(timeout); if(!settled){settled=true;reject(new Error("Gemini Live WebSocket connection failed."));} };
      socket.onmessage = event => {
        let message;
        try { message = JSON.parse(event.data); } catch (_) { return; }
        if (message.error) {
          const detail = message.error;
          const code = detail.code ? " HTTP " + detail.code : "";
          const messageText = detail.message || detail.status || JSON.stringify(detail);
          const error = new Error("Gemini Live API error" + code + ": " + messageText);
          clearTimeout(timeout);
          if (!settled) { settled = true; reject(error); }
          else if (state.desired) startFallback(error.message).catch(fallbackError => setStatus("GEMINI FAILED · FREE VOICE FALLBACK FAILED · " + fallbackError.message, "error"));
          try { socket.close(1011, "Gemini Live API error"); } catch (_) {}
          return;
        }
        if (message.setupComplete) {
          clearTimeout(timeout);
          settled = true;
          state.connected = true;
          state.reconnectDelay = 1200;
          state.reconnectAttempts = 0;
          setStatus("GEMINI LIVE · LISTENING", "live");
          startAudioPump();
          resolve();
        }
        if (message.sessionResumptionUpdate?.resumable && message.sessionResumptionUpdate.newHandle) {
          state.resumeHandle = message.sessionResumptionUpdate.newHandle;
        }
        if (message.toolCall?.functionCalls?.length) handleToolCalls(message.toolCall.functionCalls);
        const content = message.serverContent;
        if (content) {
          if (content.interrupted) stopPlayback();
          if (content.inputTranscription?.text) transcript(content.inputTranscription.text, "user");
          if (content.outputTranscription?.text) transcript(content.outputTranscription.text, "assistant");
          for (const part of content.modelTurn?.parts || []) {
            if (part.inlineData?.data && String(part.inlineData.mimeType || "").startsWith("audio/pcm")) {
              playPcm(part.inlineData.data);
            }
          }
        }
        if (message.goAway) setStatus("RECONNECTING LIVE SESSION…", "connecting");
      };
      socket.onclose = () => {
        clearTimeout(timeout);
        if(!settled){settled=true;reject(new Error("Gemini Live closed before session setup completed."));}
        state.connected = false;
        if (state.socket === socket) state.socket = null;
        if (state.desired && generation === state.generation) scheduleReconnect(generation);
      };
    });
  }

  function restartFallbackListening() {
    if (!state.fallbackMode || !state.desired || state.fallbackBusy) return;
    if (state.fallbackRestartTimer) clearTimeout(state.fallbackRestartTimer);
    state.fallbackRestartTimer = setTimeout(async () => {
      state.fallbackRestartTimer = 0;
      if (!state.fallbackMode || !state.desired || state.fallbackBusy) return;
      if (state.fallbackNativeRecognition) {
        try {
          await window.Capacitor?.Plugins?.CosmicVoice?.startFallbackRecognition?.({language:navigator.language || "en-IN"});
          state.connected = true;
          setStatus("FREE VOICE · GROQ / OPENROUTER · LISTENING", "live");
        } catch (error) {
          setStatus("FREE SPEECH RECOGNITION ERROR · " + (error.message || error), "error");
        }
        return;
      }
      try {
        state.fallbackRecognition?.start();
        state.connected = true;
        setStatus("FREE VOICE · GROQ / OPENROUTER · LISTENING", "live");
      } catch (_) {}
    }, 450);
  }

  async function speakFallback(text) {
    const value = String(text || "").trim();
    if (!value) return;
    if (window.speechSynthesis && typeof window.SpeechSynthesisUtterance === "function") {
      await new Promise(resolve => {
        try {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(value);
          utterance.lang = navigator.language || "en-IN";
          utterance.rate = 1.02;
          utterance.onend = resolve;
          utterance.onerror = resolve;
          window.speechSynthesis.speak(utterance);
        } catch (_) { resolve(); }
      });
      return;
    }
    const plugin = window.Capacitor?.Plugins?.CosmicVoice;
    if (typeof plugin?.speak === "function") {
      await plugin.speak({text:value});
      await new Promise(resolve => setTimeout(resolve, Math.min(18000, Math.max(1200, value.length * 58))));
    }
  }

  async function fallbackReply(text, alreadyDisplayed) {
    const value = String(text || "").trim();
    if (!value || !state.fallbackMode || state.fallbackBusy) return false;
    state.fallbackBusy = true;
    state.connected = false;
    try {
      if (state.fallbackNativeRecognition) {
        try { await window.Capacitor?.Plugins?.CosmicVoice?.stopFallbackRecognition?.(); } catch (_) {}
      } else {
        try { state.fallbackRecognition?.stop(); } catch (_) {}
      }
      if (!alreadyDisplayed) transcript(value, "user");
      setStatus("FREE AI · THINKING", "connecting");
      const response = await fetch(API() + "/api/chat", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        cache:"no-store",
        body:JSON.stringify({message:value,session_id:"cosmic-live-fallback",provider:"auto",model:"auto",mode:"auto"})
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || ("HTTP " + response.status));
      const answer = String(data.message || data.response || data.text || "").trim();
      if (!answer) throw new Error("The free AI providers returned an empty answer.");
      transcript(answer, "assistant");
      setStatus("FREE AI · SPEAKING", "connecting");
      await speakFallback(answer);
      return true;
    } catch (error) {
      setStatus("FREE VOICE FALLBACK · " + (error.message || String(error)), "error");
      transcript("I could not reach a configured free AI provider. Add a Groq or OpenRouter free API key in API Setup, then try again.", "assistant");
      return false;
    } finally {
      state.fallbackBusy = false;
      if (state.fallbackMode && state.desired) restartFallbackListening();
    }
  }

  async function startFallback(reason) {
    if (state.fallbackMode) return;
    state.fallbackMode = true;
    state.desired = true;
    state.nativeMode = false;
    state.connected = false;
    state.connecting = true;
    state.resumeHandle = "";
    setStatus("GEMINI UNAVAILABLE · STARTING FREE VOICE FALLBACK", "connecting");
    const plugin = window.Capacitor?.Plugins?.CosmicVoice;
    try {
      try {
        const wake = await plugin?.getWakeWordStatus?.();
        state.fallbackWakeEnabled = !!wake?.enabled;
        if (state.fallbackWakeEnabled) await plugin?.disableWakeWord?.();
      } catch (_) {}
      try { await plugin?.stopLive?.(); } catch (_) {}
      cleanupAudio();
      if (typeof plugin?.startFallbackRecognition === "function") {
        try {
          await plugin.startFallbackRecognition({language:navigator.language || "en-IN"});
          state.fallbackNativeRecognition = true;
          state.connecting = false;
          state.connected = true;
          setStatus("FREE VOICE · GROQ / OPENROUTER · LISTENING", "live");
          return;
        } catch (nativeError) {
          state.fallbackNativeRecognition = false;
          console.warn("COSMIC native speech recognition unavailable; trying browser recognition:", nativeError);
        }
      }
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (typeof Recognition !== "function") throw new Error("This Android WebView has no speech-recognition service. Update Google Speech Services or use a supported browser.");
      const recognition = new Recognition();
      recognition.lang = navigator.language || "en-IN";
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onstart = () => {
        if (state.fallbackMode) {
          state.connected = true;
          state.connecting = false;
          setStatus("FREE VOICE · GROQ / OPENROUTER · LISTENING", "live");
        }
      };
      recognition.onresult = event => {
        let heard = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) heard += event.results[i][0]?.transcript || "";
        }
        if (heard.trim()) fallbackReply(heard.trim(), false);
      };
      recognition.onerror = event => {
        if (!state.fallbackMode) return;
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          state.fallbackMode = false;
          state.desired = false;
          setStatus("FREE VOICE MICROPHONE PERMISSION DENIED", "error");
          return;
        }
        if (event.error !== "no-speech" && event.error !== "aborted") setStatus("FREE SPEECH INPUT · " + event.error, "paused");
      };
      recognition.onend = () => restartFallbackListening();
      state.fallbackRecognition = recognition;
      recognition.start();
      state.fallbackNativeRecognition = false;
      state.connecting = false;
    } catch (error) {
      state.fallbackMode = false;
      state.desired = false;
      state.connected = false;
      state.connecting = false;
      if (state.fallbackWakeEnabled) {
        try { await plugin?.enableWakeWord?.(); } catch (_) {}
      }
      state.fallbackWakeEnabled = false;
      throw new Error((reason ? "Gemini failed (" + reason + "). " : "") + (error.message || error));
    }
  }

  async function stopFallback() {
    state.fallbackMode = false;
    state.desired = false;
    state.connected = false;
    state.connecting = false;
    state.fallbackBusy = false;
    if (state.fallbackRestartTimer) clearTimeout(state.fallbackRestartTimer);
    state.fallbackRestartTimer = 0;
    try { await window.Capacitor?.Plugins?.CosmicVoice?.stopFallbackRecognition?.(); } catch (_) {}
    if (state.fallbackRecognition) {
      state.fallbackRecognition.onend = null;
      try { state.fallbackRecognition.stop(); } catch (_) {}
      state.fallbackRecognition = null;
    }
    try { window.speechSynthesis?.cancel(); } catch (_) {}
    if (state.fallbackWakeEnabled) {
      try { await window.Capacitor?.Plugins?.CosmicVoice?.enableWakeWord?.(); } catch (_) {}
    }
    state.fallbackWakeEnabled = false;
    state.fallbackNativeRecognition = false;
    setStatus("VOICE OFF", "idle");
  }

  async function handleToolCalls(calls) {
    const responses = [];
    for (const call of calls) {
      const args = call.args || {};
      try {
        let result;
        const plugin = window.Capacitor?.Plugins?.CosmicVoice;
        if (call.name !== "switch_mode" && window.COSMIC_BRAIN?.state?.enabled === false) throw new Error("COSMIC Brain is paused. Turn BRAIN ON to allow device actions.");
        if (call.name === "switch_mode") {
          const mode = String(args.mode || "").toLowerCase();
          if (!["reactor","chat","avatar","characters","home"].includes(mode)) throw new Error("Unsupported COSMIC mode.");
          const tab = document.querySelector('[data-mode="' + mode + '"]') || document.querySelector('[data-cosmic-mode="' + mode + '"]');
          if (!tab) throw new Error("Mode control is unavailable.");
          tab.click(); result = {success:true,mode};
        } else if (call.name === "google_search") {
          const query = String(args.query || "").trim().slice(0, 500);
          if (!query) throw new Error("Google search query is empty.");
          const url = "https://www.google.com/search?q=" + encodeURIComponent(query);
          if (typeof plugin?.openUrl === "function") await plugin.openUrl({url});
          else window.open(url, "_blank", "noopener,noreferrer");
          result = {success:true,query,url};
        } else if (call.name === "open_app") {
          const name = String(args.name || args.app_name || "").trim().slice(0,80);
          if (!name || typeof plugin?.launchApp !== "function") throw new Error("Android app launching is unavailable in this client.");
          await plugin.launchApp({name}); result = {success:true,opened:name};
        } else if (call.name === "open_url") {
          const url = new URL(String(args.url || ""));
          if (!["http:","https:"].includes(url.protocol)) throw new Error("Only HTTP and HTTPS links are allowed.");
          if (typeof plugin?.openUrl === "function") await plugin.openUrl({url:url.href});
          else window.open(url.href,"_blank","noopener");
          result = {success:true,url:url.href};
        } else if (call.name === "download_file") {
          const url = new URL(String(args.url || ""));
          if (!["http:","https:"].includes(url.protocol)) throw new Error("Only HTTP and HTTPS downloads are allowed.");
          if (!window.confirm("Allow COSMIC to download this file?\\n"+url.href)) throw new Error("Download cancelled by user.");
          if (typeof plugin?.downloadFile !== "function") throw new Error("Native downloads are unavailable in this client.");
          const fileName = String(args.fileName || args.file_name || "").slice(0,120);
          result = await plugin.downloadFile({url:url.href,fileName});
        } else if (call.name === "navigate_back") {
          if (typeof plugin?.systemAction !== "function") throw new Error("Back navigation is unavailable in this client.");
          await plugin.systemAction({action:"back"}); result = {success:true,action:"navigate_back"};
        } else if (call.name === "system_action") {
          const action=String(args.action||"").toLowerCase();
          if(!["home","back","notifications","quicksettings","recents"].includes(action))throw new Error("Unsupported Android action.");
          if(typeof plugin?.systemAction!=="function")throw new Error("Android device-control bridge is unavailable.");
          await plugin.systemAction({action});result={success:true,action};
         } else if (call.name === "set_home_relay") {
          const channel=args.channel, relayState=String(args.state||"").toUpperCase();
          if(!channel||!["ON","OFF"].includes(relayState))throw new Error("Specify a relay number or saved name, and ON or OFF.");
          if(typeof window.COSMIC_HOME_AUTOMATION_SET!=="function")throw new Error("Home Automation control module is unavailable in this client.");
          result=await window.COSMIC_HOME_AUTOMATION_SET(channel,relayState);
          result.message="Arduino controller reported "+(result.name||("relay "+result.channel))+" "+relayState+". This does not verify the physical appliance.";
        } else if (call.name === "name_home_relay") {
          if(typeof window.COSMIC_HOME_AUTOMATION_RENAME!=="function")throw new Error("Home Automation naming module is unavailable in this client.");
          result=window.COSMIC_HOME_AUTOMATION_RENAME(args.channel,args.name);
          result.message="Saved "+result.name+" as the name for relay "+result.channel+".";
        } else {
          throw new Error("Unknown COSMIC action.");
        }
        responses.push({name:call.name,id:call.id,response:{result}});
        transcript("Action completed: " + call.name, "assistant");
      } catch (error) {
        responses.push({name:call.name,id:call.id,response:{error:String(error.message || error)}});
        transcript("Action needs attention: " + String(error.message || error), "assistant");
      }
    }
    send({toolResponse:{functionResponses:responses}});
  }

  function handleNativeEvent(event) {
    const type=event?.type||"", message=event?.message||"";
    if(type==="state") {
      if(message==="LIVE · STOPPED") {
        state.desired=false;state.connected=false;state.connecting=false;state.sharing=false;
        state.nativeMode=false;state.bubbleActive=false;
        const native=window.Capacitor?.Plugins?.CosmicVoice;
        Promise.resolve(native?.getWakeWordStatus?.()).then(result=>{
          if(result?.enabled){
            localStorage.setItem("COSMIC_LIVE_AUTO","true");
            if(wakeButton){wakeButton.textContent="WAKE WORD ON";wakeButton.classList.add("is-enabled");wakeButton.setAttribute("aria-pressed","true");}
            setStatus("LOCAL WAKE WORD ACTIVE · SAY OK COSMIC","idle");
          }else{
            localStorage.setItem("COSMIC_LIVE_AUTO","false");
            setStatus("LIVE VOICE OFF","idle");
          }
        }).catch(()=>setStatus("LIVE VOICE STOPPED · CHECK WAKE WORD STATUS","idle"));
      } else if(/RECONNECTING/i.test(message)) {
        state.connected=false;state.desired=true;setStatus(message,"connecting");
      } else if(/SCREEN SHARING/i.test(message)) {
        state.sharing=true;state.desired=true;state.connected=true;state.connecting=false;setStatus(message,"live");
      } else if(/GEMINI CONNECTED|LISTENING/i.test(message)) {
        state.desired=true;state.connected=true;state.connecting=false;setStatus(message,"live");
      } else if(/SCREEN SHARE STOPPED/i.test(message)) {
        state.sharing=false;setStatus("GEMINI LIVE · LISTENING","live");
      } else setStatus(message,state.connected?"live":"connecting");
    } else if(type==="error") {
      const screenOnly=/screen share|screen capture|screen sharing/i.test(message);
      state.connecting=false;
      if(!screenOnly){state.connected=false;state.desired=false;state.nativeMode=false;}
      if(/key is missing|API key|permission denied|permission is required/i.test(message))localStorage.setItem("COSMIC_LIVE_AUTO","false");
      setStatus(message,"error");
    } else if(type==="transcript") transcript(message,"assistant");
    else if(type==="user_transcript") {
      transcript(message,"user");
      document.dispatchEvent(new CustomEvent("cosmic:live-transcript",{detail:{text:message,role:"user"}}));
    }
    else if(type==="audio_level") { const level=Number(message)||0; window.COSMIC_AVATAR_AUDIO_LEVEL?.(level); window.COSMIC_CHARACTER_AUDIO_LEVEL?.(level); document.dispatchEvent(new CustomEvent("cosmic:live-audio-level",{detail:{level}})); }
    else if(type==="audio_start") { window.COSMIC_AVATAR_TALK?.(true); window.COSMIC_CHARACTER_TALK?.(true); }
    else if(type==="audio_end"||type==="turn_complete") {
      window.COSMIC_AVATAR_TALK?.(false);
      window.COSMIC_CHARACTER_TALK?.(false);
      window.COSMIC_AVATAR_AUDIO_LEVEL?.(0);
    } else if(type==="tool_call") {
      try { const payload=JSON.parse(message); if(payload.functionCalls?.length)handleToolCalls(payload.functionCalls); }
      catch(error) { setStatus("DEVICE TOOL ERROR · "+error.message,"error"); }
    } else if(type==="bubble_permission_required") {
      state.bubbleActive=false;if(bubbleButton)bubbleButton.hidden=false;
      setStatus("ALLOW DISPLAY OVER OTHER APPS FOR THE FLOATING BUBBLE","connecting");
    } else if(type==="bubble") {
      state.bubbleActive=true;if(bubbleButton)bubbleButton.hidden=true;
      setStatus("LIVE · FLOATING BUBBLE ACTIVE","live");
    }
  }

  function bindNativeEvents() {
    const plugin=window.Capacitor?.Plugins?.CosmicVoice;
    if(!plugin?.addListener||state.nativeListener)return Promise.resolve();
    return plugin.addListener("liveEvent",handleNativeEvent)
      .then(handle=>{state.nativeListener=handle;})
      .catch(error=>console.warn("COSMIC native Live events unavailable:",error));
  }

  function startAudioPump() {
    if (!state.processor || !state.context) return;
    state.processor.onaudioprocess = event => {
      if (!state.desired || !state.connected) return;
      const input = event.inputBuffer.getChannelData(0);
      const pcm = floatToPcm16(input, state.context.sampleRate);
      if (!pcm.length) return;
      send({realtimeInput:{audio:{data:toBase64(new Uint8Array(pcm.buffer)),mimeType:"audio/pcm;rate=16000"}}});
    };
  }

  async function prepareAudio() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone capture is unavailable in this browser.");
    const nativeVoice = window.Capacitor?.Plugins?.CosmicVoice;
    if (typeof nativeVoice?.startLiveService === "function") {
      await nativeVoice.startLiveService();
      state.voiceService = true;
    }
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},
      video:false
    });
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio is not supported on this device.");
    state.context = new AudioContextClass();
    await state.context.resume();
    state.source = state.context.createMediaStreamSource(state.stream);
    state.processor = state.context.createScriptProcessor(2048,1,1);
    state.silentGain = state.context.createGain();
    state.silentGain.gain.value = 0;
    state.source.connect(state.processor);
    state.processor.connect(state.silentGain);
    state.silentGain.connect(state.context.destination);
  }

  function scheduleReconnect(generation) {
    if (state.reconnectTimer || !state.desired || generation !== state.generation) return;
    const delay = state.reconnectDelay;
    state.reconnectDelay = Math.min(30000, Math.round(state.reconnectDelay * 1.8));
    setStatus("CONNECTION LOST · RETRYING", "connecting");
    state.reconnectTimer = setTimeout(async () => {
      state.reconnectTimer = 0;
      if (!state.desired || generation !== state.generation) return;
      try { await connect(generation); }
      catch (error) {
        setStatus("RECONNECT FAILED · " + error.message, "error");
        scheduleReconnect(generation);
      }
    }, delay);
  }

  async function start(isAuto) {
    if (state.connecting || state.connected) return;
    const nativeVoice = window.Capacitor?.Plugins?.CosmicVoice;
    if (typeof nativeVoice?.startLive === "function") {
      state.nativeMode = true; state.desired = true; state.connecting = true;
      localStorage.setItem("COSMIC_LIVE_AUTO", "true");
      setStatus("STARTING ANDROID GEMINI LIVE…", "connecting");
      try {
        const started = await nativeVoice.startLive({model:liveModel(),voice:liveVoice(),persona:livePersona(),backendUrl:API()});
        state.connecting = false;
        if (started?.connected) {
          state.connected = true;
          setStatus("GEMINI LIVE · SESSION ALREADY ACTIVE", "live");
        } else {
          setStatus(started?.alreadyRunning ? "RECONNECTING TO GEMINI LIVE…" : "WAITING FOR GEMINI LIVE…", "connecting");
        }
      } catch (error) {
        state.desired = false; state.connecting = false;
        localStorage.setItem("COSMIC_LIVE_AUTO", "false");
        setStatus(error.message || "Could not start Gemini Live", "error");
      }
      return;
    }
    state.desired = true;
    localStorage.setItem("COSMIC_LIVE_AUTO", "true");
    state.connecting = true;
    const generation = ++state.generation;
    setStatus("REQUESTING MICROPHONE…", "connecting");
    try {
      if (!state.stream) await prepareAudio();
      if (!state.desired || generation !== state.generation) return;
      setStatus("CONNECTING GEMINI LIVE…", "connecting");
      await connect(generation);
    } catch (error) {
      state.desired = false;
      localStorage.setItem("COSMIC_LIVE_AUTO", "false");
      cleanupAudio();
      setStatus((isAuto ? "TAP TO START · " : "") + error.message, "error");
    } finally {
      state.connecting = false;
    }
  }

  function cleanupAudio() {
    if (state.voiceService) {
      state.voiceService = false;
      try { window.Capacitor?.Plugins?.CosmicVoice?.stopLiveService?.(); } catch (_) {}
    }
    if (state.processor) { state.processor.onaudioprocess = null; try { state.processor.disconnect(); } catch (_) {} }
    if (state.source) { try { state.source.disconnect(); } catch (_) {} }
    if (state.silentGain) { try { state.silentGain.disconnect(); } catch (_) {} }
    state.processor = state.source = state.silentGain = null;
    if (state.stream) { state.stream.getTracks().forEach(track => track.stop()); state.stream = null; }
    if (state.context) { const context = state.context; state.context = null; context.close().catch(() => {}); }
    stopPlayback();
  }

  function stop() {
    stopCamera();
    if (state.nativeMode) {
      state.desired = false; state.connected = false; state.connecting = false;
      localStorage.setItem("COSMIC_LIVE_AUTO", "false");
      stopScreenShare();
      const nativeVoice=window.Capacitor?.Plugins?.CosmicVoice;
      // Ending a conversation returns to local wake-word standby; it must not disable the assistant.
      Promise.resolve(nativeVoice?.stopLive?.()).catch(error => console.warn("COSMIC Live stop:", error));
      state.nativeMode = false; state.resumeHandle = "";
      Promise.resolve(nativeVoice?.getWakeWordStatus?.()).then(result => {
        const wakeEnabled = !!result?.enabled;
        setStatus(wakeEnabled ? "LOCAL WAKE WORD ACTIVE · SAY OK COSMIC" : "LIVE VOICE OFF · WAKE WORD DISABLED", "idle");
      }).catch(() => setStatus("LIVE VOICE STOPPED · CHECK WAKE WORD STATUS", "idle"));
      return;
    }
    state.desired = false;
    state.connected = false;
    state.connecting = false;
    state.generation++;
    localStorage.setItem("COSMIC_LIVE_AUTO", "false");
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    state.reconnectTimer = 0;
    stopScreenShare();
    if (state.socket) { const socket = state.socket; state.socket = null; try { socket.close(1000, "User stopped COSMIC Live"); } catch (_) {} }
    cleanupAudio();
    state.resumeHandle = "";
    setStatus("LIVE VOICE OFF", "idle");
  }

  async function sendText(text, alreadyDisplayed) {
    const value = String(text || "").trim();
    if (!value || !state.connected) return false;
    if (!alreadyDisplayed) transcript(value, "user");
    if (state.nativeMode) {
      try { await window.Capacitor.Plugins.CosmicVoice.sendLiveText({text:value}); return true; }
      catch (_) { return false; }
    }
    return send({realtimeInput:{text:value}});
  }

  async function startScreenShare() {
    if (!state.connected) { setStatus("START LIVE VOICE BEFORE SHARING", "paused"); return; }
    if (state.nativeMode) {
      const nativeVoice = window.Capacitor?.Plugins?.CosmicVoice;
      try {
        await nativeVoice.startScreenShare();
        state.nativeScreen = true; state.sharing = true;
        shareButton.textContent = "■";
        setStatus("ANDROID SCREEN SHARING · 1 FPS", "live");
      } catch (error) { setStatus("ANDROID SCREEN SHARE FAILED · " + (error.message || "permission denied"), "error"); }
      return;
    }
    const nativeScreen = window.Capacitor?.Plugins?.CosmicScreen;
    if (typeof nativeScreen?.startScreenShare === "function") {
      try {
        state.nativeScreenHandle = await nativeScreen.addListener("screenFrame", frame => {
          if (state.connected && state.sharing && frame?.data) send({realtimeInput:{video:{data:frame.data,mimeType:"image/jpeg"}}});
        });
        await nativeScreen.startScreenShare();
        state.nativeScreen = true; state.sharing = true;
        shareButton.textContent = "■";
        setStatus("ANDROID SCREEN SHARING · 1 FPS", "live");
        return;
      } catch (error) {
        if (state.nativeScreenHandle) { state.nativeScreenHandle.remove(); state.nativeScreenHandle = null; }
        setStatus("ANDROID SCREEN SHARE FAILED · " + (error.message || "permission denied"), "error");
        return;
      }
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setStatus("SCREEN SHARING IS NOT AVAILABLE IN THIS APP VIEW", "error");
      return;
    }
    try {
      state.screenStream = await navigator.mediaDevices.getDisplayMedia({video:{frameRate:1},audio:false});
      const video = document.createElement("video");
      video.muted = true; video.playsInline = true; video.srcObject = state.screenStream;
      await video.play();
      state.screenVideo = video;
      state.sharing = true;
      shareButton.textContent = "STOP SHARING";
      state.screenStream.getVideoTracks()[0].addEventListener("ended", stopScreenShare, {once:true});
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      state.screenTimer = setInterval(() => {
        if (!state.connected || !state.sharing || !video.videoWidth) return;
        const scale = Math.min(1, 1280 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        context.drawImage(video,0,0,canvas.width,canvas.height);
        const jpeg = canvas.toDataURL("image/jpeg",0.62).split(",")[1];
        send({realtimeInput:{video:{data:jpeg,mimeType:"image/jpeg"}}});
      },1000);
      setStatus("SCREEN SHARING · 1 FPS", "live");
    } catch (error) {
      setStatus("SCREEN SHARE CANCELLED · " + (error.message || "permission denied"), "error");
    }
  }

  function stopScreenShare() {
    if (state.nativeScreen) {
      state.nativeScreen = false;
      if (state.nativeMode) {
        try { window.Capacitor?.Plugins?.CosmicVoice?.stopScreenShare?.(); } catch (_) {}
      } else {
        const plugin = window.Capacitor?.Plugins?.CosmicScreen;
        try { plugin?.stopScreenShare?.(); } catch (_) {}
        if (state.nativeScreenHandle) { state.nativeScreenHandle.remove(); state.nativeScreenHandle = null; }
      }
    }
    if (state.screenTimer) clearInterval(state.screenTimer);
    state.screenTimer = 0;
    if (state.screenStream) state.screenStream.getTracks().forEach(track => track.stop());
    state.screenStream = null;
    if (state.screenVideo) { state.screenVideo.pause(); state.screenVideo.srcObject = null; }
    state.screenVideo = null;
    state.sharing = false;
    if (shareButton) { shareButton.textContent = "▣"; shareButton.classList.remove("is-sharing"); }
    if (state.connected) setStatus("GEMINI LIVE · LISTENING", "live");
  }

  document.addEventListener("cosmic:live-state", event => {
    const stateText = event.detail?.text;
    const target = document.getElementById("cosmicChatState");
    if (target && stateText) target.textContent = stateText;
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.desired && !state.connected && !state.connecting) {
      if (state.stream?.active) {
        state.generation++;
        const generation = state.generation;
        connect(generation).catch(() => scheduleReconnect(generation));
      }
    }
  });
  window.addEventListener("pagehide", () => {
    if (!state.desired) cleanupAudio();
  });
  const nativeEventsReady = bindNativeEvents();
  const boot = () => Promise.resolve(nativeEventsReady).finally(mount);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",boot,{once:true});
  else boot();
  window.COSMIC_LIVE = {
    start, stop, toggle:() => state.desired ? stop() : start(false),
    sendText, startScreenShare, stopScreenShare,
    async setPersona(persona){ const value=String(persona||"").trim().slice(0,1200); localStorage.setItem("COSMIC_LIVE_PERSONA",value); if(!state.desired)return true; if(state.nativeMode){ await window.Capacitor?.Plugins?.CosmicVoice?.startLive?.({model:liveModel(),voice:liveVoice(),persona:value}); return true; } state.resumeHandle=""; if(state.socket)state.socket.close(1012,"COSMIC character changed"); return true; },
    get active(){return state.connected;},
    get listening(){return state.desired;}
  };
  console.info("COSMIC Gemini Live controller loaded. Microphone remains user-controlled.");
})();
