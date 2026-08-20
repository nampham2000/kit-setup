#!/usr/bin/env node
'use strict';

/**
 * Port Report Digest
 * ==================
 * `.unity/port-report.csv` của một lần port thật có 1.531 dòng. Đưa cả file cho
 * AI agent là ~40k token, mà 95% là dòng lặp lại cùng một mã lỗi.
 *
 * Tool này nén report thành bảng gộp theo mã: số lần, mức độ, một ví dụ đại
 * diện, và HÀNH ĐỘNG cần làm. Mọi mã đã biết đều có hướng xử lý cụ thể — agent
 * đọc digest là biết phải làm gì, không phải suy diễn từ 1.500 dòng CSV.
 */

const fs = require('fs');
const path = require('path');

require('./lib/auto-strip-ansi.cjs');
const { color } = require('./lib/term-color.cjs');
const { parseCsv } = require('./unity-cocos-port/reporter');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const USAGE = `Port Report Digest

Usage:
  node playable-shared-kit/tools/report-digest.cjs [file.csv] [options]
  npm run port:report

Arguments:
  [file.csv]   Report cần nén. Default: .unity/port-report.csv

Options:
  --json       Xuất JSON (dùng cho AI agent / CI).
  --all        Hiện mọi mã, kể cả mức low (mặc định chỉ high + medium).
  --limit <n>  Số mã tối đa hiển thị. Default: 30.
  --help       Hiện trợ giúp và thoát.

Exit 1 khi report còn dòng mức high.`;

/** Gom các mã cùng severity thành danh sách việc cần làm, dạng một dòng mỗi mã. */
function actionList(entries, severity) {
  return entries
    .filter((entry) => entry.severity === severity)
    .map((entry) => `${entry.code} (${entry.count}x): ${entry.action}`);
}

/**
 * Việc cần làm cho từng mã. Đây là phần biến report thành hành động —
 * không có bảng này thì agent phải tự đoán ý nghĩa của từng mã.
 */
const ACTIONS = {
  SHADER_NEEDS_MANUAL_PORT: 'Mở file .effect, viết lại frag()/vert() từ khối TODO-AGENT ở cuối file.',
  CUSTOM_SHADER_NOT_PORTED: 'Chạy shader.convert cho shader gốc rồi gán effect vào material.',
  CUSTOM_SHADER_PORTED: 'Đã sinh effect — kiểm tra bằng mắt xem có giống Unity không.',
  CUSTOM_SHADER_AUTO_PORTED: 'Đã tự sinh effect — kiểm tra bằng mắt.',
  COMPONENT_UNSUPPORTED: 'Component bị bỏ: tự cài lại hành vi bằng TypeScript nếu gameplay cần.',
  COMPONENT_IGNORED_BY_DESIGN: 'Không cần làm gì — component này không mang hành vi nào cần port.',
  LAYER_UNMAPPED: 'Khai báo ánh xạ layer: --layer-map \'{"<index>":"UI_2D"}\' rồi port lại.',
  COCOS_PREFAB_INVALID_REF: 'Prefab sinh ra có graph tham chiếu sai (__id__ trỏ vào node không tồn tại) — KHÔNG mở bằng Cocos, đọc cột detail để biết ref nào hỏng rồi port lại.',
  PREFAB_NO_ROOT: 'Prefab Unity không có root transform — thường là prefab rỗng hoặc file .prefab hỏng; kiểm tra lại file gốc, thường bỏ qua được.',
  MESH_UNRESOLVED: 'MeshRenderer không tìm được mesh Cocos tương ứng: mở Cocos Creator để import model (.fbx/.glb) rồi chạy lại port.',
  NESTED_PREFAB_PLACEHOLDER: 'Prefab lồng chưa resolve được root nên chỉ sinh node rỗng thay thế — port prefab con trước, rồi port lại prefab cha.',
  SCRIPT_CLASS_UNRESOLVED: 'Chạy port.compile trên file .cs gốc để sinh class TS (port.script chỉ sinh method rỗng — chỉ dùng khi compile thất bại), rồi port lại để nối component.',
  SCRIPT_CLASS_SHAPE_MISMATCH: 'Class TS trùng tên nhưng KHÁC class Unity — prefab đang bind sai. Port class thật bằng port.compile rồi đổi tên/đặt đúng thư mục, đừng để trùng tên với class có sẵn.',
  SCRIPT_FIELD_UNKNOWN: 'Field Unity không có member tương ứng trên class Cocos nên sẽ bị drop khi load — bổ sung @property vào class TS rồi port lại.',
  SCRIPT_CLASS_SHAPE_UNKNOWN: 'Không đọc được member nào từ file TS đích; kiểm tra file có đúng là class Cocos không.',
  SCRIPT_GUID_UNRESOLVED: 'Script C# gốc không nằm trong --unity-root; mở rộng phạm vi hoặc bỏ qua nếu không cần.',
  CANVAS_NOT_PORTED: 'Dựng lại Canvas bằng UITransform + Widget của Cocos; anchor/pivot không map 1:1.',
  MODEL_SUBASSETS_PREPARED: 'Mở Cocos Creator, Assets > Refresh, rồi chạy lại để nối UUID mesh.',
  NESTED_MODEL_PENDING_MESH_WIRED: 'Như trên — cần Cocos import model trước khi nối UUID.',
  PARTICLE_CONVERTED: 'Đã port particle — so sánh bằng mắt với Unity.',
  PARTICLE_MATERIAL_CONVERTED: 'Kiểm tra material của particle (blend mode, texture).',
  PARTICLE_RENDERER_MERGED: 'Không cần làm gì — renderer được gộp vào ParticleSystem của Cocos.',
  PARTICLE_HIERARCHY_TRANSFORM_SYNC: 'Đã thêm script đồng bộ transform — không cần làm gì.',
  ANIMATOR_CONTROLLER_CONVERTED: 'Kiểm tra transition/blend tree: chúng không map 1:1.',
  ANIMATOR_DEFAULT_POSE_BAKED: 'Đã bake pose mặc định — kiểm tra tư thế ban đầu.',
  ANIMATION_CLIP_CONVERTED: 'Kiểm tra clip: curve và event có thể lệch.',
  NESTED_PREFAB_LINKED: 'Không cần làm gì.',
  NESTED_PREFAB_DEPENDENCY: 'Không cần làm gì — chỉ là ghi chú phụ thuộc.',
  NESTED_PREFAB_INSTANCE: 'Không cần làm gì.',
  NESTED_PREFAB_ASSET_WRITTEN: 'Không cần làm gì.',
  ROOT_LAYER_INHERITED: 'Không cần làm gì.',
  SPRITE_SUBASSET_PREPARED: 'Mở Cocos Creator, Assets > Refresh, rồi chạy lại để nối UUID sprite frame.',
  UI_SPRITE_ALPHA_SEP_MATERIAL_CLONED: 'Kiểm tra sprite tách alpha có hiện đúng không.',
  UI_SPRITE_ALPHA_SEP_EFFECT_PREPARED: 'Kiểm tra effect tách alpha.',
  PREFAB_PORT_FAILED: 'Port thất bại — đọc cột message để biết nguyên nhân, sửa rồi chạy lại.',
  MATERIAL_SCAFFOLDED: 'Đã sinh .mtl — gán giá trị uniform cho đúng bản Unity.',
  HLSL_TRANSPILED: 'Đã dịch cả thân shader — vẫn nên kiểm tra bằng mắt.',
  SHADERGRAPH_TRANSPILED: 'Đã dịch đồ thị node — kiểm tra bằng mắt.',
};

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

function digest(csvText, options) {
  const rows = parseCsv(csvText);
  if (!rows.length) return { total: 0, byCode: [], counts: { high: 0, medium: 0, low: 0 }, prefabs: 0 };

  const header = rows[0];
  const idx = new Map(header.map((h, i) => [h, i]));
  const get = (row, name) => row[idx.get(name)] || '';

  const byCode = new Map();
  const prefabSet = new Set();
  const counts = { high: 0, medium: 0, low: 0 };
  let total = 0;

  for (const row of rows.slice(1)) {
    const severity = (get(row, 'severity') || 'low').toLowerCase();
    const code = get(row, 'code') || 'UNKNOWN';
    if (!(severity in counts)) continue;
    total += 1;
    counts[severity] += 1;
    prefabSet.add(get(row, 'prefab'));

    if (!byCode.has(code)) {
      byCode.set(code, {
        code,
        severity,
        count: 0,
        prefabs: new Set(),
        example: '',
        action: ACTIONS[code] || 'Chưa có hướng xử lý cho mã này — đọc cột message trong CSV.',
      });
    }
    const entry = byCode.get(code);
    entry.count += 1;
    entry.prefabs.add(get(row, 'prefab'));
    // Giữ mức nặng nhất nếu cùng mã xuất hiện ở nhiều mức.
    if (SEVERITY_ORDER[severity] < SEVERITY_ORDER[entry.severity]) entry.severity = severity;
    if (!entry.example) {
      const message = get(row, 'message');
      const source = get(row, 'source');
      entry.example = `${source ? `${source} — ` : ''}${message}`.slice(0, 180);
    }
  }

  const list = [...byCode.values()]
    .map((e) => ({ ...e, prefabCount: e.prefabs.size, prefabs: undefined }))
    .sort((a, b) => {
      const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      return bySeverity !== 0 ? bySeverity : b.count - a.count;
    });

  return { total, counts, prefabs: prefabSet.size, byCode: list };
}

function parseArgs(argv) {
  const o = { json: false, all: false, limit: 30, help: false, file: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (a === '--json') { o.json = true; continue; }
    if (a === '--all') { o.all = true; continue; }
    if (a === '--limit') { o.limit = Number(argv[++i]) || 30; continue; }
    if (a.startsWith('--limit=')) { o.limit = Number(a.split('=')[1]) || 30; continue; }
    if (!a.startsWith('-')) o.file = a;
  }
  return o;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(USAGE); return; }

  const file = path.resolve(PROJECT_ROOT, options.file || path.join('.unity', 'port-report.csv'));
  if (!fs.existsSync(file)) {
    const message = `Không tìm thấy report ${path.relative(PROJECT_ROOT, file)}. Chạy port trước.`;
    if (options.json) console.log(JSON.stringify({ ok: false, tool: 'report-digest', items: [{ message }], nextActions: [] }, null, 2));
    else console.error(`[report-digest] ${message}`);
    process.exit(1);
  }

  const result = digest(fs.readFileSync(file, 'utf8'), options);
  const shown = options.all ? result.byCode : result.byCode.filter((e) => e.severity !== 'low');

  if (options.json) {
    console.log(JSON.stringify({
      ok: result.counts.high === 0,
      tool: 'report-digest',
      summary: {
        reportFile: path.relative(PROJECT_ROOT, file).replace(/\\/g, '/'),
        rows: result.total,
        prefabs: result.prefabs,
        distinctCodes: result.byCode.length,
        ...result.counts,
      },
      items: shown.slice(0, options.limit),
      // `high` alone is not enough: a prefab whose scripts were never ported
      // reports only `medium` (SCRIPT_GUID_UNRESOLVED / SCRIPT_CLASS_UNRESOLVED),
      // and an empty nextActions there reads to an agent as "nothing left to do".
      // blocking = must fix; followUp = needs a decision but does not block.
      blocking: actionList(shown, 'high'),
      followUp: actionList(shown, 'medium'),
      // Kept for callers that already read nextActions: everything actionable,
      // blocking first. Empty only when the report genuinely has nothing to act on.
      nextActions: [...actionList(shown, 'high'), ...actionList(shown, 'medium')],
    }, null, 2));
    if (result.counts.high) process.exit(1);
    return;
  }

  console.log('');
  console.log('======================================================');
  console.log(' Port Report Digest ');
  console.log('======================================================');
  console.log(`${path.relative(PROJECT_ROOT, file)}: ${result.total} dòng, ${result.prefabs} prefab, ` +
    `${result.byCode.length} mã khác nhau`);
  console.log(`high=${result.counts.high}  medium=${result.counts.medium}  low=${result.counts.low}`);
  console.log('');

  for (const entry of shown.slice(0, options.limit)) {
    const tag = entry.severity === 'high' ? color('red', '[HIGH]')
      : entry.severity === 'medium' ? color('yellow', '[MED ]') : color('gray', '[LOW ]');
    console.log(`${tag} ${entry.code}  x${entry.count} (${entry.prefabCount} prefab)`);
    console.log(`       cần làm: ${entry.action}`);
    if (entry.example) console.log(`       ${color('gray', `vd: ${entry.example}`)}`);
  }
  if (!options.all && result.counts.low) {
    console.log('');
    console.log(color('gray', `(ẩn ${result.byCode.length - shown.length} mã mức low — dùng --all để xem)`));
  }
  console.log('======================================================');
  console.log('');

  if (result.counts.high) process.exit(1);
}

if (require.main === module) main();

module.exports = { digest, ACTIONS };
