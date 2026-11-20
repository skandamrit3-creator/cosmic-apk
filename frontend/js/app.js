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
                if (/^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$/.test(value.trim())) return value.trim();
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
            const response = await fetch((window.COSMIC_API_BASE || window.location.origin) + "/api/chat", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(findBearerToken() ? {"Authorization": "Bearer " + findBearerToken()} : {})
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

            addMessage(
                "assistant-message",
                data.message ||
                data.response ||
                data.text ||
                "COSMIC returned no response."
            );

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

    window.COSMIC = {
        state,
        executeCommand
    };

    console.log("COSMIC interface initialized.");
})();
