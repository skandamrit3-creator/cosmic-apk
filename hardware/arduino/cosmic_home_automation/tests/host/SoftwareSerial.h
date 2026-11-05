#pragma once
#include <stdint.h>
#include <string>
#include <deque>
class SoftwareSerial {
public:
    std::deque<char> input;
    std::string output;
    SoftwareSerial(uint8_t, uint8_t) {}
    void begin(unsigned long) {}
    int available() { return static_cast<int>(input.size()); }
    int read() {
        if (input.empty()) return -1;
        const char value = input.front();
        input.pop_front();
        return static_cast<unsigned char>(value);
    }
    void print(const char* value) { output += value; }
    void print(char value) { output += value; }
    void print(int value) { output += std::to_string(value); }
    void println(const char* value) { output += value; output += "\r\n"; }
    void feed(const std::string& value) {
        for (char c : value) input.push_back(c);
    }
};
