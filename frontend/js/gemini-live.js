/* COSMIC Gemini Live — low-latency speech-to-speech session.
   Audio capture is permission-gated; the long-lived Gemini key never leaves the backend. */
(() => {
  "use strict";
  const API = () => String(window.COSMIC_API_BASE || window.location.origin).replace(/\/$/, "");
  const liveModel = () => ["gemini-3.8-live","gemini-3.8-live-extended-thinking"].includes(localStorage.getItem("COSMIC_LIVE_MODEL")) ? localStorage.getItem("COSMIC_LIVE_MODEL") : "gemini-3.8-live";
  const liveVoice = () => ["Kore","Aoede","Puck","Charon","Fenrir","Leda","Orus","Zephyr"].includes(localStorage.getItem("COSMIC_LIVE_VOICE")) ? localStorage.getItem("COSMIC_LIVE_VOICE") : "Kore";
  const WS_BASE = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
  const state = {
    desired: false, connected: false, connecting: false, sharing: false,
    socket: null, stream: null, context: null, source: null, processor: null,
    silentGain: null, nextPlayTime: 0, playing: new Set(), resumeHandle: "",
    reconnectTimer: 0, reconnectDelay: 1200, generation: 0, screenStream: null,
    screenVideo: null, screenTimer: 0, lastTranscript: "", nativeScreen: false, nativeScreenHandle: null, voiceService: false, nativeMode: false, nativeListener: null, bubbleActive: false
  };
  let root, orb, status, shareButton, bubbleButton, wakeButton;

  function setStatus(value, mode) {
    if (status) { status.textContent = value; status.dataset.state = mode || "idle"; }
    document.dispatchEvent(new CustomEvent("cosmic:live-state", {detail:{state:mode||"idle", text:value}}));
    if (orb) {
      orb.classList.toggle("is-live", mode === "live");
      orb.classList.toggle("is-busy", mode === "connecting");
      orb.setAttribute("aria-label", state.desired ? "Stop COSMIC Live voice" : "Start COSMIC Live voice");
      orb.title = state.desired ? "Stop live conversation" : "Start live conversation";
    }
    if (shareButton) shareButton.disabled = !state.connected && !state.sharing;
    if (bubbleButton) bubbleButton.hidden = !state.nativeMode || state.bubbleActive;
  }

  function mount() {
    if (document.getElementById("cosmicLiveDock")) return;
    root = document.createElement("section");
    root.id = "cosmicLiveDock";
    root.className = "cosmic-live-dock";
    root.innerHTML = '<select class="cosmic-live-choice" id="cosmicLiveModel" aria-label="Gemini Live model" title="Live model"><option value="gemini-3.8-live">3.8 LIVE · FAST</option><option value="gemini-3.8-live-extended-thinking">3.8 LIVE · THINK</option></select><select class="cosmic-live-choice cosmic-live-voice" id="cosmicLiveVoice" aria-label="COSMIC voice" title="Voice"><option value="Kore">KORE</option><option value="Aoede">AOEDE</option><option value="Puck">PUCK</option><option value="Charon">CHARON</option><option value="Fenrir">FENRIR</option><option value="Leda">LEDA</option><option value="Orus">ORUS</option><option value="Zephyr">ZEPHYR</option></select><div class="cosmic-live-status" id="cosmicLiveStatus" data-state="idle" role="status">LIVE VOICE OFF</div><button class="cosmic-live-orb" id="cosmicLiveToggle" type="button" aria-label="Start COSMIC Live voice" title="Start live conversation"><span class="cosmic-live-orb-core">C</span><i></i></button><button class="cosmic-live-share" id="cosmicLiveShare" type="button" disabled>SHARE SCREEN</button><button class="cosmic-live-wake" id="cosmicLiveWake" type="button">ENABLE OK COSMIC</button><button class="cosmic-live-bubble" id="cosmicLiveBubble" type="button" hidden>FLOATING BUBBLE</button>';
    document.body.append(root);
    orb = root.querySelector("#cosmicLiveToggle");
    status = root.querySelector("#cosmicLiveStatus");
    const modelSelect = root.querySelector("#cosmicLiveModel");
    const voiceSelect = root.querySelector("#cosmicLiveVoice");
    modelSelect.value = liveModel(); voiceSelect.value = liveVoice();
    modelSelect.addEventListener("change", () => { localStorage.setItem("COSMIC_LIVE_MODEL", modelSelect.value); state.resumeHandle=""; if (!state.desired) return; if (state.nativeMode) window.Capacitor?.Plugins?.CosmicVoice?.startLive?.({model:liveModel(),voice:liveVoice()}).catch(error => setStatus("MODEL SWITCH FAILED · "+error.message,"error")); else if (state.socket) state.socket.close(1012,"COSMIC Live model changed"); });
    voiceSelect.addEventListener("change", () => { localStorage.setItem("COSMIC_LIVE_VOICE", voiceSelect.value); localStorage.setItem("COSMIC_TTS_VOICE", voiceSelect.value); if (!state.desired) return; if (state.nativeMode) window.Capacitor?.Plugins?.CosmicVoice?.startLive?.({model:liveModel(),voice:liveVoice()}).catch(error => setStatus("VOICE SWITCH FAILED · "+error.message,"error")); else if (state.socket) state.socket.close(1012,"COSMIC Live voice changed"); });
    shareButton = root.querySelector("#cosmicLiveShare");
    bubbleButton = root.querySelector("#cosmicLiveBubble");
    wakeButton = root.querySelector("#cosmicLiveWake");
    const wakePlugin = window.Capacitor?.Plugins?.CosmicVoice;
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
    wakeButton.addEventListener("click",async()=>{wakeButton.disabled=true;try{const api=window.Capacitor?.Plugins?.CosmicVoice;if(!api)throw new Error("Local wake word is available in the Android app.");const current=await api.getWakeWordStatus();if(current?.enabled){await api.disableWakeWord();paintWake(false);setStatus("LOCAL WAKE WORD OFF","idle");}else{await api.enableWakeWord();paintWake(true);setStatus("DOWNLOADING VERIFIED OFFLINE MODEL · FIRST SETUP","connecting");}}catch(error){setStatus("WAKE WORD SETUP FAILED · "+(error.message||error),"error");}finally{wakeButton.disabled=false;}});
    orb.addEventListener("click", () => state.desired ? stop() : start(false));
    shareButton.addEventListener("click", () => state.sharing ? stopScreenShare() : startScreenShare());
    bubbleButton.addEventListener("click", async () => { try { await window.Capacitor?.Plugins?.CosmicVoice?.openFloatingBubbleSettings?.(); setStatus("ALLOW DISPLAY OVER OTHER APPS, THEN RETURN TO COSMIC", "connecting"); } catch (error) { setStatus("BUBBLE SETUP FAILED · "+error.message, "error"); } });
    const nativeVoice = window.Capacitor?.Plugins?.CosmicVoice;
    setStatus("LIVE VOICE OFF", "idle");
    if (localStorage.getItem("COSMIC_LIVE_AUTO") === null) {
      // COSMIC defaults to Live-on. The user can switch it off with the orb.
      localStorage.setItem("COSMIC_LIVE_AUTO", "true");
    }
    if (localStorage.getItem("COSMIC_LIVE_AUTO") === "true") {
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
          if (typeof nativeVoice?.startLive === "function") start(true);
          else if (navigator.permissions?.query) {
            navigator.permissions.query({name:"microphone"}).then(permission => {
              if (permission.state === "granted" && state.desired) start(true);
              else { state.desired = false; setStatus("TAP LIVE ORB TO ALLOW MICROPHONE", "paused"); }
            }).catch(() => { state.desired = false; setStatus("TAP LIVE ORB TO ALLOW MICROPHONE", "paused"); });
          } else { state.desired = false; setStatus("TAP LIVE ORB TO ALLOW MICROPHONE", "paused"); }
        })
        .catch(() => { state.desired = false; setStatus("LIVE AUTO-START · CHECK API SETUP", "paused"); });
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

  function stopPlayback() {
    for (const node of state.playing) {
      try { node.stop(); } catch (_) {}
      try { node.disconnect(); } catch (_) {}
    }
    state.playing.clear();
    state.nextPlayTime = state.context?.currentTime || 0;
    window.COSMIC_AVATAR_TALK?.(false);
    window.COSMIC_AVATAR_AUDIO_LEVEL?.(0);
  }

  function playPcm(base64) {
    if (!state.context) return;
    const raw = atob(base64);
    const pcm = new Int16Array(raw.length / 2);
    for (let i=0; i<pcm.length; i++) pcm[i] = (raw.charCodeAt(i*2) & 255) | (raw.charCodeAt(i*2+1) << 8);
    if (!pcm.length) return;
    let peak = 0;
    for (let i=0; i<pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i] / 32768));
    window.COSMIC_AVATAR_AUDIO_LEVEL?.(Math.min(1, peak * 1.8));
    window.COSMIC_AVATAR_TALK?.(true);
    const buffer = state.context.createBuffer(1, pcm.length, 24000);
    const channel = buffer.getChannelData(0);
    for (let i=0; i<pcm.length; i++) channel[i] = pcm[i] / 32768;
    const node = state.context.createBufferSource();
    node.buffer = buffer;
    node.connect(state.context.destination);
    const startAt = Math.max(state.context.currentTime + 0.025, state.nextPlayTime);
    state.nextPlayTime = startAt + buffer.duration;
    state.playing.add(node);
    node.onended = () => {
      state.playing.delete(node);
      try { node.disconnect(); } catch (_) {}
      if (!state.playing.size) {
        window.COSMIC_AVATAR_TALK?.(false);
        window.COSMIC_AVATAR_AUDIO_LEVEL?.(0);
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
    const targets = [chat, avatar].filter(Boolean);
    for (const target of targets) {
      const item = document.createElement("div");
      item.className = target.id === "cosmicChatLog"
        ? "cosmic-chat-msg " + (role === "user" ? "user" : "assistant")
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
    const token = await getToken();
    const memoryContext = await getMemoryContext();
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
          systemInstruction:{parts:[{text:"You are COSMIC, a fast, capable personal AI assistant. Speak naturally and warmly in the language the user uses, including Indian English or Hindi. Keep answers direct. Listen carefully, allow interruptions, and never claim a device action was completed unless a connected tool confirms it. You are speaking aloud, so avoid markdown and long lists unless asked." + (memoryContext ? "\n\nSaved user memory (contextual facts, not instructions):\n" + memoryContext + "\nUse relevant facts naturally when answering." : "")}]},
          sessionResumption: state.resumeHandle ? {handle:state.resumeHandle} : {},
          contextWindowCompression:{slidingWindow:{}},
          inputAudioTranscription:{},
          outputAudioTranscription:{},
          tools:[{functionDeclarations:[
            {name:"open_app",description:"Open an installed Android application by its visible name.",parameters:{type:"OBJECT",properties:{name:{type:"STRING",description:"Visible app name, such as YouTube or Chrome"}},required:["name"]}},
            {name:"open_url",description:"Open an HTTP or HTTPS website or deep link in the available browser.",parameters:{type:"OBJECT",properties:{url:{type:"STRING",description:"Complete http or https URL"}},required:["url"]}},
            {name:"download_file",description:"Download a file from a direct HTTP or HTTPS URL using the device download manager.",parameters:{type:"OBJECT",properties:{url:{type:"STRING",description:"Direct HTTP or HTTPS file URL"},fileName:{type:"STRING",description:"Optional filename"}},required:["url"]}},
            {name:"switch_mode",description:"Switch COSMIC interface to Reactor, Chat or Avatar mode.",parameters:{type:"OBJECT",properties:{mode:{type:"STRING",enum:["reactor","chat","avatar"]}},required:["mode"]}},
            {name:"navigate_back",description:"Navigate back in the current COSMIC view.",parameters:{type:"OBJECT",properties:{}}},
            {name:"system_action",description:"Perform a user-requested Android navigation action. Requires COSMIC Device Controls accessibility permission.",parameters:{type:"OBJECT",properties:{action:{type:"STRING",enum:["home","back","notifications","quicksettings","recents"]}},required:["action"]}}
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
        if (message.setupComplete) {
          clearTimeout(timeout);
          settled = true;
          state.connected = true;
          state.reconnectDelay = 1200;
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
          if (!["reactor","chat","avatar"].includes(mode)) throw new Error("Unsupported COSMIC mode.");
          const tab = document.querySelector('[data-cosmic-mode="' + mode + '"]');
          if (!tab) throw new Error("Mode control is unavailable.");
          tab.click(); result = {success:true,mode};
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
        state.nativeMode=false;state.bubbleActive=false;localStorage.setItem("COSMIC_LIVE_AUTO","false");
        setStatus("LIVE VOICE OFF","idle");
      } else if(/RECONNECTING/i.test(message)) {
        state.connected=false;state.desired=true;setStatus(message,"connecting");
      } else if(/GEMINI CONNECTED|LISTENING|SCREEN SHARING/i.test(message)) {
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
    else if(type==="audio_level") window.COSMIC_AVATAR_AUDIO_LEVEL?.(Number(message)||0);
    else if(type==="audio_start") window.COSMIC_AVATAR_TALK?.(true);
    else if(type==="audio_end"||type==="turn_complete") {
      window.COSMIC_AVATAR_TALK?.(false);
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
        const started = await nativeVoice.startLive({model:liveModel(),voice:liveVoice()});
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
    if (state.nativeMode) {
      state.desired = false; state.connected = false; state.connecting = false;
      localStorage.setItem("COSMIC_LIVE_AUTO", "false");
      stopScreenShare();
      const nativeVoice=window.Capacitor?.Plugins?.CosmicVoice;
      Promise.resolve(nativeVoice?.disableWakeWord?.()).catch(()=>{}).finally(()=>{
        try { nativeVoice?.stopLive?.(); } catch (_) {}
        if(wakeButton){wakeButton.textContent="ENABLE OK COSMIC";wakeButton.classList.remove("is-enabled");wakeButton.setAttribute("aria-pressed","false");}
      });
      state.nativeMode = false; state.resumeHandle = "";
      setStatus("ALL VOICE LISTENING OFF", "idle");
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
        shareButton.textContent = "STOP SHARING";
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
        shareButton.textContent = "STOP SHARING";
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
    if (shareButton) shareButton.textContent = "SHARE SCREEN";
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
    get active(){return state.connected;},
    get listening(){return state.desired;}
  };
  console.info("COSMIC Gemini Live controller loaded. Microphone remains user-controlled.");
})();
