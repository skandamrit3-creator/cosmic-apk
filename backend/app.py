from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory, Response
from dotenv import load_dotenv
from flask_cors import CORS
from backend.database.connection import init_db, get_connection
from backend.core.kernel.kernel import process_message
from backend.config import APP_NAME, APP_VERSION, HOST, PORT
from backend.integrations.tripo import TripoService, TripoError
import os, platform, time, base64, uuid, requests, datetime

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 90 * 1024 * 1024

# COSMIC FRONTEND
PROJECT_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = PROJECT_ROOT / "frontend"

@app.get("/")
def frontend_index():
    return send_from_directory(FRONTEND_DIR, "index.html")

@app.get("/frontend/<path:filename>")
def frontend_files(filename):
    return send_from_directory(FRONTEND_DIR, filename)

# The browser and Android WebView load the same relative css/ and js/ paths.
# Serve real frontend assets at the root URL so they work on localhost:8059.
@app.get("/<path:asset>")
def frontend_asset(asset):
    target = (FRONTEND_DIR / asset).resolve()
    try:
        target.relative_to(FRONTEND_DIR.resolve())
    except ValueError:
        return jsonify({"success": False, "error": "Not found"}), 404
    if target.is_file():
        return send_from_directory(FRONTEND_DIR, asset)
    return jsonify({"success": False, "error": "Not found"}), 404

CORS(app)
init_db()
START_TIME = time.time()



@app.get("/api/health")
def health():
    return jsonify({"success": True, "service": APP_NAME, "status": "healthy", "version": APP_VERSION})


# 1. Route discovery
@app.get("/api/routes")
def routes():
    return jsonify({
        "success": True,
        "routes": sorted([
            rule.rule for rule in app.url_map.iter_rules()
            if rule.rule != "/static/<path:filename>"
        ])
    })


# 2. COSMIC status
@app.get("/api/status")
def status():
    return jsonify({
        "success": True,
        "service": APP_NAME,
        "version": APP_VERSION,
        "uptime_seconds": round(time.time() - START_TIME, 2),
        "platform": platform.system(),
        "python": platform.python_version()
    })


# 3. Memory count — READ ONLY
@app.get("/api/memory/count")
def memory_count():
    with get_connection() as db:
        count = db.execute("SELECT COUNT(*) FROM conversations").fetchone()[0]
    return jsonify({"success": True, "count": count})


# 4. Conversation creation
@app.post("/api/conversations")
def create_conversation():
    data = request.get_json(silent=True) or {}
    message = str(data.get("message", "")).strip()
    if not message:
        return jsonify({"success": False, "error": "message is required"}), 400
    session_id = str(data.get("session_id", "default"))
    return jsonify(process_message(message, session_id))


# 5. Memory search
@app.get("/api/memory/search")
def search_memory():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"success": False, "error": "q is required"}), 400

    with get_connection() as db:
        rows = db.execute(
            "SELECT id,message,response,created_at FROM conversations "
            "WHERE message LIKE ? OR response LIKE ? "
            "ORDER BY id DESC LIMIT 100",
            (f"%{q}%", f"%{q}%")
        ).fetchall()

    return jsonify({
        "success": True,
        "count": len(rows),
        "items": [
            {"id": r[0], "message": r[1], "response": r[2], "created_at": r[3]}
            for r in rows
        ]
    })


# 6. Paginated memory
@app.get("/api/memory/page")
def memory_page():
    try:
        page = max(1, int(request.args.get("page", 1)))
        limit = min(100, max(1, int(request.args.get("limit", 20))))
    except ValueError:
        return jsonify({"success": False, "error": "invalid page or limit"}), 400

    offset = (page - 1) * limit

    with get_connection() as db:
        rows = db.execute(
            "SELECT id,message,response,created_at FROM conversations "
            "ORDER BY id DESC LIMIT ? OFFSET ?",
            (limit, offset)
        ).fetchall()

    return jsonify({
        "success": True,
        "page": page,
        "limit": limit,
        "items": [
            {"id": r[0], "message": r[1], "response": r[2], "created_at": r[3]}
            for r in rows
        ]
    })


# 7. Read individual memory — NO DELETE
@app.get("/api/memory/<int:memory_id>")
def get_memory(memory_id):
    with get_connection() as db:
        row = db.execute(
            "SELECT id,message,response,created_at FROM conversations WHERE id=?",
            (memory_id,)
        ).fetchone()

    if not row:
        return jsonify({"success": False, "error": "memory not found"}), 404

    return jsonify({
        "success": True,
        "item": {
            "id": row[0],
            "message": row[1],
            "response": row[2],
            "created_at": row[3]
        }
    })


# 8. Gemini model information
@app.get("/api/ai/gemini")
def gemini_info():
    return jsonify({
        "success": True,
        "provider": "gemini",
        "configured": bool(os.getenv("GEMINI_API_KEY")),
        "model": os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
    })


# 9. Runtime information
@app.get("/api/runtime")
def runtime():
    return jsonify({
        "success": True,
        "uptime_seconds": round(time.time() - START_TIME, 2),
        "python": platform.python_version(),
        "platform": platform.platform(),
        "pid": os.getpid()
    })


# 10. Strict chat validation



@app.get("/api/ai/models")
def ai_models():
    from backend.ai.gateway.gateway import model_catalog
    return jsonify({
        "success": True,
        "models": model_catalog()
    })



@app.post("/api/ai/test-provider")
def ai_test_provider():
    """Perform a real, minimal chat completion with one selected provider."""
    if request.remote_addr not in ("127.0.0.1", "::1"):
        return jsonify({"success": False, "error": "Provider tests are local-app only."}), 403
    data = request.get_json(silent=True) or {}
    provider = str(data.get("provider", "")).strip().lower()
    allowed = {"gemini", "openai", "groq", "mistral", "openrouter"}
    if provider not in allowed:
        return jsonify({"success": False, "error": "Choose a supported chat provider."}), 400
    from backend.ai.gateway.gateway import AIGateway, load_saved_provider_keys, CONFIG
    load_saved_provider_keys()
    key = os.getenv(CONFIG[provider]["key"], "").strip()
    if not key:
        return jsonify({"success": False, "provider": provider, "tested": False,
                        "status": "not_configured", "error": "API key is not configured."}), 400
    model = str(data.get("model", "auto")).strip() or "auto"
    result = AIGateway().chat(
        "Reply with exactly: COSMIC CONNECTION OK",
        history=[], provider=provider, model=model, mode="manual"
    )
    if result.get("success") and result.get("verified"):
        return jsonify({"success": True, "provider": provider,
                        "model": result.get("model"), "tested": True,
                        "status": "working", "reply": result.get("message", "")})
    return jsonify({"success": False, "provider": provider, "tested": True,
                    "status": "api_error", "error": result.get("error", "Provider test failed.")}), 502


@app.get("/api/ai/provider-status")
def ai_provider_status():
    """Live API reachability check; never returns API keys."""
    from backend.ai.gateway.gateway import AIGateway, load_saved_provider_keys
    load_saved_provider_keys()
    return jsonify({"success": True, "providers": AIGateway().provider_status()})

@app.post("/api/ai/live-token")
def create_gemini_live_token():
    """Mint a short-lived, single-use Gemini Live token; never expose the long-lived API key."""
    if request.remote_addr not in ("127.0.0.1", "::1"):
        return jsonify({"success": False, "error": "Live tokens can only be requested by the local COSMIC app."}), 403
    from backend.ai.gateway.gateway import load_saved_provider_keys
    load_saved_provider_keys()
    key = os.getenv("GEMINI_API_KEY", "").strip()
    if not key:
        return jsonify({"success": False, "error": "Gemini API key is not configured. Open API SETUP first."}), 400

    data = request.get_json(silent=True) or {}
    requested_model = str(data.get("model", "gemini-3.8-live")).strip()
    allowed_live_models = {
        "gemini-3.8-live",
        "gemini-3.8-live-extended-thinking",
    }
    if requested_model not in allowed_live_models:
        return jsonify({"success": False, "error": "Unsupported Live model. Choose Gemini 3.8 Live or Gemini 3.8 Live Extended Thinking."}), 400

    now = datetime.datetime.now(datetime.timezone.utc)
    model = "models/" + requested_model
    try:
        response = requests.post(
            "https://generativelanguage.googleapis.com/v1beta/auth_tokens",
            headers={"x-goog-api-key": key, "Content-Type": "application/json"},
            json={
                # Keep token provisioning to the universally supported fields.
                # Live model/configuration is sent in the WebSocket setup message.
                "uses": 1,
                "expireTime": (now + datetime.timedelta(minutes=30)).isoformat().replace("+00:00", "Z"),
                "newSessionExpireTime": (now + datetime.timedelta(minutes=1)).isoformat().replace("+00:00", "Z"),
            },
            timeout=15,
        )
        if not response.ok:
            detail = (response.text or "").replace("\\n", " ")[:350]
            return jsonify({"success": False, "error": "Gemini Live token request failed (HTTP "
                + str(response.status_code) + "): " + detail}), 502
        data = response.json()
        token = data.get("name")
        if not token:
            return jsonify({"success": False, "error": "Gemini did not return a Live token."}), 502
        return jsonify({
            "success": True,
            "token": token,
            "model": model,
            "expires_in_seconds": 1800,
            "config": {"responseModalities": ["AUDIO"]},
        })
    except requests.RequestException as exc:
        return jsonify({"success": False, "error": "Gemini Live token request failed: " + str(exc)[:240]}), 502


@app.get("/api/ai/provider-keys")
def ai_provider_keys():
    """Return key-presence flags only; load device-saved keys before reporting."""
    from backend.ai.gateway.gateway import CONFIG, load_saved_provider_keys
    load_saved_provider_keys()
    return jsonify({"success": True, "providers": [
        {"provider": provider, "configured": bool(os.getenv(cfg["key"], "").strip())}
        for provider, cfg in CONFIG.items()
    ]})


@app.post("/api/ai/speech")
def generate_gemini_speech():
    """Natural Gemini 3.8 TTS for chat replies; API key stays on the local backend."""
    if request.remote_addr not in ("127.0.0.1", "::1"):
        return jsonify({"success": False, "error": "Speech generation is available only from the local COSMIC app."}), 403
    data = request.get_json(silent=True) or {}
    text = str(data.get("text", "")).strip()
    if not text:
        return jsonify({"success": False, "error": "Text is required."}), 400
    if len(text) > 6000:
        return jsonify({"success": False, "error": "Speech text is limited to 6,000 characters."}), 400
    voice = str(data.get("voice", "Kore"))
    if voice not in {"Kore", "Aoede", "Puck", "Charon", "Fenrir", "Leda", "Orus", "Zephyr"}:
        voice = "Kore"
    model = str(data.get("model", "gemini-3.8-flash-lite-tts"))
    if model not in {"gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"}:
        model = "gemini-3.8-flash-lite-tts"
    from backend.ai.gateway.gateway import load_saved_provider_keys
    load_saved_provider_keys()
    key = os.getenv("GEMINI_API_KEY", "").strip()
    if not key:
        return jsonify({"success": False, "error": "Gemini API key is not configured. Open API SETUP first."}), 400
    try:
        response = requests.post(
            "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent",
            headers={"x-goog-api-key": key, "Content-Type": "application/json"},
            json={
                "contents": [{"role": "user", "parts": [{"text": text}]}],
                "generationConfig": {
                    "responseModalities": ["AUDIO"],
                    "speechConfig": {"voiceConfig": {"voice": voice}},
                },
            },
            timeout=90,
        )
        if not response.ok:
            detail = (response.text or "").replace("\\n", " ")[:300]
            return jsonify({"success": False, "error": "Gemini TTS HTTP "
                + str(response.status_code) + ": " + detail}), 502
        payload = response.json()
        encoded = None
        for candidate in payload.get("candidates", []):
            for part in candidate.get("content", {}).get("parts", []):
                inline = part.get("inlineData") or part.get("inline_data") or {}
                if inline.get("data"):
                    encoded = inline["data"]
                    break
            if encoded:
                break
        if not encoded:
            return jsonify({"success": False, "error": "Gemini TTS returned no audio."}), 502
        audio = base64.b64decode(encoded, validate=True)
        if not audio or len(audio) > 20 * 1024 * 1024:
            return jsonify({"success": False, "error": "Gemini TTS audio was empty or too large."}), 502
        return Response(audio, mimetype="audio/wav", headers={
            "Cache-Control": "no-store", "X-COSMIC-Voice": voice,
            "X-COSMIC-Model": model,
        })
    except requests.RequestException as exc:
        return jsonify({"success": False, "error": "Gemini TTS request failed: " + str(exc)[:220]}), 502
    except (ValueError, TypeError) as exc:
        return jsonify({"success": False, "error": "Could not decode Gemini TTS audio: " + str(exc)}), 502



@app.get("/api/ai/gemini/models")
def ai_gemini_models():
    """Return every page of Google's live Gemini model catalogue for the local key."""
    from backend.ai.gateway.gateway import load_saved_provider_keys
    load_saved_provider_keys()
    key = os.getenv("GEMINI_API_KEY", "").strip()
    if not key:
        return jsonify({"success": False, "error": "Gemini API key is not configured."}), 400
    try:
        models = []
        page_token = None
        pages = 0
        while pages < 20:
            params = {"key": key, "pageSize": 1000}
            if page_token:
                params["pageToken"] = page_token
            response = requests.get(
                "https://generativelanguage.googleapis.com/v1beta/models",
                params=params, timeout=15
            )
            if not response.ok:
                return jsonify({"success": False, "error":
                    "Google model catalogue returned HTTP " + str(response.status_code)}), 502
            data = response.json()
            for item in data.get("models", []):
                name = str(item.get("name", ""))
                if name.startswith("models/"):
                    name = name[7:]
                if name:
                    models.append({
                        "id": name,
                        "display_name": item.get("displayName") or name,
                        "supported_generation_methods": item.get("supportedGenerationMethods", []),
                        "input_token_limit": item.get("inputTokenLimit"),
                        "output_token_limit": item.get("outputTokenLimit"),
                    })
            page_token = data.get("nextPageToken")
            pages += 1
            if not page_token:
                break
        return jsonify({"success": True, "source": "Google Gemini API",
            "models": models, "count": len(models),
            "complete": not bool(page_token), "next_page_token": page_token})
    except requests.RequestException as exc:
        return jsonify({"success": False, "error":
            "Could not reach Google model catalogue: " + str(exc)[:180]}), 502

@app.post("/api/ai/provider-keys")
def save_ai_provider_keys():
    """Save keys entered locally in the COSMIC app. This endpoint is loopback-only."""
    if request.remote_addr not in ("127.0.0.1", "::1"):
        return jsonify({"success": False, "error": "For safety, configure API keys from the device running COSMIC."}), 403
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"success": False, "error": "JSON object required"}), 400
    try:
        from backend.ai.gateway.gateway import save_provider_keys
        providers = save_provider_keys(data.get("keys"), data.get("clear", []))
        return jsonify({"success": True, "providers": providers,
                        "message": "Provider key settings saved on this device."})
    except (TypeError, ValueError) as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    except OSError:
        app.logger.exception("Could not save COSMIC provider keys")
        return jsonify({"success": False, "error": "Could not save provider keys to app storage."}), 500

@app.post("/api/chat")
def chat():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"success": False, "error": "JSON object required"}), 400

    message = data.get("message")
    if not isinstance(message, str) or not message.strip():
        return jsonify({"success": False, "error": "message cannot be empty"}), 400

    session_id = str(data.get("session_id", "default"))
    provider = str(data.get("provider", "auto"))
    model = str(data.get("model", "auto"))
    mode = str(data.get("mode", "auto"))

    # Load recent messages for context. Do not expose database errors or secrets.
    history_items = []
    try:
        with get_connection() as db:
            rows = db.execute(
                "SELECT message, response FROM conversations "
                "WHERE session_id = ? ORDER BY id DESC LIMIT 10",
                (session_id,)
            ).fetchall()
        for row in reversed(rows):
            history_items.append({"role": "user", "content": row[0]})
            if row[1]:
                history_items.append({"role": "assistant", "content": row[1]})
    except Exception:
        history_items = []

    from backend.ai.gateway.gateway import AIGateway
    result = AIGateway().chat(
        message.strip(), history_items, provider=provider, model=model, mode=mode
    )

    if result.get("success"):
        try:
            with get_connection() as db:
                db.execute(
                    "INSERT INTO conversations (message, response, session_id) "
                    "VALUES (?, ?, ?)",
                    (message.strip(), result["message"], session_id)
                )
                db.commit()
        except Exception:
            # Chat still succeeds even if history storage is unavailable.
            pass

    return jsonify(result)


@app.post("/api/images/generate")
def generate_image():
    """Generate an image with Gemini Nano Banana and save it in app-private storage."""
    if request.remote_addr not in ("127.0.0.1", "::1"):
        return jsonify({"success": False, "error": "Image generation is available only from the local COSMIC app."}), 403
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"success": False, "error": "JSON object required"}), 400
    prompt = str(data.get("prompt", "")).strip()
    if not prompt:
        return jsonify({"success": False, "error": "Describe the image you want."}), 400
    if len(prompt) > 4000:
        return jsonify({"success": False, "error": "Image prompt must be 4,000 characters or fewer."}), 400

    from backend.ai.gateway.gateway import load_saved_provider_keys
    load_saved_provider_keys()
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        return jsonify({"success": False, "error": "Gemini API key is not configured. Open API SETUP and add your Gemini key."}), 400

    aspect_ratio = str(data.get("aspect_ratio", "1:1"))
    image_size = str(data.get("image_size", "1K"))
    if aspect_ratio not in {"1:1","1:4","1:8","2:3","3:2","3:4","4:1","4:3","4:5","5:4","8:1","9:16","16:9","21:9"}:
        return jsonify({"success": False, "error": "Unsupported image aspect ratio."}), 400
    if image_size not in {"512","1K","2K","4K"}:
        return jsonify({"success": False, "error": "Image size must be 512, 1K, 2K or 4K."}), 400
    payload = {
        "model": "gemini-nano-banana-2.1",
        "input": [{"type": "text", "text": prompt}],
        "response_format": {
            "type": "image", "mime_type": "image/jpeg",
            "aspect_ratio": aspect_ratio, "image_size": image_size,
        },
    }
    try:
        response = requests.post(
            "https://generativelanguage.googleapis.com/v1beta/interactions",
            headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
            json=payload,
            timeout=180,
        )
        if not response.ok:
            detail = (response.text or "").replace("\\n", " ")[:400]
            return jsonify({"success": False, "error": "Gemini Nano Banana 2.1 HTTP "
                + str(response.status_code) + ": " + detail}), 502
        result = response.json()
        output_image = result.get("output_image") or {}
        encoded = output_image.get("data") if isinstance(output_image, dict) else None
        if not encoded:
            for step in result.get("steps", []):
                if step.get("type") != "model_output":
                    continue
                for item in step.get("content", []):
                    if item.get("type") == "image" and item.get("data"):
                        encoded = item["data"]
                        break
                if encoded:
                    break
        if not encoded:
            return jsonify({"success": False, "error": "Gemini completed without returning an image. Try a simpler prompt."}), 502
        image_bytes = base64.b64decode(encoded, validate=True)
        if not image_bytes or len(image_bytes) > 25 * 1024 * 1024:
            return jsonify({"success": False, "error": "Generated image was empty or exceeded the 25 MB limit."}), 502

        data_root = Path(os.getenv("COSMIC_DATABASE", "data/local/cosmic.db")).resolve().parent
        image_dir = data_root / "generated-images"
        image_dir.mkdir(parents=True, exist_ok=True)
        filename = uuid.uuid4().hex + ".jpg"
        (image_dir / filename).write_bytes(image_bytes)
        return jsonify({
            "success": True,
            "url": "/api/images/generated/" + filename,
            "filename": filename,
            "size_bytes": len(image_bytes),
            "model": "gemini-nano-banana-2.1",
        })
    except (ValueError, TypeError) as exc:
        return jsonify({"success": False, "error": "Could not decode Gemini's image response: " + str(exc)}), 502
    except requests.RequestException as exc:
        return jsonify({"success": False, "error": "Gemini image request failed: " + str(exc)[:240]}), 502
    except OSError:
        app.logger.exception("Could not save generated COSMIC image")
        return jsonify({"success": False, "error": "Could not save the generated image on this device."}), 500


@app.get("/api/images/generated/<filename>")
def serve_generated_image(filename):
    if not filename.endswith(".jpg") or not filename[:-4].isalnum():
        return jsonify({"success": False, "error": "Invalid image name"}), 404
    data_root = Path(os.getenv("COSMIC_DATABASE", "data/local/cosmic.db")).resolve().parent
    image_dir = data_root / "generated-images"
    return send_from_directory(image_dir, filename, mimetype="image/jpeg", as_attachment=False, max_age=86400)


@app.get("/api/history")
def history():
    session_id = str(request.args.get("session_id", "default"))
    try:
        limit = min(200, max(1, int(request.args.get("limit", 100))))
    except ValueError:
        limit = 100

    with get_connection() as db:
        rows = db.execute("""
            SELECT id, message, response, created_at, session_id
            FROM conversations
            WHERE session_id = ?
            ORDER BY id ASC
            LIMIT ?
        """, (session_id, limit)).fetchall()

    return jsonify({
        "success": True,
        "session_id": session_id,
        "items": [dict(row) for row in rows]
    })


@app.get("/api/chats")
def chats():
    search = str(request.args.get("search", "")).strip()

    with get_connection() as db:
        if search:
            rows = db.execute("""
                SELECT
                    session_id,
                    MAX(id) AS last_id,
                    MAX(created_at) AS last_time,
                    COUNT(*) AS message_count,
                    (
                        SELECT c2.message
                        FROM conversations c2
                        WHERE c2.session_id = c.session_id
                        ORDER BY c2.id ASC
                        LIMIT 1
                    ) AS title
                FROM conversations c
                WHERE c.message LIKE ? OR c.response LIKE ?
                GROUP BY session_id
                ORDER BY last_id DESC
            """, (f"%{search}%", f"%{search}%")).fetchall()
        else:
            rows = db.execute("""
                SELECT
                    session_id,
                    MAX(id) AS last_id,
                    MAX(created_at) AS last_time,
                    COUNT(*) AS message_count,
                    (
                        SELECT c2.message
                        FROM conversations c2
                        WHERE c2.session_id = c.session_id
                        ORDER BY c2.id ASC
                        LIMIT 1
                    ) AS title
                FROM conversations c
                GROUP BY session_id
                ORDER BY last_id DESC
            """).fetchall()

    return jsonify({
        "success": True,
        "items": [dict(row) for row in rows]
    })


@app.get("/api/memories")
def memories():
    with get_connection() as db:
        rows = db.execute("""
            SELECT id, memory, source, created_at, updated_at
            FROM memories
            ORDER BY id DESC
        """).fetchall()

    return jsonify({
        "success": True,
        "items": [dict(row) for row in rows]
    })



from backend.core.upgrades import manager as upgrade_manager

@app.get("/api/upgrades/status")
def cosmic_upgrade_status():
    return jsonify(upgrade_manager.status())

@app.get("/api/upgrades/project")
def cosmic_upgrade_project():
    return jsonify(upgrade_manager.inspect_project())

@app.get("/api/upgrades/history")
def cosmic_upgrade_history():
    return jsonify(upgrade_manager.history())

@app.post("/api/upgrades/preview")
def cosmic_upgrade_preview():
    data = request.get_json(silent=True) or {}
    try:
        result = upgrade_manager.preview(data.get("path", ""), data.get("content", ""))
        return jsonify({k: v for k, v in result.items() if k != "content"})
    except (ValueError, TypeError) as e:
        return jsonify({"success": False, "error": str(e)}), 400

@app.post("/api/upgrades/apply")
def cosmic_upgrade_apply():
    data = request.get_json(silent=True) or {}
    try:
        result = upgrade_manager.apply(
            data.get("path", ""), data.get("content", ""),
            approved=data.get("approved") is True
        )
        return jsonify(result)
    except (ValueError, TypeError) as e:
        return jsonify({"success": False, "error": str(e)}), 400

@app.post("/api/upgrades/rollback")
def cosmic_upgrade_rollback():
    data = request.get_json(silent=True) or {}
    try:
        result = upgrade_manager.rollback(
            data.get("id", ""), approved=data.get("approved") is True
        )
        return jsonify(result)
    except (ValueError, TypeError) as e:
        return jsonify({"success": False, "error": str(e)}), 400


# Optional user-consented 3D avatar generation.
@app.get("/api/avatar/3d/status")
def avatar_3d_status():
    service = TripoService()
    return jsonify({
        "success": True,
        "configured": service.configured,
        "provider": "Tripo",
        "model": os.getenv("TRIPO_MODEL", "v3.1-20260211"),
        "message": "3D generation ready" if service.configured else "Set TRIPO_API_KEY on the backend to enable paid cloud generation."
    })


@app.post("/api/avatar/3d/preset")
def avatar_3d_preset():
    data = request.get_json(silent=True) or {}
    try:
        result = TripoService().create_preset(data.get("preset", ""))
        return jsonify({"success": True, **result})
    except TripoError as exc:
        return jsonify({"success": False, "error": str(exc)}), exc.status


@app.post("/api/avatar/3d/generate")
def avatar_3d_generate():
    if request.form.get("consent") != "true":
        return jsonify({"success": False, "error": "Explicit photo-upload consent is required."}), 400
    files = {view: request.files.get(view) for view in ("front", "left", "back", "right")}
    try:
        result = TripoService().create_multiview(files)
        return jsonify({"success": True, **result})
    except TripoError as exc:
        return jsonify({"success": False, "error": str(exc)}), exc.status


@app.get("/api/avatar/3d/task/<task_id>")
def avatar_3d_task(task_id):
    try:
        return jsonify({"success": True, **TripoService().task(task_id)})
    except TripoError as exc:
        return jsonify({"success": False, "error": str(exc)}), exc.status


@app.post("/api/avatar/3d/rig-check")
def avatar_3d_rig_check():
    data = request.get_json(silent=True) or {}
    try:
        result = TripoService().rig_check(data.get("task_id", ""))
        return jsonify({"success": True, **result})
    except TripoError as exc:
        return jsonify({"success": False, "error": str(exc)}), exc.status


@app.post("/api/avatar/3d/rig")
def avatar_3d_rig():
    data = request.get_json(silent=True) or {}
    try:
        result = TripoService().rig(data.get("task_id", ""), data.get("rig_type", "biped"), data.get("rig_model", "v3.0-20260909"), data.get("spec", "vrm"))
        return jsonify({"success": True, **result})
    except TripoError as exc:
        return jsonify({"success": False, "error": str(exc)}), exc.status


@app.errorhandler(Exception)
def error_handler(error):
    return jsonify({
        "success": False,
        "error": str(error),
        "type": "server_error"
    }), 500


if __name__ == "__main__":
    app.run(host=HOST, port=PORT, debug=False)
