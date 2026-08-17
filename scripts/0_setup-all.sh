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
    if [ -f "$SHARED_KIT/template-config/.gitignore" ]; then
        node -e "const fs=require('fs'),path=require('path');const targetPath=process.argv[1],tmplPath=process.argv[2];if(!fs.existsSync(targetPath)){fs.copyFileSync(tmplPath,targetPath);console.log('[ok] .gitignore created from template');process.exit(0);}const parseLines=c=>c.split(/\r?\n/).map(l=>l.trim()).filter(l=>l&&!l.startsWith('#'));const targetRaw=fs.readFileSync(targetPath,'utf8');const targetLines=new Set(parseLines(targetRaw));const tmplRaw=fs.readFileSync(tmplPath,'utf8');const missingRules=[];for(const line of tmplRaw.split(/\r?\n/)){const trimmed=line.trim();if(trimmed&&!trimmed.startsWith('#')&&!targetLines.has(trimmed)){missingRules.push(trimmed);}}if(missingRules.length>0){const sep=targetRaw.endsWith('\n')?'\n':'\n\n';fs.appendFileSync(targetPath,sep+'# Added by playable-shared-kit setup\n'+missingRules.join('\n')+'\n');console.log('[ok] .gitignore updated ('+missingRules.length+' missing rules added)');}else{console.log('[ok] .gitignore is up to date');}" "$ROOT/.gitignore" "$SHARED_KIT/template-config/.gitignore"
    fi
    if [ ! -f "$ROOT/tsconfig.json" ] && [ -f "$SHARED_KIT/template-config/tsconfig_TEMPLATE.json" ]; then
        cp "$SHARED_KIT/template-config/tsconfig_TEMPLATE.json" "$ROOT/tsconfig.json"
    fi
    if [ ! -f "$SHARED_KIT/tools/playable-build/playable-cli.config.cjs" ] && [ -f "$SHARED_KIT/template-config/playable-cli.config_TEMPLATE.cjs" ]; then
        cp "$SHARED_KIT/template-config/playable-cli.config_TEMPLATE.cjs" "$SHARED_KIT/tools/playable-build/playable-cli.config.cjs"
    fi
    echo "[ok] template config applied"
fi

# 2.5) Ensure system runtimes and MCP dependencies
if [ -f "$SHARED_KIT/tools/ensure-dependencies.cjs" ]; then
    echo "==> Verifying system runtimes and dependencies..."
    node "$SHARED_KIT/tools/ensure-dependencies.cjs" || true
fi

# 3) Ensure shared-kit dependencies & scripts
echo "==> Ensuring root dependencies: playable-sdk, playable-core, @modelcontextprotocol/sdk & scripts"
node -e "const fs=require('fs'),path=require('path');const root=process.argv[1],sharedKit=process.argv[2];const file=path.join(root,'package.json');const raw=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');const pkg=JSON.parse(raw);pkg.dependencies={...(pkg.dependencies||{}),'playable-sdk':'file:./playable-shared-kit/packages/playable-sdk','playable-core':'file:./playable-shared-kit/packages/playable-core','@modelcontextprotocol/sdk':pkg.dependencies?.['@modelcontextprotocol/sdk']||'^1.29.0'};const tmplFile=path.join(sharedKit,'template-config','package.scripts_TEMPLATE.json');if(fs.existsSync(tmplFile)){const tmpl=JSON.parse(fs.readFileSync(tmplFile,'utf8').replace(/^\uFEFF/,''));if(tmpl.scripts)pkg.scripts={...(tmpl.scripts||{}),...(pkg.scripts||{})};if(tmpl.devDependencies)pkg.devDependencies={...(tmpl.devDependencies||{}),...(pkg.devDependencies||{})};}fs.writeFileSync(file,JSON.stringify(pkg,null,2)+'\n');" "$ROOT" "$SHARED_KIT"

# 4) Install root packages
echo "==> Installing root npm packages..."
(cd "$ROOT" && npm install)

# 4.5) Sync shared kit extensions
if [ -d "$SHARED_KIT/packages/extensions" ]; then
    echo "==> Syncing editor extensions from shared kit..."
    mkdir -p "$ROOT/extensions"
    for ext_src in "$SHARED_KIT/packages/extensions"/*; do
        if [ -d "$ext_src" ]; then
            ext_name="$(basename "$ext_src")"
            mkdir -p "$ROOT/extensions/$ext_name"
            cp -Rn "$ext_src/"* "$ROOT/extensions/$ext_name/" 2>/dev/null || true
            echo "[ok] extension: $ext_name"
        fi
    done
fi

# 5) Install extensions packages
if [ -d "$ROOT/extensions" ]; then
    for ext_dir in "$ROOT/extensions"/*; do
        if [ -d "$ext_dir" ] && [ -f "$ext_dir/package.json" ]; then
            echo "==> Installing extension: $(basename "$ext_dir")"
            (cd "$ext_dir" && npm install)
        fi
    done
fi

# 6) Synchronize Work-Memory knowledge database from Git
if [ -f "$SHARED_KIT/tools/work-memory.cjs" ]; then
    echo "==> Synchronizing Work-Memory knowledge database from Git..."
    node "$SHARED_KIT/tools/work-memory.cjs" sync --repo-root "$ROOT" || true
    echo "[ok] work-memory synchronized"
fi

# 7) Deploy AI knowledge & skills pack
if [ -f "$SHARED_KIT/tools/ai-knowledge-sync.cjs" ]; then
    echo "==> Deploying AI Provider Knowledge & Skills..."
    node "$SHARED_KIT/tools/ai-knowledge-sync.cjs" || true
fi

# 8) Sync MCP clients if PowerShell Core is present
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
