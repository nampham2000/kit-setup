#!/usr/bin/env node
'use strict';

/**
 * Prefab Script Closure Resolver
 * ==============================
 * Trả lời câu hỏi mà không tool nào trong kit trả lời được: "prefab này cần
 * những file C# nào?"
 *
 * Trước tool này, agent port một prefab có gắn C# component phải tự dựng bảng
 * GUID từ `*.cs.meta` rồi tự khớp với `m_Script:` trong prefab. Hệ quả đo được
 * trên BlastShooter: `port.prefab` báo `high=0` trong khi chưa có dòng script
 * nào được port, và digest trả `nextActions: []` — agent đọc như "đã xong".
 *
 * Luồng dùng:
 *   1. npm run port:closure -- --prefab <file.prefab> --unity-root <Assets> --copy-to .unity/closure
 *   2. npm run port:compile -- --src .unity/closure --out assets/script/ --runtime-only
 *   3. npm run port -- port --src <file.prefab> --out assets/... --unity-root <Assets>
 *
 * Vì sao phải có bước 1: port cả `Assets/` là 2.184 file C# (~43k token chỉ để
 * đọc source). Closure của một prefab thật thường là 10-50 file.
 *
 * Chỉ đọc Unity project; ghi duy nhất vào --copy-to nếu được yêu cầu.
 */

const fs = require('fs');
const path = require('path');

require('./lib/auto-strip-ansi.cjs');
const { color } = require('./lib/term-color.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const USAGE = `Prefab Script Closure Resolver

Usage:
  node playable-shared-kit/tools/port-closure.cjs --prefab <file|dir> [options]
  npm run port:closure -- --prefab <file.prefab> --unity-root <Assets>

Options:
  --prefab <path>    File .prefab/.unity/.asset, hoặc thư mục chứa chúng.
  --unity-root <dir> Thư mục Assets của Unity. Mặc định: suy ra từ --prefab.
  --copy-to <dir>    Copy closure ra thư mục staging (giữ cấu trúc tương đối)
                     để đưa thẳng vào port.compile --src.
  --max-depth <n>    Giới hạn độ sâu closure. Default: 2.
  --exclude <a,b>    Bỏ file có đường dẫn chứa các chuỗi này (vendor, monetization...).
  --json             Xuất JSON (mặc định khi không phải TTY).
  --out <file>       Ghi JSON ra file.
  --help             Hiện trợ giúp và thoát.

Vì sao default --max-depth 2: closure bắc cầu trong codebase gắn kết chặt sẽ
hội tụ về gần như cả project. Đo trên BlastShooter, prefab CameraController:
depth 1 = 11 file, depth 2 = 48, depth 8 = 400 (trên tổng 648 file game).
Depth 2 là ranh giới còn dùng được làm đơn vị port; đọc depthHistogram trong
output để tự chọn điểm cắt khác.

Exit 1 khi có script GUID không resolve được.`;

/** Thư mục không chứa code game — bỏ để closure phản ánh code cần port. */
const SKIP_DIRS = new Set([
  'Plugins', 'Editor', 'TextMesh Pro', 'ExternalDependencyManager', 'Firebase',
  'GooglePlayPlugins', 'MaxSdk', 'OneSignal', 'GameAnalytics', 'UniWebView',
  'BitLabs', 'RestClient', 'MeshBaker', 'JMO Assets', 'Library', 'obj', 'Temp',
  '.git', 'GeneratedLocalRepo', 'UnitTest',
]);

/**
 * Tên type không tính là dependency: primitive, BCL, và Unity engine. Những thứ
 * này không nằm trong project nên không bao giờ cần port kèm.
 */
const NON_PROJECT_TYPES = new Set([
  'int', 'float', 'double', 'bool', 'string', 'char', 'byte', 'short', 'long',
  'uint', 'ulong', 'ushort', 'sbyte', 'decimal', 'object', 'void', 'var', 'dynamic',
  'List', 'Dictionary', 'HashSet', 'Queue', 'Stack', 'Array', 'IEnumerable',
  'IEnumerator', 'IList', 'ICollection', 'IDictionary', 'Action', 'Func', 'Task',
  'Nullable', 'Tuple', 'KeyValuePair', 'Exception', 'Math', 'Convert', 'String',
  'Debug', 'MonoBehaviour', 'ScriptableObject', 'GameObject', 'Transform',
  'Vector2', 'Vector3', 'Vector4', 'Quaternion', 'Color', 'Color32', 'Rect',
  'Mathf', 'Time', 'Random', 'Input', 'Camera', 'Sprite', 'Texture2D', 'Material',
  'Animator', 'Animation', 'AudioClip', 'AudioSource', 'Rigidbody', 'Collider',
  'Coroutine', 'WaitForSeconds', 'Serializable', 'SerializeField', 'Header',
  'Tooltip', 'Range', 'RequireComponent', 'System', 'UnityEngine', 'UnityEditor',
]);

function isSkippedDir(name) {
  return SKIP_DIRS.has(name) || name.endsWith('~');
}

/** Xoá comment và string literal để việc quét identifier không bắt vào nội dung text. */
function stripCommentsAndStrings(source) {
  return source
    .replace(/@"(?:[^"]|"")*"/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n\r\u2028\u2029]*/g, ' ');
}

function walkFiles(dir, onFile) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isSkippedDir(entry.name)) continue;
      walkFiles(full, onFile);
    } else if (entry.isFile()) {
      onFile(full, entry.name);
    }
  }
}

/**
 * Hai chỉ mục cho toàn bộ Unity project:
 *   guidToScript: guid trong .cs.meta -> đường dẫn .cs
 *   typeToFile:   tên type khai báo   -> đường dẫn .cs khai báo nó
 *
 * typeToFile dùng regex khai báo (`class X` / `enum X` / ...) chứ không parse
 * đầy đủ: nó chỉ cần trả lời "type X nằm ở file nào", và quét 2.184 file bằng
 * parser thật sẽ đắt hơn nhiều lần mà không đổi kết quả.
 */
function buildIndex(unityRoot) {
  const guidToScript = new Map();
  const typeToFile = new Map();
  const csFiles = [];

  walkFiles(unityRoot, (full, name) => {
    if (name.endsWith('.cs.meta')) {
      const text = fs.readFileSync(full, 'utf8');
      const match = /^guid:\s*([0-9a-fA-F]{32})/m.exec(text);
      if (match) guidToScript.set(match[1].toLowerCase(), full.slice(0, -5));
    } else if (name.endsWith('.cs')) {
      csFiles.push(full);
    }
  });

  for (const file of csFiles) {
    let source;
    try {
      source = stripCommentsAndStrings(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    for (const match of source.matchAll(
      /\b(?:class|struct|enum|interface|record)\s+([A-Za-z_][\w]*)/g,
    )) {
      const typeName = match[1];
      // Type đầu tiên khai báo thắng: partial class rải nhiều file thì lấy file
      // đầu, đủ để kéo phần còn lại vào qua tham chiếu chéo.
      if (!typeToFile.has(typeName)) typeToFile.set(typeName, file);
    }
  }

  return { guidToScript, typeToFile, scannedFiles: csFiles.length };
}

/** Mọi script GUID mà một Unity YAML asset tham chiếu, kèm số component dùng nó. */
function readScriptGuids(assetFile) {
  const counts = new Map();
  let text;
  try {
    text = fs.readFileSync(assetFile, 'utf8');
  } catch {
    return counts;
  }
  for (const match of text.matchAll(/m_Script:\s*\{fileID:\s*\d+,\s*guid:\s*([0-9a-fA-F]{32})/g)) {
    const guid = match[1].toLowerCase();
    counts.set(guid, (counts.get(guid) || 0) + 1);
  }
  return counts;
}

/** Type mà một file C# tham chiếu và có khai báo trong project. */
function referencedProjectTypes(file, typeToFile) {
  let source;
  try {
    source = stripCommentsAndStrings(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  const found = new Set();
  for (const match of source.matchAll(/\b([A-Z][\w]*)\b/g)) {
    const name = match[1];
    if (NON_PROJECT_TYPES.has(name)) continue;
    const declaredIn = typeToFile.get(name);
    if (declaredIn && declaredIn !== file) found.add(declaredIn);
  }
  return [...found];
}

function resolveClosure(assetFiles, index, maxDepth, exclude = []) {
  const isExcluded = (file) => exclude.some((needle) => file.split(path.sep).join('/').includes(needle));
  const scripts = new Set();
  const unresolved = new Map();
  let componentCount = 0;

  for (const assetFile of assetFiles) {
    for (const [guid, count] of readScriptGuids(assetFile)) {
      componentCount += count;
      const scriptFile = index.guidToScript.get(guid);
      if (scriptFile) {
        scripts.add(scriptFile);
      } else {
        const existing = unresolved.get(guid) || { guid, components: 0, assets: new Set() };
        existing.components += count;
        existing.assets.add(assetFile);
        unresolved.set(guid, existing);
      }
    }
  }

  // Mở rộng theo tầng để biết mỗi file nằm ở độ sâu nào — hữu ích khi closure
  // phình ra và cần biết cắt ở đâu.
  const depthOf = new Map();
  for (const file of scripts) depthOf.set(file, 0);
  let frontier = [...scripts];
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const next = [];
    for (const file of frontier) {
      for (const dependency of referencedProjectTypes(file, index.typeToFile)) {
        if (depthOf.has(dependency) || isExcluded(dependency)) continue;
        depthOf.set(dependency, depth);
        next.push(dependency);
      }
    }
    frontier = next;
  }

  const truncated = frontier.length > 0;
  return { scripts, unresolved: [...unresolved.values()], depthOf, componentCount, truncated };
}

function relativeTo(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function copyClosure(files, unityRoot, destination) {
  const root = path.resolve(destination);
  fs.mkdirSync(root, { recursive: true });
  let copied = 0;
  for (const file of files) {
    const target = path.join(root, relativeTo(unityRoot, file));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file, target);
    copied += 1;
  }
  return { root, copied };
}

function collectAssetFiles(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [path.resolve(target)];
  const out = [];
  walkFiles(path.resolve(target), (full, name) => {
    if (/\.(prefab|unity|asset)$/i.test(name)) out.push(full);
  });
  return out;
}

function inferUnityRoot(target) {
  let current = path.resolve(target);
  if (fs.statSync(current).isFile()) current = path.dirname(current);
  while (true) {
    if (path.basename(current) === 'Assets') return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(target);
    current = parent;
  }
}

function parseArgs(argv) {
  const o = { prefab: '', unityRoot: '', copyTo: '', maxDepth: 2, exclude: [], json: false, out: '', help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (a === '--json') { o.json = true; continue; }
    if (a === '--prefab' && argv[i + 1]) { o.prefab = argv[++i]; continue; }
    if (a === '--unity-root' && argv[i + 1]) { o.unityRoot = argv[++i]; continue; }
    if (a === '--copy-to' && argv[i + 1]) { o.copyTo = argv[++i]; continue; }
    if (a === '--max-depth' && argv[i + 1]) { o.maxDepth = parseInt(argv[++i], 10) || 2; continue; }
    if (a === '--exclude' && argv[i + 1]) { o.exclude.push(...argv[++i].split(',').map((x) => x.trim()).filter(Boolean)); continue; }
    if (a === '--out' && argv[i + 1]) { o.out = argv[++i]; continue; }
    if (!a.startsWith('--') && !o.prefab) { o.prefab = a; continue; }
  }
  return o;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(USAGE); return; }
  if (!options.prefab) {
    console.error('Error: --prefab <file_or_dir> is required.');
    process.exit(1);
  }
  if (!fs.existsSync(options.prefab)) {
    console.error(`Error: not found: ${options.prefab}`);
    process.exit(1);
  }

  const unityRoot = path.resolve(options.unityRoot || inferUnityRoot(options.prefab));
  if (!fs.existsSync(unityRoot)) {
    console.error(`Error: unity root not found: ${unityRoot}`);
    process.exit(1);
  }

  const assetFiles = collectAssetFiles(options.prefab);
  if (assetFiles.length === 0) {
    console.error(`Error: no .prefab/.unity/.asset file under ${options.prefab}`);
    process.exit(1);
  }

  const startedAt = Date.now();
  const index = buildIndex(unityRoot);
  const closure = resolveClosure(assetFiles, index, options.maxDepth, options.exclude);

  const attached = [...closure.scripts].map((f) => relativeTo(unityRoot, f)).sort();
  const all = [...closure.depthOf.keys()];
  const closureList = all
    .map((f) => ({ file: relativeTo(unityRoot, f), depth: closure.depthOf.get(f) }))
    .sort((a, b) => (a.depth - b.depth) || a.file.localeCompare(b.file));

  let staging = null;
  if (options.copyTo) staging = copyClosure(all, unityRoot, options.copyTo);

  const compileSrc = staging ? relativeTo(PROJECT_ROOT, staging.root) : '<closure_dir>';
  const nextActions = [];
  if (!staging) {
    nextActions.push(`Chạy lại với --copy-to .unity/closure để gom ${all.length} file vào một thư mục staging.`);
  }
  nextActions.push(`npm run port:compile -- --src ${compileSrc} --out assets/script/ --runtime-only`);
  if (closure.unresolved.length > 0) {
    nextActions.push(`${closure.unresolved.length} script GUID không nằm trong ${relativeTo(PROJECT_ROOT, unityRoot)} (script của package/DLL) — cài lại hành vi bằng TypeScript nếu gameplay cần.`);
  }
  if (closure.truncated) {
    // Ở default depth 2 việc cắt là CHỦ Ý, không phải sự cố: cứ mở rộng hết thì
    // closure hội tụ về gần cả project. Nói rõ để agent không tự tăng bừa.
    nextActions.push(`Còn dependency sâu hơn --max-depth ${options.maxDepth} chưa gom. Đọc depthHistogram + byTopFolder rồi quyết định: tăng --max-depth, hoặc --exclude nhánh không cần (ads/IAP/analytics thường không cần cho playable), hoặc viết stub TypeScript.`);
  }

  const payload = {
    ok: closure.unresolved.length === 0,
    tool: 'port-closure',
    summary: {
      unityRoot: relativeTo(PROJECT_ROOT, unityRoot) || unityRoot,
      assets: assetFiles.length,
      scriptComponents: closure.componentCount,
      attachedScripts: attached.length,
      closureFiles: all.length,
      unresolvedGuids: closure.unresolved.length,
      scannedCsFiles: index.scannedFiles,
      indexedTypes: index.typeToFile.size,
      maxDepth: options.maxDepth,
      moreBeyondMaxDepth: closure.truncated,
      durationMs: Date.now() - startedAt,
    },
    // Số file thêm vào ở mỗi tầng. Dùng để chọn điểm cắt: closure bắc cầu tăng
    // rất nhanh, nên đây là dữ liệu quyết định chứ không phải thống kê phụ.
    depthHistogram: closureList.reduce((acc, entry) => {
      acc[`d${entry.depth}`] = (acc[`d${entry.depth}`] || 0) + 1;
      return acc;
    }, {}),
    // Khối lượng theo thư mục gốc — chỗ để biết nên --exclude cái gì.
    byTopFolder: Object.fromEntries(
      Object.entries(closureList.reduce((acc, entry) => {
        const top = entry.file.split('/')[0];
        acc[top] = (acc[top] || 0) + 1;
        return acc;
      }, {})).sort((a, b) => b[1] - a[1]),
    ),
    attachedScripts: attached,
    closure: closureList,
    unresolved: closure.unresolved.map((entry) => ({
      guid: entry.guid,
      components: entry.components,
      reason: `Không có .cs.meta nào trong ${relativeTo(PROJECT_ROOT, unityRoot)} mang guid này (thường là script trong Packages/ hoặc trong DLL)`,
    })),
    staging: staging ? { dir: relativeTo(PROJECT_ROOT, staging.root), files: staging.copied } : null,
    nextActions,
    limits: [
      'Dependency được suy ra bằng cách khớp identifier hoa đầu với bảng type khai báo trong project. Thiên về gom THỪA (port thêm vài file) hơn là bỏ SÓT.',
      'Không đọc .csproj nên không phân biệt assembly definition.',
    ],
  };

  const json = JSON.stringify(payload, null, 2);
  if (options.out) {
    fs.mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
    fs.writeFileSync(options.out, `${json}\n`, 'utf8');
  }
  if (options.json || !process.stdout.isTTY) {
    console.log(json);
  } else {
    console.log('');
    console.log('======================================================');
    console.log(' Prefab Script Closure ');
    console.log('======================================================');
    console.log(`${assetFiles.length} asset · ${closure.componentCount} script component · quét ${index.scannedFiles} file .cs`);
    console.log(`${color('green', String(attached.length))} script gắn trực tiếp → ${color('green', String(all.length))} file trong closure`);
    if (closure.unresolved.length > 0) {
      console.log(color('yellow', `${closure.unresolved.length} GUID không resolve được (script ngoài Assets/)`));
    }
    console.log('');
    for (const entry of closureList.slice(0, 40)) {
      console.log(`  ${color('gray', `d${entry.depth}`)} ${entry.file}`);
    }
    if (closureList.length > 40) console.log(color('gray', `  ... còn ${closureList.length - 40} file`));
    if (staging) {
      console.log('');
      console.log(`Đã copy ${staging.copied} file → ${staging.dir}`);
    }
    console.log('');
    console.log('Bước tiếp:');
    for (const action of nextActions) console.log(`  - ${action}`);
    console.log('');
  }

  if (closure.unresolved.length > 0) process.exitCode = 1;
}

if (require.main === module) {
  main();
}

module.exports = { buildIndex, readScriptGuids, referencedProjectTypes, resolveClosure, stripCommentsAndStrings };
