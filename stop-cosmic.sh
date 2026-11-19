#!/bin/sh
cd "/public/Cosmic AI" || exit 1

PIDFILE="runtime/backend-8160.pid"

if [ ! -f "$PIDFILE" ]; then
    echo "No COSMIC PID file found."
    exit 0
fi

PID=$(cat "$PIDFILE")
case "$PID" in
    ''|*[!0-9]*) echo "Invalid PID. Refusing to stop."; exit 1 ;;
esac

if [ ! -r "/proc/$PID/cmdline" ]; then
    echo "Process not visible or already stopped."
    rm -f "$PIDFILE"
    exit 0
fi

CMD=$(tr '\000' ' ' < "/proc/$PID/cmdline")

case "$CMD" in
    *"backend.app"*)
        kill "$PID"
        sleep 2
        rm -f "$PIDFILE"
        echo "COSMIC stop signal sent."
        ;;
    *)
        echo "PID does not match backend.app. Refusing to kill."
        ;;
esac
