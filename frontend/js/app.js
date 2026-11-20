(() => {
    "use strict";

    const state = {
        mode: "auto",
        provider: "auto",
        model: "auto",
        task: "chat",
        busy: false
    };

    const $ = (selector) => document.querySelector(selector);
    const $$ = (selector) => [...document.querySelectorAll(selector)];

    const input = $("#messageInput");
    const sendButton = $("#sendButton");
    const stream = $("#responseStream");

    // Account tokens are restored by the account panel after sign-in. Read the
    // token without assuming one particular storage key used by older builds.
    function findBearerToken() {
        if (typeof window.COSMIC_ACCOUNT_TOKEN === "string" && window.COSMIC_ACCOUNT_TOKEN.includes(".")) {
            return window.COSMIC_ACCOUNT_TOKEN;
        }
        const visit = (value, depth = 0) => {
            if (depth > 3 || value == null) return "";
            if (typeof value === "string") {
                if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.trim())) return value.trim();
                try { return visit(JSON.parse(value), depth + 1); } catch (_) { return ""; }
            }
            if (typeof value === "object") {
                for (const [key, item] of Object.entries(value)) {
                    if (/^(token|access_token|account_token|cosmic_token)$/i.test(key)) {
                        const found = visit(item, depth + 1);
                        if (found) return found;
                    }
                }
                for (const item of Object.values(value)) {
                    const found = visit(item, depth + 1);
                    if (found) return found;
                }
            }
            return "";
        };
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const found = visit(localStorage.getItem(localStorage.key(i)));
                if (found) return found;
            }
        } catch (_) {}
        return "";
    }

    function updateClock() {
        const clock = $("#clock");
        if (!clock) return;

        clock.textContent = new Date().toLocaleTimeString([], {
            hour12: false
        });
    }

    function addMessage(type, text) {
        if (!stream) return;

        $("#emptyCore")?.remove();

        const item = document.createElement("div");
        item.className = `stream-item ${type}`;

        const label =
            type === "user-message" ? "YOU" :
            type === "assistant-message" ? "COSMIC" :
            "SYSTEM";

        item.innerHTML = `
            <span class="stream-tag">${label}</span>
            <span class="stream-text"></span>
        `;

        item.querySelector(".stream-text").textContent = text;

        stream.appendChild(item);
        stream.scrollTop = stream.scrollHeight;
    }

    function setBusy(busy) {
        state.busy = busy;

        document.body.classList.toggle("processing", busy);

        if (sendButton) {
            sendButton.disabled = busy;
        }

        const session = $("#sessionState");
        const coreLoad = $("#coreLoad");

        if (session) {
            session.textContent = busy ? "PROCESSING" : "STANDBY";
        }

        if (coreLoad) {
            coreLoad.textContent = busy ? "ACTIVE" : "READY";
        }
    }

    function selectTask(task) {
        state.task = task;

        $$(".task").forEach(button => {
            button.classList.toggle(
                "active",
                button.dataset.task === task
            );
        });

        const activeTask = $("#commandMode");

        if (activeTask) {
            activeTask.textContent =
                `${task.toUpperCase()} • AUTO ROUTING`;
        }
    }

    function updateModelDisplay() {
        const mode = $("#modeSelector");
        const provider = $("#providerSelector");
        const model = $("#modelSelector");

        if (mode) {
            state.mode = mode.value;
        }

        if (provider) {
            state.provider = provider.value;
        }

        if (model) {
            state.model = model.value;
        }

        const topMode = $("#topMode");
        const routerState = $("#routerState");
        const selectedModel = $("#selectedModel");
        const engineStatus = $("#engineStatus");
        const activeProvider = $("#activeProvider");

        if (topMode) {
            topMode.textContent = state.mode.toUpperCase();
        }

        if (routerState) {
            routerState.textContent =
                state.mode === "auto" ? "AUTO" : "MANUAL";
        }

        if (selectedModel) {
            selectedModel.textContent =
                state.model === "auto"
                    ? "BEST AVAILABLE MODEL"
                    : state.model;
        }

        if (engineStatus) {
            engineStatus.textContent =
                state.mode === "auto"
                    ? "AUTO ROUTER"
                    : "MANUAL ROUTER";
        }

        if (activeProvider) {
            activeProvider.textContent =
                state.provider === "auto"
                    ? "Awaiting task analysis"
                    : state.provider.toUpperCase();
        }
    }

    async function executeCommand() {
        if (!input || state.busy) return;

        const text = input.value.trim();

        if (!text) return;

        addMessage("user-message", text);

        if (window.COSMIC_BRAIN?.handle && await window.COSMIC_BRAIN.handle(text)) {
            addMessage("system-message", "BRAIN: " + (window.COSMIC_BRAIN.state.lastAction || "Command processed"));
            input.value = "";
            return;
        }

        input.value = "";

        setBusy(true);

        const start = performance.now();

        try {
            const bearerToken = findBearerToken();
            const response = await fetch((window.COSMIC_API_BASE || window.location.origin) + "/api/chat", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(bearerToken ? {"Authorization": "Bearer " + bearerToken} : {})
                },
                body: JSON.stringify({
                    message: text,
                    task: state.task,
                    mode: state.mode,
                    provider: state.provider,
                    model: state.model,
                    session_id: localStorage.getItem("cosmic_session_id") || "default"
                })
            });

            const data = await response.json();

            const latency = Math.round(performance.now() - start);

            const latencyElement = $("#latency");

            if (latencyElement) {
                latencyElement.textContent = `${latency} ms`;
            }

            if (!response.ok || data.success === false) {
                throw new Error(
                    data.error ||
                    data.message ||
                    `HTTP ${response.status}`
                );
            }

            const replyText = data.message || data.response || data.text || "COSMIC returned no response.";
            addMessage("assistant-message", replyText);
            document.dispatchEvent(new CustomEvent("cosmic:reply", {detail: {text: replyText}}));

            const connection = $("#connection");

            if (connection) {
                connection.textContent = "CONNECTED";
            }

        } catch (error) {
            console.error("COSMIC API error:", error);

            addMessage(
                "system-message",
                `API ERROR: ${error.message}`
            );

            const connection = $("#connection");

            if (connection) {
                connection.textContent = "API ERROR";
            }

        } finally {
            setBusy(false);
            input.focus();
        }
    }

    // Task selection
    $$(".task").forEach(button => {
        button.addEventListener("click", () => {
            selectTask(button.dataset.task || "chat");
        });
    });

    // Model controls
    $("#modeSelector")?.addEventListener(
        "change",
        updateModelDisplay
    );

    $("#providerSelector")?.addEventListener(
        "change",
        updateModelDisplay
    );

    $("#modelSelector")?.addEventListener(
        "change",
        updateModelDisplay
    );

    // Execute
    sendButton?.addEventListener(
        "click",
        executeCommand
    );

    // Enter = execute
    input?.addEventListener("keydown", event => {
        if (
            event.key === "Enter" &&
            !event.shiftKey
        ) {
            event.preventDefault();
            executeCommand();
        }
    });

    // Native/browser voice controls are registered in voice-control.js.

    // File selection is local in this build; the text-chat API does not upload image/document bytes.
    $("#attachButton")?.addEventListener("click", () => {
        let picker = $("#cosmicAttachmentPicker");
        if (!picker) {
            picker = document.createElement("input");
            picker.id = "cosmicAttachmentPicker";
            picker.type = "file";
            picker.accept = "image/*,.pdf,.txt,.md,.doc,.docx";
            picker.hidden = true;
            document.body.append(picker);
            picker.addEventListener("change", () => {
                const file = picker.files && picker.files[0];
                if (file) addMessage("system-message", "Selected locally: " + file.name + " (" + Math.round(file.size / 1024) + " KB). File transfer/vision analysis is not enabled on the current chat endpoint.");
            });
        }
        picker.click();
    });

    // System menu
    $("#systemMenu")?.addEventListener("click", () => {
        addMessage(
            "system-message",
            "COSMIC SYSTEM MENU — CORE ONLINE."
        );
    });

    // Navigation: desktop rail and Android bottom bar share one action map.
    function showReactorSection(view) {
        const targets = {
            command: [".core-stage", "COMMAND CORE"],
            models: [".right-panel .hud-panel:nth-of-type(2)", "MODEL CONTROL"],
            memory: [".response-stream", "MEMORY"],
            research: [".task[data-task='research']", "RESEARCH"],
            tools: [".task[data-task='coding']", "TOOLS"],
            devices: [".cosmic-brain-panel", "DEVICES"],
            settings: ["#cosmicBackendDialog", "CONFIGURATION"]
        };
        const entry = targets[view] || targets.command;
        const target = document.querySelector(entry[0]);
        if (view === "settings") {
            document.querySelector("#systemMenu")?.click();
            return;
        }
        if (view === "research" || view === "tools") {
            document.querySelector(entry[0])?.click();
            input?.focus();
        } else if (view === "memory") {
            const stream = document.querySelector("#responseStream");
            if (stream) {
                const note = document.createElement("div");
                note.className = "stream-item system-message";
                note.textContent = "MEMORY CENTER: Loading saved memory records…";
                stream.append(note);
                stream.scrollTop = stream.scrollHeight;
            }
            Promise.all([
                fetch((window.COSMIC_API_BASE || window.location.origin) + "/api/memory/count"),
                fetch((window.COSMIC_API_BASE || window.location.origin) + "/api/memories")
            ]).then(async ([countResponse, listResponse]) => {
                if (!countResponse.ok || !listResponse.ok) throw new Error("Memory API unavailable");
                const count = await countResponse.json(), list = await listResponse.json();
                const note = document.querySelector("#responseStream .system-message:last-child");
                if (note) note.textContent = "MEMORY CENTER: " + (count.count ?? count.total ?? "Records") + " saved records. " + ((list.memories || list.items || []).length) + " records returned.";
            }).catch(error => {
                const note = document.querySelector("#responseStream .system-message:last-child");
                if (note) note.textContent = "MEMORY CENTER: " + error.message;
            });
        } else if (target) {
            target.scrollIntoView({behavior:"smooth",block:"center"});
            target.focus?.({preventScroll:true});
        } else {
            addMessage("system-message", entry[1] + " is not available in this build.");
        }
        $(".rail-item,.mobile-nav-item").forEach(item => item.classList.toggle("active", item.dataset.view === view));
    }
    $(".rail-item,.mobile-nav-item").forEach(button => {
        button.addEventListener("click", () => showReactorSection(button.dataset.view || "command"));
    });

    // Initial state
    selectTask("chat");
    updateModelDisplay();
    updateClock();

    setInterval(updateClock, 1000);

    // COSMIC account registration and sign-in panel.
    (function installAccountPanel() {
        if (document.getElementById("cosmicAccountPanel")) return;
        const style = document.createElement("style");
        style.textContent = `
          #cosmicAccountLauncher{position:fixed;right:16px;bottom:88px;z-index:9998;border:1px solid #6487a8;background:#10263b;color:#fff;border-radius:24px;padding:10px 15px;font:600 13px system-ui;box-shadow:0 6px 24px #0006}
          #cosmicAccountPanel{position:fixed;right:12px;bottom:132px;z-index:9999;width:min(340px,calc(100vw - 24px));padding:18px;border:1px solid #52718c;border-radius:16px;background:#101e2d;color:#edf6ff;box-shadow:0 12px 40px #0009;font:14px system-ui;display:none}
          #cosmicAccountPanel input{box-sizing:border-box;width:100%;margin:7px 0;padding:12px;border:1px solid #526b82;border-radius:9px;background:#071522;color:#fff;font:14px system-ui}
          #cosmicAccountPanel button{border:0;border-radius:9px;padding:10px 12px;margin:5px 4px 0 0;background:#24618b;color:white;font-weight:600}
          #cosmicAccountPanel button.secondary{background:#34485a}#cosmicAccountStatus{font-size:12px;line-height:1.4;margin:10px 0;color:#bcd4e8}
        `;
        document.head.append(style);
        const launcher=document.createElement("button");
        launcher.id="cosmicAccountLauncher";launcher.type="button";launcher.textContent="👤 COSMIC Account";
        const panel=document.createElement("section");
        panel.id="cosmicAccountPanel";
        panel.innerHTML=`
          <div style="display:flex;justify-content:space-between;align-items:center"><strong style="font-size:16px">COSMIC Account</strong><button class="secondary" id="cosmicAccountClose" type="button">✕</button></div>
          <div id="cosmicAccountStatus">Create an account once, then sign in on other devices to restore access.</div>
          <label for="cosmicAccountEmail">Email address</label><input id="cosmicAccountEmail" type="email" autocomplete="email" placeholder="you@example.com">
          <label for="cosmicAccountPassword">Password (10–256 characters)</label><input id="cosmicAccountPassword" type="password" autocomplete="current-password" minlength="10" placeholder="At least 10 characters">
          <label for="cosmicAccountName">Display name (registration only)</label><input id="cosmicAccountName" type="text" autocomplete="name" placeholder="Your name">
          <div><button id="cosmicAccountRegister" type="button">Create account</button><button id="cosmicAccountLogin" type="button">Sign in</button><button id="cosmicAccountLogout" class="secondary" type="button">Sign out</button></div>`;
        document.body.append(launcher,panel);
        const $id=id=>document.getElementById(id);
        const status=$id("cosmicAccountStatus");
        const base=()=>String(window.COSMIC_API_BASE||window.location.origin).replace(/\/+$/,"");
        const token=()=>window.COSMIC_ACCOUNT_TOKEN||localStorage.getItem("COSMIC_ACCOUNT_TOKEN")||"";
        const show=()=>{panel.style.display="block";launcher.style.display="none";};
        const hide=()=>{panel.style.display="none";launcher.style.display="block";};
        const refresh=async()=>{
          const t=token();
          if(!t){status.textContent="Not signed in. Create an account or sign in.";launcher.textContent="👤 Sign in / Register";return;}
          window.COSMIC_ACCOUNT_TOKEN=t;
          try{const r=await fetch(base()+"/api/account/me",{headers:{Authorization:"Bearer "+t},cache:"no-store"});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||"Session expired");status.textContent="Signed in as "+d.account.email+". Chat is authorized.";launcher.textContent="👤 "+d.account.email; }
          catch(e){status.textContent="Sign in required: "+e.message;launcher.textContent="👤 Sign in / Register";}
        };
        async function submit(mode){
          const email=$id("cosmicAccountEmail").value.trim();
          const password=$id("cosmicAccountPassword").value;
          const display_name=$id("cosmicAccountName").value.trim();
          if(!email||password.length<10){status.textContent="Enter a valid email and a password of at least 10 characters.";return;}
          status.textContent=mode==="register"?"Creating your account…":"Signing in…";
          try{
            const r=await fetch(base()+"/api/account/"+(mode==="register"?"register":"login"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,display_name})});
            const d=await r.json();
            if(!r.ok||!d.success)throw new Error(d.error||("HTTP "+r.status));
            if(!d.token)throw new Error("Server did not return an account token.");
            localStorage.setItem("COSMIC_ACCOUNT_TOKEN",d.token);
            localStorage.setItem("COSMIC_ACCOUNT_EMAIL",d.account?.email||email);
            window.COSMIC_ACCOUNT_TOKEN=d.token;
            status.textContent=(mode==="register"?"Account created. ":"Signed in. ")+(d.account?.email||email)+". You can now chat with COSMIC.";
            launcher.textContent="👤 "+(d.account?.email||email);
          }catch(e){status.textContent="Account error: "+e.message;}
        }
        launcher.addEventListener("click",show);
        $id("cosmicAccountClose").addEventListener("click",hide);
        $id("cosmicAccountRegister").addEventListener("click",()=>submit("register"));
        $id("cosmicAccountLogin").addEventListener("click",()=>submit("login"));
        $id("cosmicAccountLogout").addEventListener("click",()=>{localStorage.removeItem("COSMIC_ACCOUNT_TOKEN");localStorage.removeItem("COSMIC_ACCOUNT_EMAIL");window.COSMIC_ACCOUNT_TOKEN="";status.textContent="Signed out.";launcher.textContent="👤 Sign in / Register";});
        refresh();
    })();

    window.COSMIC = {
        state,
        executeCommand
    };

    console.log("COSMIC interface initialized.");
})();
