#!/bin/sh

cd "/public/Cosmic AI" || exit 1

mkdir -p runtime

# Configure server
export COSMIC_HOST=127.0.0.1
export COSMIC_PORT=8059

# Check whether backend is already running
if [ -f runtime/backend.pid ]; then
    OLD_PID=$(cat runtime/backend.pid)
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "COSMIC backend is already running."
        exit 0
    fi
fi

# Start backend in background
nohup python3 -m backend.app \
    > runtime/backend.log 2>&1 < /dev/null &

PID=$!
echo "$PID" > runtime/backend.pid

sleep 3

# Verify process
if kill -0 "$PID" 2>/dev/null; then
    echo "COSMIC AI BACKEND STARTED"
    echo "PID: $PID"
    echo "SERVER: http://127.0.0.1:8059"
    echo "LOG: runtime/backend.log"
else
    echo "BACKEND FAILED TO START"
    tail -40 runtime/backend.log
fi
