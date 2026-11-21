from pathlib import Path
from flask import Flask, Response, g, jsonify, request, send_from_directory
from dotenv import load_dotenv
from flask_cors import CORS
from backend.database.connection import init_db, get_connection
from backend.core.kernel.kernel import process_message
from backend.config import APP_NAME, APP_VERSION, HOST, PORT
from backend.integrations.tripo import TripoService, TripoError
from backend.platform_api import require_account
import os, platform, time

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 90 * 1024 * 1024

# COSMIC FRONTEND
PROJECT_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = PROJECT_ROOT / "frontend"

@app.get("/")
def frontend_index():
    # Inject account provider-key controls into the actual V2 page served at the root.
    html = (FRONTEND_DIR / "index.html").read_text(encoding="utf-8")
    script = '<script src="/js/provider-keys-settings.js?v=1" defer></script>'
    extra = '<script src="/js/cosmic-enhancements.js?v=1" defer></script>'
    live_script = '<script src="/js/cosmic-live.js?v=1" defer></script>'
    device_script = '<script src="/js/cosmic-device-vision.js?v=1" defer></script>'
    avatar2d_script = '<script src="/js/cosmic-live-2d.js?v=1" defer></script>'
    myraa_script = '<script src="/js/cosmic-myraa-vva.js?v=1" defer></script>'
    if "cosmic-enhancements.js" not in html:
        html = html.replace("</body>", extra + "</body>", 1)
    if "cosmic-live.js" not in html:
        html = html.replace("</body>", live_script + "</body>", 1)
    if "cosmic-device-vision.js" not in html:
        html = html.replace("</body>", device_script + "</body>", 1)
    if "cosmic-live-2d.js" not in html:
        html = html.replace("</body>", avatar2d_script + "</body>", 1)
    if "cosmic-myraa-vva.js" not in html:
        html = html.replace("</body>", myraa_script + "</body>", 1)
    if "provider-keys-settings.js" not in html:
        marker = "</body>"
        html = html.replace(marker, script + marker, 1) if marker in html else html + script
    response = Response(html, mimetype="text/html")
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return response

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

CORS(app, origins=[x.strip() for x in os.getenv("COSMIC_CORS_ORIGINS", "capacitor://localhost,http://localhost,https://localhost,http://127.0.0.1:8059").split(",") if x.strip()])
init_db()
from backend.platform_api import register_platform_routes
from backend.realtime import socketio
register_platform_routes(app)
socketio.init_app(app)
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
@require_account
def memory_count():
    with get_connection() as db:
        count = db.execute("SELECT COUNT(*) FROM conversations").fetchone()[0]
    return jsonify({"success": True, "count": count})


# 4. Conversation creation
@app.post("/api/conversations")
@require_account
def create_conversation():
    data = request.get_json(silent=True) or {}
    message = str(data.get("message", "")).strip()
    if not message:
        return jsonify({"success": False, "error": "message is required"}), 400
    session_id = str(data.get("session_id", "default"))
    return jsonify(process_message(message, session_id))


# 5. Memory search
@app.get("/api/memory/search")
@require_account
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
@require_account
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
@require_account
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



@app.get("/api/ai/provider-status")
def ai_provider_status():
    """Live API reachability check; never returns API keys."""
    from backend.ai.gateway.gateway import AIGateway
    return jsonify({"success": True, "providers": AIGateway().provider_status()})

@app.post("/api/chat")
@require_account
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
        message.strip(), history_items, provider=provider, model=model, mode=mode,
        user_keys=__import__("backend.platform_api", fromlist=["_account_provider_keys"])._account_provider_keys(g.cosmic_user_id)
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

@app.get("/api/history")
@require_account
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
@require_account
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
@require_account
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
@require_account
def cosmic_upgrade_status():
    return jsonify(upgrade_manager.status())

@app.get("/api/upgrades/project")
@require_account
def cosmic_upgrade_project():
    return jsonify(upgrade_manager.inspect_project())

@app.get("/api/upgrades/history")
@require_account
def cosmic_upgrade_history():
    return jsonify(upgrade_manager.history())

@app.post("/api/upgrades/preview")
@require_account
def cosmic_upgrade_preview():
    data = request.get_json(silent=True) or {}
    try:
        result = upgrade_manager.preview(data.get("path", ""), data.get("content", ""))
        return jsonify({k: v for k, v in result.items() if k != "content"})
    except (ValueError, TypeError) as e:
        return jsonify({"success": False, "error": str(e)}), 400

@app.post("/api/upgrades/apply")
@require_account
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
@require_account
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
@require_account
def avatar_3d_preset():
    data = request.get_json(silent=True) or {}
    try:
        result = TripoService().create_preset(data.get("preset", ""))
        return jsonify({"success": True, **result})
    except TripoError as exc:
        return jsonify({"success": False, "error": str(exc)}), exc.status


@app.post("/api/avatar/3d/generate")
@require_account
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
@require_account
def avatar_3d_rig_check():
    data = request.get_json(silent=True) or {}
    try:
        result = TripoService().rig_check(data.get("task_id", ""))
        return jsonify({"success": True, **result})
    except TripoError as exc:
        return jsonify({"success": False, "error": str(exc)}), exc.status


@app.post("/api/avatar/3d/rig")
@require_account
def avatar_3d_rig():
    data = request.get_json(silent=True) or {}
    try:
        result = TripoService().rig(data.get("task_id", ""), data.get("rig_type", "biped"), data.get("rig_model", "v3.0-20260909"), data.get("spec", "vrm"))
        return jsonify({"success": True, **result})
    except TripoError as exc:
        return jsonify({"success": False, "error": str(exc)}), exc.status




@app.post("/api/vision/identify")
@require_account
def cosmic_vision_identify():
    data = request.get_json(silent=True) or {}
    image_data = str(data.get("image", ""))
    mime = str(data.get("mime_type", "image/jpeg"))
    if not image_data or len(image_data) > 12_000_000:
        return jsonify(success=False, error="A valid, size-limited base64 image is required."), 400
    if mime not in ("image/jpeg", "image/png", "image/webp"):
        return jsonify(success=False, error="Unsupported image type."), 400
    try:
        from backend.platform_api import _account_provider_keys
        key = _account_provider_keys(g.cosmic_user_id).get("gemini") or os.getenv("GEMINI_API_KEY", "")
        if not key:
            return jsonify(success=False, error="Save a Gemini API key in COSMIC settings first."), 503
        import requests
        payload = {"contents": [{"parts": [{"text": "Identify the main visible object(s) in this image. Give concise labels, distinguishing details, and uncertainty; do not guess identity of people."}, {"inlineData": {"mimeType": mime, "data": image_data}}]}]}
        response = requests.post("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", params={"key": key}, json=payload, timeout=35)
        if not response.ok:
            return jsonify(success=False, error="Vision provider returned HTTP " + str(response.status_code)), 502
        result = response.json()
        answer = "".join(p.get("text", "") for p in result.get("candidates", [{}])[0].get("content", {}).get("parts", []))
        if not answer.strip():
            return jsonify(success=False, error="Vision provider returned no description."), 502
        return jsonify(success=True, provider="gemini", message=answer.strip())
    except Exception as exc:
        return jsonify(success=False, error="Vision request failed: " + str(exc)[:180]), 502

@app.errorhandler(Exception)
def error_handler(error):
    return jsonify({
        "success": False,
        "error": str(error),
        "type": "server_error"
    }), 500


if __name__ == "__main__":
    socketio.run(app, host=HOST, port=PORT, debug=False, allow_unsafe_werkzeug=True)

@app.post("/api/live/token")
@require_account
def cosmic_live_token():
    """Provision a short-lived Gemini Live token; never expose the account's long-lived key."""
    data = request.get_json(silent=True) or {}
    model = str(data.get("model", "gemini-2.5-flash-native-audio-preview-12-2025"))
    allowed = {"gemini-2.5-flash-native-audio-preview-12-2025", "gemini-3.8-live"}
    if model not in allowed:
        return jsonify(success=False, error="Unsupported Live model."), 400
    try:
        from backend.platform_api import _account_provider_keys
        key = _account_provider_keys(g.cosmic_user_id).get("gemini") or os.getenv("GEMINI_API_KEY", "")
        if not key:
            return jsonify(success=False, error="Save a Gemini API key first."), 503
        import requests
        payload = {"uses": 1, "liveConnectConstraints": {"model": "models/" + model, "config": {"responseModalities": ["AUDIO"], "sessionResumption": {}}}}
        resp = requests.post("https://generativelanguage.googleapis.com/v1beta/auth_tokens", headers={"x-goog-api-key": key, "Content-Type": "application/json"}, json=payload, timeout=20)
        if not resp.ok:
            return jsonify(success=False, error="Live token provisioning failed (HTTP " + str(resp.status_code) + ")."), 502
        token = resp.json().get("name")
        if not token:
            return jsonify(success=False, error="Live token provider returned no token."), 502
        return jsonify(success=True, token=token, model=model, expires=resp.json().get("expireTime"))
    except Exception as exc:
        return jsonify(success=False, error="Live token request failed: " + str(exc)[:160]), 502
