#!/bin/sh
cd "/public/Cosmic AI" || exit 1
mkdir -p runtime
LOG="runtime/cosmic-watchdog.log"

echo "COSMIC monitor started: $(date)" >> "$LOG"

while true; do
    if curl -fsS --max-time 5 http://127.0.0.1:8059/api/health >/dev/null 2>&1; then
        sleep 15
        continue
    fi

    echo "COSMIC health check failed: $(date)" >> "$LOG"

    COSMIC_HOST=127.0.0.1 COSMIC_PORT=8059 \
        python3 -m backend.app >> "$LOG" 2>&1 &

    SERVER_PID=$!
    echo "Started server attempt PID $SERVER_PID" >> "$LOG"
    wait "$SERVER_PID"

    echo "Server attempt exited: $(date)" >> "$LOG"
    sleep 5
done
