#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR"
SHARED_KIT="$ROOT/playable-shared-kit"

if [ ! -f "$SHARED_KIT/scripts/1_open-project.sh" ]; then
    SHARED_KIT="$(cd "$SCRIPT_DIR/.." && pwd)"
    if [ -f "$SHARED_KIT/scripts/1_open-project.sh" ]; then
        ROOT="$(cd "$SHARED_KIT/.." && pwd)"
    fi
fi

if [ ! -f "$ROOT/package.json" ]; then
    echo "[ERROR] Could not locate game project root from $SCRIPT_DIR."
    exit 1
fi

COCOS_MCP_PORT=3000
BLENDER_MCP_PORT=9876
GIMP_MCP_PORT=9877

# 1) Locate Cocos Creator 3.8.8 on macOS / Linux
COCOS_CANDIDATES=(
    "/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator"
    "/Applications/CocosCreator.app/Contents/MacOS/CocosCreator"
    "/Applications/Cocos/Creator/3.8.8/CocosCreator.app"
    "$HOME/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator"
)

COCOS_BIN=""
for candidate in "${COCOS_CANDIDATES[@]}"; do
    if [ -f "$candidate" ] || [ -d "$candidate" ]; then
        COCOS_BIN="$candidate"
        break
    fi
done

# 2) Warm up work-memory
if [ -f "$SHARED_KIT/tools/work-memory.cjs" ]; then
    echo "  [mcp] Initializing / warming up work-memory cache..."
    node "$SHARED_KIT/tools/work-memory.cjs" init --repo-root "$ROOT" >/dev/null 2>&1 || true
fi

# 3) Sync MCP configurations
if command -v pwsh >/dev/null 2>&1 && [ -f "$SHARED_KIT/tools/mcp-clients-sync.ps1" ]; then
    echo "==> Syncing MCP configurations..."
    pwsh -NoProfile -ExecutionPolicy Bypass -File "$SHARED_KIT/tools/mcp-clients-sync.ps1" -ProjectDir "$ROOT" || true
fi

# 4) Launch Cocos Creator
if [ -n "$COCOS_BIN" ]; then
    echo "==> Launching Cocos Creator 3.8.8..."
    if [[ "$COCOS_BIN" == *.app ]]; then
        open -a "$COCOS_BIN" --args --project "$ROOT" &
    else
        "$COCOS_BIN" --project "$ROOT" >/dev/null 2>&1 &
    fi
else
    echo "  [warn] Cocos Creator 3.8.8 executable not found in default /Applications paths."
fi

# 5) Launch Blender if installed
BLENDER_BIN="/Applications/Blender.app/Contents/MacOS/Blender"
if [ -f "$BLENDER_BIN" ] && [ "${PLAYABLE_SKIP_MCP_BACKENDS:-0}" != "1" ]; then
    echo "==> Starting Blender for blender-mcp (port $BLENDER_MCP_PORT)..."
    "$BLENDER_BIN" >/dev/null 2>&1 &
fi

# 6) Launch GIMP if installed
GIMP_BIN="/Applications/GIMP.app/Contents/MacOS/gimp"
if [ ! -f "$GIMP_BIN" ]; then
    GIMP_BIN="/Applications/GIMP-3.app/Contents/MacOS/gimp"
fi
if [ -f "$GIMP_BIN" ] && [ "${PLAYABLE_SKIP_MCP_BACKENDS:-0}" != "1" ]; then
    echo "==> Starting GIMP for gimp-mcp (port $GIMP_MCP_PORT)..."
    "$GIMP_BIN" --batch-interpreter=plug-in-script-fu-eval -b '(plug-in-mcp-server RUN-NONINTERACTIVE)' >/dev/null 2>&1 &
fi

# 7) Open VS Code
if command -v code >/dev/null 2>&1; then
    echo "==> Opening VS Code..."
    code "$ROOT"
elif [ -d "/Applications/Visual Studio Code.app" ]; then
    echo "==> Opening Visual Studio Code.app..."
    open -a "/Applications/Visual Studio Code.app" "$ROOT"
fi

echo ""
echo "Done. Workspace and MCP servers launched."
