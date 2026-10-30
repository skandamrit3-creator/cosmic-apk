"""Approval-gated local source update manager for COSMIC.

Updates are restricted to project source folders. Secrets, runtime state, git
metadata, package caches and arbitrary filesystem paths are never writable.
"""
from __future__ import annotations

import difflib
import hashlib
import json
import os
import re
import shutil
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from uuid import uuid4

PROJECT_ROOT = Path(__file__).resolve().parents[3]
STATE_DIR = PROJECT_ROOT / "data" / "local" / "cosmic-upgrades"
HISTORY_FILE = STATE_DIR / "history.json"
MAX_TEXT_BYTES = 2 * 1024 * 1024
MAX_HISTORY = 50
ALLOWED_ROOTS = {"frontend", "backend", "android-wrapper", "docs", "scripts"}
DENIED_PARTS = {
    ".git", ".env", ".venv", "venv", "__pycache__", "node_modules",
    ".idea", ".gradle", "build", "dist", "secrets", "credentials",
}
LOCK = threading.RLock()


def _now():
    return datetime.now(timezone.utc).isoformat()


def _safe_path(relative_path: str) -> tuple[str, Path]:
    raw = str(relative_path or "").strip().replace("\\", "/")
    if not raw or "\x00" in raw or len(raw) > 500:
        raise ValueError("A valid relative project file path is required.")
    posix = PurePosixPath(raw)
    if posix.is_absolute() or any(part in ("", ".", "..") for part in posix.parts):
        raise ValueError("Absolute paths and parent-directory traversal are not allowed.")
    if len(posix.parts) < 2 or posix.parts[0] not in ALLOWED_ROOTS:
        raise ValueError("Updates are allowed only inside frontend, backend, android-wrapper, docs or scripts.")
    if any(part.lower() in DENIED_PARTS or part.lower().startswith(".env") for part in posix.parts):
        raise ValueError("This path contains protected project or secret data.")
    if posix.suffix.lower() not in {".py", ".js", ".mjs", ".cjs", ".css", ".html", ".json", ".xml", ".gradle", ".md", ".txt", ".yml", ".yaml", ".toml", ".properties", ".sql"}:
        raise ValueError("This file type is not supported by the source update manager.")
    resolved = (PROJECT_ROOT / Path(*posix.parts)).resolve()
    try:
        resolved.relative_to(PROJECT_ROOT.resolve())
    except ValueError:
        raise ValueError("The requested file is outside the COSMIC project.")
    return posix.as_posix(), resolved


def _read_history():
    if not HISTORY_FILE.exists():
        return []
    try:
        payload = json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
        return payload if isinstance(payload, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def _write_json_atomic(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(value, ensure_ascii=False, indent=2)
    fd, temp_name = tempfile.mkstemp(prefix=".cosmic-", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    finally:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def status():
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    return {
        "success": True,
        "available": True,
        "project_root": str(PROJECT_ROOT),
        "approval_required": True,
        "automatic_remote_updates": False,
        "writable_roots": sorted(ALLOWED_ROOTS),
        "history_count": len(_read_history()),
        "message": "Local preview, explicit apply, backup and rollback are available. Remote self-updating is not enabled.",
    }


def inspect_project():
    counts = {}
    for root_name in sorted(ALLOWED_ROOTS):
        root = PROJECT_ROOT / root_name
        if root.is_dir():
            counts[root_name] = sum(1 for p in root.rglob("*") if p.is_file() and not any(x in DENIED_PARTS for x in p.parts))
        else:
            counts[root_name] = 0
    return {"success": True, "project": PROJECT_ROOT.name, "files_by_area": counts, "total_files": sum(counts.values())}


def history():
    records = _read_history()
    records.sort(key=lambda item: item.get("created_at", ""), reverse=True)
    return {"success": True, "items": records[:MAX_HISTORY]}


def preview(relative_path: str, content: str):
    clean_path, target = _safe_path(relative_path)
    if not isinstance(content, str):
        raise TypeError("File content must be text.")
    encoded = content.encode("utf-8")
    if len(encoded) > MAX_TEXT_BYTES:
        raise ValueError("Update content exceeds the 2 MB limit.")
    if "\x00" in content:
        raise ValueError("Binary data is not accepted by the source update manager.")
    before_bytes = target.read_bytes() if target.is_file() else b""
    try:
        before = before_bytes.decode("utf-8")
    except UnicodeDecodeError:
        raise ValueError("The selected file is not UTF-8 text and cannot be previewed.")
    diff = list(difflib.unified_diff(
        before.splitlines(keepends=True),
        content.splitlines(keepends=True),
        fromfile="current/" + clean_path,
        tofile="proposed/" + clean_path,
    ))
    return {
        "success": True,
        "path": clean_path,
        "exists": target.is_file(),
        "current_sha256": _sha256(before_bytes) if target.exists() else None,
        "proposed_sha256": _sha256(encoded),
        "changed": before != content,
        "diff": "".join(diff)[:200000],
        "requires_approval": True,
        "content": content,
    }


def apply(relative_path: str, content: str, approved=False):
    if approved is not True:
        raise ValueError("Explicit approval is required before applying a source update.")
    clean_path, target = _safe_path(relative_path)
    if not isinstance(content, str):
        raise TypeError("File content must be text.")
    encoded = content.encode("utf-8")
    if len(encoded) > MAX_TEXT_BYTES or "\x00" in content:
        raise ValueError("Update content is invalid or exceeds the 2 MB limit.")
    with LOCK:
        current = target.read_bytes() if target.is_file() else b""
        try:
            current_text = current.decode("utf-8")
        except UnicodeDecodeError:
            raise ValueError("The selected file is not UTF-8 text.")
        if current_text == content:
            return {"success": True, "changed": False, "path": clean_path, "message": "The file already has this content."}

        update_id = uuid4().hex
        backup_rel = None
        if target.exists():
            backup_path = STATE_DIR / "backups" / update_id / Path(*PurePosixPath(clean_path).parts)
            backup_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, backup_path)
            backup_rel = backup_path.relative_to(PROJECT_ROOT).as_posix()

        target.parent.mkdir(parents=True, exist_ok=True)
        fd, temp_name = tempfile.mkstemp(prefix=".cosmic-update-", suffix=".tmp", dir=str(target.parent))
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(encoded)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_name, target)
        finally:
            try:
                os.unlink(temp_name)
            except FileNotFoundError:
                pass

        record = {
            "id": update_id,
            "path": clean_path,
            "backup": backup_rel,
            "created_at": _now(),
            "previous_sha256": _sha256(current) if target.exists() and current else None,
            "applied_sha256": _sha256(encoded),
            "rollback_available": bool(backup_rel),
        }
        records = _read_history()
        records.append(record)
        _write_json_atomic(HISTORY_FILE, records[-MAX_HISTORY:])
        return {"success": True, "changed": True, "id": update_id, "path": clean_path, "sha256": record["applied_sha256"], "backup": backup_rel}


def rollback(update_id: str, approved=False):
    if approved is not True:
        raise ValueError("Explicit approval is required before rolling back a source update.")
    key = str(update_id or "").strip()
    if not re.fullmatch(r"[0-9a-f]{32}", key):
        raise ValueError("A valid update history ID is required.")
    with LOCK:
        records = _read_history()
        record = next((item for item in records if item.get("id") == key), None)
        if not record:
            raise ValueError("Update history entry was not found.")
        backup_rel = record.get("backup")
        if not backup_rel:
            raise ValueError("This entry has no previous version to restore.")
        backup = (PROJECT_ROOT / backup_rel).resolve()
        try:
            backup.relative_to((STATE_DIR / "backups" / key).resolve())
        except ValueError:
            raise ValueError("Backup path failed integrity validation.")
        if not backup.is_file():
            raise ValueError("The previous file backup is missing.")
        clean_path, target = _safe_path(record.get("path", ""))
        data = backup.read_bytes()
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, temp_name = tempfile.mkstemp(prefix=".cosmic-rollback-", suffix=".tmp", dir=str(target.parent))
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_name, target)
        finally:
            try:
                os.unlink(temp_name)
            except FileNotFoundError:
                pass
        record["rolled_back_at"] = _now()
        record["rollback_available"] = False
        record["rollback_sha256"] = _sha256(data)
        _write_json_atomic(HISTORY_FILE, records[-MAX_HISTORY:])
        return {"success": True, "path": clean_path, "restored_sha256": _sha256(data), "message": "Previous file contents restored."}
