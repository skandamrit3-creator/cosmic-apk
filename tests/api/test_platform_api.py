import os
import uuid
import pytest

os.environ["COSMIC_AUTH_SECRET"] = "test-secret-that-is-long-enough-for-hmac"
os.environ["COSMIC_DATABASE"] = "data/test-platform-" + uuid.uuid4().hex + ".db"

from backend.app import app
from backend.platform_api import init_platform_db


@pytest.fixture()
def client():
    init_platform_db()
    with app.test_client() as client:
        yield client


def account(client):
    response = client.post("/api/account/register", json={
        "email": "tester-" + uuid.uuid4().hex + "@example.test", "password": "correct-horse-battery",
        "display_name": "Tester"})
    assert response.status_code == 201
    return response.json["token"]


def auth(token):
    return {"Authorization": "Bearer " + token}


def test_account_register_login_and_settings(client):
    token = account(client)
    assert client.get("/api/account/me", headers=auth(token)).status_code == 200
    saved = client.put("/api/account/settings", headers=auth(token),
                       json={"voice": {"wake_word": "COSMIC"}})
    assert saved.status_code == 200
    assert client.get("/api/account/settings", headers=auth(token)).json["settings"]["voice"]["wake_word"] == "COSMIC"
    login = client.post("/api/account/login", json={
        "email": "tester@example.test", "password": "correct-horse-battery"})
    assert login.status_code == 200


def test_device_command_queue_and_acknowledgement(client):
    token = account(client)
    headers = auth(token)
    registered = client.post("/api/devices/register", headers=headers,
        json={"name": "Uno relay board", "kind": "arduino-relay"})
    assert registered.status_code == 201
    device = registered.json["device"]
    secret = registered.json["device_secret"]
    queued = client.post("/api/devices/"+device["id"]+"/commands", headers=headers,
        json={"command": {"action": "relay", "relay": 8, "state": "on"}})
    assert queued.status_code == 202
    device_headers = {"X-Cosmic-Device": device["id"], "X-Cosmic-Device-Secret": secret}
    next_command = client.get("/api/device/commands/next", headers=device_headers)
    command = next_command.json["command"]
    assert command["pin"] == 9
    ack = client.post("/api/device/commands/"+command["id"]+"/ack",
        headers=device_headers, json={"status": "acknowledged",
        "result": {"relay_status": {"8": "on"}}})
    assert ack.status_code == 200
    status = client.get("/api/devices/"+device["id"]+"/commands/"+command["id"],
                        headers=headers)
    assert status.json["command"]["status"] == "acknowledged"


def test_permissions_and_voice_home_intent(client):
    token = account(client)
    headers = auth(token)
    response = client.put("/api/account/permissions", headers=headers,
                          json={"camera": "granted", "microphone": "granted",
                                "bluetooth_scan": "denied"})
    assert response.status_code == 200
    client.post("/api/devices/register", headers=headers,
        json={"name": "Relay", "kind": "arduino-relay"})
    voice = client.post("/api/assistant/command", headers=headers,
                        json={"text": "turn on relay 2"})
    assert voice.status_code == 202
    assert voice.json["intent"] == "home_automation"


def test_auth_required_and_invalid_relay(client):
    assert client.get("/api/devices").status_code == 401
    token = account(client)
    headers = auth(token)
    device = client.post("/api/devices/register", headers=headers,
        json={"name": "Relay", "kind": "arduino-relay"}).json["device"]
    bad = client.post("/api/devices/"+device["id"]+"/commands", headers=headers,
        json={"command": {"action": "relay", "relay": 9, "state": "on"}})
    assert bad.status_code == 400


def test_generation_requires_provider_configuration(client, monkeypatch):
    token = account(client)
    monkeypatch.delenv("COSMIC_IMAGE_GENERATION_URL", raising=False)
    monkeypatch.delenv("COSMIC_IMAGE_API_KEY", raising=False)
    response = client.post("/api/generation/image", headers=auth(token),
                           json={"prompt": "A blue nebula"})
    assert response.status_code == 503
