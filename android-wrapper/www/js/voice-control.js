(() => {
"use strict";
const button = document.querySelector("#voiceButton");
const input = document.querySelector("#messageInput");
const api = () => window.Capacitor?.Plugins?.CosmicVoice;
let listening = false;

function status(text) {
  const el = document.querySelector("#sessionState");
  if (el) el.textContent = text;
}
async function voiceCommand(raw) {
  const text = String(raw || "").trim();
  if (!text) return;
  if (input) input.value = text;
  const lower = text.toLowerCase();
  const native = api();

  const match = lower.match(/^(?:please )?(?:open|launch|start) (?:the )?(.+?)(?: app)?$/);
  if (match && native?.launchApp) {
    try {
      await native.launchApp({name: match[1].replace(/ app$/, "").trim()});
      status("APP LAUNCHED");
    } catch (e) {
      status("APP NOT FOUND");
      if (native.speak) native.speak({text: e.message || "App not found"}).catch(()=>{});
    }
    return;
  }

  if (/^(go )?back$/.test(lower) && native?.systemAction) {
    try { await native.systemAction({action:"back"}); } catch (_) {}
    return;
  }
  if (window.COSMIC?.executeCommand) window.COSMIC.executeCommand();
}
if (button) button.addEventListener("click", async event => {
  event.preventDefault();
  if (listening) return;
  const native = api();
  if (!native?.listen) {
    status("VOICE PLUGIN UNAVAILABLE");
    alert("Native voice is not available in this build. Rebuild and reinstall the APK.");
    return;
  }
  listening = true;
  button.disabled = true;
  status("LISTENING");
  try {
    const result = await native.listen();
    if (result?.text) await voiceCommand(result.text);
    else status("NO SPEECH");
  } catch (e) {
    status("VOICE ERROR");
    alert(e?.message || "Speech recognition failed. Check microphone permission.");
  } finally {
    listening = false;
    button.disabled = false;
    if (document.querySelector("#sessionState")?.textContent === "LISTENING")
      status("STANDBY");
  }
});

document.addEventListener("cosmic:reply", event => {
  const text = event.detail?.text;
  if (text && api()?.speak) api().speak({text}).catch(()=>{});
});
console.log("COSMIC native voice bridge loaded");
})();