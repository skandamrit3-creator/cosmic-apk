/*
 * COSMIC Home Automation Bridge — Arduino UNO + HC-05 + 8-channel relay
 * Protocol: docs/COSMIC_HOME_AUTOMATION_PROTOCOL.md
 *
 * IMPORTANT:
 * - Start with LOW-VOLTAGE test loads only.
 * - Confirm relay-board active polarity before connecting it.
 * - HC-05 TX -> Arduino D10; Arduino D11 -> HC-05 RX through a suitable
 *   logic-level divider. Common HC-05 data-mode baud is 9600; verify yours.
 * - Exact relay mapping: D2=Relay 1, D3=Relay 2, D4=Relay 3, D5=Relay 4,
 *   D6=Relay 5, D7=Relay 6, D8=Relay 7, D9=Relay 8. Confirm the board labels.
 * - All relay channels are forced OFF at boot; saved states are never restored.
 */
#include <SoftwareSerial.h>
#include <string.h>
#include <stdlib.h>

static const uint8_t BT_RX_PIN = 10; // Arduino receives from HC-05 TX
static const uint8_t BT_TX_PIN = 11; // Arduino transmits to HC-05 RX (use divider)
static const uint8_t RELAY_PINS[8] = {2, 3, 4, 5, 6, 7, 8, 9};
static const bool RELAY_ACTIVE_LOW = true; // VERIFY against the exact relay board
static const unsigned long SERIAL_BAUD = 9600;
static const size_t LINE_CAPACITY = 80;

SoftwareSerial cosmicBt(BT_RX_PIN, BT_TX_PIN);
char lineBuffer[LINE_CAPACITY];
size_t lineLength = 0;
bool overflowed = false;
bool relayState[8] = {false, false, false, false, false, false, false, false};

uint8_t outputLevel(bool on) {
  return (on ^ RELAY_ACTIVE_LOW) ? HIGH : LOW;
}

void writeRelay(uint8_t index, bool on) {
  relayState[index] = on;
  digitalWrite(RELAY_PINS[index], outputLevel(on));
}

void sendError(const char *code) {
  cosmicBt.print(F("COSMIC,1,ERR,"));
  cosmicBt.print(code);
  cosmicBt.print('\n');
}

void sendState(uint8_t index) {
  cosmicBt.print(F("COSMIC,1,STATE,"));
  cosmicBt.print(index + 1);
  cosmicBt.print(',');
  cosmicBt.print(relayState[index] ? F("ON") : F("OFF"));
  cosmicBt.print('\n');
}

void sendAllStates() {
  for (uint8_t i = 0; i < 8; ++i) sendState(i);
  cosmicBt.print(F("COSMIC,1,END\n"));
}

bool parseRelayNumber(const char *value, uint8_t &index) {
  if (!value || !*value) return false;
  char *end = nullptr;
  long n = strtol(value, &end, 10);
  if (*end != '\0' || n < 1 || n > 8) return false;
  index = (uint8_t)(n - 1);
  return true;
}

void handleLine(char *line) {
  char *tokens[6] = {nullptr, nullptr, nullptr, nullptr, nullptr, nullptr};
  uint8_t count = 0;
  char *save = nullptr;
  for (char *part = strtok_r(line, ",", &save); part && count < 6;
       part = strtok_r(nullptr, ",", &save)) {
    tokens[count++] = part;
  }
  if (count < 3 || strcmp(tokens[0], "COSMIC") != 0 || strcmp(tokens[1], "1") != 0) {
    sendError("BAD_FORMAT");
    return;
  }

  if (strcmp(tokens[2], "GET") == 0) {
    if (count != 4 || strcmp(tokens[3], "ALL") != 0) {
      sendError("BAD_GET");
      return;
    }
    sendAllStates();
    return;
  }

  if (strcmp(tokens[2], "SET") == 0) {
    uint8_t index = 0;
    if (count != 5 || !parseRelayNumber(tokens[3], index)) {
      sendError("BAD_RELAY");
      return;
    }
    bool on;
    if (strcmp(tokens[4], "ON") == 0) on = true;
    else if (strcmp(tokens[4], "OFF") == 0) on = false;
    else {
      sendError("BAD_STATE");
      return;
    }
    writeRelay(index, on);
    cosmicBt.print(F("COSMIC,1,ACK,"));
    cosmicBt.print(index + 1);
    cosmicBt.print(',');
    cosmicBt.print(on ? F("ON") : F("OFF"));
    cosmicBt.print('\n');
    sendState(index);
    return;
  }
  sendError("UNKNOWN_COMMAND");
}

void setup() {
  // Preload the OFF level before enabling output drivers to reduce boot glitches.
  for (uint8_t i = 0; i < 8; ++i) {
    digitalWrite(RELAY_PINS[i], outputLevel(false));
    pinMode(RELAY_PINS[i], OUTPUT);
    relayState[i] = false;
  }
  Serial.begin(SERIAL_BAUD);
  cosmicBt.begin(SERIAL_BAUD);
  Serial.println(F("COSMIC relay bridge ready; all channels OFF."));
  cosmicBt.print(F("COSMIC,1,READY,8\n"));
  sendAllStates();
}

void loop() {
  while (cosmicBt.available()) {
    char c = (char)cosmicBt.read();
    if (c == '\r') continue;
    if (c == '\n') {
      if (overflowed) sendError("LINE_TOO_LONG");
      else if (lineLength) {
        lineBuffer[lineLength] = '\0';
        handleLine(lineBuffer);
      }
      lineLength = 0;
      overflowed = false;
    } else if (!overflowed) {
      if (lineLength + 1 < LINE_CAPACITY) lineBuffer[lineLength++] = c;
      else overflowed = true;
    }
  }
}
