"""Authenticated COSMIC account, device, voice and generation APIs."""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
import uuid
from datetime import datetime, timedelta, timezone
from functools import wraps

import requests
from flask import Blueprint, g, jsonify, request

from backend.database.connection import get_connection

bp = Blueprint("cosmic_platform", __name__, url_prefix="/api")
TOKEN_TTL = int(os.getenv("COSMIC_TOKEN_TTL", "604800"))
PBKDF2_ROUNDS = 310000


def _b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _secret():
    value = os.getenv("COSMIC_AUTH_SECRET", "").strip()
    if len(value) < 32:
        raise RuntimeError("COSMIC_AUTH_SECRET must contain at least 32 characters")
    return value.encode()


def _token(user_id):
    now = int(time.time())
    header = _b64(b'{"alg":"HS256","typ":"JWT"}')
    payload = _b64(json.dumps({"sub": user_id, "iat": now, "exp": now + TOKEN_TTL},
                              separators=(",", ":")).encode())
    body = header + "." + payload
    signature = _b64(hmac.new(_secret(), body.encode(), hashlib.sha256).digest())
    return body + "." + signature


def _verify_token(token):
    try:
        head, payload, signature = token.split(".")
        body = head + "." + payload
        expected = _b64(hmac.new(_secret(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            return None
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if int(claims["exp"]) <= int(time.time()):
            return None
        return claims["sub"]
    except (ValueError, KeyError, TypeError, json.JSONDecodeError, RuntimeError):
        return None


def _hash_secret(value, salt=None):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", value.encode(), salt, PBKDF2_ROUNDS)
    return _b64(salt) + "$" + _b64(digest)


def _check_secret(value, stored):
    try:
        salt_text, digest_text = stored.split("$", 1)
        salt = base64.urlsafe_b64decode(salt_text + "=" * (-len(salt_text) % 4))
        expected = _b64(hashlib.pbkdf2_hmac("sha256", value.encode(), salt, PBKDF2_ROUNDS))
        return hmac.compare_digest(expected, digest_text)
    except (ValueError, TypeError):
        return False


def _json():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def _auth_user():
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    return _verify_token(header[7:].strip())


def require_account(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        user_id = _auth_user()
        if not user_id:
            return jsonify(success=False, error="Valid account token required"), 401
        g.cosmic_user_id = user_id
        return fn(*args, **kwargs)
    return wrapped


def _device_from_request(db):
    device_id = request.headers.get("X-Cosmic-Device", "").strip()
    supplied = request.headers.get("X-Cosmic-Device-Secret", "")
    if not device_id or not supplied:
        return None
    row = db.execute("SELECT * FROM devices WHERE id=? AND revoked=0", (device_id,)).fetchone()
    expected = hmac.new(_secret(), supplied.encode(), hashlib.sha256).hexdigest()
    if not row or not hmac.compare_digest(expected, row["secret_hash"]):
        return None
    return row


def init_platform_db():
    with get_connection() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
          display_name TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS account_settings (
          user_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
          settings_json TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS permission_reports (
          user_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
          permissions_json TEXT NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS devices (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES accounts(id),
          name TEXT NOT NULL, kind TEXT NOT NULL, secret_hash TEXT NOT NULL,
          metadata_json TEXT NOT NULL DEFAULT '{}', last_seen INTEGER,
          relay_status_json TEXT NOT NULL DEFAULT '{}', revoked INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_devices_owner ON devices(user_id);
        CREATE TABLE IF NOT EXISTS device_commands (
          id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id),
          user_id TEXT NOT NULL REFERENCES accounts(id), command_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued', created_at INTEGER NOT NULL,
          delivered_at INTEGER, acknowledged_at INTEGER, result_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_device_queue ON device_commands(device_id,status,created_at);
        CREATE TABLE IF NOT EXISTS generation_jobs (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES accounts(id),
          kind TEXT NOT NULL, provider TEXT NOT NULL, prompt TEXT NOT NULL,
          status TEXT NOT NULL, provider_job_id TEXT, result_json TEXT,
          error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS security_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, event TEXT NOT NULL,
          detail_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
        );
        """)
        db.commit()


def _audit(db, user_id, event, detail=None):
    db.execute("INSERT INTO security_events(user_id,event,detail_json,created_at) VALUES(?,?,?,?)",
               (user_id, event, json.dumps(detail or {})[:4000], int(time.time())))


@bp.post("/account/register")
def register():
    data = _json()
    email = str(data.get("email", "")).strip().lower()
    password = data.get("password", "")
    display_name = str(data.get("display_name", "")).strip()[:80]
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) or len(email) > 254:
        return jsonify(success=False, error="A valid email address is required"), 400
    if not isinstance(password, str) or not 10 <= len(password) <= 256:
        return jsonify(success=False, error="Password must contain 10–256 characters"), 400
    try:
        _secret()
    except RuntimeError as exc:
        return jsonify(success=False, error=str(exc)), 503
    user_id = str(uuid.uuid4())
    now = int(time.time())
    try:
        with get_connection() as db:
            db.execute("INSERT INTO accounts(id,email,password_hash,display_name,created_at) VALUES(?,?,?,?,?)",
                       (user_id, email, _hash_secret(password), display_name, now))
            db.execute("INSERT INTO account_settings(user_id,settings_json,updated_at) VALUES(?,?,?)",
                       (user_id, "{}", now))
            _audit(db, user_id, "account.register")
            db.commit()
    except sqlite3.IntegrityError:
        return jsonify(success=False, error="An account with this email already exists"), 409
    return jsonify(success=True, token=_token(user_id), token_type="Bearer",
                   expires_in=TOKEN_TTL, account={"id": user_id, "email": email,
                   "display_name": display_name}), 201


@bp.post("/account/login")
def login():
    data = _json()
    email = str(data.get("email", "")).strip().lower()
    password = data.get("password", "")
    try:
        with get_connection() as db:
            row = db.execute("SELECT * FROM accounts WHERE email=?", (email,)).fetchone()
        if not row or not isinstance(password, str) or not _check_secret(password, row["password_hash"]):
            return jsonify(success=False, error="Invalid email or password"), 401
        token = _token(row["id"])
    except RuntimeError as exc:
        return jsonify(success=False, error=str(exc)), 503
    return jsonify(success=True, token=token, token_type="Bearer", expires_in=TOKEN_TTL,
                   account={"id": row["id"], "email": row["email"],
                            "display_name": row["display_name"]})


@bp.get("/account/me")
@require_account
def account_me():
    with get_connection() as db:
        row = db.execute("SELECT id,email,display_name,created_at FROM accounts WHERE id=?",
                         (g.cosmic_user_id,)).fetchone()
    if not row:
        return jsonify(success=False, error="Account not found"), 404
    return jsonify(success=True, account=dict(row))


@bp.route("/account/settings", methods=["GET", "PUT"])
@require_account
def account_settings():
    with get_connection() as db:
        row = db.execute("SELECT settings_json FROM account_settings WHERE user_id=?",
                         (g.cosmic_user_id,)).fetchone()
        if request.method == "GET":
            return jsonify(success=True, settings=json.loads(row["settings_json"] if row else "{}"))
        data = _json()
        if len(json.dumps(data)) > 16000:
            return jsonify(success=False, error="Settings payload too large"), 413
        now = int(time.time())
        db.execute("""INSERT INTO account_settings(user_id,settings_json,updated_at) VALUES(?,?,?)
          ON CONFLICT(user_id) DO UPDATE SET settings_json=excluded.settings_json,updated_at=excluded.updated_at""",
                   (g.cosmic_user_id, json.dumps(data), now))
        db.commit()
    return jsonify(success=True, settings=data)


@bp.put("/account/permissions")
@require_account
def permission_report():
    data = _json()
    allowed = {"camera", "microphone", "bluetooth_scan", "bluetooth_connect", "notifications"}
    if set(data) - allowed or any(v not in ("granted", "denied", "prompt", "restricted", "unsupported") for v in data.values()):
        return jsonify(success=False, error="Permission values must use the supported status vocabulary"), 400
    now = int(time.time())
    with get_connection() as db:
        db.execute("""INSERT INTO permission_reports(user_id,permissions_json,updated_at) VALUES(?,?,?)
          ON CONFLICT(user_id) DO UPDATE SET permissions_json=excluded.permissions_json,updated_at=excluded.updated_at""",
                   (g.cosmic_user_id, json.dumps(data), now))
        db.commit()
    return jsonify(success=True, permissions=data, updated_at=now)


@bp.get("/account/permissions")
@require_account
def get_permission_report():
    with get_connection() as db:
        row = db.execute("SELECT permissions_json,updated_at FROM permission_reports WHERE user_id=?",
                         (g.cosmic_user_id,)).fetchone()
    return jsonify(success=True, permissions=json.loads(row["permissions_json"]) if row else {},
                   updated_at=row["updated_at"] if row else None)


@bp.post("/devices/register")
@require_account
def register_device():
    data = _json()
    name = str(data.get("name", "")).strip()[:80]
    kind = str(data.get("kind", "arduino-relay")).strip().lower()
    if not name or kind not in {"arduino-relay", "hc05-bridge", "android", "generic-iot"}:
        return jsonify(success=False, error="Valid device name and kind are required"), 400
    device_id, secret = str(uuid.uuid4()), secrets.token_urlsafe(32)
    now = int(time.time())
    with get_connection() as db:
        db.execute("""INSERT INTO devices(id,user_id,name,kind,secret_hash,metadata_json,last_seen,created_at)
          VALUES(?,?,?,?,?,?,?,?)""",
                   (device_id, g.cosmic_user_id, name, kind,
                    hmac.new(_secret(), secret.encode(), hashlib.sha256).hexdigest(),
                    json.dumps(data.get("metadata") if isinstance(data.get("metadata"), dict) else {}),
                    now, now))
        _audit(db, g.cosmic_user_id, "device.register", {"device_id": device_id, "kind": kind})
        db.commit()
    # The raw device secret is returned once and is never stored.
    return jsonify(success=True, device={"id": device_id, "name": name, "kind": kind},
                   device_secret=secret), 201


@bp.get("/devices")
@require_account
def list_devices():
    with get_connection() as db:
        rows = db.execute("""SELECT id,name,kind,metadata_json,last_seen,relay_status_json,created_at
          FROM devices WHERE user_id=? AND revoked=0 ORDER BY created_at DESC""",
                          (g.cosmic_user_id,)).fetchall()
    return jsonify(success=True, devices=[{"id": r["id"], "name": r["name"], "kind": r["kind"],
        "metadata": json.loads(r["metadata_json"]), "last_seen": r["last_seen"],
        "relay_status": json.loads(r["relay_status_json"]), "created_at": r["created_at"]}
        for r in rows])


@bp.post("/devices/<device_id>/commands")
@require_account
def queue_device_command(device_id):
    data = _json()
    command = data.get("command")
    if not isinstance(command, dict) or len(json.dumps(command)) > 2000:
        return jsonify(success=False, error="A small JSON command object is required"), 400
    if command.get("action") == "relay":
        try:
            relay = int(command.get("relay"))
        except (TypeError, ValueError):
            return jsonify(success=False, error="Relay must be an integer from 1 to 8"), 400
        if relay not in range(1, 9) or command.get("state") not in ("on", "off"):
            return jsonify(success=False, error="Relay must be 1–8 and state must be on/off"), 400
        command = {"action": "relay", "relay": relay, "pin": relay + 1,
                   "state": command["state"]}
    elif command.get("action") not in {"status", "all_off", "ping"}:
        return jsonify(success=False, error="Unsupported device command"), 400
    command_id, now = str(uuid.uuid4()), int(time.time())
    with get_connection() as db:
        device = db.execute("SELECT id FROM devices WHERE id=? AND user_id=? AND revoked=0",
                            (device_id, g.cosmic_user_id)).fetchone()
        if not device:
            return jsonify(success=False, error="Device not found"), 404
        db.execute("""INSERT INTO device_commands(id,device_id,user_id,command_json,status,created_at)
          VALUES(?,?,?,?, 'queued', ?)""",
                   (command_id, device_id, g.cosmic_user_id, json.dumps(command), now))
        _audit(db, g.cosmic_user_id, "device.command.queued",
               {"device_id": device_id, "command_id": command_id, "action": command["action"]})
        db.commit()
    from backend.realtime import emit_user_event
    emit_user_event(g.cosmic_user_id, "device:command", {"device_id": device_id,
        "command_id": command_id, "status": "queued", "command": command})
    return jsonify(success=True, command_id=command_id, status="queued", command=command), 202


@bp.get("/device/commands/next")
def device_next_command():
    with get_connection() as db:
        device = _device_from_request(db)
        if not device:
            return jsonify(success=False, error="Invalid device credentials"), 401
        now = int(time.time())
        row = db.execute("""SELECT * FROM device_commands WHERE device_id=? AND status='queued'
          ORDER BY created_at LIMIT 1""", (device["id"],)).fetchone()
        db.execute("UPDATE devices SET last_seen=? WHERE id=?", (now, device["id"]))
        if not row:
            db.commit()
            return jsonify(success=True, command=None)
        db.execute("UPDATE device_commands SET status='delivered',delivered_at=? WHERE id=?",
                   (now, row["id"]))
        db.commit()
    return jsonify(success=True, command={"id": row["id"], **json.loads(row["command_json"])})


@bp.post("/device/commands/<command_id>/ack")
def device_ack(command_id):
    data = _json()
    with get_connection() as db:
        device = _device_from_request(db)
        if not device:
            return jsonify(success=False, error="Invalid device credentials"), 401
        row = db.execute("SELECT * FROM device_commands WHERE id=? AND device_id=?",
                         (command_id, device["id"])).fetchone()
        if not row:
            return jsonify(success=False, error="Command not found"), 404
        status = data.get("status")
        if status not in {"acknowledged", "failed"}:
            return jsonify(success=False, error="Status must be acknowledged or failed"), 400
        result = data.get("result") if isinstance(data.get("result"), dict) else {}
        now = int(time.time())
        db.execute("UPDATE device_commands SET status=?,acknowledged_at=?,result_json=? WHERE id=?",
                   (status, now, json.dumps(result)[:4000], command_id))
        if status == "acknowledged" and isinstance(result.get("relay_status"), dict):
            db.execute("UPDATE devices SET relay_status_json=?,last_seen=? WHERE id=?",
                       (json.dumps(result["relay_status"]), now, device["id"]))
        else:
            db.execute("UPDATE devices SET last_seen=? WHERE id=?", (now, device["id"]))
        _audit(db, device["user_id"], "device.command."+status,
               {"device_id": device["id"], "command_id": command_id})
        db.commit()
    from backend.realtime import emit_user_event
    emit_user_event(device["user_id"], "device:ack", {"device_id": device["id"],
        "command_id": command_id, "status": status, "result": result})
    return jsonify(success=True, command_id=command_id, status=status)


@bp.get("/devices/<device_id>/commands/<command_id>")
@require_account
def command_status(device_id, command_id):
    with get_connection() as db:
        row = db.execute("""SELECT id,status,created_at,delivered_at,acknowledged_at,result_json
          FROM device_commands WHERE id=? AND device_id=? AND user_id=?""",
                         (command_id, device_id, g.cosmic_user_id)).fetchone()
    if not row:
        return jsonify(success=False, error="Command not found"), 404
    return jsonify(success=True, command={**dict(row),
        "result": json.loads(row["result_json"]) if row["result_json"] else None})


@bp.post("/assistant/live-token")
@require_account
def assistant_live_token():
    """Mint a short-lived Gemini Live token; the permanent API key stays server-side."""
    key = os.getenv("GEMINI_API_KEY", "").strip()
    model = os.getenv("GEMINI_LIVE_MODEL", "gemini-3.8-live").strip()
    if not key:
        return jsonify(success=False, error="Gemini provider is not configured on the server"), 503
    try:
        response = requests.post("https://generativelanguage.googleapis.com/v1alpha/authTokens",
            headers={"x-goog-api-key": key, "Content-Type": "application/json"},
            json={"uses": 1,
                  "expireTime": (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat().replace("+00:00", "Z"),
                  "newSessionExpireTime": (datetime.now(timezone.utc) + timedelta(minutes=1)).isoformat().replace("+00:00", "Z"),
                  "bidiGenerateContentSetup": {"model": "models/" + model,
                    "generationConfig": {"responseModalities": ["AUDIO"]},
                    "systemInstruction": {"parts": [{"text":
                      "You are COSMIC, a concise, low-latency personal voice assistant. "
                      "Respond naturally and never claim a device action succeeded until acknowledged."}]}}},
            timeout=12)
        response.raise_for_status()
        token_data = response.json()
        token = token_data.get("name") or token_data.get("token")
        if not token:
            return jsonify(success=False, error="Gemini did not return a temporary Live token"), 502
        return jsonify(success=True, token=token, model=model,
                       expires_at=token_data.get("expireTime"),
                       new_session_expires_at=token_data.get("newSessionExpireTime"))
    except requests.RequestException:
        return jsonify(success=False, error="Gemini Live token service is unavailable"), 502


@bp.post("/assistant/command")
@require_account
def assistant_command():
    data = _json()
    transcript = data.get("text")
    if not isinstance(transcript, str) or not transcript.strip() or len(transcript) > 2000:
        return jsonify(success=False, error="A voice transcript is required"), 400
    text = transcript.strip()
    # Deterministic local intent parsing keeps common relay commands fast and predictable.
    match = re.search(r"\b(turn\s+on|switch\s+on|turn\s+off|switch\s+off)\s+(?:the\s+)?(?:relay\s*)?([1-8])\b|\b(?:relay\s*)?([1-8])\s+(?:turn\s+on|switch\s+on|on|turn\s+off|switch\s+off|off)\b", text, re.I)
    if match:
        action_text = (match.group(1) or match.group(0)).lower()
        relay = int(match.group(2) or match.group(3))
        state = "on" if "on" in action_text else "off"
        with get_connection() as db:
            device = db.execute("""SELECT id,name FROM devices WHERE user_id=? AND revoked=0
              AND kind IN ('arduino-relay','hc05-bridge') ORDER BY last_seen DESC LIMIT 1""",
                                (g.cosmic_user_id,)).fetchone()
        if not device:
            return jsonify(success=False, intent="home_automation", error="No registered relay device is available"), 409
        # Reuse the same authorization and validation path as explicit commands.
        command_id, now = str(uuid.uuid4()), int(time.time())
        command = {"action": "relay", "relay": relay, "pin": relay + 1, "state": state}
        with get_connection() as db:
            db.execute("""INSERT INTO device_commands(id,device_id,user_id,command_json,status,created_at)
              VALUES(?,?,?,?, 'queued', ?)""",
                       (command_id, device["id"], g.cosmic_user_id, json.dumps(command), now))
            db.commit()
        from backend.realtime import emit_user_event
        emit_user_event(g.cosmic_user_id, "device:command", {"device_id": device["id"],
            "command_id": command_id, "status": "queued", "command": command})
        return jsonify(success=True, intent="home_automation", spoken_response=f"Relay {relay} {state} command queued.",
                       command_id=command_id, device=device["name"], status="queued"), 202
    from backend.ai.gateway.gateway import AIGateway
    result = AIGateway().chat(text, [], provider="auto", model="auto", mode="assistant")
    if not result.get("success"):
        return jsonify(success=False, intent="conversation", error=result.get("error", "Assistant provider unavailable")), 503
    return jsonify(success=True, intent="conversation", response=result["message"],
                   provider=result.get("provider"), model=result.get("model"))


@bp.post("/generation/<kind>")
@require_account
def create_generation(kind):
    if kind not in {"image", "video"}:
        return jsonify(success=False, error="Generation kind must be image or video"), 404
    data = _json()
    prompt = data.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 4000:
        return jsonify(success=False, error="Prompt must contain 1–4000 characters"), 400
    prefix = "COSMIC_IMAGE" if kind == "image" else "COSMIC_VIDEO"
    endpoint = os.getenv(prefix + "_GENERATION_URL", "").strip()
    key = os.getenv(prefix + "_API_KEY", "").strip()
    if not endpoint or not key:
        return jsonify(success=False, error=f"{kind.title()} generation provider is not configured on the server"), 503
    job_id, now = str(uuid.uuid4()), int(time.time())
    with get_connection() as db:
        db.execute("""INSERT INTO generation_jobs(id,user_id,kind,provider,prompt,status,created_at,updated_at)
          VALUES(?,?,?,?,?,'submitting',?,?)""",
                   (job_id, g.cosmic_user_id, kind, os.getenv(prefix+"_PROVIDER", "custom"),
                    prompt.strip(), now, now))
        db.commit()
    try:
        response = requests.post(endpoint, headers={"Authorization": "Bearer "+key,
            "Content-Type": "application/json"},
            json={"prompt": prompt.strip(), **(data.get("options") if isinstance(data.get("options"), dict) else {})},
            timeout=25)
        response.raise_for_status()
        payload = response.json()
        provider_job_id = str(payload.get("id") or payload.get("task_id") or "")
        status = "submitted" if provider_job_id else "completed"
        with get_connection() as db:
            db.execute("UPDATE generation_jobs SET status=?,provider_job_id=?,result_json=?,updated_at=? WHERE id=?",
                       (status, provider_job_id or None, json.dumps(payload)[:20000], int(time.time()), job_id))
            db.commit()
    except (requests.RequestException, ValueError) as exc:
        with get_connection() as db:
            db.execute("UPDATE generation_jobs SET status='failed',error=?,updated_at=? WHERE id=?",
                       (str(exc)[:500], int(time.time()), job_id))
            db.commit()
        return jsonify(success=False, job_id=job_id, error="Generation provider request failed"), 502
    return jsonify(success=True, job_id=job_id, kind=kind, status=status,
                   provider_job_id=provider_job_id or None, provider_response=payload), 202


@bp.get("/generation/jobs/<job_id>")
@require_account
def get_generation_job(job_id):
    with get_connection() as db:
        row = db.execute("""SELECT id,kind,provider,status,provider_job_id,result_json,error,created_at,updated_at
          FROM generation_jobs WHERE id=? AND user_id=?""", (job_id, g.cosmic_user_id)).fetchone()
    if not row:
        return jsonify(success=False, error="Generation job not found"), 404
    if row["status"] == "submitted" and row["provider_job_id"]:
        prefix = "COSMIC_IMAGE" if row["kind"] == "image" else "COSMIC_VIDEO"
        status_url = os.getenv(prefix + "_STATUS_URL", "").strip()
        status_key = os.getenv(prefix + "_API_KEY", "").strip()
        if status_url and status_key:
            try:
                response = requests.get(status_url.replace("{job_id}", row["provider_job_id"]),
                    headers={"Authorization": "Bearer " + status_key}, timeout=12)
                response.raise_for_status()
                payload = response.json()
                provider_status = str(payload.get("status", "running")).lower()
                mapped = "completed" if provider_status in {"completed", "succeeded", "success", "done"} else (
                    "failed" if provider_status in {"failed", "error", "cancelled"} else "submitted")
                with get_connection() as db:
                    db.execute("UPDATE generation_jobs SET status=?,result_json=?,updated_at=? WHERE id=?",
                        (mapped, json.dumps(payload)[:20000], int(time.time()), job_id))
                    db.commit()
                row = dict(row)
                row["status"], row["result_json"] = mapped, json.dumps(payload)
            except (requests.RequestException, ValueError):
                pass
    return jsonify(success=True, job={**dict(row),
        "result": json.loads(row["result_json"]) if row["result_json"] else None})


def register_platform_routes(app):
    init_platform_db()
    app.register_blueprint(bp)
