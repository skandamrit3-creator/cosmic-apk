(() => {
  "use strict";
  if (window.MYRAA_LIVE_TRANSPORT) return;

  const state = {
    ws: null, emit: null, intentional: false, fallback: false,
    recognition: null, resumeHandle: "", reconnectTimer: null,
    fallbackAudioUrl: null, systemInstruction: "", tools: null
  };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const emit = data => {
    try { state.emit?.("geminiMessage", data); } catch (error) { console.error("MYRAA event delivery failed", error); }
  };

  function config() {
    let value = {};
    try { value = JSON.parse(localStorage.getItem("cosmic_config") || "{}"); } catch {}
    try {
      if (window.parent && window.parent !== window && window.parent.COSMIC_CONFIG) {
        value = { ...value, ...window.parent.COSMIC_CONFIG };
      }
    } catch {}
    value.apiBase = String(value.apiBase || location.origin || "").replace(/\/+$/, "").replace(/\/api$/i, "");
    value.apiKey = String(value.apiKey || window.COSMIC_ACCOUNT_TOKEN || "");
    return value;
  }

  async function api(path, body) {
    const cfg = config();
    if (!cfg.apiBase || cfg.apiBase === "null" || !cfg.apiKey) {
      throw new Error("Sign in to COSMIC first and configure its API URL. MYRAA cannot request a secure Live token without your account session.");
    }
    const response = await fetch(cfg.apiBase + "/api/" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + cfg.apiKey },
      body: JSON.stringify(body || {})
    });
    const type = response.headers.get("content-type") || "";
    if (!response.ok) {
      let detail = "HTTP " + response.status;
      if (type.includes("application/json")) {
        try { const data = await response.json(); detail = data.error || detail; } catch {}
      }
      throw new Error(detail);
    }
    return response;
  }

  async function mintToken() {
    const response = await api("assistant/live-token", {
      system_instruction: state.systemInstruction,
      tools: Array.isArray(state.tools) ? state.tools : [],
      session_resumption_handle: state.resumeHandle || undefined
    });
    const data = await response.json();
    if (!data.success || !data.token || !data.setup) {
      throw new Error(data.error || "Gemini did not issue a Live session token.");
    }
    return data;
  }

  function stopRecognition() {
    const recognition = state.recognition;
    state.recognition = null;
    if (recognition) {
      recognition.onend = null;
      try { recognition.stop(); } catch {}
    }
  }

  async function fallbackReply(text, userAlreadyEmitted) {
    const prompt = String(text || "").trim();
    if (!prompt) return { ok: false, error: "No speech was recognized." };
    if (!userAlreadyEmitted) emit({ type: "transcription", role: "user", text: prompt });
    try {
      const response = await api("assistant/command", { text: prompt });
      const data = await response.json();
      const answer = String(data.response || data.spoken_response || "").trim();
      if (!data.success || !answer) throw new Error(data.error || "The alternate assistant provider returned no response.");
      emit({ type: "transcription", role: "model", text: answer });
      emit({ type: "turnComplete" });

      try {
        const tts = await api("assistant/tts", { text: answer });
        const blob = await tts.blob();
        const url = URL.createObjectURL(blob);
        state.fallbackAudioUrl = url;
        emit({ type: "fallbackAudio", url });
      } catch (ttsError) {
        emit({ type: "status", status: "fallback_text_only", message: String(ttsError.message || ttsError) });
      }
      return { ok: true, text: answer, mode: "fallback" };
    } catch (error) {
      emit({ type: "error", error: "Fallback assistant failed: " + String(error.message || error) });
      return { ok: false, error: String(error.message || error) };
    }
  }

  function startRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      emit({ type: "error", error: "Gemini Live is unavailable and this browser does not provide fallback speech recognition." });
      return false;
    }
    stopRecognition();
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = localStorage.getItem("COSMIC_VOICE_LANGUAGE") || localStorage.getItem("MYRAA_VOICE_LANGUAGE") || "en-IN";
    recognition.onresult = event => {
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalText += event.results[i][0].transcript + " ";
      }
      finalText = finalText.trim();
      if (finalText) fallbackReply(finalText, false);
    };
    recognition.onerror = event => {
      if (event.error !== "no-speech" && event.error !== "aborted") {
        emit({ type: "status", status: "fallback_text_only", message: "Fallback microphone: " + event.error });
      }
    };
    recognition.onend = () => {
      if (state.fallback && !state.intentional && state.recognition === recognition) {
        state.reconnectTimer = setTimeout(() => {
          if (state.fallback && !state.intentional) {
            try { recognition.start(); } catch {}
          }
        }, 450);
      }
    };
    state.recognition = recognition;
    try {
      recognition.start();
      return true;
    } catch (error) {
      state.recognition = null;
      emit({ type: "error", error: "Could not start fallback microphone: " + String(error.message || error) });
      return false;
    }
  }

  function activateFallback(reason) {
    if (state.intentional || state.fallback) return;
    state.fallback = true;
    state.ws = null;
    emit({ type: "status", status: "fallback", message: "Gemini Live unavailable. Using alternate speech recognition and neural voice when configured." });
    console.warn("MYRAA switched to fallback voice pipeline:", reason);
    startRecognition();
  }

  function handleServerMessage(message, resolveSetup) {
    const serverContent = message.serverContent || {};
    if (message.sessionResumptionUpdate?.newHandle) {
      state.resumeHandle = message.sessionResumptionUpdate.newHandle;
    }
    if (message.setupComplete) {
      state.fallback = false;
      stopRecognition();
      emit({ type: "status", status: "connected" });
      resolveSetup();
    }
    if (serverContent.interrupted) emit({ type: "interrupted" });
    if (serverContent.inputTranscription?.text) {
      emit({ type: "transcription", role: "user", text: serverContent.inputTranscription.text });
    }
    if (serverContent.outputTranscription?.text) {
      emit({ type: "transcription", role: "model", text: serverContent.outputTranscription.text });
    }
    const parts = serverContent.modelTurn?.parts || [];
    for (const part of parts) {
      if (part.inlineData?.data && String(part.inlineData.mimeType || "").includes("audio")) {
        emit({ type: "audio", audio: part.inlineData.data });
      }
      if (part.text) emit({ type: "transcription", role: "model", text: part.text });
    }
    if (serverContent.turnComplete) emit({ type: "turnComplete" });
    if (message.toolCall?.functionCalls) {
      for (const call of message.toolCall.functionCalls) {
        emit({ type: "toolCall", name: call.name, args: call.args || {}, callId: call.id });
      }
    }
    if (message.error) {
      const detail = message.error.message || message.error.status || "Gemini Live returned an error.";
      emit({ type: "error", error: String(detail) });
      try { state.ws?.close(); } catch {}
    }
    if (message.goAway) {
      emit({ type: "status", status: "reconnecting" });
      try { state.ws?.close(); } catch {}
    }
  }

  function openSocket(data, attempt) {
    return new Promise((resolve, reject) => {
      const url = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=" + encodeURIComponent(data.token);
      const ws = new WebSocket(url);
      state.ws = ws;
      let settled = false;
      let setupTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { ws.close(); } catch {}
          reject(new Error("Gemini Live did not complete session setup before the timeout."));
        }
      }, 12000);

      ws.onopen = () => {
        if (state.intentional) { try { ws.close(); } catch {} return; }
        ws.send(JSON.stringify({ setup: data.setup }));
      };
      ws.onmessage = event => {
        let message;
        try { message = JSON.parse(event.data); }
        catch { emit({ type: "error", error: "Gemini Live sent an unreadable WebSocket message." }); return; }
        const wasReady = !!message.setupComplete;
        handleServerMessage(message, () => {
          if (!settled) {
            settled = true;
            clearTimeout(setupTimer);
            resolve(true);
          }
        });
        if (wasReady) clearTimeout(setupTimer);
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(setupTimer);
          reject(new Error("Gemini Live WebSocket connection failed."));
        }
      };
      ws.onclose = event => {
        clearTimeout(setupTimer);
        if (state.ws === ws) state.ws = null;
        if (!settled) {
          settled = true;
          reject(new Error("Gemini Live closed before setup completed (code " + event.code + (event.reason ? ", " + event.reason : "") + ")."));
          return;
        }
        if (state.intentional || state.fallback) return;
        if (attempt < 2) {
          emit({ type: "status", status: "reconnecting" });
          state.reconnectTimer = setTimeout(() => connect(attempt + 1).catch(error => activateFallback(error)), 900 * (attempt + 1));
        } else {
          activateFallback("Live session closed (code " + event.code + ").");
        }
      };
    });
  }

  async function connect(attempt) {
    if (state.intentional) throw new Error("Connection cancelled.");
    try {
      const data = await mintToken();
      if (state.intentional) throw new Error("Connection cancelled.");
      return await openSocket(data, attempt);
    } catch (error) {
      if (state.intentional || attempt >= 2) throw error;
      emit({ type: "status", status: "reconnecting" });
      await wait(900 * (attempt + 1));
      return connect(attempt + 1);
    }
  }

  async function start({ systemInstruction, tools, emit: eventEmitter } = {}) {
    state.emit = eventEmitter;
    state.intentional = false;
    state.fallback = false;
    state.resumeHandle = "";
    state.systemInstruction = String(systemInstruction || "You are MYRAA, a natural and helpful voice assistant.");
    state.tools = Array.isArray(tools) ? tools : [];
    try {
      await connect(0);
      return { ok: true, mode: "gemini-live" };
    } catch (error) {
      if (state.intentional) throw error;
      const cfg = config();
      if (!cfg.apiKey) throw error;
      activateFallback(error);
      if (!state.recognition) throw error;
      return { ok: true, mode: "fallback", reason: String(error.message || error) };
    }
  }

  async function sendText({ text, emit: eventEmitter } = {}) {
    if (eventEmitter) state.emit = eventEmitter;
    const prompt = String(text || "").trim();
    if (!prompt) return { ok: false, error: "Type a message first." };
    if (state.ws && state.ws.readyState === WebSocket.OPEN && !state.fallback) {
      emit({ type: "transcription", role: "user", text: prompt });
      state.ws.send(JSON.stringify({
        clientContent: { turns: [{ role: "user", parts: [{ text: prompt }] }], turnComplete: true }
      }));
      return { ok: true, mode: "gemini-live" };
    }
    return fallbackReply(prompt, false);
  }

  function sendAudio({ base64 } = {}) {
    if (state.fallback) return { ok: true, skipped: true };
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return { ok: false, error: "Gemini Live session is not connected." };
    state.ws.send(JSON.stringify({
      realtimeInput: { audio: { data: String(base64 || ""), mimeType: "audio/pcm;rate=16000" } }
    }));
    return { ok: true };
  }

  function sendVideo({ base64 } = {}) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return { ok: false, error: "Gemini Live session is not connected." };
    state.ws.send(JSON.stringify({
      realtimeInput: { video: { data: String(base64 || ""), mimeType: "image/jpeg" } }
    }));
    return { ok: true };
  }

  function sendToolResponse({ id, name, output } = {}) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return { ok: false, error: "Gemini Live session is not connected." };
    state.ws.send(JSON.stringify({
      toolResponse: { functionResponses: [{ id, name, response: { output } }] }
    }));
    return { ok: true };
  }

  function stop() {
    state.intentional = true;
    state.fallback = false;
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
    stopRecognition();
    try { state.ws?.close(1000, "User stopped MYRAA Live"); } catch {}
    state.ws = null;
    emit({ type: "status", status: "disconnected" });
    return { ok: true };
  }

  window.MYRAA_LIVE_TRANSPORT = {
    start, stop, sendText, sendAudio, sendVideo, sendToolResponse,
    isFallback: () => state.fallback,
    getState: () => state.fallback ? "fallback" : (state.ws?.readyState === WebSocket.OPEN ? "connected" : "disconnected")
  };
})();
