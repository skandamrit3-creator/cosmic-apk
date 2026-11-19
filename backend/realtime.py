"""Socket.IO transport for authenticated account/device events."""
import os
from flask import request
from flask_socketio import SocketIO, join_room

from backend.platform_api import _verify_token

socketio = SocketIO(cors_allowed_origins=os.getenv("COSMIC_SOCKET_ORIGINS", "capacitor://localhost,http://localhost,https://localhost,http://127.0.0.1:8059").split(","),
                    async_mode="threading", ping_interval=20, ping_timeout=30)


@socketio.on("connect", namespace="/cosmic")
def connect_cosmic(auth=None):
    auth = auth if isinstance(auth, dict) else {}
    token = auth.get("token") or request.args.get("token", "")
    user_id = _verify_token(str(token))
    if not user_id:
        return False
    join_room("user:" + user_id)
    return True


@socketio.on("device:status", namespace="/cosmic")
def device_status(payload):
    # Device status is persisted through the device-secret REST endpoint;
    # account clients may only publish a UI refresh hint for their own room.
    return {"accepted": isinstance(payload, dict)}


def emit_user_event(user_id, event, payload):
    socketio.emit(event, payload, to="user:" + user_id, namespace="/cosmic")
