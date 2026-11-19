# COSMIC backend platform APIs

All account routes use bearer tokens issued by /api/account/register or /api/account/login. Configure a random COSMIC_AUTH_SECRET of at least 32 characters before enabling account endpoints. Account passwords are PBKDF2-SHA256 hashed; device secrets are stored as server-keyed HMAC-SHA256 digests; raw device secrets are returned once at registration.

## Accounts and Android permission reporting

- POST /api/account/register and POST /api/account/login
- GET /api/account/me
- GET|PUT /api/account/settings
- PUT|GET /api/account/permissions

Android owns the actual runtime permission prompts. The APK reports current states (granted, denied, prompt, restricted, unsupported) to the backend; the backend never grants device permissions itself.

## Home automation and HC-05 bridge

Register a device with POST /api/devices/register, using kind arduino-relay or hc05-bridge. Save the returned device_secret securely on the Android bridge; it is shown only once. Android should poll /api/device/commands/next with X-Cosmic-Device and X-Cosmic-Device-Secret, forward commands over HC-05 serial, then post the Arduino response to /api/device/commands/{command_id}/ack.

Account clients queue commands through POST /api/devices/{device_id}/commands. Relay 1–8 map to Arduino D2–D9. A command is not considered complete until the bridge acknowledges it. Device heartbeat and relay state are returned by GET /api/devices.

The Socket.IO namespace is /cosmic. Connect with auth token. Account-room events include device:command and device:ack. REST remains the durable command/acknowledgement source of truth.

## Voice assistant

POST /api/assistant/command accepts a transcript. Common relay intents are parsed locally and queued without an LLM round trip; other messages use the configured AI gateway. The response explicitly distinguishes queued from acknowledged device actions.

POST /api/assistant/live-token mints a short-lived, single-use Gemini Live token. The permanent Gemini key remains server-side. Configure GEMINI_LIVE_MODEL to a Live API model enabled for the project.

## Image and video generation

POST /api/generation/image and POST /api/generation/video submit prompt jobs to configured provider endpoints. Set COSMIC_IMAGE_GENERATION_URL / COSMIC_VIDEO_GENERATION_URL and their corresponding API keys on the server. Provider submission accepts JSON with prompt and options and returns JSON with an id or task_id for asynchronous jobs. Optional status URLs may contain {job_id} and are queried by GET /api/generation/jobs/{job_id}. Provider credentials are never sent to the Android client.

## Required environment

- COSMIC_AUTH_SECRET: random, private, at least 32 characters.
- GEMINI_API_KEY: server-side only.
- COSMIC_SOCKET_ORIGINS: comma-separated trusted origins for cross-origin Socket.IO.
- Optional image/video provider URL, key, provider name, and status URL values from .env.example.

The current SQLite adapter is suitable for local development. Use a durable database volume or a PostgreSQL adapter before deploying multi-instance production services. Configure HTTPS at the hosting layer. This backend does not itself implement the Android HC-05 Bluetooth connection or request Android runtime permissions; those remain APK responsibilities.
