"""Embedded COSMIC backend entry point for the Android foreground service."""
import os
import threading
from pathlib import Path
from werkzeug.serving import make_server

_server = None
_thread = None
_lock = threading.RLock()
PORT = 8160


def start_server(data_dir):
    global _server, _thread
    with _lock:
        if _server is not None:
            return {"success": True, "already_running": True, "url": f"http://127.0.0.1:{PORT}"}

        data = Path(data_dir)
        data.mkdir(parents=True, exist_ok=True)
        (data / "cosmic").mkdir(parents=True, exist_ok=True)
        os.environ["COSMIC_HOST"] = "127.0.0.1"
        os.environ["COSMIC_PORT"] = str(PORT)
        os.environ["COSMIC_DATABASE"] = str(data / "cosmic" / "cosmic.db")
        os.environ["COSMIC_SECRETS_FILE"] = str(data / "cosmic" / "provider-keys.json")

        # Import only after setting Android-private storage paths.
        from backend.app import app
        _server = make_server("127.0.0.1", PORT, app, threaded=True)
        _thread = threading.Thread(
            target=_server.serve_forever,
            name="COSMIC-Flask-Server",
            daemon=True,
        )
        _thread.start()
        return {"success": True, "url": f"http://127.0.0.1:{PORT}"}


def stop_server():
    global _server, _thread
    with _lock:
        server = _server
        thread = _thread
        _server = None
        _thread = None
    if server is not None:
        server.shutdown()
        server.server_close()
    if thread is not None and thread.is_alive():
        thread.join(timeout=3)
    return {"success": True}
