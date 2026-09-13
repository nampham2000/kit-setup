#!/usr/bin/env node
'use strict';

/**
 * Knowledge Distiller Tool
 *
 * Scans chat logs (transcripts), Work Memory SQLite/JSON, and Git diffs to extract
 * ultra-compact context digests (<1.5k tokens) and automatically render standardized
 * 5-layer daily learning tutorials with Unity vs Cocos comparisons, Mermaid diagrams,
 * and automatic Work Memory persistence.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

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

const SHARED_KIT_DIR = path.join(ROOT_DIR, 'playable-shared-kit');
const DOCS_DIR = path.join(ROOT_DIR, 'docs');
const TUTORIALS_DIR = path.join(DOCS_DIR, 'tutorials');
const DIAGRAMS_IMAGES_DIR = path.join(DOCS_DIR, 'diagrams', 'images');
const TUTORIALS_INDEX_FILE = path.join(TUTORIALS_DIR, 'TUTORIALS_INDEX.json');
const WORK_MEMORY_RECORDS_FILE = path.join(SHARED_KIT_DIR, 'ai', 'knowledge', 'work-memory-records.json');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  const options = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        options[key] = next;
        i++;
      } else {
        options[key] = true;
      }
    }
  }

  return { command, options };
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'tutorial';
}

function getFormattedDate() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// -----------------------------------------------------------------------------
// Kroki / Mermaid.ink Diagram Exporter
// -----------------------------------------------------------------------------
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

async function renderMermaidToPng(diagramCode, outPngPath) {
  ensureDir(path.dirname(outPngPath));
  try {
    const buf = await fetchPngViaKroki(diagramCode);
    fs.writeFileSync(outPngPath, buf);
    return true;
  } catch (errKroki) {
    try {
      const buf = await fetchPngViaMermaidInk(diagramCode);
      fs.writeFileSync(outPngPath, buf);
      return true;
    } catch (errInk) {
      console.warn(`  [warn] Diagram rendering failed (${errInk.message}). Diagram text preserved.`);
      return false;
    }
  }
}

// -----------------------------------------------------------------------------
// Extraction Engine: Scans transcripts, git diff, and work memory
// -----------------------------------------------------------------------------
function findLatestTranscriptFile() {
  const homeDir = process.env.USERPROFILE || process.env.HOME || '';
  const geminiBrainDir = path.join(homeDir, '.gemini', 'antigravity', 'brain');
  
  if (!fs.existsSync(geminiBrainDir)) return null;

  let latestFile = null;
  let latestMtime = 0;

  try {
    const convoDirs = fs.readdirSync(geminiBrainDir, { withFileTypes: true });
    for (const entry of convoDirs) {
      if (!entry.isDirectory()) continue;
      const transcriptPath = path.join(geminiBrainDir, entry.name, '.system_generated', 'logs', 'transcript.jsonl');
      if (fs.existsSync(transcriptPath)) {
        const stat = fs.statSync(transcriptPath);
        if (stat.mtimeMs > latestMtime) {
          latestMtime = stat.mtimeMs;
          latestFile = transcriptPath;
        }
      }
    }
  } catch (e) {
    // ignore
  }

  return latestFile;
}

function extractFromTranscript(transcriptPath, maxLines = 150) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return { extracted: [], workMemoryMarkers: [] };

  const raw = fs.readFileSync(transcriptPath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const recentLines = lines.slice(-maxLines);

  const extracted = [];
  const workMemoryMarkers = [];

  for (const line of recentLines) {
    try {
      const obj = JSON.parse(line);
      const text = obj.content || (obj.tool_calls ? JSON.stringify(obj.tool_calls) : '');

      // Check for WORK_MEMORY markers
      const markerRegex = /<!--\s*WORK_MEMORY:\s*([\s\S]*?)\s*-->/g;
      let match;
      while ((match = markerRegex.exec(text))) {
        try {
          const parsed = JSON.parse(match[1]);
          workMemoryMarkers.push(parsed);
        } catch {
          // ignore
        }
      }

      if (obj.type === 'USER_INPUT') {
        extracted.push({
          type: 'USER_INPUT',
          content: String(obj.content || '').slice(0, 300)
        });
      } else if (obj.tool_calls && Array.isArray(obj.tool_calls)) {
        for (const tc of obj.tool_calls) {
          const name = tc.name || (tc.function && tc.function.name) || '';
          if (['replace_file_content', 'write_to_file', 'run_command'].includes(name)) {
            const args = tc.args || (tc.function && tc.function.arguments) || {};
            const summary = args.CommandLine || args.TargetFile || args.Instruction || '';
            extracted.push({
              type: 'ACTION',
              tool: name,
              summary: String(summary).slice(0, 200)
            });
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return { extracted, workMemoryMarkers };
}

function getRecentGitDiff() {
  try {
    const diffStat = execSync('git diff HEAD~1 --stat', { cwd: ROOT_DIR, encoding: 'utf8', timeout: 5000 }).trim();
    const diffLog = execSync('git log -n 3 --oneline', { cwd: ROOT_DIR, encoding: 'utf8', timeout: 5000 }).trim();
    return { diffStat, diffLog };
  } catch {
    return { diffStat: '', diffLog: '' };
  }
}

function getRecentWorkMemories(limit = 6) {
  if (fs.existsSync(WORK_MEMORY_RECORDS_FILE)) {
    try {
      const records = JSON.parse(fs.readFileSync(WORK_MEMORY_RECORDS_FILE, 'utf8'));
      return Array.isArray(records) ? records.slice(-limit) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function runExtract(options = {}) {
  const transcriptPath = options.transcript || findLatestTranscriptFile();
  const transcriptData = extractFromTranscript(transcriptPath, 120);
  const gitData = getRecentGitDiff();
  const recentMemories = getRecentWorkMemories(5);

  const digest = {
    generatedAt: new Date().toISOString(),
    transcriptSource: transcriptPath ? path.basename(path.dirname(path.dirname(transcriptPath))) : null,
    recentUserInputs: transcriptData.extracted ? transcriptData.extracted.filter(e => e.type === 'USER_INPUT') : [],
    recentActions: transcriptData.extracted ? transcriptData.extracted.filter(e => e.type === 'ACTION') : [],
    discoveredWorkMemories: transcriptData.workMemoryMarkers || [],
    recentRepoMemories: recentMemories.map(m => ({
      category: m.category,
      title: m.title,
      summary: m.content ? m.content.slice(0, 150) : '',
      tags: m.tags
    })),
    gitSummary: gitData
  };

  const digestPath = path.join(TUTORIALS_DIR, '.last-digest.json');
  ensureDir(TUTORIALS_DIR);
  fs.writeFileSync(digestPath, JSON.stringify(digest, null, 2), 'utf8');

  if (options.json) {
    console.log(JSON.stringify(digest, null, 2));
  } else {
    console.log('\n======================================================');
    console.log(' Knowledge Distiller - Compact Digest Extracted');
    console.log('======================================================');
    console.log(`[Source Transcript]: ${digest.transcriptSource || 'Auto-detected'}`);
    console.log(`[Recent Inputs]: ${digest.recentUserInputs.length}`);
    console.log(`[Key Actions/Changes]: ${digest.recentActions.length}`);
    console.log(`[Work Memories]: ${digest.recentRepoMemories.length} repo + ${digest.discoveredWorkMemories.length} in-session`);
    console.log(`[Digest File Saved]: ${path.relative(ROOT_DIR, digestPath)}`);
    console.log('======================================================\n');
  }

  return digest;
}

// -----------------------------------------------------------------------------
// Render & Save Engine: Builds 5-Layer Markdown, Diagrams & Updates Index
// -----------------------------------------------------------------------------
async function runSaveTutorial(data, options = {}) {
  ensureDir(TUTORIALS_DIR);
  ensureDir(DIAGRAMS_IMAGES_DIR);

  const title = data.title || 'Untitled Tutorial';
  const category = (data.category || 'porting').toLowerCase();
  const tags = Array.isArray(data.tags) ? data.tags : (data.tags ? String(data.tags).split(',').map(t => t.trim()) : ['cocos3.8']);
  const slug = slugify(data.slug || title);
  const dateStr = getFormattedDate();

  const categoryDir = path.join(TUTORIALS_DIR, category);
  ensureDir(categoryDir);

  const mdFilename = `${dateStr}-${slug}.md`;
  const mdFilePath = path.join(categoryDir, mdFilename);
  const diagramFilename = `${dateStr}-${slug}.png`;
  const diagramImagePath = path.join(DIAGRAMS_IMAGES_DIR, diagramFilename);
  const relativeDiagramImagePath = `../diagrams/images/${diagramFilename}`;

  // 1. Render Diagram if provided
  let hasDiagramImage = false;
  if (data.mermaidDiagram && data.mermaidDiagram.trim()) {
    console.log(`==> Rendering Mermaid Diagram for [${slug}]...`);
    hasDiagramImage = await renderMermaidToPng(data.mermaidDiagram, diagramImagePath);
  }

  // 2. Build Standardized 5-Layer Markdown Document
  let md = `---
title: "${title.replace(/"/g, '\\"')}"
category: "${category}"
tags: [${tags.map(t => `"${t}"`).join(', ')}]
date: "${dateStr}"
author: "Antigravity AI Lead Engineer"
---

# ${title}

> [!NOTE]
> **Category**: \`${category.toUpperCase()}\` | **Tags**: ${tags.map(t => `\`#${t}\``).join(' ')} | **Date**: ${dateStr}

---

## 🎯 1. Tổng Quan & Vấn Đề (Core Concept & Challenge)
${data.objective || 'Mô tả bài toán, mục tiêu porting hoặc vấn đề kỹ thuật cần giải quyết.'}

---

## ⚖️ 2. Ma Trận So Sánh Input (Unity) vs Output (Cocos Creator 3.8)

| Tiêu Chí | Unity Input (C# / Shader / Inspector) | Cocos Creator 3.8 Output (TypeScript / JSON Config) | Ghi Chú Kỹ Thuật |
| :--- | :--- | :--- | :--- |
${(data.comparisonRows || [
  '| **Component/Class** | `MonoBehaviour` | `@ccclass(\'...\') Component` | Kế thừa từ `cc.Component` |',
  '| **Cấu hình** | `[SerializeField]` trên Scene | `playable-config.json` | Zero-Scene-Tweak pattern |',
  '| **Bộ nhớ & GC** | `new Vector3()` tự do | Static cached `Vec3` / Zero-GC | Tránh giật lag trên WebGL/Playable |'
]).join('\n')}

### 📝 Code Snippet Đối Chiếu Chi Tiết

#### 🔴 Unity C# (Input)
\`\`\`csharp
${data.unityCode || '// Unity C# Implementation\nvoid Start() {\n    // Unity code\n}'}
\`\`\`

#### 🟢 Cocos Creator 3.8 TypeScript (Output)
\`\`\`typescript
${data.cocosCode || '// Cocos Creator 3.8 TypeScript (Zero-GC compliant)\nimport { _decorator, Component, Vec3 } from \'cc\';\nconst { ccclass, property } = _decorator;\n\nconst _tempVec3 = new Vec3();\n\n@ccclass(\'GameComponent\')\nexport class GameComponent extends Component {\n    start() {\n        // Cocos code\n    }\n}'}
\`\`\`

---

## 📊 3. Sơ Đồ Kiến Trúc & Luồng Xử Lý (Visual Architecture)

\`\`\`mermaid
${data.mermaidDiagram || 'flowchart TD\n    A[Unity Input] --> B[Smart Porting / Scaffolder]\n    B --> C[Cocos Creator 3.8 Output]\n    C --> D[Headless Verifier & Zero-GC QA]'}
\`\`\`

${hasDiagramImage ? `\n![Sơ đồ kiến trúc](${relativeDiagramImagePath})\n` : ''}

---

## ⚠️ 4. Bẫy Tiềm Ẩn & Quy Tắc Hiệu Năng (Traps & Performance Rules)

> [!WARNING]
> **Các lỗi runtime thường gặp cần tránh tuyệt đối:**
${(data.traps || [
  '- **Zero-GC Violation**: Không khởi tạo `new Vec3()` hoặc `new Quat()` trong hàm `update(dt)`.',
  '- **3D Node Touch Trap**: Không gắn `Node.EventType.TOUCH_START` trực tiếp trên Node 3D (dễ crash cameraPriority null). Dùng Raycast toàn cục.',
  '- **Mobile Web Audio**: Luôn kích hoạt mở khóa AudioContext sau cú chạm đầu tiên.'
]).map(t => t.startsWith('-') ? t : `- ${t}`).join('\n')}

---

## 💡 5. Đúc Kết Bài Học Nhanh (Daily Actionable Takeaways)

> [!TIP]
> **3 Điểm Cốt Lõi Cần Nhớ:**
${(data.takeaways || [
  '1. Luôn ưu tiên cấu hình qua Scriptable JSON (`playable-config.json`) thay vì chỉnh tay trên Scene.',
  '2. Tận dụng math types từ `cc` với biến static tạm để đảm bảo 60fps mượt mà trên mobile.',
  '3. Luôn chạy `npm run ai:verify` ngay sau khi code để phát hiện lỗi TypeScript và meta.'
]).map(t => (/^\d+\./.test(t) || t.startsWith('-')) ? t : `- ${t}`).join('\n')}
`;

  fs.writeFileSync(mdFilePath, md, 'utf8');
  console.log(`  [ok] Created Tutorial Markdown: ${path.relative(ROOT_DIR, mdFilePath)}`);

  // 3. Update Index Registry
  let index = [];
  if (fs.existsSync(TUTORIALS_INDEX_FILE)) {
    try {
      index = JSON.parse(fs.readFileSync(TUTORIALS_INDEX_FILE, 'utf8'));
    } catch {
      index = [];
    }
  }

  const existingIdx = index.findIndex(item => item.slug === slug);
  const entry = {
    title,
    slug,
    category,
    tags,
    date: dateStr,
    path: path.relative(ROOT_DIR, mdFilePath).replace(/\\/g, '/'),
    diagramImage: hasDiagramImage ? path.relative(ROOT_DIR, diagramImagePath).replace(/\\/g, '/') : null,
    summary: data.objective ? data.objective.slice(0, 180) : ''
  };

  if (existingIdx >= 0) {
    index[existingIdx] = entry;
  } else {
    index.unshift(entry);
  }

  fs.writeFileSync(TUTORIALS_INDEX_FILE, JSON.stringify(index, null, 2), 'utf8');
  console.log(`  [ok] Updated Tutorials Index: ${path.relative(ROOT_DIR, TUTORIALS_INDEX_FILE)} (${index.length} total)`);

  // 4. Upsert into Work Memory (Flywheel effect)
  if (data.workMemoryPayload) {
    try {
      const mem = {
        scope: data.workMemoryPayload.scope || 'global',
        category: data.workMemoryPayload.category || 'tip',
        title: data.workMemoryPayload.title || title,
        content: data.workMemoryPayload.content || data.objective,
        tags: tags
      };
      const workMemoryCli = path.join(SHARED_KIT_DIR, 'tools', 'work-memory.cjs');
      if (fs.existsSync(workMemoryCli)) {
        execSync(`node "${workMemoryCli}" remember-auto --memory "${JSON.stringify(mem).replace(/"/g, '\\"')}"`, {
          cwd: ROOT_DIR,
          stdio: 'ignore'
        });
        console.log(`  [ok] Persisted lesson to Work Memory SQLite & cache.`);
      }
    } catch (e) {
      // ignore
    }
  }

  return {
    success: true,
    mdPath: mdFilePath,
    entry
  };
}

// -----------------------------------------------------------------------------
// Reference Seed Generator for Testing & Initial Setup
// -----------------------------------------------------------------------------
async function runTestRender() {
  console.log('\n==> Generating Seed Reference Tutorial (Unity Physics to Cocos 3.8 Zero-GC)...');
  
  const sampleData = {
    title: 'Porting Unity Physics & Rigidbody Sang Cocos Creator 3.8 (Zero-GC & Scriptable Config)',
    slug: 'unity-physics-to-cocos-38-zero-gc',
    category: 'physics',
    tags: ['unity', 'cocos3.8', 'physics', 'rigidbody', 'zero-gc', 'porting'],
    objective: 'Cách chuyển đổi logic điều khiển vật lý (Rigidbody, AddForce, Velocity, Collision Events) từ Unity C# sang Cocos Creator 3.8.8+ TypeScript, tối ưu hóa Zero-GC trong vòng lặp vật lý và liên kết thông số lực qua JSON Config.',
    comparisonRows: [
      '| **Rigidbody Component** | `Rigidbody` (3D) | `RigidBody` (3D từ `cc`) | Cần cấu hình đúng Physics Engine (`builtin` hoặc `cannon.js`) |',
      '| **Lực đẩy / Impulse** | `rb.AddForce(direction * force, ForceMode.Impulse)` | `this._rb.applyImpulse(direction)` | Cocos dùng `applyImpulse` hoặc `applyForce` |',
      '| **Vận tốc tuyến tính** | `rb.velocity` | `this._rb.getLinearVelocity(outVec3)` | **Zero-GC Trap**: Không dùng getter tạo mới vector |',
      '| **Sự kiện va chạm** | `void OnCollisionEnter(Collision col)` | `collider.on(\'onCollisionEnter\', this.onCollide, this)` | Phải đăng ký listener trên `Collider` trong `start()` |',
      '| **Thông số vật lý** | Inspector `[SerializeField] float jumpForce;` | `PlayableConfigManager.instance.get(\'physics.jumpForce\', 10)` | Zero-Scene-Tweak kiến trúc |'
    ],
    unityCode: `using UnityEngine;

public class PlayerBallController : MonoBehaviour {
    [SerializeField] private float jumpForce = 8f;
    private Rigidbody rb;

    void Awake() {
        rb = GetComponent<Rigidbody>();
    }

    public void Jump() {
        rb.AddForce(Vector3.up * jumpForce, ForceMode.Impulse);
    }

    void OnCollisionEnter(Collision collision) {
        if (collision.gameObject.CompareTag("Obstacle")) {
            Debug.Log("Hit obstacle!");
        }
    }
}`,
    cocosCode: `import { _decorator, Component, Node, RigidBody, Vec3, Collider, ICollisionEvent } from 'cc';
import { PlayableConfigManager } from 'playable-core/config/PlayableConfigManager';
const { ccclass, property } = _decorator;

// Static pre-allocated vector to guarantee ZERO Garbage Collection
const _tempJumpImpulse = new Vec3();

@ccclass('PlayerBallController')
export class PlayerBallController extends Component {
    private _rb: RigidBody | null = null;
    private _collider: Collider | null = null;

    start() {
        this._rb = this.getComponent(RigidBody);
        this._collider = this.getComponent(Collider);

        if (this._collider) {
            this._collider.on('onCollisionEnter', this._onCollisionEnter, this);
        }
    }

    public jump(): void {
        if (!this._rb) return;
        const jumpForce = PlayableConfigManager.instance.get<number>('physics.jumpForce', 8);
        
        // Zero-GC: Reuse cached vector
        Vec3.set(_tempJumpImpulse, 0, jumpForce, 0);
        this._rb.applyImpulse(_tempJumpImpulse);
    }

    private _onCollisionEnter(event: ICollisionEvent): void {
        const otherNode = event.otherCollider.node;
        if (otherNode.name.includes('Obstacle')) {
            console.log('[Game] Hit obstacle!');
        }
    }

    onDestroy() {
        if (this._collider) {
            this._collider.off('onCollisionEnter', this._onCollisionEnter, this);
        }
    }
}`,
    mermaidDiagram: `flowchart TD
    subgraph UnityInput ["1. Unity Input"]
        A["Rigidbody.AddForce(Vector3.up * force)"]
        B["OnCollisionEnter Callback"]
        C["Inspector [SerializeField] Params"]
    end

    subgraph PortingEngine ["2. Smart Porting Engine"]
        D["Scaffold C# AST to Cocos TS"]
        E["Inject Zero-GC Static Vectors"]
        F["Extract Params to playable-config.json"]
    end

    subgraph CocosOutput ["3. Cocos Creator 3.8 Output"]
        G["RigidBody.applyImpulse(_tempVec3)"]
        H["Collider.on('onCollisionEnter')"]
        I["PlayableConfigManager.instance.get()"]
    end

    UnityInput --> PortingEngine --> CocosOutput`,
    traps: [
      '**Zero-GC Trap**: Không gọi `this._rb.getLinearVelocity()` mà không truyền `out` vector, hoặc gán `new Vec3()` trong `update()`.',
      '**Collider Event Listener**: Trong Cocos 3.8, event va chạm nằm trên component `Collider`, KHÔNG nằm trên `RigidBody`. Luôn nhớ `collider.off()` trong `onDestroy()`.',
      '**Physics Engine Selection**: Vào Project Settings -> Feature Cropping & Physics 3D để đảm bảo đã bật đúng engine (Cannon.js / Builtin).'
    ],
    takeaways: [
      '1. Luôn dùng `Vec3.set(_tempVec3, x, y, z)` và truyền vào `applyImpulse` để đạt chuẩn Zero-GC 60fps.',
      '2. Chuyển toàn bộ biến tùy chỉnh vật lý sang `playable-config.json` để tester dễ dàng cân bằng game mà không cần build lại scene.',
      '3. Đăng ký va chạm qua `Collider.on(\'onCollisionEnter\')` và luôn giải phóng trong `onDestroy()`.'
    ],
    workMemoryPayload: {
      scope: 'global',
      category: 'porting-note',
      title: 'Unity Rigidbody to Cocos 3.8 Zero-GC Physics Rule',
      content: 'When porting Unity Rigidbody physics to Cocos Creator 3.8: Use RigidBody.applyImpulse with static cached Vec3, attach event listeners on Collider component rather than RigidBody, and bind parameters via PlayableConfigManager.'
    }
  };

  return await runSaveTutorial(sampleData);
}

// -----------------------------------------------------------------------------
// List & Query Engine
// -----------------------------------------------------------------------------
function runList() {
  if (!fs.existsSync(TUTORIALS_INDEX_FILE)) {
    console.log('[Knowledge Distiller] No tutorials created yet. Run "npm run ai:distill" to generate your first tutorial.');
    return;
  }

  try {
    const index = JSON.parse(fs.readFileSync(TUTORIALS_INDEX_FILE, 'utf8'));
    console.log('\n========================================================================');
    console.log(` Daily Learning Tutorials & Tips (${index.length} entries)`);
    console.log('========================================================================\n');
    
    for (const item of index) {
      console.log(`📌 [${item.category.toUpperCase()}] ${item.title}`);
      console.log(`   📅 Date: ${item.date} | 🏷️ Tags: #${item.tags.join(' #')}`);
      console.log(`   📄 File: ${item.path}`);
      console.log(`   💡 Summary: ${item.summary}\n`);
    }
  } catch (e) {
    console.error(`Failed to read tutorials index: ${e.message}`);
  }
}

// -----------------------------------------------------------------------------
// Main CLI Router
// -----------------------------------------------------------------------------
async function main() {
  const { command, options } = parseArgs();

  switch (command) {
    case 'extract':
      runExtract(options);
      break;

    case 'save':
    case 'render':
      if (options.file) {
        const fileContent = fs.readFileSync(options.file, 'utf8');
        const data = JSON.parse(fileContent);
        await runSaveTutorial(data, options);
      } else {
        console.error('Error: Please provide JSON payload with --file <path_to_json>');
      }
      break;

    case 'test-render':
      await runTestRender();
      break;

    case 'list':
      runList();
      break;

    case 'help':
    default:
      console.log(`
Knowledge Distiller CLI - Daily Learning & Tutorial Synthesizer

Usage:
  node playable-shared-kit/tools/knowledge-distiller.cjs <command> [options]

Commands:
  extract       Scan transcript & work-memory to create compact .last-digest.json (<1.5k tokens)
  save          Render and save a 5-layer standardized tutorial Markdown + Mermaid PNG
  test-render   Generate the reference seed tutorial (Unity Physics -> Cocos 3.8 Zero-GC)
  list          List all synthesized tutorials and learning notes
  help          Show this help message

Options:
  --transcript <path>   Explicit transcript file to scan
  --file <path>         Input JSON data file for save/render
  --json                Output compact machine-readable JSON
      `);
      break;
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  runExtract,
  runSaveTutorial,
  runTestRender,
  runList
};
