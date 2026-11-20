import os
import requests

COSMIC_SYSTEM = """You are COSMIC, the user's personal AI system.
Your name is COSMIC. Be practical, technically capable, concise, and honest.
Never claim to control devices or files unless an actual connected tool provides that capability.
"""

# These are candidate IDs; providers can change availability and free quotas.
CATALOG = {
    "gemini": [
        ("gemini-3.6-flash", "Gemini 3.6 Flash"),
        ("gemini-3.5-flash", "Gemini 3.5 Flash"),
        ("gemini-3.5-flash-lite", "Gemini 3.5 Flash Lite"),
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
        "default": "gemini-3.6-flash",
    },
    "groq": {
        "key": "GROQ_API_KEY",
        "url": "https://api.groq.com/openai/v1/chat/completions",
        "default": "openai/gpt-oss-120b",
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

AUTO_ORDER = ("groq", "gemini", "mistral", "openrouter")


def model_catalog():
    result = []
    for provider, models in CATALOG.items():
        cfg = CONFIG[provider]
        configured = bool(os.getenv(cfg["key"], "").strip())
        for model_id, label in models:
            result.append({
                "provider": provider,
                "id": model_id,
                "label": label,
                "configured": configured,
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


    def _gemini(self, model, key, message, history):
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
                "systemInstruction": {"parts": [{"text": COSMIC_SYSTEM}]},
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

    def _openai_compatible(self, provider, model, key, message, history):
        cfg = CONFIG[provider]
        messages = [{"role": "system", "content": COSMIC_SYSTEM}]
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

    def chat(self, message, history=None, provider="auto", model="auto", mode="auto", user_keys=None):
        history = history or []
        user_keys = user_keys or {}
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

        errors = []
        for candidate in candidates:
            cfg = CONFIG[candidate]
            key = str(user_keys.get(candidate) or os.getenv(cfg["key"], "")).strip()
            if not key:
                errors.append(candidate + ": API key not configured")
                continue

            chosen_model = model if model != "auto" and candidate == provider else cfg["default"]
            try:
                if cfg.get("kind") == "gemini":
                    answer = self._gemini(chosen_model, key, message, history)
                else:
                    answer = self._openai_compatible(
                        candidate, chosen_model, key, message, history
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
                errors.append(candidate + ": " + str(exc))
                # In automatic mode, try the next configured provider.
                if provider != "auto":
                    break

        return {
            "success": False,
            "provider": provider,
            "error": "All selected chat attempts failed. " + " | ".join(errors),
        }
