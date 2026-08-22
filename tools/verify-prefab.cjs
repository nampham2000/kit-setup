#!/usr/bin/env node
'use strict';

/**
 * Prefab / Scene Integrity Verifier
 * =================================
 * `headless-verifier` kiểm tra TypeScript, config, .meta và bundle size — nhưng
 * KHÔNG kiểm tra thứ mà porter vừa sinh ra. Tool này lấp đúng khoảng đó: đọc
 * trực tiếp file .prefab/.scene dạng JSON của Cocos và tìm những lỗi chỉ lộ ra
 * lúc runtime (hoặc lúc mở editor):
 *
 *   1. UUID treo        — tham chiếu tới asset không tồn tại trong project.
 *   2. Script chưa có   — component trỏ tới class TS chưa được viết.
 *   3. Material rỗng    — Sprite/MeshRenderer không có SpriteFrame/Material.
 *   4. Node trùng tên   — hai con cùng cha cùng tên: getChildByName() bốc sai.
 *   5. Cấu trúc lỗi     — __id__ trỏ ra ngoài mảng, node mồ côi, thiếu _name.
 *   6. Ngân sách vẽ     — ước lượng số renderer / draw call cho playable.
 *
 * Exit 1 nếu có lỗi mức `high`.
 */

const fs = require('fs');
const path = require('path');
const { color, isColorEnabled } = require('./lib/term-color.cjs');

const USAGE = `Cocos Prefab / Scene Integrity Verifier

Usage:
  node playable-shared-kit/tools/verify-prefab.cjs [options] [paths...]
  npm run verify:prefab

Arguments:
  [paths...]   File .prefab/.scene hoặc thư mục cần kiểm tra.
               Mặc định: toàn bộ assets/ của project.

Options:
  --json              Xuất JSON (dùng cho AI agent / CI).
  --quiet             Chỉ in tổng kết.
  --max-renderers <n> Ngưỡng cảnh báo số renderer trong một prefab. Default: 120.
  --help              Hiện trợ giúp và thoát.

Exit code 1 khi có phát hiện mức high.`;

const RENDERER_TYPES = new Set([
  'cc.Sprite', 'cc.Label', 'cc.MeshRenderer', 'cc.SkinnedMeshRenderer',
  'cc.ParticleSystem', 'cc.ParticleSystem2D', 'cc.Graphics', 'cc.RichText',
  'cc.TiledLayer', 'cc.Spine', 'sp.Skeleton',
]);

// ────────────────────────────────────────────────────────── asset index ──

/** Chỉ mục UUID -> đường dẫn, đọc từ mọi file .meta trong assets/. */
/**
 * Built-in assets (db://internal): primitive meshes, builtin effects and
 * materials. They live in the editor install, not in the project, so a scene
 * that uses e.g. the Plane primitive references a uuid this tool would
 * otherwise call dangling.
 */
function findInternalAssetRoots() {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const bases = [
    process.env.COCOS_CREATOR_PATH || '',
    'C:/ProgramData/cocos/editors/Creator/3.8.8',
    'C:/Program Files/Cocos/Creator/3.8.8',
    'C:/CocosDashboard/resources/.editors/Creator/3.8.8',
    'D:/CocosDashboard/resources/.editors/Creator/3.8.8',
    home ? path.join(home, 'AppData/Local/CocosDashboard/resources/.editors/Creator/3.8.8') : '',
    '/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents',
  ].filter(Boolean);

  const roots = [];
  for (const base of bases) {
    for (const tail of [
      'resources/resources/3d/engine/editor/assets',
      'resources/resources/3d/engine/editor/static/default-assets',
    ]) {
      const dir = path.join(base, tail);
      try { if (fs.statSync(dir).isDirectory()) roots.push(dir); } catch (_) { /* not this one */ }
    }
  }
  return roots;
}

function buildAssetIndex(assetsRoot) {
  const byUuid = new Map();
  const scriptClasses = new Map(); // uuid -> tên class trong file .ts

  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.meta')) continue;

      let meta;
      try { meta = JSON.parse(fs.readFileSync(full, 'utf8')); } catch (_) { continue; }
      const assetFile = full.replace(/\.meta$/, '');
      if (meta.uuid) byUuid.set(meta.uuid, assetFile);
      // sub-asset (sprite frame trong texture, mesh trong model, ...)
      for (const [key, sub] of Object.entries(meta.subMetas || {})) {
        if (sub && sub.uuid) byUuid.set(sub.uuid, `${assetFile}#${sub.name || key}`);
      }
      if (assetFile.endsWith('.ts') && meta.uuid) {
        let source = '';
        try { source = fs.readFileSync(assetFile, 'utf8'); } catch (_) { /* ignore */ }
        const classes = [...source.matchAll(/@ccclass\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
        scriptClasses.set(meta.uuid, { file: assetFile, classes });
      }
    }
  };
  walk(assetsRoot);

  const internalRoots = findInternalAssetRoots();
  const projectAssetCount = byUuid.size;
  for (const root of internalRoots) walk(root);

  const index = {
    byUuid,
    scriptClasses,
    internalIndexed: internalRoots.length > 0,
    internalAssetCount: byUuid.size - projectAssetCount,
  };
  index.scriptPrefixes = scriptPrefixSet(index);
  return index;
}

/** Mọi UUID xuất hiện trong một cây JSON, kèm đường dẫn thuộc tính. */
function collectUuidRefs(node, trail, out) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((item, i) => collectUuidRefs(item, `${trail}[${i}]`, out));
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === '__uuid__' && typeof value === 'string') {
      out.push({ uuid: value, at: trail });
      continue;
    }
    collectUuidRefs(value, trail ? `${trail}.${key}` : key, out);
  }
}

// ────────────────────────────────────────────────────────────── checks ──

function verifyDocument(file, docs, index, options, findings) {
  const rel = (p) => path.relative(options.projectRoot, p).replace(/\\/g, '/');
  const name = path.basename(file);
  const add = (severity, code, message, detail = '') =>
    findings.push({ severity, code, file: rel(file), message, detail });

  if (!Array.isArray(docs)) {
    add('high', 'PREFAB_NOT_ARRAY', 'File không phải mảng object của Cocos — có thể bị hỏng hoặc chưa hoàn tất.');
    return { renderers: 0 };
  }

  // (5) __id__ trỏ ra ngoài mảng
  const refs = [];
  collectUuidRefs(docs, '', refs);
  const badIds = [];
  const scanIds = (node, trail) => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach((v, i) => scanIds(v, `${trail}[${i}]`)); return; }
    for (const [key, value] of Object.entries(node)) {
      if (key === '__id__' && typeof value === 'number') {
        if (value < 0 || value >= docs.length) badIds.push(`${trail} -> __id__ ${value}`);
        continue;
      }
      scanIds(value, trail ? `${trail}.${key}` : key);
    }
  };
  scanIds(docs, '');
  if (badIds.length) {
    add('high', 'DANGLING_INTERNAL_ID',
      `${badIds.length} tham chiếu __id__ trỏ ra ngoài mảng (mảng có ${docs.length} phần tử).`,
      badIds.slice(0, 3).join(' | '));
  }

  // (1) UUID treo
  const missing = new Map();
  for (const ref of refs) {
    if (index.byUuid.has(ref.uuid)) continue;
    if (!missing.has(ref.uuid)) missing.set(ref.uuid, []);
    missing.get(ref.uuid).push(ref.at);
  }
  if (missing.size) {
    const detail = [...missing.entries()].slice(0, 3).map(([u, at]) => `${u} @ ${at[0]}`).join(' | ');
    if (index.internalIndexed) {
      add('high', 'DANGLING_ASSET_UUID',
        `${missing.size} UUID không tìm thấy asset tương ứng trong project — sẽ thành null lúc runtime.`,
        detail);
    } else {
      // Without the editor's db://internal assets indexed we cannot tell a real
      // dangling ref from a builtin one, so this is "unknown", not "broken".
      add('medium', 'UNRESOLVED_ASSET_UUID',
        `${missing.size} UUID không đối chiếu được: không tìm thấy asset built-in của editor để lập chỉ mục. `
        + 'Đặt COCOS_CREATOR_PATH tới thư mục cài Cocos rồi chạy lại để phân biệt UUID treo thật.',
        detail);
    }
  }

  // (2) component script chưa tồn tại
  const unresolvedScripts = new Set();
  for (const doc of docs) {
    const type = doc && doc.__type__;
    if (typeof type !== 'string') continue;
    // Component custom được lưu bằng UUID nén của script, không phải 'cc.*'
    if (type.startsWith('cc.') || type.startsWith('CC')) continue;
    if (!/^[0-9a-zA-Z+/]{20,}$/.test(type)) continue;
    unresolvedScripts.add(type);
  }
  if (unresolvedScripts.size) {
    const known = index.scriptPrefixes;
    const notFound = [...unresolvedScripts].filter((t) => !known.has(uuidPrefix(t)));
    if (notFound.length) {
      add('high', 'SCRIPT_CLASS_MISSING',
        `${notFound.length} component trỏ tới script chưa tồn tại trong assets/ — component sẽ không nạp được.`,
        notFound.slice(0, 3).join(', '));
    }
  }

  // (3) renderer thiếu binding + (6) ngân sách vẽ
  let renderers = 0;
  const emptyBindings = [];
  for (let i = 0; i < docs.length; i += 1) {
    const doc = docs[i];
    const type = doc && doc.__type__;
    if (!RENDERER_TYPES.has(type)) continue;
    renderers += 1;
    if (type === 'cc.Sprite') {
      const frame = doc._spriteFrame;
      if (!frame || (typeof frame === 'object' && !frame.__uuid__ && frame.__id__ === undefined)) {
        emptyBindings.push(`#${i} cc.Sprite thiếu _spriteFrame`);
      }
    }
    if (type === 'cc.MeshRenderer' || type === 'cc.SkinnedMeshRenderer') {
      const mats = doc._materials || [];
      if (!Array.isArray(mats) || !mats.length || mats.every((m) => !m || (!m.__uuid__ && m.__id__ === undefined))) {
        emptyBindings.push(`#${i} ${type} thiếu _materials`);
      }
    }
  }
  if (emptyBindings.length) {
    add('medium', 'RENDERER_BINDING_EMPTY',
      `${emptyBindings.length} renderer chưa được gán asset — sẽ hiện màu hồng/trắng hoặc vô hình.`,
      emptyBindings.slice(0, 3).join(' | '));
  }
  if (renderers > options.maxRenderers) {
    add('medium', 'RENDERER_BUDGET',
      `${renderers} renderer trong một prefab (ngưỡng ${options.maxRenderers}) — nhiều draw call cho playable.`);
  }

  // (4) node trùng tên trong cùng cha
  const nodesById = new Map();
  docs.forEach((doc, i) => { if (doc && doc.__type__ === 'cc.Node') nodesById.set(i, doc); });
  const childrenByParent = new Map();
  for (const [id, node] of nodesById) {
    const parentId = node._parent && typeof node._parent.__id__ === 'number' ? node._parent.__id__ : -1;
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push({ id, name: node._name });
  }
  const dupGroups = [];
  for (const [parentId, kids] of childrenByParent) {
    const seen = new Map();
    for (const kid of kids) {
      const key = String(kid.name ?? '');
      if (!key) continue;
      seen.set(key, (seen.get(key) || 0) + 1);
    }
    for (const [kidName, count] of seen) {
      if (count > 1) dupGroups.push(`parent#${parentId} có ${count} con tên "${kidName}"`);
    }
  }
  if (dupGroups.length) {
    add('medium', 'DUPLICATE_SIBLING_NAME',
      `${dupGroups.length} nhóm node trùng tên cùng cha — getChildByName() sẽ bốc không xác định.`,
      dupGroups.slice(0, 3).join(' | '));
  }

  // node thiếu tên (khó đọc trong editor, không tra được bằng tên)
  const unnamed = [...nodesById.values()].filter((n) => !('_name' in n) && !(n._prefab && n._prefab.__id__ !== undefined));
  if (unnamed.length) {
    add('low', 'NODE_WITHOUT_NAME', `${unnamed.length} node không có _name (không phải instance prefab lồng).`);
  }

  return { renderers, docCount: docs.length, name };
}

/**
 * Đối chiếu `__type__` nén của component custom với UUID của script.
 *
 * Cocos nén UUID 32 hex thành 23 ký tự và GIỮ NGUYÊN 5 ký tự đầu:
 *   9e67e8e2-e809-... -> 9e67eji6AlBI4ZR8zI9Tst1
 *   fe8b6d9b-6254-... -> fe8b62bYlRBrYRaf1+UfAgF
 * (kiểm chứng trên assets/ của project này)
 *
 * Không cài lại thuật toán nén ở đây: cài sai một bit là báo động giả hàng loạt
 * (bản đầu của tool này báo 7 script "thiếu" trong khi chúng đều tồn tại).
 * Đối chiếu bằng tiền tố 5 hex: 1.048.576 khả năng, đủ để một project không
 * trùng; và khi trùng thì tool CHẤP NHẬN thay vì báo lỗi — thà bỏ sót hơn là
 * báo sai cho agent.
 */
function uuidPrefix(value) {
  return String(value).replace(/-/g, '').slice(0, 5).toLowerCase();
}

/** Tập tiền tố của mọi script trong assets/ (bao gồm cả script không có @ccclass). */
function scriptPrefixSet(index) {
  const prefixes = new Set();
  for (const uuid of index.scriptClasses.keys()) prefixes.add(uuidPrefix(uuid));
  return prefixes;
}

// ────────────────────────────────────────────────────────────── runner ──

function findTargets(inputs, projectRoot) {
  const roots = inputs.length ? inputs : [path.join(projectRoot, 'assets')];
  const files = [];
  for (const input of roots) {
    const resolved = path.resolve(projectRoot, input);
    if (!fs.existsSync(resolved)) continue;
    if (fs.statSync(resolved).isFile()) { files.push(resolved); continue; }
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (/\.(prefab|scene)$/i.test(entry.name)) files.push(full);
      }
    };
    walk(resolved);
  }
  return files;
}

function parseArgs(argv) {
  const options = { json: false, quiet: false, maxRenderers: 120, inputs: [], help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    if (arg === '--json') { options.json = true; continue; }
    if (arg === '--quiet') { options.quiet = true; continue; }
    if (arg === '--max-renderers') { options.maxRenderers = Number(argv[++i]) || 120; continue; }
    if (arg.startsWith('--max-renderers=')) { options.maxRenderers = Number(arg.split('=')[1]) || 120; continue; }
    if (arg.startsWith('-')) continue;
    options.inputs.push(arg);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(USAGE); return; }

  options.projectRoot = path.resolve(__dirname, '..', '..');
  const assetsRoot = path.join(options.projectRoot, 'assets');
  if (!fs.existsSync(assetsRoot)) {
    console.error('[verify-prefab] Không tìm thấy thư mục assets/.');
    process.exit(1);
  }

  const index = buildAssetIndex(assetsRoot);
  const targets = findTargets(options.inputs, options.projectRoot);
  const findings = [];
  let totalRenderers = 0;

  for (const file of targets) {
    let docs;
    try {
      docs = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      findings.push({
        severity: 'high',
        code: 'PREFAB_UNPARSEABLE',
        file: path.relative(options.projectRoot, file).replace(/\\/g, '/'),
        message: `Không parse được JSON: ${error.message}`,
        detail: '',
      });
      continue;
    }
    const stats = verifyDocument(file, docs, index, options, findings);
    totalRenderers += stats.renderers || 0;
  }

  const counts = { high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity] += 1;

  if (options.json) {
    console.log(JSON.stringify({
      ok: counts.high === 0,
      tool: 'verify-prefab',
      summary: {
        files: targets.length,
        assetsIndexed: index.byUuid.size,
        renderers: totalRenderers,
        ...counts,
      },
      items: findings,
      nextActions: counts.high
        ? ['Xử lý mọi phát hiện `high` trước khi build: UUID treo và script thiếu sẽ thành null lúc runtime.']
        : [],
    }, null, 2));
    if (counts.high) process.exit(1);
    return;
  }

  const c = (name, text) => color(name, text);
  console.log('');
  console.log('======================================================');
  console.log(' Cocos Prefab / Scene Integrity Verifier ');
  console.log('======================================================');
  console.log(`Kiểm tra ${targets.length} file, chỉ mục ${index.byUuid.size} asset`
    + (index.internalIndexed ? ` (gồm ${index.internalAssetCount} built-in)` : ' (CHƯA có built-in của editor)')
    + `, ${totalRenderers} renderer.`);
  console.log('');

  if (!findings.length) {
    console.log(c('green', 'Result: PASS') + ' — không phát hiện vấn đề.');
  } else {
    const order = { high: 0, medium: 1, low: 2 };
    const shown = findings.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, options.quiet ? 10 : 60);
    for (const f of shown) {
      const tag = f.severity === 'high' ? c('red', '[HIGH]')
        : f.severity === 'medium' ? c('yellow', '[MED ]') : c('gray', '[LOW ]');
      console.log(`${tag} ${f.file} (${f.code})`);
      console.log(`       ${f.message}`);
      if (f.detail) console.log(`       ${c('gray', f.detail)}`);
    }
    if (findings.length > shown.length) console.log(`... còn ${findings.length - shown.length} phát hiện nữa (dùng --json để xem hết)`);
    console.log('');
    const verdict = counts.high ? c('red', 'Result: FAIL') : c('yellow', 'Result: WARN');
    console.log(`${verdict} — high=${counts.high}, medium=${counts.medium}, low=${counts.low}`);
  }
  console.log('======================================================');
  console.log('');

  if (counts.high) process.exit(1);
}

if (require.main === module) main();

module.exports = { buildAssetIndex, verifyDocument, uuidPrefix, scriptPrefixSet, collectUuidRefs };
