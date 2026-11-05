# COSMIC AI — Final Integrated Architecture

Status: architecture target and implementation contract. A component is not considered implemented merely because it appears in this document or UI; each feature must pass its stated verification.

## Current implementation snapshot (2026-11-06)

Implemented in source on the development branch: Android VoiceInteractionService/session scaffolding and Vosk wake-word standby; Gemini Live browser/native adapters; MYRAA SVG avatar with blinking, expressions and playback-envelope mouth movement; Arduino UNO + HC-05 + eight-relay protocol firmware; Android Bluetooth SPP plugin; Home Automation workspace; voice-triggered relay actions with explicit ON confirmation and matching controller STATE acknowledgement.

Not yet verified or complete: Android Gradle compilation and APK packaging; Arduino toolchain compilation; target-phone runtime, Bluetooth pairing and hardware tests; phoneme-accurate Hindi/English viseme lip-sync; persistent user-editable relay-to-appliance mapping; full shared permission/risk/audit integration across every tool; durable memory controls; complete Reactor telemetry and broader Device Control coverage. Do not treat a source implementation as a released or tested feature.

## 1. Product structure

COSMIC is one personal AI operating system with one identity, conversation context, memory layer, permission system, event bus, model gateway, action planner, audit trail, and verification layer. Reactor, Chat, Avatar, Home Automation, and Device Control are workspaces over the same core—not separate assistants with disconnected memories.

Primary flow:

User input (touch / text / Hindi-English speech / wake phrase)
→ Input & Session Manager
→ Identity, Context and Memory
→ Intent Router / Planner
→ Permission & Risk Gate
→ Model Gateway and specialist agents
→ Tool / Device adapters
→ Execution result
→ Verification and audit
→ Response (text, voice, avatar animation, live status)

The model proposes actions; deterministic adapters execute them. A model response alone must never be reported as proof that a device, file, app, or system action succeeded.

## 2. COSMIC interface workspaces

- **Reactor:** truthful live system dashboard for backend health, latency, model routing, device connectivity, network and task activity. Show unavailable / permission-denied / stale states explicitly; never fabricate sensor readings or graphs.
- **Chat:** fast, mobile-first conversational workspace with streaming text, code, tables, diagrams, citations, copy actions, image/media outputs and accessible compact controls.
- **Avatar:** MYRAA 2D live companion by default, with selectable character profiles and optional 3D Avatar Studio. Keep the workspace spacious; character and controls must scale to phone portrait and desktop.
- **Home Automation:** relay/device dashboard, room/group controls, connection state, manual override, schedules and event history. It uses the same conversation and permission system.
- **Device Control:** Android capabilities such as opening apps, navigation, approved UI actions, downloads and system intents through explicit Android permissions and supported APIs. Accessibility control is opt-in and must remain visible to the user.

Persistent navigation switches workspaces without destroying the current conversation or assistant session.

## 3. MYRAA 2D animation and speech

Create a separate reusable frontend module under `frontend/js/avatar/` (proposed files: `avatar-controller.js`, `lip-sync.js`, `eye-animation.js`, `expression-state.js`, plus an asset manifest). The renderer should use layered vector/SVG or canvas assets with independent mouth, eyelid, iris, eyebrow and expression layers. It is a live animation component, not a single flattened character picture.

Required states:
- idle: natural blink with randomized intervals, subtle eye/head movement;
- listening: attentive eyes and listening indicator;
- thinking: restrained gaze/expression change;
- speaking: mouth shapes animate from actual output audio timing;
- interrupted / muted / disconnected / error: visibly distinct states.

Lip-sync priority:
1. Use timestamped phoneme/viseme events when the speech provider exposes them.
2. Otherwise derive mouth-open amount and energy from the actual PCM audio playback stream using a smoothed envelope, with optional speech-segment timing.
3. Never run a generic mouth loop that moves independently of the spoken audio.

Provide viseme groups suitable for Hindi and English phonetics (including open vowels, rounded vowels, closed-lip consonants such as प/ब/म, and neutral/rest). Use a provider-neutral event contract so Gemini Live or another speech engine can drive the same avatar. Align animation to the audio playback clock, not network-arrival time. On pause, interruption, or end-of-audio, return to neutral promptly. Blinking continues during speech without overriding mouth motion.

Character profiles should be swappable without changing the voice/session engine: MYRAA, human-style, anime/stylized, robotic and antagonist/enemy-style fictional profiles. Each profile has its own permitted asset pack, voice/persona mapping and expression set. Do not promise a realistic human avatar from a static illustration; use rigged layered assets or a properly rigged model.

Hindi-first and bilingual voice:
- Hindi and English input/output with language selection or reliable language detection.
- Voice output remains the source of truth for lip-sync.
- Captions/transcript are optional UI companions, not a replacement for speech.
- User can interrupt speech; avatar and audio must stop together.

## 4. Voice and Android assistant

- Local wake-word standby (for example, “OK COSMIC”) runs on-device; do not stream microphone audio to a cloud model while only waiting for the wake phrase.
- After wake, request/start the selected live speech session and route speech through the provider-neutral voice interface.
- Gemini Live is the initial provider adapter; keep a replaceable provider interface for future engines and benchmark actual end-to-end latency.
- Native Android VoiceInteractionService allows the user to select COSMIC as the system assistant on supported Android versions. The user must make this selection in Android settings/role UI; COSMIC cannot silently replace the system assistant.
- Permissions, microphone indicator, wake toggle, battery impact and current listening state must be visible.
- 24/7 availability is best-effort, not guaranteed: force-stop, revoked permissions, OEM battery management, reboot policy, Android background restrictions and hardware can stop listening. Test on the target phone and provide a clear recovery path.
- Keep secrets on the backend or Android secure storage; never embed provider API keys in frontend assets or the APK.

## 5. Home Automation: Arduino UNO + HC-05 + 8-channel relay

Initial supported hardware profile:
- Arduino UNO as the controller.
- HC-05 Bluetooth Classic serial module as the local wireless bridge.
- 8-channel relay board as the output stage.

Android connects to HC-05 over Bluetooth Classic SPP after the user pairs and grants the required Bluetooth permissions. The COSMIC Android adapter sends a small versioned command protocol; Arduino validates commands and returns acknowledgements and relay-state reports. The frontend must display connection and last-confirmed state, not merely the last requested state.

Suggested protocol contract (final bytes/baud/pins must be confirmed against the actual HC-05 board and relay module before wiring):
- `COSMIC,1,SET,1,ON\n` — request relay 1 ON.
- `COSMIC,1,SET,1,OFF\n` — request relay 1 OFF.
- `COSMIC,1,GET,ALL\n` — request current output states.
- Arduino response: `COSMIC,1,ACK,1,ON\n` or `COSMIC,1,ERR,<code>\n`.
- Include a heartbeat/timeout policy and a safe boot state; do not restore unknown outputs automatically after reset.

Safety and reliability:
- Map human-readable device names to relay channels in user configuration; never infer wiring from a name.
- Voice commands should be parsed into a proposed device action, shown/announced, then passed through the permission/risk gate. Require confirmation for high-risk loads and ambiguous commands.
- Provide an immediate all-off control, per-channel manual override, stale-state warning and command timeout.
- Do not connect household mains directly to an Arduino or expose relay terminals. Mains installation requires correctly rated isolation, enclosure, fusing, strain relief and a qualified adult/electrician. Start testing with low-voltage loads.
- Relay active-high/active-low behavior, coil supply, logic compatibility, HC-05 voltage divider and pin mapping must be verified from the exact board before producing a final wiring diagram.

## 6. Android device-control boundary

Use native Android APIs and explicit user-granted permissions wherever possible. AccessibilityService is only for user-authorized UI interaction where no supported API exists; it is not a hidden surveillance mechanism. Distinguish:
- safe actions (open a chosen app, navigate within COSMIC);
- sensitive actions (send messages, delete files, make purchases, alter security settings);
- physical actions (operate relays, motors, locks).

Sensitive and physical actions require a clear confirmation policy, command/result logging and post-action verification. Never claim control of every Android setting or every third-party app; platform APIs and permissions define the boundary.

## 7. Shared core services

- **Session manager:** one conversation/session across workspaces, interruption and resume.
- **Memory service:** user-approved durable preferences and project context, with inspect/edit controls.
- **Model gateway:** task-based routing, provider health, fallback and manual model override.
- **Tool registry:** typed adapters for GitHub, research, files, Android, Bluetooth and future devices.
- **Policy/permission engine:** scopes, confirmations, deny rules and revocation.
- **Event bus:** voice state, avatar visemes, tool progress, device state and UI events.
- **Verification layer:** compare expected vs observed result; report failures and timeouts honestly.
- **Audit log:** timestamp, action, source, permission, adapter response and verification result; avoid storing raw audio by default.

## 8. Delivery order and acceptance tests

1. **Voice foundation:** app startup, wake standby, system assistant role selection, wake-to-live flow, interruption, microphone/permission recovery and battery measurement.
2. **2D MYRAA engine:** layered assets, blink timing, expression state machine, Hindi/English viseme mapping, audio-clock lip-sync, pause/interruption synchronization and low-end Android performance.
3. **Unified command router:** natural-language intent schema, risk classification, permission checks, tool adapters and verified results.
4. **Home Automation:** pair HC-05, protocol handshake, relay discovery/configuration, per-channel control, acknowledgements, timeout, all-off and low-voltage bench test.
5. **Android device actions:** app launch and approved actions, permission UX, visible status and failure recovery.
6. **Reactor/Chat/Avatar integration:** consistent navigation, shared session and truthful telemetry; regression-test mobile portrait and desktop.
7. **Hardening:** automated tests, signed release build, upgrade-path validation, device testing, latency/battery profiling and security review.

A feature is **implemented** only after code exists; **verified** only after automated or device tests pass. The architecture itself does not mean an APK has been built, hardware has been wired, or Android background operation has been proven.

## Home Automation implementation update (2026-11-05)

The branch now contains an initial end-to-end source integration for the disclosed Arduino UNO + HC-05 + 8-channel relay target:

- Arduino firmware at `hardware/arduino/cosmic_home_automation/cosmic_home_automation.ino` implements protocol v1, eight configurable relay GPIOs, state reports, ACK/error responses, and OFF-at-boot initialization.
- Protocol contract and low-voltage bench procedure are documented in `docs/COSMIC_HOME_AUTOMATION_PROTOCOL.md`.
- Android `CosmicHomeAutomationPlugin` exposes bonded-device listing, Bluetooth Classic SPP connection, newline command transport, incoming line events, and disconnect/status methods.
- Android manifest permissions and MainActivity plugin registration are included.
- The frontend has a Home Automation workspace with paired-device selection, connect/disconnect, eight per-channel ON/OFF controls, state display, and an explicit all-off action that sends eight individual OFF commands.

Important implementation limits:
- This source has not yet been built or tested on an Android device, Arduino UNO, HC-05, or relay board.
- Confirm relay active polarity, pin mapping, HC-05 UART baud and RX logic-level requirements before wiring. The firmware's active-low setting is only a default.
- Reported GPIO state is not physical appliance verification.
- No automatic relay changes occur on Bluetooth connection. Household mains must not be used for initial testing.
- This is the first hardware bridge milestone, not completion of every planned COSMIC subsystem.

### Voice-controlled home automation source integration

Gemini Live browser and native Android sessions now expose a `set_home_relay` tool. It accepts only explicit channel numbers 1–8 and ON/OFF, requires on-screen confirmation before ON, requires an active Bluetooth SPP connection, and waits for a matching Arduino STATE line. COSMIC is instructed never to infer room/appliance mappings. The response is labelled controller-reported state, not physical appliance verification.
