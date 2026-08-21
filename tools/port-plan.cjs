#!/usr/bin/env node
'use strict';

/**
 * Unity Port Planner
 * ==================
 * Thay cho `unity-cocos-port.cjs doctor` — lệnh đó chỉ in số record của asset DB
 * rồi ghi một CSV chỉ có dòng header, không chẩn đoán gì (DR-01).
 *
 * Tool này trả lời đúng những câu một agent cần TRƯỚC khi port:
 *   - Project Unity này có gì? (scene, prefab, script, shader, model, texture)
 *   - Nó dùng những thứ nào KHÔNG có đường sang Cocos? (TMP, Addressables,
 *     Zenject, URP volume, ShaderGraph, DOTween...)
 *   - Nên bắt đầu từ đâu? (prefab nào là gốc, prefab nào nặng nhất)
 *   - Chi phí ước lượng bao nhiêu? (theo tốc độ port đo được)
 *
 * Output là JSON gọn để agent đọc một lần thay vì tự quét cây thư mục 2GB.
 */

const fs = require('fs');
const path = require('path');

require('./lib/auto-strip-ansi.cjs');
const { color } = require('./lib/term-color.cjs');

const USAGE = `Unity Port Planner

Usage:
  node playable-shared-kit/tools/port-plan.cjs --src <UnityAssetsFolder> [options]
  npm run port:plan -- --src <UnityAssetsFolder>

Options:
  --src <path>      Thư mục Unity cần phân tích (thường là .../Assets hoặc một module con).
  --json            Xuất JSON (mặc định khi không phải TTY).
  --out <file>      Ghi JSON ra file.
  --top <n>         Số prefab liệt kê trong thứ tự đề xuất. Default: 15.
  --include-vendor  Không bỏ qua thư mục thư viện (demo/samples/plugins/...).
                    Cần dùng khi chính package asset store là thứ phải port.
  --help            Hiện trợ giúp và thoát.

Không ghi gì vào project Cocos — chỉ đọc và phân tích.`;

/** Thư viện bên thứ ba: bỏ qua để không làm nhiễu số liệu game. */
const VENDOR_DIRS = new Set([
  'plugins', 'zenject', 'textmesh pro', 'samples', 'demo', 'demos',
  'editor default resources', 'gizmos', 'standard assets',
  'firebase', 'maxsdk', 'onesignal', 'googleplayplugins', 'externaldependencymanager',
  'restclient', 'uniwebview', 'bitlabs', 'mcofferwallsdk', 'gameanalytics',
  'cheatdetected', 'jmo assets', 'recyclable scroll rect', 'simple scroll-snap',
  'ugui particle', 'uguiparticle', 'vibration', 'internetchecker', 'realtimenet',
]);

/**
 * Tính năng Unity KHÔNG có đường chuyển thẳng sang Cocos playable.
 * Mỗi entry: cách phát hiện + hệ quả + việc phải làm.
 */
const BLOCKERS = [
  {
    id: 'textmeshpro',
    label: 'TextMeshPro',
    test: (f, text) => /TMPro|TextMeshProUGUI|TMP_Text/.test(text),
    impact: 'Label của Cocos không có outline/gradient/SDF của TMP.',
    action: 'Quy về cc.Label + bitmap font; dựng lại outline/gradient bằng effect nếu cần.',
  },
  {
    id: 'addressables',
    label: 'Addressables / AssetBundle',
    test: (f, text) => /Addressables|AssetReference|AsyncOperationHandle|AssetBundle/.test(text),
    impact: 'Playable là single-file: mọi load bất đồng bộ phải thành preload đồng bộ.',
    action: 'Chuyển sang resources.preload hoặc nhúng trực tiếp; bỏ mọi await load runtime.',
  },
  {
    id: 'zenject',
    label: 'Zenject / DI',
    test: (f, text) => /\[Inject\]|Zenject|MonoInstaller|DiContainer/.test(text),
    impact: 'Không có container DI; scaffolder không hiểu [Inject].',
    action: 'Thay bằng tham chiếu trực tiếp hoặc singleton (GameManager.instance).',
  },
  {
    id: 'dotween',
    label: 'DOTween',
    test: (f, text) => /DG\.Tweening|DOTween|\.DOMove|\.DOScale|\.DOFade/.test(text),
    impact: 'Ease/Sequence của DOTween không map 1:1 sang cc.tween.',
    action: 'Dùng cc.tween; ánh xạ easing thủ công.',
  },
  {
    id: 'urp-volume',
    label: 'URP post-processing (Volume)',
    test: (f) => /VolumeProfile|UniversalRenderPipelineGlobalSettings/.test(path.basename(f)),
    impact: 'Bloom/vignette/color-grading không có tương đương.',
    action: 'Làm lại bằng effect riêng, hoặc bỏ để tiết kiệm bundle.',
  },
  {
    id: 'shadergraph',
    label: 'ShaderGraph',
    test: (f) => f.toLowerCase().endsWith('.shadergraph'),
    impact: 'Có bộ dịch node->GLSL, nhưng không phủ hết node.',
    action: 'Chạy shader.convert rồi kiểm tra từng effect bằng mắt.',
  },
  {
    id: 'shaderlab',
    label: 'ShaderLab (.shader)',
    test: (f) => f.toLowerCase().endsWith('.shader'),
    impact: 'THÂN shader KHÔNG được dịch — chỉ sinh khung + properties + UBO.',
    action: 'shader.convert rồi tự viết lại frag()/vert() từ khối TODO-AGENT.',
  },
  {
    id: 'animator',
    label: 'Animator state machine',
    test: (f) => f.toLowerCase().endsWith('.controller'),
    impact: 'Transition/blend tree không map hết sang cc.Animation.',
    action: 'Dựng lại luồng chuyển state bằng code.',
  },
  {
    id: 'particle',
    label: 'Unity ParticleSystem',
    test: (f, text) => /ParticleSystem:/.test(text),
    impact: 'Đa số module được port, nhưng sub-emitter và trail cần kiểm tra.',
    action: 'Port bằng port.prefab rồi so sánh bằng mắt.',
  },
  {
    id: 'coroutine',
    label: 'Coroutine',
    test: (f, text) => /StartCoroutine|IEnumerator|yield return/.test(text),
    impact: 'Cocos không có coroutine.',
    action: 'Chuyển sang async/await, scheduleOnce hoặc cc.tween.',
  },
];

/** Tốc độ port đo được trên MyCozyHome (sau khi sửa PERF-01). */
const MEASURED_SECONDS_PER_PREFAB = 2.9;
const MEASURED_SECONDS_PER_PREFAB_JOBS4 = 1.1;

/**
 * Duyệt cây thư mục, bỏ qua thư viện bên thứ ba để số liệu phản ánh code game.
 *
 * `skipped` được ghi lại và LUÔN báo ra ngoài: 'demo' và 'samples' nằm trong
 * VENDOR_DIRS, nên khi port chính một asset store package (đường dẫn kiểu
 * `AllIn1SpriteShader/Demo/Demo.unity`) toàn bộ nội dung cần port bị loại và
 * report ra `scenes: 0` — đọc như "không có scene" chứ không phải "đã bỏ qua".
 */
function walk(root, onFile, skipped) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue;
        if (!INCLUDE_VENDOR && VENDOR_DIRS.has(entry.name.toLowerCase())) {
          if (skipped) skipped.add(path.relative(root, full).replace(/\\/g, '/') || entry.name);
          continue;
        }
        stack.push(full);
        continue;
      }
      onFile(full, entry.name);
    }
  }
}

/** Đặt bởi --include-vendor; tắt hoàn toàn việc bỏ qua thư mục thư viện. */
let INCLUDE_VENDOR = false;

const TEXT_SCAN_EXT = new Set(['.cs', '.prefab', '.unity', '.asset', '.mat', '.shader', '.shadergraph']);
const MAX_TEXT_BYTES = 400 * 1024;

/**
 * Đếm GameObject và Material nhúng trong một file YAML của Unity.
 *
 * Không dùng chung đường đọc text với bộ dò blocker: file đó bị chặn ở 400KB còn
 * scene thật thường lớn hơn nhiều (Demo.unity = 1.7MB). Ở đây quét theo byte nên
 * kích thước không thành vấn đề.
 */
function countYamlDocs(file) {
  const out = { gameObjects: 0, materials: 0 };
  let buf;
  try { buf = fs.readFileSync(file); } catch (_) { return out; }
  const GAME_OBJECT = Buffer.from('\n--- !u!1 ');
  const MATERIAL = Buffer.from('\n--- !u!21 ');
  for (let i = buf.indexOf(GAME_OBJECT); i >= 0; i = buf.indexOf(GAME_OBJECT, i + 1)) out.gameObjects += 1;
  for (let i = buf.indexOf(MATERIAL); i >= 0; i = buf.indexOf(MATERIAL, i + 1)) out.materials += 1;
  return out;
}

function analyze(srcRoot, options) {
  const counts = {
    scenes: 0, prefabs: 0, scripts: 0, shaders: 0, shaderGraphs: 0,
    materials: 0, models: 0, textures: 0, animations: 0, controllers: 0, audio: 0,
  };
  const prefabs = [];
  const scenes = [];
  const blockerHits = new Map();
  const skippedVendorDirs = new Set();
  let totalBytes = 0;
  // Material nhúng thẳng trong scene/prefab (--- !u!21) không phải file .mat nên
  // cách đếm theo phần mở rộng bỏ sót hoàn toàn. Demo.unity của AllIn1SpriteShader
  // có 91 material dạng này và 0 file .mat.
  let inlineMaterials = 0;
  let sceneObjects = 0;

  const noteBlocker = (blocker, file) => {
    if (!blockerHits.has(blocker.id)) {
      blockerHits.set(blocker.id, { ...blocker, count: 0, examples: [] });
      delete blockerHits.get(blocker.id).test;
    }
    const entry = blockerHits.get(blocker.id);
    entry.count += 1;
    if (entry.examples.length < 3) {
      entry.examples.push(path.relative(srcRoot, file).replace(/\\/g, '/'));
    }
  };

  walk(srcRoot, (full, name) => {
    const ext = path.extname(name).toLowerCase();
    let size = 0;
    try { size = fs.statSync(full).size; } catch (_) { return; }
    totalBytes += size;

    if (ext === '.unity' || ext === '.prefab') {
      const inline = countYamlDocs(full);
      inlineMaterials += inline.materials;
      sceneObjects += inline.gameObjects;
      const entry = {
        path: path.relative(srcRoot, full).replace(/\\/g, '/'),
        kb: Math.round(size / 1024),
        gameObjects: inline.gameObjects,
        inlineMaterials: inline.materials,
      };
      if (ext === '.unity') { counts.scenes += 1; scenes.push(entry); }
      else { counts.prefabs += 1; prefabs.push(entry); }
    }
    else if (ext === '.cs') counts.scripts += 1;
    else if (ext === '.shader') counts.shaders += 1;
    else if (ext === '.shadergraph') counts.shaderGraphs += 1;
    else if (ext === '.mat') counts.materials += 1;
    else if (['.fbx', '.obj', '.gltf', '.glb'].includes(ext)) counts.models += 1;
    else if (['.png', '.jpg', '.jpeg', '.tga', '.psd', '.exr'].includes(ext)) counts.textures += 1;
    else if (ext === '.anim') counts.animations += 1;
    else if (ext === '.controller') counts.controllers += 1;
    else if (['.mp3', '.wav', '.ogg', '.m4a'].includes(ext)) counts.audio += 1;

    // Phát hiện blocker theo tên file (rẻ) và theo nội dung (chỉ file text nhỏ).
    let text = '';
    if (TEXT_SCAN_EXT.has(ext) && size <= MAX_TEXT_BYTES) {
      try { text = fs.readFileSync(full, 'utf8'); } catch (_) { text = ''; }
    }
    for (const blocker of BLOCKERS) {
      try { if (blocker.test(full, text)) noteBlocker(blocker, full); } catch (_) { /* ignore */ }
    }
  }, skippedVendorDirs);

  // Prefab gốc = không bị prefab nào khác tham chiếu. Xấp xỉ bằng GUID trong .meta.
  const guidToPath = new Map();
  walk(srcRoot, (full, name) => {
    if (!name.endsWith('.prefab.meta')) return;
    try {
      const meta = fs.readFileSync(full, 'utf8');
      const m = /guid:\s*([0-9a-f]{32})/.exec(meta);
      if (m) guidToPath.set(m[1], full.replace(/\.meta$/, ''));
    } catch (_) { /* ignore */ }
  });
  const referenced = new Set();
  walk(srcRoot, (full, name) => {
    if (!name.endsWith('.prefab') && !name.endsWith('.unity')) return;
    let text = '';
    try {
      if (fs.statSync(full).size > MAX_TEXT_BYTES) return;
      text = fs.readFileSync(full, 'utf8');
    } catch (_) { return; }
    for (const guid of text.matchAll(/guid:\s*([0-9a-f]{32})/g)) {
      const target = guidToPath.get(guid[1]);
      if (target && path.resolve(target) !== path.resolve(full)) referenced.add(path.resolve(target));
    }
  });

  const roots = prefabs.filter((p) => !referenced.has(path.resolve(srcRoot, p.path)));
  const byWeight = [...prefabs].sort((a, b) => b.kb - a.kb);

  counts.inlineMaterials = inlineMaterials;
  counts.sceneObjects = sceneObjects;

  return {
    counts,
    totalMb: Math.round((totalBytes / 1024 / 1024) * 10) / 10,
    scenes: scenes.sort((a, b) => b.kb - a.kb).slice(0, options.top),
    rootPrefabs: roots.sort((a, b) => b.kb - a.kb).slice(0, options.top),
    heaviestPrefabs: byWeight.slice(0, options.top),
    rootPrefabCount: roots.length,
    skippedVendorDirs: [...skippedVendorDirs].sort(),
    blockers: [...blockerHits.values()].sort((a, b) => b.count - a.count),
  };
}

function buildPlan(srcRoot, analysis, options) {
  const p = analysis.counts.prefabs;
  return {
    _meta: {
      tool: 'port-plan',
      source: srcRoot.replace(/\\/g, '/'),
      generatedFor: 'AI agent — đọc file này TRƯỚC khi port, thay cho việc quét cây thư mục',
      note: 'Chỉ đọc, không ghi gì vào project Cocos.',
    },
    inventory: { ...analysis.counts, totalMb: analysis.totalMb },
    estimate: {
      prefabs: p,
      secondsPerPrefabMeasured: MEASURED_SECONDS_PER_PREFAB,
      singleProcessMinutes: Math.round((p * MEASURED_SECONDS_PER_PREFAB) / 60),
      jobs4Minutes: Math.round((p * MEASURED_SECONDS_PER_PREFAB_JOBS4) / 60),
      basis: 'Đo trên MyCozyHome sau khi sửa PERF-01; không tính thời gian agent sửa tay.',
    },
    suggestedOrder: [
      { step: 1, what: 'Port prefab gốc trước', why: 'Prefab gốc kéo theo nested prefab, nên phủ được nhiều nhất với ít lệnh nhất.', items: analysis.rootPrefabs.map((x) => x.path) },
      { step: 2, what: 'Xử lý mọi dòng `high` trong report', why: 'high = mất hành vi hoặc mất hình ảnh.', command: 'npm run port:report -- --digest' },
      { step: 3, what: 'Chuyển shader còn thiếu', why: 'Thân shader không tự dịch được.', command: 'node playable-shared-kit/tools/unity-hlsl-to-cocos-effect.cjs batch --dir <shaders> --out-dir assets/effects' },
      { step: 4, what: 'Kiểm tra prefab đã port', why: 'Bắt UUID treo và script thiếu trước khi build.', command: 'npm run ai:verify:prefab' },
      { step: 5, what: 'Build rồi smoke test', why: 'Compile được KHÔNG có nghĩa là chạy được.', command: 'npm run build && npm run ai:verify:runtime' },
    ],
    blockers: analysis.blockers,
    heaviestPrefabs: analysis.heaviestPrefabs,
    scenes: analysis.scenes,
    // Không im lặng: một số 0 trong inventory có thể là "đã bỏ qua", không phải
    // "không tồn tại". Chạy lại với --include-vendor nếu đúng thứ cần port nằm ở đây.
    skippedVendorDirs: analysis.skippedVendorDirs,
  };
}

function printHuman(plan) {
  const inv = plan.inventory;
  console.log('');
  console.log('======================================================');
  console.log(' Unity Port Planner ');
  console.log('======================================================');
  console.log(`Nguồn: ${plan._meta.source}`);
  console.log('');
  console.log(`Tồn kho: ${inv.prefabs} prefab, ${inv.scenes} scene, ${inv.scripts} script C#, ` +
    `${inv.shaders + inv.shaderGraphs} shader, ${inv.materials} material, ${inv.models} model, ` +
    `${inv.textures} texture, ${inv.controllers} animator, ${inv.audio} audio — ${inv.totalMb} MB`);
  if (inv.sceneObjects) {
    console.log(`Trong scene/prefab: ${inv.sceneObjects} GameObject, ${inv.inlineMaterials} material nhúng ` +
      '(material nhúng KHÔNG phải file .mat, cách đếm theo phần mở rộng bỏ sót hoàn toàn)');
  }
  console.log(`Ước lượng port: ~${plan.estimate.singleProcessMinutes} phút (1 tiến trình) / ` +
    `~${plan.estimate.jobs4Minutes} phút (--jobs 4)`);
  if (plan.skippedVendorDirs && plan.skippedVendorDirs.length) {
    console.log('');
    console.log(color('yellow', `Đã BỎ QUA ${plan.skippedVendorDirs.length} thư mục thư viện: ${plan.skippedVendorDirs.slice(0, 6).join(', ')}`));
    console.log('  Số 0 ở trên có thể là "đã bỏ qua", không phải "không có". Chạy lại với --include-vendor');
    console.log('  nếu chính package đó là thứ cần port (ví dụ asset store có thư mục Demo/ hoặc Samples/).');
  }
  console.log('');

  if (plan.blockers.length) {
    console.log(color('yellow', 'Tính năng KHÔNG có đường sang Cocos:'));
    for (const b of plan.blockers) {
      console.log(`  • ${b.label} (${b.count} chỗ)`);
      console.log(`      hệ quả: ${b.impact}`);
      console.log(`      cần làm: ${b.action}`);
      if (b.examples.length) console.log(`      ví dụ: ${b.examples.join(', ')}`);
    }
    console.log('');
  }

  console.log(`Prefab gốc (${plan.suggestedOrder[0].items.length}/${plan.estimate.prefabs}) — nên port trước:`);
  for (const item of plan.suggestedOrder[0].items) console.log(`  ${item}`);
  console.log('');
  console.log('Thứ tự đề xuất:');
  for (const step of plan.suggestedOrder) {
    console.log(`  ${step.step}. ${step.what}`);
    console.log(`     ${step.why}`);
    if (step.command) console.log(`     $ ${step.command}`);
  }
  console.log('======================================================');
  console.log('');
}

function parseArgs(argv) {
  const o = { top: 15, json: false, help: false, includeVendor: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (a === '--json') { o.json = true; continue; }
    if (a === '--src') { o.src = argv[++i]; continue; }
    if (a.startsWith('--src=')) { o.src = a.slice('--src='.length); continue; }
    if (a === '--out') { o.out = argv[++i]; continue; }
    if (a.startsWith('--out=')) { o.out = a.slice('--out='.length); continue; }
    if (a === '--include-vendor') { o.includeVendor = true; continue; }
    if (a === '--top') { o.top = Number(argv[++i]) || 15; continue; }
    if (a.startsWith('--top=')) { o.top = Number(a.split('=')[1]) || 15; continue; }
  }
  return o;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(USAGE); return; }
  if (!options.src) {
    console.error('[port-plan] Thiếu --src <UnityAssetsFolder>. Xem --help.');
    process.exit(1);
  }
  const srcRoot = path.resolve(options.src);
  if (!fs.existsSync(srcRoot)) {
    console.error(`[port-plan] Không tìm thấy ${srcRoot}`);
    process.exit(1);
  }

  INCLUDE_VENDOR = !!options.includeVendor;
  const analysis = analyze(srcRoot, options);
  const plan = buildPlan(srcRoot, analysis, options);

  if (options.out) {
    fs.mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
    fs.writeFileSync(path.resolve(options.out), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
    console.log(`[port-plan] Đã ghi ${options.out}`);
  }
  if (options.json || !process.stdout.isTTY) console.log(JSON.stringify(plan, null, 2));
  else printHuman(plan);
}

if (require.main === module) main();

module.exports = { analyze, buildPlan, BLOCKERS };
