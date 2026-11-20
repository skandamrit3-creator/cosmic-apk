## COSMIC HC-05 + Arduino Uno + 8 relays

Relay outputs map R1=D2, R2=D3, R3=D4, R4=D5, R5=D6, R6=D7, R7=D8, R8=D9. Bluetooth SoftwareSerial uses Uno D10 (RX from HC-05 TX) and D11 (TX toward HC-05 RX through a voltage divider/level shifter). HC-05 RX is not 5 V tolerant. Power relay loads separately; use isolation and suitable fusing. Do not connect mains unless qualified and using enclosed, appropriately rated hardware.

Firmware command protocol, newline terminated: `R1 ON`, `R1 OFF`, `R1 TOGGLE` through R8; `ALL OFF`; `STATUS`. Firmware responds with acknowledgements and `STATE 0,1,...` state report. Verify relay module polarity and change output logic if active-low. Startup state is OFF.
