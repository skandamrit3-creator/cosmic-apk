(() => {
  "use strict";
  if (window.COSMIC_MYRAA_INTEGRATION) return;

  function install() {
    if (document.getElementById("cosmicMyraaOpenButton")) return;

    const button = document.createElement("button");
    button.id = "cosmicMyraaOpenButton";
    button.type = "button";
    button.textContent = "Open MYRAA";
    button.setAttribute("aria-haspopup", "dialog");
    button.style.cssText = [
      "position:fixed", "left:18px", "bottom:20px", "z-index:99980",
      "padding:13px 18px", "border:1px solid #ffffff40", "border-radius:999px",
      "background:linear-gradient(135deg,#7259e8,#3e73bd)", "color:#fff",
      "font:700 14px system-ui", "box-shadow:0 5px 22px #0006", "cursor:pointer"
    ].join(";");

    const overlay = document.createElement("div");
    overlay.id = "cosmicMyraaOverlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "MYRAA assistant");
    overlay.hidden = true;
    overlay.style.cssText = [
      "position:fixed", "inset:0", "z-index:100000", "display:none",
      "background:#080b16", "padding:0", "margin:0"
    ].join(";");

    const bar = document.createElement("div");
    bar.style.cssText = "height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;background:#11182a;color:#fff;font:600 14px system-ui;box-sizing:border-box";
    const label = document.createElement("span");
    label.textContent = "COSMIC · MYRAA";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.setAttribute("aria-label", "Close MYRAA");
    close.style.cssText = "border:0;border-radius:18px;padding:9px 16px;background:#5748a8;color:#fff;font:600 13px system-ui";
    bar.append(label, close);

    const frame = document.createElement("iframe");
    frame.title = "MYRAA";
    frame.src = "/myraa";
    frame.allow = "microphone; camera; autoplay; clipboard-read; clipboard-write";
    frame.referrerPolicy = "same-origin";
    frame.style.cssText = "display:block;width:100%;height:calc(100% - 52px);border:0;background:#080b16";

    overlay.append(bar, frame);
    document.body.append(button, overlay);

    function open() {
      overlay.hidden = false;
      overlay.style.display = "block";
      document.documentElement.style.overflow = "hidden";
      close.focus();
    }
    function shut() {
      overlay.hidden = true;
      overlay.style.display = "none";
      document.documentElement.style.overflow = "";
      button.focus();
    }
    button.addEventListener("click", open);
    close.addEventListener("click", shut);
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !overlay.hidden) shut();
    });
    overlay.addEventListener("click", event => {
      if (event.target === overlay) shut();
    });
    window.COSMIC_MYRAA_INTEGRATION = { open, close: shut, frame };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();