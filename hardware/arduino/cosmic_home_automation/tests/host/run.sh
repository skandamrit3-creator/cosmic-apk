#!/bin/sh
set -eu
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
OUTPUT="${TMPDIR:-/tmp}/cosmic-home-automation-host-test"
g++ -std=gnu++11 -Wall -Wextra -I"$SCRIPT_DIR" "$SCRIPT_DIR/test_firmware.cpp" -o "$OUTPUT"
"$OUTPUT"
