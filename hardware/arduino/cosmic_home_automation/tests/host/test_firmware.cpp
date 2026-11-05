#include <cassert>
#include <iostream>
#include <string>
#include "Arduino.h"
#include "SoftwareSerial.h"
int cosmicTestPinLevels[20] = {};
int cosmicTestPinModes[20] = {};
CosmicTestSerial Serial;
#include "../../cosmic_home_automation.ino"
int main() {
    setup();
    for (int pin = 2; pin <= 9; ++pin) {
        assert(cosmicTestPinModes[pin] == OUTPUT);
        assert(cosmicTestPinLevels[pin] == HIGH);
    }
    assert(cosmicBt.output.find("COSMIC,1,READY,8\n") != std::string::npos);
    assert(cosmicBt.output.find("COSMIC,1,END\n") != std::string::npos);
    cosmicBt.output.clear();
    cosmicBt.feed("COSMIC,1,SET,2,ON\n");
    loop();
    assert(relayState[1] && cosmicTestPinLevels[3] == LOW);
    assert(cosmicBt.output.find("COSMIC,1,ACK,2,ON\n") != std::string::npos);
    assert(cosmicBt.output.find("COSMIC,1,STATE,2,ON\n") != std::string::npos);
    cosmicBt.output.clear();
    cosmicBt.feed("COSMIC,1,SET,9,ON\n");
    loop();
    assert(cosmicBt.output.find("COSMIC,1,ERR,BAD_RELAY\n") != std::string::npos);
    assert(relayState[1] && cosmicTestPinLevels[3] == LOW);
    cosmicBt.output.clear();
    cosmicBt.feed("COSMIC,1,SET,2,OFF\n");
    loop();
    assert(!relayState[1] && cosmicTestPinLevels[3] == HIGH);
    assert(cosmicBt.output.find("COSMIC,1,STATE,2,OFF\n") != std::string::npos);
    cosmicBt.output.clear();
    cosmicBt.feed("COSMIC,1,GET,ALL\n");
    loop();
    assert(cosmicBt.output.find("COSMIC,1,STATE,2,OFF\n") != std::string::npos);
    assert(cosmicBt.output.find("COSMIC,1,END\n") != std::string::npos);
    cosmicBt.output.clear();
    cosmicBt.feed("BROKEN,1,SET,1,ON\n");
    loop();
    assert(cosmicBt.output.find("COSMIC,1,ERR,BAD_FORMAT\n") != std::string::npos);

    cosmicBt.output.clear();
    cosmicBt.feed("COSMIC,1,GET,1\n");
    loop();
    assert(cosmicBt.output.find("COSMIC,1,ERR,BAD_GET\n") != std::string::npos);

    cosmicBt.output.clear();
    cosmicBt.feed("COSMIC,1,SET,3,TOGGLE\n");
    loop();
    assert(cosmicBt.output.find("COSMIC,1,ERR,BAD_STATE\n") != std::string::npos);
    assert(!relayState[2]);

    cosmicBt.output.clear();
    cosmicBt.feed("COSMIC,1,REBOOT\n");
    loop();
    assert(cosmicBt.output.find("COSMIC,1,ERR,UNKNOWN_COMMAND\n") != std::string::npos);

    cosmicBt.output.clear();
    cosmicBt.feed("COSMIC,1,SET,3,ON,EXTRA\n");
    loop();
    assert(cosmicBt.output.find("COSMIC,1,ERR,BAD_RELAY\n") != std::string::npos);
    assert(!relayState[2]);

    cosmicBt.output.clear();
    cosmicBt.feed(std::string(100, 'X') + "\n");
    loop();
    assert(cosmicBt.output.find("COSMIC,1,ERR,LINE_TOO_LONG\n") != std::string::npos);
    std::cout << "COSMIC relay firmware host tests: PASS\n";
    return 0;
}
