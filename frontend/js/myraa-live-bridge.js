(() => {
"use strict";
if (window.COSMIC_MYRAA_LIVE_BRIDGE) return;
const root = document.documentElement;
let mouthAnimations = [];
let lastExpression = "neutral";
function expressionFrom(text) {
  const s = String(text || "").toLowerCase();
  if (/\b(love|great|excellent|wonderful|happy|glad|congratulations|awesome|yes!)\b/.test(s)) return "happy";
  if (/\b(sorry|unfortunately|sad|worried|concerned|problem|danger)\b/.test(s)) return "concerned";
  if (/[?]|(what|why|how|which|wonder|curious)/.test(s)) return "curious";
  if (/\b(think|consider|analy[sz]e|perhaps|maybe|let me)\b/.test(s)) return "thinking";
  return "neutral";
}
function invokeAvatar(methods, ...args) {
  const targets = [window.MYRAA, window.myraa, window.myraaAvatar, window.myraaController, window.avatarController, window.avatar];
  for (const target of targets) {
    if (!target) continue;
    for (const method of methods) {
      try { if (typeof target[method] === "function") { target[method](...args); return true; } } catch (_) {}
    }
  }
  return false;
}
function setExpression(value) {
  lastExpression = value || "neutral";
  invokeAvatar(["setExpression","setEmotion","setMood","changeExpression"], lastExpression);
  root.dataset.cosmicMyraaExpression = lastExpression;
  root.classList.remove("cosmic-myraa-happy","cosmic-myraa-concerned","cosmic-myraa-curious","cosmic-myraa-thinking","cosmic-myraa-neutral");
  root.classList.add("cosmic-myraa-" + lastExpression);
  window.dispatchEvent(new CustomEvent("cosmic:myraa-expression", { detail: { expression: lastExpression } }));
}
function mouthNodes() {
  return Array.from(document.querySelectorAll(
    '[id*="mouth" i],[class*="mouth" i],[data-part*="mouth" i],[id*="lip" i],[class*="lip" i],[data-part*="lip" i],[id*="jaw" i],[class*="jaw" i]'
  )).filter(el => el instanceof HTMLElement && el.getClientRects().length);
}
function animateMouth(level) {
  const amount = Math.max(0, Math.min(1, Number(level) || 0));
  for (const a of mouthAnimations) { try { a.cancel(); } catch (_) {} }
  mouthAnimations = [];
  const nodes = mouthNodes();
  for (const el of nodes) {
    if (!el.animate) continue;
    const scale = 0.85 + amount * 0.65;
    try {
      const a = el.animate(
        [{ transform: "scaleY(0.92)" }, { transform: "scaleY(" + scale.toFixed(2) + ")" }, { transform: "scaleY(0.92)" }],
        { duration: 90, easing: "ease-in-out", composite: "add" }
      );
      mouthAnimations.push(a);
    } catch (_) {}
  }
  root.dataset.cosmicMyraaMouth = amount.toFixed(3);
  invokeAvatar(["setMouthOpen","setMouthOpenness","setVoiceLevel","setAudioLevel","updateLipSync"], amount);
  invokeAvatar(["setSpeaking"], amount > 0.035);
  window.dispatchEvent(new CustomEvent("cosmic:myraa-mouth", { detail: { level: amount, nodes: nodes.length } }));
}
function receive(event) {
  if (!event || event.origin !== location.origin || event.source !== parent) return;
  const data = event.data;
  if (!data || data.namespace !== "COSMIC_MYRAA_LIVE") return;
  const detail = data.detail || {};
  window.dispatchEvent(new CustomEvent(data.event || "cosmic:myraa-live", { detail }));
  if (data.event === "cosmic:live-audio-level") {
    root.dataset.cosmicMyraaState = "speaking";
    animateMouth(detail.level);
  } else if (data.event === "cosmic:live-output" || data.event === "cosmic:live-text") {
    setExpression(expressionFrom(detail.text));
  } else if (data.event === "cosmic:live-input") {
    root.dataset.cosmicMyraaState = "listening";
    invokeAvatar(["setListening"], true);
    invokeAvatar(["setSpeaking"], false);
    setExpression("curious");
  } else if (data.event === "cosmic:live-interrupted" || data.event === "cosmic:live-ended" || data.event === "cosmic:live-playback-ended") {
    root.dataset.cosmicMyraaState = "idle";
    invokeAvatar(["setListening"], false);
    invokeAvatar(["setSpeaking"], false);
    animateMouth(0);
    setExpression("neutral");
  } else if (data.event === "cosmic:live-state") {
    root.dataset.cosmicMyraaState = detail.state || "idle";
    invokeAvatar(["setState","setStatus"], detail.state || "idle");
  }
}
window.addEventListener("message", receive);
function frameInput(activity, emotion="idle", analyser=null) {
  window.dispatchEvent(new CustomEvent("cosmic:myraa-frame-input", {
    detail: { activity, emotion, outputAnalyser: analyser || null }
  }));
}
function avatarEmotion(value) {
  return ({ neutral:"idle", concerned:"sad", happy:"happy", curious:"curious", thinking:"thinking" })[value] || "idle";
}
window.addEventListener("cosmic:live-audio-level", event => {
  const detail = event.detail || {};
  root.dataset.cosmicMyraaState = "speaking";
  frameInput("talking", avatarEmotion(lastExpression), detail.outputAnalyser);
  animateMouth(detail.level);
});
window.addEventListener("cosmic:live-output", event => {
  setExpression(expressionFrom(event.detail?.text));
  frameInput("talking", avatarEmotion(lastExpression), null);
});
window.addEventListener("cosmic:live-text", event => {
  setExpression(expressionFrom(event.detail?.text));
  frameInput("talking", avatarEmotion(lastExpression), null);
});
window.addEventListener("cosmic:live-input", () => {
  root.dataset.cosmicMyraaState = "listening";
  frameInput("listening", "curious", null);
});
window.addEventListener("cosmic:live-ready", () => frameInput("listening", "idle", null));
window.addEventListener("cosmic:live-playback-ended", () => {
  root.dataset.cosmicMyraaState = "listening";
  frameInput("listening", "idle", null);
  animateMouth(0);
});
window.addEventListener("cosmic:live-interrupted", () => {
  root.dataset.cosmicMyraaState = "listening";
  frameInput("listening", "idle", null);
  animateMouth(0);
});
window.addEventListener("cosmic:live-ended", () => {
  root.dataset.cosmicMyraaState = "idle";
  frameInput("idle", "idle", null);
  animateMouth(0);
});
window.addEventListener("cosmic:live-state", event => {
  const state = event.detail?.state || "idle";
  frameInput(state === "connected" ? "listening" : "idle", "idle", null);
});
window.COSMIC_MYRAA_LIVE_BRIDGE = Object.freeze({
  version: "1.0.0",
  setExpression,
  animateMouth,
  get expression() { return lastExpression; }
});
})();