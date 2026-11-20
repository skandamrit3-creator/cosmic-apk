// COSMIC 8-channel HC-05 relay firmware (Arduino Uno)
// Relay pins D2-D9. This assumes ACTIVE-HIGH relay modules; invert logic if your module is active-low.
#include <SoftwareSerial.h>
SoftwareSerial bluetooth(10, 11); // Uno RX,TX: HC-05 TX->10; Uno 11->level-shifted HC-05 RX
const byte relayPins[8]={2,3,4,5,6,7,8,9};
bool state[8]={false,false,false,false,false,false,false,false};
void apply(byte i){digitalWrite(relayPins[i],state[i]?HIGH:LOW);}
void report(){bluetooth.print("STATE ");for(byte i=0;i<8;i++){bluetooth.print(state[i]?1:0);if(i<7)bluetooth.print(',');}bluetooth.println();}
void setup(){Serial.begin(9600);bluetooth.begin(9600);for(byte i=0;i<8;i++){pinMode(relayPins[i],OUTPUT);digitalWrite(relayPins[i],LOW);}bluetooth.println("COSMIC RELAY READY");report();}
void execute(String s){s.trim();s.toUpperCase();if(s=="STATUS"){report();return;}if(s=="ALL OFF"){for(byte i=0;i<8;i++){state[i]=false;apply(i);}report();return;}
if(s.length()<4||s.charAt(0)!='R')return;int n=s.substring(1,2).toInt();if(n<1||n>8)return;String cmd=s.substring(2);if(cmd==" ON")state[n-1]=true;else if(cmd==" OFF")state[n-1]=false;else if(cmd==" TOGGLE")state[n-1]=!state[n-1];else return;apply(n-1);bluetooth.print("OK R");bluetooth.print(n);bluetooth.print(state[n-1]?" ON":" OFF");bluetooth.println();report();}
void loop(){if(bluetooth.available()){String cmd=bluetooth.readStringUntil('\n');execute(cmd);}if(Serial.available()){bluetooth.println(Serial.readStringUntil('\n'));}}