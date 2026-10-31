/* COSMIC Brain: permission-aware command dispatcher.
   Android controls are delegated only to explicitly registered native plugin methods. */
(() => {
  "use strict";
  const native = () => window.Capacitor?.Plugins?.CosmicVoice;
  const state = { enabled: true, lastAction: "Ready", busy: false };
  const status = (message) => {
    state.lastAction = message;
    const el = document.getElementById("brainStatus");
    if (el) el.textContent = message;
  };
  const parse = (raw) => {
    const text = String(raw || "").trim();
    let m = text.match(/^(?:cosmic[, ]*)?(?:please )?download (https?:\/\/\S+)(?:\s+as\s+(.+))?[.!]?$/i);
    if (m) return {type:"download", url:m[1].replace(/[.!?]+$/,""), fileName:(m[2]||"").trim()};
    m = text.match(/^(?:cosmic[, ]*)?(?:please )?(?:open|visit) (https?:\/\/\S+)[.!]?$/i);
    if (m) return {type:"url", url:m[1].replace(/[.!?]+$/,"")};
    m = text.match(/^(?:cosmic[, ]*)?(?:please )?(?:open|launch|start) (?:the )?(.+?)(?: app)?[.!]?$/i);
    if (m) return {type:"launch", name:m[1].replace(/\s+app$/i,"").trim()};
    if (/^(?:cosmic[, ]*)?(?:go )?back[.!]?$/i.test(text)) return {type:"back"};
    if (/^(?:cosmic[, ]*)?(?:open|show) (?:phone )?settings[.!]?$/i.test(text)) return {type:"launch",name:"settings"};
    return null;
  };
  async function handle(raw) {
    if (!state.enabled) return false;
    const intent = parse(raw);
    if (!intent) return false;
    const plugin = native();
    if (!plugin) { status("Native control unavailable in this build"); return true; }
    if (state.busy) { status("Brain is already executing an action"); return true; }
    state.busy = true;
    try {
      if (intent.type === "launch") {
        if (typeof plugin.launchApp !== "function") throw new Error("App-launch permission bridge unavailable");
        await plugin.launchApp({name:intent.name});
        status("Opened " + intent.name);
      } else if (intent.type === "url") {
        if (typeof plugin.openUrl !== "function") throw new Error("Browser bridge unavailable in this APK");
        await plugin.openUrl({url:intent.url});
        status("Opened link in Android: " + intent.url);
      } else if (intent.type === "download") {
        if (typeof plugin.downloadFile !== "function") throw new Error("Download bridge unavailable in this APK");
        const result = await plugin.downloadFile({url:intent.url,fileName:intent.fileName});
        status("Download started: " + (result.fileName || intent.url));
      } else if (intent.type === "back") {
        if (typeof plugin.systemAction !== "function") throw new Error("Navigation bridge unavailable");
        await plugin.systemAction({action:"back"});
        status("Back action completed");
      }
    } catch (error) {
      status(error?.message || "Action failed");
      document.dispatchEvent(new CustomEvent("cosmic:brain-error",{detail:{message:state.lastAction}}));
    } finally { state.busy = false; }
    return true;
  }
  async function handleTool(name,args) {
    const plugin=native();
    if(!plugin)throw new Error("Android action bridge is unavailable.");
    args=args&&typeof args==="object"?args:{};
    if(name==="open_app"){
      const app=String(args.app_name||"").trim().slice(0,100);
      if(!app)throw new Error("App name is missing.");
      await plugin.launchApp({name:app});status("Opened "+app);return {success:true,action:"open_app",app};
    }
    if(name==="open_url"){
      const raw=String(args.url||"").trim();const url=new URL(raw);
      if(!["http:","https:"].includes(url.protocol))throw new Error("Only HTTP and HTTPS links can be opened.");
      await plugin.openUrl({url:url.href});status("Opened "+url.hostname);return {success:true,action:"open_url",url:url.href};
    }
    if(name==="download_file"){
      const raw=String(args.url||"").trim();const url=new URL(raw);
      if(!["http:","https:"].includes(url.protocol))throw new Error("Only HTTP and HTTPS files can be downloaded.");
      const fileName=String(args.file_name||"").slice(0,120);
      const result=await plugin.downloadFile({url:url.href,fileName});
      status("Download started: "+(result.fileName||url.hostname));return {success:true,action:"download_file",fileName:result.fileName};
    }
    if(name==="navigate_back"){
      await plugin.systemAction({action:"back"});status("Navigated back");return {success:true,action:"navigate_back"};
    }
    throw new Error("COSMIC has no approved device tool named "+name+".");
  }

  function mount() {
    if (document.getElementById("cosmicBrainPanel")) return;
    const panel = document.createElement("section");
    panel.id = "cosmicBrainPanel";
    panel.className = "cosmic-brain-panel";
    panel.innerHTML = '<div class="brain-head"><div><small>PERSONAL DEVICE CONTROLLER</small><h2>◈ COSMIC BRAIN</h2></div><label class="brain-toggle"><input id="brainEnabled" type="checkbox" checked><span>ENABLED</span></label></div><p>Voice and text commands for Android actions. Each action uses the permissions Android grants to COSMIC.</p><div class="brain-actions"><button type="button" data-brain-action="accessibility">ACCESSIBILITY PERMISSION</button><button type="button" data-brain-action="app-settings">APP PERMISSIONS</button></div><div class="brain-status"><span>LAST ACTION</span><strong id="brainStatus">Ready</strong></div><small class="brain-note">Open installed apps, open web links and download direct HTTP/HTTPS files are supported. Screen-wide control, notification access, calls and messages need additional Android services and your explicit approval.</small>';
    const stage = document.querySelector(".core-stage");
    const command = document.querySelector(".command-zone");
    if (stage && command) stage.insertBefore(panel, command);
    panel.querySelector("#brainEnabled").addEventListener("change", e => {
      state.enabled = e.target.checked;
      status(state.enabled ? "Brain enabled" : "Brain paused");
    });
    panel.querySelectorAll("[data-brain-action]").forEach(btn => btn.addEventListener("click", () => {
      const p = native();
      const method = btn.dataset.brainAction === "accessibility" ? "openAccessibilitySettings" : "openAppSettings";
      if (typeof p?.[method] !== "function") {
        status("This permission screen requires a newer native APK build");
        return;
      }
      p[method]().catch(e => status(e.message || "Could not open Android settings"));
    }));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",mount,{once:true}); else mount();
  window.COSMIC_BRAIN = {handle, handleTool, state, parse};
  document.addEventListener("cosmic:brain-error",e => console.warn("COSMIC Brain:",e.detail?.message));
})();
