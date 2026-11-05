/* COSMIC MYRAA 2D runtime avatar.
 * Vector layers are animated from real playback-level events; the audio engine remains provider-neutral.
 * Current Gemini Live integration supplies PCM envelope events. Phoneme/viseme events can be added
 * later through cosmic:avatar-viseme without changing the renderer.
 */
const SVG = `
<svg class="myraa-vector" viewBox="0 0 480 560" role="img" aria-label="Animated 2D MYRAA avatar" xmlns="http://www.w3.org/2000/svg">
 <defs>
  <linearGradient id="myraa-skin" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f8d8c7"/><stop offset="1" stop-color="#d99f91"/></linearGradient>
  <linearGradient id="myraa-hair" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#18283e"/><stop offset="1" stop-color="#070d19"/></linearGradient>
  <radialGradient id="myraa-aura"><stop stop-color="#4ed9ef" stop-opacity=".25"/><stop offset="1" stop-color="#4ed9ef" stop-opacity="0"/></radialGradient>
 </defs>
 <ellipse cx="240" cy="520" rx="155" ry="24" fill="#42cce8" opacity=".13"/>
 <path d="M111 244 Q78 73 240 56 Q402 73 369 244 L382 468 Q240 532 98 468Z" fill="url(#myraa-hair)"/>
 <path d="M128 223 Q126 113 240 101 Q354 113 352 223 L337 385 Q326 465 240 477 Q154 465 143 385Z" fill="url(#myraa-skin)" stroke="#eab8a9" stroke-width="3"/>
 <path d="M126 235 Q94 122 164 82 Q239 23 319 75 Q386 116 354 244 Q330 193 304 163 Q235 199 148 171Z" fill="url(#myraa-hair)"/>
 <path d="M132 209 Q100 277 120 395 Q133 461 181 479 Q139 413 151 321Z" fill="#111e32"/>
 <path d="M348 209 Q380 277 360 395 Q347 461 299 479 Q341 413 329 321Z" fill="#111e32"/>
 <path d="M153 256 Q183 228 215 251" fill="none" stroke="#553b3c" stroke-width="9" stroke-linecap="round"/>
 <path d="M265 251 Q297 228 327 256" fill="none" stroke="#553b3c" stroke-width="9" stroke-linecap="round"/>
 <g class="myraa-eye left"><ellipse cx="185" cy="278" rx="25" ry="15" fill="#fff8f1"/><ellipse cx="190" cy="279" rx="10" ry="13" fill="#456f82"/><ellipse cx="193" cy="279" rx="5" ry="9" fill="#101b2a"/><circle cx="196" cy="273" r="3.5" fill="white"/><path class="myraa-lid" d="M158 278 Q185 248 212 278 Q185 296 158 278Z" fill="#e6b6a6"/></g>
 <g class="myraa-eye right"><ellipse cx="295" cy="278" rx="25" ry="15" fill="#fff8f1"/><ellipse cx="290" cy="279" rx="10" ry="13" fill="#456f82"/><ellipse cx="287" cy="279" rx="5" ry="9" fill="#101b2a"/><circle cx="284" cy="273" r="3.5" fill="white"/><path class="myraa-lid" d="M268 278 Q295 248 322 278 Q295 296 268 278Z" fill="#e6b6a6"/></g>
 <path d="M240 286 Q229 318 242 322" fill="none" stroke="#bd8279" stroke-width="4" stroke-linecap="round"/>
 <path class="myraa-mouth-shape" d="M211 361 Q240 369 269 361 Q240 385 211 361Z" fill="#762d43" stroke="#a95667" stroke-width="2"/>
 <path d="M220 365 Q240 372 260 365" fill="none" stroke="#fff0e9" stroke-width="3" stroke-linecap="round"/>
 <path d="M165 335 Q185 346 204 337 M276 337 Q295 346 315 335" fill="none" stroke="#d58c88" stroke-width="5" stroke-linecap="round" opacity=".5"/>
 <path d="M188 411 Q240 433 292 411" fill="none" stroke="#bd8279" stroke-width="3" opacity=".5"/>
 <path d="M166 484 Q240 460 314 484 L365 560 H115Z" fill="#14263e" stroke="#345a79" stroke-width="4"/>
 <path d="M215 486 L240 526 L265 486" fill="none" stroke="#53d6e7" stroke-width="4" opacity=".8"/>
 <circle cx="240" cy="523" r="7" fill="#73f1ff"/>
</svg>`;
let blinkTimer = 0, root = null, level = 0, viseme = "rest";
function scheduleBlink() {
 clearTimeout(blinkTimer);
 if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
 blinkTimer = window.setTimeout(() => {
  root?.classList.add("is-blinking");
  window.setTimeout(() => root?.classList.remove("is-blinking"), 135);
  scheduleBlink();
 }, 2200 + Math.random() * 3100);
}
function setMouth(next, shape) {
 if (!root) return;
 level = Math.max(0, Math.min(1, Number(next) || 0));
 if (shape) viseme = String(shape).toLowerCase();
 root.style.setProperty("--myraa-jaw", String(level));
 root.style.setProperty("--myraa-mouth-scale", String(.22 + level * 1.5));
 root.dataset.viseme = viseme;
 root.classList.toggle("is-speaking", level > .055);
}
window.COSMIC_MYRAA_SET_LEVEL = (value, shape) => setMouth(value, shape);
export function mountMyraaAvatar(host) {
 if (!host) return null;
 root = host.querySelector(".myraa-avatar-runtime");
 if (!root) {
  root = document.createElement("div");
  root.className = "myraa-avatar-runtime";
  root.innerHTML = SVG;
  host.append(root);
 }
 scheduleBlink();
 const onLevel = event => setMouth(event.detail?.level || 0);
 const onViseme = event => setMouth(event.detail?.level ?? .45, event.detail?.viseme || "rest");
 const onLiveState = event => {
  root?.classList.toggle("is-listening", event.detail?.state === "live");
  if (["idle","paused","error"].includes(event.detail?.state)) setMouth(0, "rest");
 };
 document.addEventListener("cosmic:live-audio-level", onLevel);
 document.addEventListener("cosmic:avatar-viseme", onViseme);
 document.addEventListener("cosmic:live-state", onLiveState);
 const cleanup = () => {
  document.removeEventListener("cosmic:live-audio-level", onLevel);
  document.removeEventListener("cosmic:avatar-viseme", onViseme);
  document.removeEventListener("cosmic:live-state", onLiveState);
  clearTimeout(blinkTimer);
 };
 return {setMouth, cleanup};
}
