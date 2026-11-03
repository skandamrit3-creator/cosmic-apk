# COSMIC AI

COSMIC is a modular personal AI operating system designed as a device-independent AI core with mobile, computer, research, coding, automation, security, and future hardware interfaces.

## Architecture

User Interface → API → Kernel → Context/Memory/Identity → AI Gateway → Planner/Agents → Security/Permissions → Tools → Verification → State/Memory/Audit → Response

## Core Principles

- Real execution only; never simulate success.
- Every important action is permission-aware and auditable.
- Verification follows execution.
- AI providers remain replaceable.
- Android is a client/node, not the permanent brain.
- Local-first architecture.
- Cloud storage is optional backup/archive/synchronization.
- Authorized defensive cybersecurity only.
- Modular components with clear boundaries.


## COSMIC 2.0 browser and Android runtime

The Flask server serves the same frontend/ files that the Android build copies into android-wrapper/www/. This keeps the Reactor, Chat and Avatar Studio interfaces in sync.

1. Create a private root .env file from .env.example.
2. Set COSMIC_HOST=127.0.0.1 and COSMIC_PORT=8059 for same-device use.
3. Start the server from the repository root with python -m backend.app.
4. Open http://127.0.0.1:8059 in the browser on that same device.
5. In the Android app, open the system menu → backend connection, test http://127.0.0.1:8059, then save.

To let a different device on the same Wi-Fi access the server, bind the backend to 0.0.0.0 and use the host device's LAN IP. Do not expose an unauthenticated development backend directly to the public internet.

## 3D Avatar Studio

The viewer supports .glb, .gltf and .vrm models using Three.js and the @pixiv/three-vrm loader. Human-style and anime-style starter previews are procedural placeholders, not photorealistic characters. Import character files to view actual models.

The photo-to-3D pipeline accepts front/left/back/right views and sends selected images to Tripo only after the user checks the explicit consent box and presses Create detailed 3D avatar. Images are streamed to Tripo and are not written to COSMIC's server disk. Tripo is an external paid-credit service; set TRIPO_API_KEY in the private root .env file. Do not put a real key in Git or in frontend JavaScript. After generation, humanoid rigging is a separate optional API task and may use additional credits.

## Device and performance notes

The layout uses safe-area insets and responsive breakpoints for narrow portrait and landscape displays. The 3D renderer caps its device pixel ratio to reduce GPU load on mobile. Very detailed generated GLB models may still be large for phone memory; import optimized GLB/VRM assets for smoother performance.

## Build the Android debug APK

The Build COSMIC Android APK GitHub Actions workflow copies the latest frontend tree into android-wrapper/www/, runs npx cap sync android, and assembles a debug APK. A successful CI build confirms packaging, not physical-device testing. Debug APKs are not production-signed updates; stable in-place updates require a private signing keystore configured as GitHub Actions secrets.


## COSMIC 2.9.3 feature build

This branch contains the from-scratch workspace upgrade:

- Compact, textured Chat workspace with code-copy controls, safe Markdown links, tables, lists, and saved conversation history.
- Four persistent visual themes: Midnight, Aurora, Ember, and Light.
- Native Gemini Live voice path with a single listening toggle, offline OK COSMIC wake-word standby, and permission-aware Android actions.
- Reactor telemetry for backend latency and native Android CPU, RAM, storage, battery, and network receive/transmit rates. GPU utilisation is deliberately shown as unavailable.
- Avatar Studio with local GLB import, animation-clip playback, Tripo character presets including MYRAA, and optional humanoid rigging.
- Durable memory create/delete controls and local knowledge imports (up to 20 MB per text document). This is retrieval-based personal knowledge, not model-weight fine-tuning.
- Gemini Nano Banana image generation through the current Interactions API, Cloudflare FLUX selection, output aspect/resolution controls, and automatic Cloudflare fallback when Auto routing has both providers configured.

### Pull the feature branch

```sh
cd "/public/Cosmic AI"
git pull --ff-only origin feature/cosmic-from-scratch
```

The Android release workflow copies the latest frontend and backend into the Capacitor wrapper and builds a signed in-place update using the existing package ID and signing keystore. The 2.9.3 release increments versionCode to 16.

### Android permission notes

Microphone access is opt-in. Android requires a foreground notification for ongoing microphone capture; after a reboot, COSMIC posts a resume notification that must be tapped. Screen sharing requires Android's system approval dialog. Home, Recents, Notifications and Quick Settings actions require COSMIC's Accessibility service to be explicitly enabled. These controls cannot silently bypass Android permissions or OS restrictions.

### Provider requirements

Gemini image generation needs a working Gemini API key and model access. Cloudflare FLUX needs an Account ID and an API token with Workers AI permission. MYRAA/Tripo generation and rigging need a configured TRIPO_API_KEY and may consume paid credits.
