#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR"
SHARED_KIT="$ROOT/playable-shared-kit"

if [ ! -f "$SHARED_KIT/scripts/0_setup-all.sh" ]; then
    SHARED_KIT="$(cd "$SCRIPT_DIR/.." && pwd)"
    if [ -f "$SHARED_KIT/scripts/0_setup-all.sh" ]; then
        ROOT="$(cd "$SHARED_KIT/.." && pwd)"
    fi
fi

if [ ! -f "$ROOT/package.json" ]; then
    echo "[ERROR] Could not locate game project root from $SCRIPT_DIR."
    exit 1
fi

if [ ! -d "$SHARED_KIT" ]; then
    echo "[ERROR] playable-shared-kit folder not found under $ROOT."
    exit 1
fi

exec node "$SHARED_KIT/tools/setup-project.cjs" "$ROOT"
