#!/bin/sh
cd "/public/Cosmic AI" || exit 1

export COSMIC_HOST=127.0.0.1
export COSMIC_PORT=8160

echo "Starting COSMIC on port 8160..."

if curl -fsS --max-time 2 http://127.0.0.1:8160/api/health >/dev/null 2>&1; then
    echo "COSMIC is already running on 8160."
else
    python3 - <<'PY'
import socket
s = socket.socket()
try:
    s.bind(("127.0.0.1", 8160))
    print("Port 8160 is available.")
except OSError as e:
    print("Port 8160 unavailable:", e)
    raise SystemExit(1)
finally:
    s.close()
PY

    if [ $? -ne 0 ]; then
        echo "Startup cancelled."
    else
        nohup python3 -m backend.app \
          </dev/null > runtime/backend-8160.log 2>&1 &

        echo $! > runtime/backend-8160.pid
    fi
fi

i=0
while [ "$i" -lt 12 ]; do
    if curl -fsS --max-time 2 http://127.0.0.1:8160/api/health; then
        echo
        echo "COSMIC SERVER RUNNING"
        echo "OPEN: http://127.0.0.1:8160"
        exit 0
    fi
    sleep 1
    i=$((i+1))
done

echo "Startup failed. Log:"
tail -30 runtime/backend-8160.log
