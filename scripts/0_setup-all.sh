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

echo "==> Setting up Cocos Playable Framework on macOS / Linux..."

# 1) Sync root script if needed
if [ "$SCRIPT_DIR" != "$ROOT" ] && [ -f "$SHARED_KIT/scripts/0_setup-all.sh" ]; then
    cp "$SHARED_KIT/scripts/0_setup-all.sh" "$ROOT/0_setup-all.sh"
    chmod +x "$ROOT/0_setup-all.sh"
    echo "[ok] root 0_setup-all.sh"
fi
if [ -f "$SHARED_KIT/scripts/1_open-project.sh" ]; then
    cp "$SHARED_KIT/scripts/1_open-project.sh" "$ROOT/1_open-project.sh"
    chmod +x "$ROOT/1_open-project.sh"
    echo "[ok] root 1_open-project.sh"
fi

# 2) Apply template config
if [ -d "$SHARED_KIT/template-config" ]; then
    echo "==> Applying shared template config"
    mkdir -p "$ROOT/profiles" "$ROOT/settings" "$ROOT/.vscode"
    cp -Rn "$SHARED_KIT/template-config/profiles/"* "$ROOT/profiles/" 2>/dev/null || true
    cp -Rn "$SHARED_KIT/template-config/settings/"* "$ROOT/settings/" 2>/dev/null || true
    cp -Rn "$SHARED_KIT/template-config/.vscode/"* "$ROOT/.vscode/" 2>/dev/null || true
    if [ ! -f "$ROOT/.gitignore" ] && [ -f "$SHARED_KIT/template-config/.gitignore" ]; then
        cp "$SHARED_KIT/template-config/.gitignore" "$ROOT/.gitignore"
    fi
    if [ ! -f "$ROOT/tsconfig.json" ] && [ -f "$SHARED_KIT/template-config/tsconfig_TEMPLATE.json" ]; then
        cp "$SHARED_KIT/template-config/tsconfig_TEMPLATE.json" "$ROOT/tsconfig.json"
    fi
    if [ ! -f "$SHARED_KIT/tools/playable-build/playable-cli.config.cjs" ] && [ -f "$SHARED_KIT/template-config/playable-cli.config_TEMPLATE.cjs" ]; then
        cp "$SHARED_KIT/template-config/playable-cli.config_TEMPLATE.cjs" "$SHARED_KIT/tools/playable-build/playable-cli.config.cjs"
    fi
    echo "[ok] template config applied"
fi

# 3) Ensure shared-kit dependencies
echo "==> Ensuring root dependencies: playable-sdk, playable-core"
node -e "const fs=require('fs'),path=require('path');const file=path.join(process.argv[1],'package.json');const raw=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');const pkg=JSON.parse(raw);pkg.dependencies={...(pkg.dependencies||{}),'playable-sdk':'file:./playable-shared-kit/packages/playable-sdk','playable-core':'file:./playable-shared-kit/packages/playable-core'};fs.writeFileSync(file,JSON.stringify(pkg,null,2)+'\n');" "$ROOT"

# 4) Install root packages
echo "==> Installing root npm packages..."
(cd "$ROOT" && npm install)

# 5) Install extensions packages
if [ -d "$ROOT/extensions" ]; then
    for ext_dir in "$ROOT/extensions"/*; do
        if [ -d "$ext_dir" ] && [ -f "$ext_dir/package.json" ]; then
            echo "==> Installing extension: $(basename "$ext_dir")"
            (cd "$ext_dir" && npm install)
        fi
    done
fi

# 6) Initialize Work-Memory SQLite database
if [ -f "$SHARED_KIT/tools/work-memory.cjs" ]; then
    echo "==> Initializing Work-Memory SQLite database..."
    node "$SHARED_KIT/tools/work-memory.cjs" init --repo-root "$ROOT" || true
    echo "[ok] work-memory initialized"
fi

# 7) Sync MCP clients if PowerShell Core is present
if command -v pwsh >/dev/null 2>&1; then
    if [ -f "$SHARED_KIT/tools/mcp-clients-sync.ps1" ]; then
        echo "==> Syncing MCP servers to AI clients (Claude, Antigravity, Copilot, Codex)..."
        pwsh -NoProfile -ExecutionPolicy Bypass -File "$SHARED_KIT/tools/mcp-clients-sync.ps1" -ProjectDir "$ROOT" || true
        echo "[ok] MCP clients synced"
    fi
else
    echo "[note] pwsh (PowerShell Core) not found. To auto-sync MCP config files on macOS, run: brew install --cask powershell"
fi

echo ""
echo "All packages and MCP configurations installed successfully on macOS / Linux."
