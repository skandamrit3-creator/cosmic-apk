import os
import json
from pathlib import Path
import requests

COSMIC_SYSTEM = """You are COSMIC, the user's personal AI system.
Your name is COSMIC. Be practical, technically capable, concise, and honest.
Never claim to control devices or files unless an actual connected tool provides that capability.
"""

# These are candidate IDs; providers can change availability and free quotas.
CATALOG = {
    "gemini": [
        ("gemini-3.8-flash", "Gemini 3.8 Flash · Recommended"),
        ("gemini-3.6-flash", "Gemini 3.6 Flash · Fast"),
        ("gemini-3.5-flash-lite", "Gemini 3.5 Flash Lite · Fast / low cost"),
        ("gemini-3.5-flash", "Gemini 3.5 Flash"),
        ("gemini-3.1-flash-lite", "Gemini 3.1 Flash Lite · Fast"),
        ("gemini-3-flash-preview", "Gemini 3 Flash · Preview"),
        ("gemini-3.1-pro-preview", "Gemini 3.1 Pro · Reasoning"),
        ("gemini-4-argon", "Gemini 4 Argon · Advanced reasoning"),
        ("gemini-2.5-flash", "Gemini 2.5 Flash · Legacy access"),
        ("gemini-2.5-flash-lite", "Gemini 2.5 Flash Lite · Legacy access"),
        ("gemini-2.5-pro", "Gemini 2.5 Pro · Legacy access"),
    ],
    "openai": [
        ("gpt-4.1-mini", "GPT-4.1 mini · Fast"),
        ("gpt-4.1", "GPT-4.1 · Advanced"),
    ],
    "groq": [
        ("openai/gpt-oss-120b", "GPT OSS 120B"),
        ("openai/gpt-oss-20b", "GPT OSS 20B - Fast"),
    ],
    "mistral": [
        ("mistral-small-latest", "Mistral Small"),
        ("open-mistral-nemo", "Mistral Nemo"),
    ],
    "openrouter": [
        ("openrouter/auto", "OpenRouter Auto"),
        ("meta-llama/llama-3.3-70b-instruct:free", "Llama 3.3 70B Free (if available)"),
        ("deepseek/deepseek-r1:free", "DeepSeek R1 Free (if available)"),
    ],
}

CONFIG = {
    "gemini": {
        "key": "GEMINI_API_KEY",
        "kind": "gemini",
        "default": "gemini-3.8-flash",
    },
    "openai": {
        "key": "OPENAI_API_KEY",
        "url": "https://api.openai.com/v1/chat/completions",
        "default": "gpt-4.1-mini",
    },
    "groq": {
        "key": "GROQ_API_KEY",
        "url": "https://api.groq.com/openai/v1/chat/completions",
        "default": "openai/gpt-oss-20b",
    },
    "mistral": {
        "key": "MISTRAL_API_KEY",
        "url": "https://api.mistral.ai/v1/chat/completions",
        "default": "mistral-small-latest",
    },
    "openrouter": {
        "key": "OPENROUTER_API_KEY",
        "url": "https://openrouter.ai/api/v1/chat/completions",
        "default": "openrouter/auto",
    },
}


AUTO_ORDER = ("gemini", "openai", "groq", "mistral", "openrouter")


def _provider_key_file():
    configured = os.getenv("COSMIC_SECRETS_FILE", "").strip()
    if configured:
        return Path(configured)
    return Path.home() / ".cosmic-ai" / "provider-keys.json"


def load_saved_provider_keys():
    """Load user-entered provider keys from app-private runtime storage."""
    path = _provider_key_file()
    try:
        saved = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(saved, dict):
            for provider, cfg in CONFIG.items():
                value = saved.get(provider)
                if isinstance(value, str) and value.strip():
                    if not os.getenv(cfg["key"], "").strip():
                        os.environ[cfg["key"]] = value.strip()
    except (OSError, ValueError, TypeError):
        pass


def save_provider_keys(keys=None, clear=None):
    """Persist provider keys without ever returning their values to the client."""
    keys = keys if isinstance(keys, dict) else {}
    clear = set(clear or [])
    allowed = set(CONFIG)
    unknown = (set(keys) | clear) - allowed
    if unknown:
        raise ValueError("Unknown providers: " + ", ".join(sorted(unknown)))

    path = _provider_key_file()
    saved = {}
    try:
        existing = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(existing, dict):
            saved.update({k: v for k, v in existing.items()
                          if k in allowed and isinstance(v, str)})
    except (OSError, ValueError, TypeError):
        pass

    for provider in clear:
        saved.pop(provider, None)
        os.environ.pop(CONFIG[provider]["key"], None)

    for provider, value in keys.items():
        if not isinstance(value, str):
            raise ValueError("API keys must be text.")
        value = value.strip()
        if len(value) > 512:
            raise ValueError("API key is too long.")
        if value:
            saved[provider] = value
            os.environ[CONFIG[provider]["key"]] = value

    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(saved), encoding="utf-8")
    try:
        temporary.chmod(0o600)
    except OSError:
        pass
    temporary.replace(path)
    try:
        path.chmod(0o600)
    except OSError:
        pass
    return [{"provider": provider,
             "configured": bool(os.getenv(cfg["key"], "").strip())}
            for provider, cfg in CONFIG.items()]


load_saved_provider_keys()


# Gemini API models are separated by task. Only text models appear in Chat.
GEMINI_SPECIALIST_MODELS = [
    ("gemini-3.8-live", "Gemini 3.8 Live · Default real-time voice", "live", "active"),
    ("gemini-3.8-live-extended-thinking", "Gemini 3.8 Live Extended Thinking", "live", "active"),
    ("gemini-3.5-live-translate-preview", "Gemini 3.5 Live Translate", "live", "preview"),
    ("gemini-3.5-transcribe", "Gemini 3.5 Transcribe", "transcription", "active"),
    ("gemini-3.5-transcribe-live", "Gemini 3.5 Transcribe Live", "transcription", "active"),
    ("gemini-3.1-flash-live-preview", "Gemini 3.1 Flash Live · Legacy preview", "live", "legacy"),
    ("gemini-2.5-flash-native-audio-preview-12-2025", "Gemini 2.5 Flash Native Audio Dialog · Legacy", "live", "legacy"),
    ("gemini-3.8-flash-tts", "Gemini 3.8 Flash TTS · Natural speech", "tts", "active"),
    ("gemini-3.8-flash-lite-tts", "Gemini 3.8 Flash Lite TTS · Fast speech", "tts", "active"),
    ("gemini-3.1-flash-tts-preview", "Gemini 3.1 Flash TTS · Legacy preview", "tts", "legacy"),
    ("gemini-2.5-flash-preview-tts", "Gemini 2.5 Flash TTS · Legacy access", "tts", "legacy"),
    ("gemini-2.5-pro-preview-tts", "Gemini 2.5 Pro TTS · Legacy access", "tts", "legacy"),
    ("gemini-nano-banana-2.1", "Nano Banana 2.1 · Image generation", "image", "active"),
    ("gemini-3.1-flash-image", "Nano Banana 2 · Image generation · Deprecated", "image", "deprecated"),
    ("gemini-3.1-flash-lite-image", "Nano Banana 2 Lite · Image generation", "image", "active"),
    ("gemini-3-pro-image", "Nano Banana Pro · Image generation", "image", "active"),
    ("gemini-2.5-flash-image", "Nano Banana · Legacy image generation", "image", "legacy"),
    ("gemini-embedding-001", "Gemini Embedding 1", "embedding", "active"),
    ("gemini-embedding-2", "Gemini Embedding 2 · Multimodal", "embedding", "active"),
    ("gemini-omni-1.1-flash", "Gemini Omni 1.1 Flash · Video generation", "video", "active"),
    ("gemini-robotics-er-2-preview", "Gemini Robotics ER 2 · Robotics", "robotics", "preview"),
    ("veo-3.1-generate-preview", "Veo 3.1 Generate · Shut down 22 Oct 2026", "video", "retired"),
    ("veo-3.1-fast-generate-preview", "Veo 3.1 Fast Generate · Shut down 22 Oct 2026", "video", "retired"),
    ("veo-3.1-lite-generate-preview", "Veo 3.1 Lite Generate · Shut down 22 Oct 2026", "video", "retired"),
    ("veo-3.0-generate-001", "Veo 3 Generate · Shut down 30 Jun 2026", "video", "retired"),
    ("veo-3.0-fast-generate-001", "Veo 3 Fast Generate · Shut down 30 Jun 2026", "video", "retired"),
    ("lyria-3-clip-preview", "Lyria 3 Clip · Music", "audio_generation", "preview"),
    ("lyria-3-pro-preview", "Lyria 3 Pro · Music", "audio_generation", "preview"),
    ("lyria-3.5", "Lyria 3.5 · Music generation", "audio_generation", "active"),
    ("antigravity-preview-09-2026", "Antigravity · Managed agent", "agent", "active"),
    ("deep-research-preview-04-2026", "Deep Research Preview", "agent", "active"),
    ("deep-research-max-preview-04-2026", "Deep Research Max Preview", "agent", "active"),
    ("deep-research-pro-preview-12-2025", "Deep Research Pro Preview · Retired 23 Oct 2026", "agent", "retired"),
    ("gemma-4-26b-a4b-it", "Gemma 4 26B", "open-model", "active"),
    ("gemma-4-31b-it", "Gemma 4 31B", "open-model", "active"),
]
RETIRED_GEMINI_ENTRIES = [
    ("gemini-2.0-flash", "Gemini 2 Flash · Shut down", "chat", "retired"),
    ("gemini-2.0-flash-lite", "Gemini 2 Flash Lite · Shut down", "chat", "retired"),
    ("gemini-2.5-computer-use-preview-10-2025", "Computer Use Preview · Shut down", "tool", "retired"),
]


def model_catalog():
    result = []
    for provider, models in CATALOG.items():
        cfg = CONFIG[provider]
        configured = bool(os.getenv(cfg["key"], "").strip())
        for model_id, label in models:
            result.append({
                "provider": provider, "id": model_id, "label": label,
                "configured": configured, "task": "chat",
                "chat_compatible": True, "status": "active", "integration": "chat",
            })
    gemini_configured = bool(os.getenv(CONFIG["gemini"]["key"], "").strip())
    for model_id, label, task, status in GEMINI_SPECIALIST_MODELS + RETIRED_GEMINI_ENTRIES:
        if status == "retired":
            integration = "retired"
        elif task == "live" and model_id in {"gemini-3.8-live", "gemini-3.8-live-extended-thinking"}:
            integration = "live"
        elif task == "tts" and model_id in {"gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"}:
            integration = "tts"
        elif task == "image" and model_id == "gemini-nano-banana-2.1":
            integration = "image"
        elif task == "open-model" and model_id in {"gemma-4-26b-a4b-it", "gemma-4-31b-it"}:
            integration = "chat"
        else:
            integration = "catalog"
        result.append({
            "provider": "gemini", "id": model_id, "label": label,
            "configured": gemini_configured, "task": ("chat" if integration == "chat" else task),
            "chat_compatible": integration == "chat", "status": status,
            "integration": integration,
        })
    return result



class AIGateway:
    def __init__(self):
        pass


    def provider_status(self):
        """Report key presence separately from a real provider API probe."""
        result = []
        for provider, cfg in CONFIG.items():
            key = os.getenv(cfg["key"], "").strip()
            item = {"provider": provider, "configured": bool(key),
                    "status": "not_configured" if not key else "not_tested",
                    "tested": False}
            if key:
                try:
                    if cfg.get("kind") == "gemini":
                        url = "https://generativelanguage.googleapis.com/v1beta/models"
                        response = requests.get(url, params={"key": key}, timeout=8)
                    else:
                        base = cfg["url"].rsplit("/", 2)[0]
                        response = requests.get(base + "/models",
                            headers={"Authorization": "Bearer " + key}, timeout=8)
                    item["tested"] = True
                    item["http_status"] = response.status_code
                    item["status"] = "reachable" if response.ok else "api_error"
                    if not response.ok:
                        item["detail"] = (response.text or "")[:180]
                except requests.RequestException as exc:
                    item["tested"] = True
                    item["status"] = "network_error"
                    item["detail"] = str(exc)[:180]
            result.append(item)
        return result


    def _gemini(self, model, key, message, history, system_prompt=None):
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            + model + ":generateContent"
        )
        contents = []
        for item in history[-20:]:
            text = str(item.get("content", item.get("message", "")) or "")
            if text:
                role = "user" if item.get("role", "user") == "user" else "model"
                contents.append({"role": role, "parts": [{"text": text}]})
        contents.append({"role": "user", "parts": [{"text": message}]})
        r = requests.post(
            url, params={"key": key},
            headers={"Content-Type": "application/json"},
            json={
                "systemInstruction": {"parts": [{"text": system_prompt or COSMIC_SYSTEM}]},
                "contents": contents,
            }, timeout=60
        )
        if not r.ok:
            detail = (r.text or "").replace("\n", " ")[:300]
            raise RuntimeError("Gemini HTTP " + str(r.status_code) + ": " + detail)
        data = r.json()
        candidates = data.get("candidates", [])
        if not candidates:
            raise RuntimeError("Gemini returned no candidates")
        text = "".join(
            part.get("text", "")
            for part in candidates[0].get("content", {}).get("parts", [])
        ).strip()
        if not text:
            raise RuntimeError("Gemini returned an empty response")
        return text

    def _openai_compatible(self, provider, model, key, message, history, system_prompt=None):
        cfg = CONFIG[provider]
        messages = [{"role": "system", "content": system_prompt or COSMIC_SYSTEM}]
        for item in history[-20:]:
            content = str(item.get("content", item.get("message", "")) or "")
            if content:
                role = item.get("role", "user")
                messages.append({
                    "role": "assistant" if role in ("assistant", "model") else "user",
                    "content": content,
                })
        messages.append({"role": "user", "content": message})
        r = requests.post(
            cfg["url"],
            headers={
                "Authorization": "Bearer " + key,
                "Content-Type": "application/json",
                **({"HTTP-Referer": "http://localhost", "X-Title": "COSMIC AI"}
                   if provider == "openrouter" else {}),
            },
            json={"model": model, "messages": messages, "temperature": 0.6},
            timeout=60,
        )
        if not r.ok:
            detail = (r.text or "").replace("\n", " ")[:300]
            raise RuntimeError(
                provider.title() + " HTTP " + str(r.status_code) + ": " + detail
            )
        data = r.json()
        choices = data.get("choices", [])
        if not choices:
            raise RuntimeError(provider.title() + " returned no choices")
        text = choices[0].get("message", {}).get("content") or ""
        if isinstance(text, list):
            text = "".join(
                str(part.get("text", "")) for part in text
                if isinstance(part, dict)
            )
        text = str(text).strip()
        if not text:
            raise RuntimeError(provider.title() + " returned an empty response")
        return text

    @staticmethod
    def _auto_gemini_model(message):
        """Fast task-aware model choice; explicit user selection always wins."""
        text = str(message or "").lower()
        deep_signals = (
            "prove ", "proof ", "derive ", "architecture", "design a system",
            "deep analysis", "analyze in detail", "debug this code",
            "complex reasoning", "compare in depth", "step by step implementation",
            "security review", "optimize this code",
        )
        quick_signals = (
            "in one line", "short answer", "quickly", "just the answer",
            "yes or no", "define ", "meaning of ",
        )
        if any(signal in text for signal in deep_signals):
            return "gemini-4-argon"
        if len(text) < 100 and any(signal in text for signal in quick_signals):
            return "gemini-3.5-flash-lite"
        return "gemini-3.8-flash"

    def chat(self, message, history=None, provider="auto", model="auto", mode="auto", system_prompt=None):
        # Reload app-private credentials for every request. Android .env files are
        # intentionally not bundled into the APK; API Setup stores keys on-device.
        load_saved_provider_keys()
        history = history or []
        provider = str(provider or "auto").lower()
        model = str(model or "auto")

        # Model dropdown values may be "provider:model-id".
        if ":" in model and model.split(":", 1)[0] in CONFIG:
            model_provider, model_id = model.split(":", 1)
            if provider == "auto":
                provider = model_provider
            model = model_id

        if provider != "auto" and provider not in CONFIG:
            return {"success": False, "error": "Unknown text provider: " + provider}

        if provider == "auto":
            candidates = list(AUTO_ORDER)
        else:
            candidates = [provider]

        if model != "auto" and provider != "auto":
            candidates = [provider]

        configured_candidates = [
            candidate for candidate in candidates
            if os.getenv(CONFIG[candidate]["key"], "").strip()
        ]
        if not configured_candidates:
            return {
                "success": False,
                "provider": provider,
                "needs_setup": True,
                "error": "No API key is configured for the selected provider(s): "
                    + ", ".join(candidates)
                    + ". Open COSMIC → API SETUP, add your Gemini API key, and tap SAVE API KEYS. Model names and quota counters are not API credentials.",
            }

        errors = []
        for candidate in candidates:
            cfg = CONFIG[candidate]
            key = os.getenv(cfg["key"], "").strip()
            if not key:
                errors.append(candidate + ": API key not configured")
                continue

            chosen_model = model if model != "auto" and candidate == provider else (self._auto_gemini_model(message) if candidate == "gemini" else cfg["default"])
            try:
                if cfg.get("kind") == "gemini":
                    answer = self._gemini(chosen_model, key, message, history, system_prompt=system_prompt)
                else:
                    answer = self._openai_compatible(
                        candidate, chosen_model, key, message, history, system_prompt=system_prompt
                    )
                return {
                    "success": True,
                    "provider": candidate,
                    "model": chosen_model,
                    "message": answer,
                    "type": "response",
                    "verified": True,
                }
            except Exception as exc:
                errors.append(candidate + " (" + chosen_model + "): " + str(exc))
                # If the task-selected Gemini model is unavailable on this key,
                # retry the fast stable model before falling back to another provider.
                if (provider == "auto" and candidate == "gemini" and
                        model == "auto" and chosen_model != "gemini-3.8-flash"):
                    try:
                        fallback_model = "gemini-3.8-flash"
                        fallback_answer = self._gemini(fallback_model, key, message, history, system_prompt=system_prompt)
                        return {
                            "success": True, "provider": "gemini",
                            "model": fallback_model, "message": fallback_answer,
                            "type": "response", "verified": True,
                        }
                    except Exception as fallback_exc:
                        errors.append("gemini (" + fallback_model + "): " + str(fallback_exc))
                # In automatic mode, try the next configured provider.
                if provider != "auto":
                    break

        return {
            "success": False,
            "provider": provider,
            "error": "All selected chat attempts failed. " + " | ".join(errors),
        }
