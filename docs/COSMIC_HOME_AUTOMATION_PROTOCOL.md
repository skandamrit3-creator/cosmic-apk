# COSMIC Home Automation Protocol v1

Status: firmware, native Android Bluetooth SPP adapter, Home Automation UI and Gemini Live voice-command source are integrated on the development branch. Java/Gradle compilation, Arduino compilation, phone pairing and physical relay testing are still outstanding.

## Hardware assumptions to verify

- Arduino UNO
- HC-05 in Bluetooth Classic SPP data mode
- Eight-channel relay input channels on Arduino D2–D9, mapped exactly as follows:

| Arduino digital pin | COSMIC relay channel |
|---|---|
| D2 | Relay 1 |
| D3 | Relay 2 |
| D4 | Relay 3 |
| D5 | Relay 4 |
| D6 | Relay 5 |
| D7 | Relay 6 |
| D8 | Relay 7 |
| D9 | Relay 8 |

The firmware uses this fixed mapping. COSMIC relay display names can be customized in the app; custom names do not change the physical pin mapping.
- HC-05 UART on SoftwareSerial D10 (Arduino RX from HC-05 TX) and D11 (Arduino TX to HC-05 RX through a suitable divider)
- UART defaults to 9600 baud; check the actual module configuration.
- `RELAY_ACTIVE_LOW` defaults to `true` in the sketch and MUST be checked against the actual relay board before attaching loads.

Do not connect household mains while developing or testing. Begin with LEDs or other isolated low-voltage loads. Mains switching requires correctly rated isolation, enclosure, fusing, strain relief and qualified electrical work.

## Framing

UTF-8/ASCII CSV, one command per line, LF terminated. CRLF is accepted. Protocol prefix and version are mandatory.

## Commands

- `COSMIC,1,GET,ALL\n` — request all eight reported states.
- `COSMIC,1,SET,1,ON\n` — turn relay channel 1 on.
- `COSMIC,1,SET,1,OFF\n` — turn relay channel 1 off.

Relay channel is 1–8. State is exactly ON or OFF. Unknown commands and malformed frames return an error.

## Responses

- `COSMIC,1,READY,8`
- `COSMIC,1,ACK,1,ON` — command accepted by firmware.
- `COSMIC,1,STATE,1,ON` — firmware's current commanded output state.
- `COSMIC,1,END` — end of a full state report.
- `COSMIC,1,ERR,BAD_STATE`

ACK means the firmware accepted and wrote the requested GPIO state; it does not prove that a connected appliance physically changed state. COSMIC must label this as controller-reported state, not verified appliance state.

## Safety contract

1. Every boot initializes all relay outputs to OFF; no previous state is restored.
2. Bluetooth connection never switches a relay by itself.
3. The app must query state after connecting and must not assume the relay state from a previous session.
4. Physical-load switching from voice requires an explicit, scoped permission and a confirmation for ambiguous or high-risk loads.
5. An OFF command is supported for each channel. The current app's all-off control sends eight individual OFF commands sequentially and waits for a matching STATE report after each; the firmware does not implement a separate ALL_OFF frame.
6. The reference firmware does not impose a disconnect auto-off timer. Automatically dropping arbitrary loads on Bluetooth loss could itself be hazardous; define per-load fail-safe behavior before enabling one.
7. No physical device is considered verified merely because an ACK arrived.

## Bench test

1. Upload the sketch with relay inputs disconnected from mains and loads.
2. Verify all eight channels are de-energized at power-up; if not, stop and correct the polarity/pin configuration.
3. Pair the phone with the HC-05 in Android Bluetooth settings.
4. From a serial Bluetooth terminal, send `COSMIC,1,GET,ALL`.
5. Confirm eight STATE lines and END.
6. Test one relay at a time using a low-voltage indicator, then query all states again.
7. Test malformed channel numbers and commands; firmware must reject them without changing outputs.

This firmware is a protocol baseline, not evidence of tested hardware compatibility.

## COSMIC voice-control integration

The COSMIC Gemini Live browser and native Android sessions advertise `set_home_relay` and `name_home_relay` tools. The app stores custom relay names locally on the device; the user can rename from the Home Automation card or by voice, for example, “Rename relay 1 to bedroom light.” After saving, the user can say “Turn bedroom light off.” The tool:
- accepts a numeric channel 1–8 or an exact saved relay name, plus ON/OFF;
- refuses to infer a channel-to-room/appliance mapping;
- asks for explicit on-screen confirmation before ON;
- requires an active paired Bluetooth SPP connection;
- waits for the Arduino `STATE` response matching the requested channel and state;
- reports the result as controller-reported state, never as proof of physical appliance operation.

This is a command authorization and controller acknowledgement path, not an appliance feedback sensor. If the user has not mapped relay channels to loads, COSMIC must ask rather than guess.

## Host-side regression tests

A lightweight C++ mock harness is included at `hardware/arduino/cosmic_home_automation/tests/host/`. From the repository root on a machine with `g++`, run:

```sh
sh hardware/arduino/cosmic_home_automation/tests/host/run.sh
```

It checks boot-off pin levels for the configured active-low board, SET/ACK/STATE behavior, invalid-channel rejection without state mutation, GET ALL framing and overlong-line rejection. This is a host simulation using Arduino/SoftwareSerial stubs; it is not an Arduino-core compile, electrical test or proof that the actual relay board is active-low.
