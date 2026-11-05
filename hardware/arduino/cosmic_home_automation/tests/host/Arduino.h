#pragma once
#include <stdint.h>
#include <stddef.h>
#define HIGH 1
#define LOW 0
#define OUTPUT 1
#define F(value) value
extern int cosmicTestPinLevels[20];
extern int cosmicTestPinModes[20];
inline void digitalWrite(uint8_t pin, int value) { cosmicTestPinLevels[pin] = value; }
inline void pinMode(uint8_t pin, int mode) { cosmicTestPinModes[pin] = mode; }
struct CosmicTestSerial {
    void begin(unsigned long) {}
    void println(const char*) {}
};
extern CosmicTestSerial Serial;
