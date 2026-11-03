/* COSMIC 3.1 interaction polish — additive, dependency-free, keeps existing controllers. */
(() => {
  "use strict";
  if (window.__COSMIC_EXPERIENCE__) return;
  window.__COSMIC_EXPERIENCE__ = true;

  const $ = (selector, root=document) => root.querySelector(selector);
  const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
  const resize = el => {
    if (!el || el.dataset.cosmicAutosize === "1") return;
    el.dataset.cosmicAutosize = "1";
    const fit = () => {
      el.style.height = "auto";
      const max = Number.parseInt(getComputedStyle(el).maxHeight, 10) || 220;
      el.style.height = Math.min(el.scrollHeight, max) + "px";
      el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
    };
    el.addEventListener("input", fit, {passive:true});
    requestAnimationFrame(fit);
  };

  function mountChatWelcome() {
    const log = $("#cosmicChatLog");
    if (!log || log.dataset.cosmicWelcome === "1") return;
    const first = log.firstElementChild;
    if (first && !/COSMIC CHAT/i.test(first.textContent || "")) return;
    log.dataset.cosmicWelcome = "1";
    log.replaceChildren();
    const welcome = document.createElement("section");
    welcome.className = "cosmic-welcome";
    welcome.innerHTML = [
      '<div class="cosmic-welcome-kicker"><span></span> YOUR PERSONAL INTELLIGENCE SPACE</div>',
      '<h1>What are we <em>building</em> today?</h1>',
      '<p>Ask a question, explore an idea, write code or give COSMIC a task.</p>',
      '<div class="cosmic-prompt-grid">',
      '<button type="button" class="cosmic-prompt" data-prompt="Explain a difficult concept with a simple analogy and a worked example."><span>✳</span><b>LEARN SOMETHING</b><small>Clear explanations, step by step</small></button>',
      '<button type="button" class="cosmic-prompt" data-prompt="Help me plan and build a software project. Start by identifying the architecture and first milestone."><span>⌘</span><b>BUILD A PROJECT</b><small>Architecture, code and debugging</small></button>',
      '<button type="button" class="cosmic-prompt" data-prompt="Research this topic carefully. Separate verified facts, uncertainty and useful sources."><span>⌕</span><b>RESEARCH A TOPIC</b><small>Evidence, context and sources</small></button>',
      '<button type="button" class="cosmic-prompt" data-prompt="Help me brainstorm five original approaches to this challenge, then compare their trade-offs."><span>◇</span><b>EXPLORE IDEAS</b><small>Creative options with trade-offs</small></button>',
      '</div>'
    ].join("");
    log.append(welcome);
    const input = $("#cosmicChatInput");
    if (input) resize(input);
  }

  document.addEventListener("click", event => {
    const prompt = event.target.closest(".cosmic-prompt");
    if (prompt) {
      const input = $("#cosmicChatInput");
      if (!input) return;
      input.value = prompt.dataset.prompt || "";
      input.focus();
      input.dispatchEvent(new Event("input", {bubbles:true}));
    }
    const tab = event.target.closest("[data-cosmic-mode]");
    if (tab) {
      $$(".mode-tab").forEach(item => item.setAttribute("aria-pressed", String(item === tab)));
    }
  });

  document.addEventListener("input", event => {
    if (event.target.matches("#messageInput,#cosmicChatInput,#avatarConversationInput")) resize(event.target);
  }, true);

  document.addEventListener("keydown", event => {
    const key = event.key.toLowerCase();
    const mod = event.ctrlKey || event.metaKey;
    if (mod && key === "k") {
      event.preventDefault();
      const mode = document.body.dataset.cosmicMode || "reactor";
      const target = mode === "chat" ? $("#cosmicChatInput") : mode === "avatar" ? $("#avatarConversationInput") : $("#messageInput");
      target?.focus();
      return;
    }
    if (mod && event.key === "Enter") {
      const mode = document.body.dataset.cosmicMode || "reactor";
      if (mode === "chat") {
        event.preventDefault();
        $("#cosmicChatForm")?.requestSubmit();
      } else if (mode === "reactor") {
        event.preventDefault();
        $("#sendButton")?.click();
      } else if (mode === "avatar") {
        event.preventDefault();
        const send = $("#avatarConversationSend");
        send?.click();
      }
      return;
    }
    if (event.altKey && ["1","2","3"].includes(event.key)) {
      const mode = ({1:"reactor",2:"chat",3:"avatar"})[event.key];
      const tab = $('[data-cosmic-mode="' + mode + '"]');
      if (tab) { event.preventDefault(); tab.click(); }
    }
    if (event.key === "Escape") {
      const quick = $("#cosmicQuickPanel");
      if (quick && !quick.hidden) quick.hidden = true;
      const history = $("#cosmicHistoryPanel");
      if (history && !history.hidden) {
        history.hidden = true;
        $("#cosmicHistoryToggle")?.setAttribute("aria-expanded","false");
      }
    }
  });

  const observer = new MutationObserver(() => {
    mountChatWelcome();
    $$("#cosmicChatInput,#messageInput,#avatarConversationInput").forEach(resize);
  });
  observer.observe(document.documentElement, {childList:true,subtree:true});
  document.addEventListener("DOMContentLoaded", () => {
    mountChatWelcome();
    $$("#cosmicChatInput,#messageInput,#avatarConversationInput").forEach(resize);
    $$(".mode-tab").forEach((tab,i) => tab.setAttribute("aria-pressed",String(tab.classList.contains("active"))));
  }, {once:true});

  console.info("COSMIC 3.1 experience layer ready · keyboard shortcuts: Ctrl/⌘+K, Ctrl/⌘+Enter, Alt+1/2/3");
})();
