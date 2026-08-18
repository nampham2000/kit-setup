#!/usr/bin/env node
'use strict';

/**
 * Mermaid Diagram PNG Exporter
 *
 * Scans documentation & diagrams, renders each Mermaid diagram to high-resolution PNG,
 * and saves them into docs/diagrams/images/.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

function findProjectRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    const hasPackageJson = fs.existsSync(path.join(current, 'package.json'));
    const looksLikeCocosProject = fs.existsSync(path.join(current, 'assets'))
      || fs.existsSync(path.join(current, 'configs'));
    if (hasPackageJson && looksLikeCocosProject) return current;

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

const ROOT_DIR = process.env.PLAYABLE_PROJECT_ROOT
  ? path.resolve(process.env.PLAYABLE_PROJECT_ROOT)
  : (findProjectRoot(process.cwd()) || process.cwd());

const DIAGRAMS_DIR = path.join(ROOT_DIR, 'docs', 'diagrams');
const IMAGES_OUT_DIR = path.join(DIAGRAMS_DIR, 'images');

if (!fs.existsSync(IMAGES_OUT_DIR)) {
  fs.mkdirSync(IMAGES_OUT_DIR, { recursive: true });
}

// Predefined core project diagrams
const CORE_DIAGRAMS = [
  {
    name: '01_provider_rules_architecture.png',
    title: 'Quy ước đặt tên file chỉ dẫn theo từng Provider',
    code: `flowchart TD
    subgraph Providers ["Quy ước đặt tên file chỉ dẫn theo từng Provider"]
        A["GitHub Copilot / Cursor AI"] -->|"Quy ước chính thức"| A1[".github/copilot-instructions.md & .cursorrules"]
        B["Anthropic Claude"] -->|"Quy ước chính thức"| B1["CLAUDE.md"]
        C["Google Gemini / Antigravity"] -->|"Quy ước chính thức"| C1["GEMINI.md & .gemini/GEMINI.md"]
        D["OpenAI Codex / Universal Agents"] -->|"Quy ước chính thức"| D1["AGENTS.md"]
    end`
  },
  {
    name: '02_automated_verification_flow.png',
    title: 'Quy trình kiểm thử & tự động sửa lỗi',
    code: `flowchart TD
    A["Port Data / Scaffold Script / Edit Code"] --> B["Tự động chạy npm run ai:verify"]
    B --> C{"Kết quả kiểm thử"}
    C -->|"PASS"| D["Bàn giao / Hoàn tất task"]
    C -->|"FAIL"| E["Tự động phân tích lỗi & sửa code/config"]
    E --> B`
  },
  {
    name: '03_ai_lifecycle_stages.png',
    title: '7 Giai đoạn Vòng đời AI trong Phát triển Playable Ads',
    code: `flowchart TD
    subgraph Plan ["1. Plan & Onboarding"]
        A1["PROJECT_MAP.json Generator\\n(npm run ai:map)"]
        A2["PLAN_TEMPLATE.md"]
        A3["PlayableConfigTypes.d.ts Generator\\n(Auto IntelliSense for Copilot/Cursor)"]
    end

    subgraph Implement ["2. Implement & Port"]
        B1["C# Script Scaffolder AST\\n(npm run port:script)"]
        B2["Prefab / Material / Shader Porter\\n(npm run port / npm run port:smart)"]
        B3["Zero-Scene-Tweak JSON Config\\n(PlayableConfigManager)"]
    end

    subgraph Verify ["3. Verify & QA"]
        C1["Zero-GC Linter\\n(npm run lint:gc / npm run ai:lint)"]
        C2["Headless Verification Suite\\n(npm run verify / npm run ai:verify)"]
    end

    subgraph Polish ["4. Polish, Debug & Memory"]
        D1["Scene ASCII Tree Inspector\\n(npm run ai:scene)"]
        D2["Work Memory SQLite Flywheel\\n(npm run memory:query / memory:stats)"]
        D3["Multi-Provider Auto-Sync\\n(npm run ai:sync)"]
    end

    Plan --> Implement --> Verify --> Polish
    Polish -.->|"Tích lũy kinh nghiệm"| Plan`
  },
  {
    name: '04_smart_port_pipeline.png',
    title: 'Pipeline Porting Toàn diện từ Unity sang Cocos 3.8',
    code: `flowchart LR
    A["Unity Project Source\\n(.prefab, .mat, .cs, .shader)"] --> B["Smart Port Engine\\n(npm run port:smart)"]
    
    B --> C1["Prefab Porter\\n(.prefab -> .prefab)"]
    B --> C2["Material / Texture\\n(.mat -> .mtl)"]
    B --> C3["C# AST Scaffolder\\n(.cs -> Cocos 3.8 TS)"]
    B --> C4["Shader Converter\\n(.shader -> .effect)"]
    
    C1 --> D["Headless Verifier (PASS/FAIL)"]
    C2 --> D
    C3 --> D
    C4 --> D`
  },
  {
    name: '05_claude_execution_flow.png',
    title: 'Luồng thực thi 4 bước chuẩn của Claude Code',
    code: `flowchart LR
    A["1. Read Map & Memory"] --> B["2. Plan & Automated Port"]
    B --> C["3. Scriptable JSON & TS"]
    C --> D["4. Mandatory Verification & Build"]`
  },
  {
    name: '06_physics_detection_strategy.png',
    title: 'Chiến lược tự động nhận diện & ánh xạ Physics',
    code: `flowchart TD
    Start["Quét Components Physics Unity"] --> Check3D{"Có 3D Physics?"}
    
    Check3D -- Yes --> HasComplex3D{"Có MeshCollider / Convex?"}
    HasComplex3D -- Yes --> Set3DPhysics["Thêm RigidBody + MeshCollider 3D\\n(builtin / cannon.js)"]
    HasComplex3D -- No --> SetSimple3D["Thêm BoxCollider / SphereCollider 3D"]
    
    Check3D -- No --> Check2D{"Có 2D Physics / Box2D?"}
    Check2D -- Yes --> Set2DPhysics["Thêm RigidBody2D + BoxCollider2D (Box2D)"]
    Check2D -- No --> SetKinematic["Giữ Transform Kinematic / Tween"]`
  },
  {
    name: '07_gimp_blender_asset_pipeline.png',
    title: 'Pipeline sinh Asset đồ họa qua GIMP & Blender MCP',
    code: `flowchart TD
    A["GIMP MCP: Design Face Texture 2D"] -->|Export PNG| B["Save Texture to assets/textures/"]
    B --> C["Blender MCP: Apply Texture to 3D Mesh"]
    C --> D["Blender MCP: Render Keyframes Idle / Dance / Jump"]
    D --> E["Cocos Creator: Import Sprite Frames / 3D Model"]`
  }
];

function fetchPngViaKroki(diagramCode) {
  return new Promise((resolve, reject) => {
    const postData = Buffer.from(diagramCode, 'utf8');
    const req = https.request('https://kroki.io/mermaid/png', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': postData.length
      },
      timeout: 15000
    }, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Kroki returned status ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Kroki request timed out'));
    });
    req.write(postData);
    req.end();
  });
}

function fetchPngViaMermaidInk(diagramCode) {
  return new Promise((resolve, reject) => {
    const base64 = Buffer.from(diagramCode, 'utf8').toString('base64');
    const url = `https://mermaid.ink/img/${base64}`;

    https.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Mermaid.ink returned status ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function renderDiagram(diagram) {
  const outPath = path.join(IMAGES_OUT_DIR, diagram.name);
  console.log(`==> Rendering [${diagram.name}] - ${diagram.title}...`);

  try {
    const buf = await fetchPngViaKroki(diagram.code);
    fs.writeFileSync(outPath, buf);
    console.log(`  [ok] Saved via Kroki: ${path.relative(ROOT_DIR, outPath)} (${Math.round(buf.length / 1024)} KB)`);
    return true;
  } catch (errKroki) {
    console.warn(`  [warn] Kroki failed (${errKroki.message}), falling back to Mermaid.ink...`);
    try {
      const buf = await fetchPngViaMermaidInk(diagram.code);
      fs.writeFileSync(outPath, buf);
      console.log(`  [ok] Saved via Mermaid.ink: ${path.relative(ROOT_DIR, outPath)} (${Math.round(buf.length / 1024)} KB)`);
      return true;
    } catch (errInk) {
      console.error(`  [error] Failed to render diagram ${diagram.name}: ${errInk.message}`);
      return false;
    }
  }
}

async function main() {
  console.log('======================================================');
  console.log(' Playable Framework - Mermaid Diagram PNG Exporter ');
  console.log('======================================================\n');

  let successCount = 0;
  for (const diag of CORE_DIAGRAMS) {
    const success = await renderDiagram(diag);
    if (success) successCount++;
  }

  console.log(`\n======================================================`);
  console.log(` Export Finished: ${successCount}/${CORE_DIAGRAMS.length} diagrams rendered to PNG.`);
  console.log(` Output Directory: ${path.relative(ROOT_DIR, IMAGES_OUT_DIR)}`);
  console.log(`======================================================\n`);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { renderDiagram, CORE_DIAGRAMS };
