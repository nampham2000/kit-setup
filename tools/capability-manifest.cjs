#!/usr/bin/env node
'use strict';

/**
 * Capability Manifest Builder
 * ===========================
 * Đọc `playable-shared-kit/ai/capabilities.def.cjs` (single source of truth) và:
 *   1. Sinh `playable-shared-kit/ai/CAPABILITIES.json` (máy đọc).
 *   2. Sinh `playable-shared-kit/ai/CORE.md` (nguyên tắc bất biến cho mọi agent).
 *   3. Cung cấp các hàm render markdown để `ai-knowledge-sync.cjs` nhúng vào
 *      CLAUDE.md / AGENTS.md / GEMINI.md / .cursorrules / copilot-instructions.md
 *      giữa cặp marker BEGIN/END:GENERATED.
 *
 * Không tool nào được chép tay lệnh CLI ra file .md nữa.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const AI_DIR = path.join(PROJECT_ROOT, 'playable-shared-kit', 'ai');
const DEF_FILE = path.join(AI_DIR, 'capabilities.def.cjs');

const { CAPABILITIES, CORE_RULES } = require(DEF_FILE);

const GROUP_TITLES = {
  onboarding: 'Onboarding (chạy trước tiên)',
  port: 'Port Unity → Cocos',
  verify: 'Xác minh (bắt buộc)',
  optimize: 'Tối ưu',
  build: 'Build & Deploy',
  knowledge: 'Tri thức & bộ nhớ',
};

const GROUP_ORDER = ['onboarding', 'port', 'verify', 'optimize', 'build', 'knowledge'];

/** Lệnh ngắn gọn nhất để gọi capability: ưu tiên npm script nếu có. */
function invocation(cap) {
  if (cap.npm) return cap.npm;
  const parts = [cap.cmd, ...(cap.args || [])];
  return parts.join(' ');
}

/** Lệnh đầy đủ (luôn dùng đường dẫn tool trực tiếp) — dùng khi cần chính xác flag. */
function fullCommand(cap) {
  return [cap.cmd, ...(cap.args || [])].join(' ');
}

function statusBadge(status) {
  if (status === 'ok') return 'ok';
  if (status === 'partial') return 'partial';
  return 'broken';
}

function buildManifest() {
  const byGroup = {};
  for (const group of GROUP_ORDER) byGroup[group] = [];
  for (const cap of CAPABILITIES) {
    if (!byGroup[cap.group]) byGroup[cap.group] = [];
    byGroup[cap.group].push({
      id: cap.id,
      title: cap.title,
      run: invocation(cap),
      command: fullCommand(cap),
      optional: cap.optional || [],
      when: cap.when,
      outputs: cap.outputs || [],
      limits: cap.limits || [],
      verify: cap.verify || null,
      status: statusBadge(cap.status),
    });
  }

  return {
    _meta: {
      description:
        'Hợp đồng lệnh CLI cho AI agent. Sinh tự động từ playable-shared-kit/ai/capabilities.def.cjs. ' +
        'Không sửa file này bằng tay. Chạy `npm run ai:contract:verify` để đối chiếu với CLI thật.',
      source: 'playable-shared-kit/ai/capabilities.def.cjs',
      generatedBy: 'npm run ai:sync',
      contractCheck: 'npm run ai:contract:verify',
      count: CAPABILITIES.length,
    },
    coreRules: CORE_RULES,
    capabilities: byGroup,
  };
}

/**
 * Cheat-sheet phẳng cho PROJECT_MAP.json — key là id capability nên
 * không thể lệch khỏi manifest.
 */
function buildCheatSheet() {
  const sheet = {};
  for (const cap of CAPABILITIES) sheet[cap.id] = invocation(cap);
  return sheet;
}

// ─────────────────────────────────────────────────────────────── renderers ──

/** Bảng markdown đầy đủ, dùng cho CLAUDE.md / AGENTS.md / GEMINI.md. */
function renderCommandTable() {
  const lines = [];
  for (const group of GROUP_ORDER) {
    const caps = CAPABILITIES.filter((c) => c.group === group);
    if (!caps.length) continue;
    lines.push(`### ${GROUP_TITLES[group] || group}`);
    lines.push('');
    lines.push('| Khi nào dùng | Lệnh | Giới hạn cần biết |');
    lines.push('| --- | --- | --- |');
    for (const cap of caps) {
      const limits = (cap.limits || []).length
        ? (cap.limits || []).map((l) => l.replace(/\|/g, '\\|')).join(' ')
        : '—';
      lines.push(`| ${cap.when} | \`${invocation(cap)}\` | ${limits} |`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

/** Danh sách gạch đầu dòng gọn, dùng cho .cursorrules / copilot. */
function renderCommandList() {
  const lines = [];
  for (const group of GROUP_ORDER) {
    const caps = CAPABILITIES.filter((c) => c.group === group);
    if (!caps.length) continue;
    lines.push(`**${GROUP_TITLES[group] || group}**`);
    for (const cap of caps) {
      const warn = (cap.limits || []).length ? `  <!-- limit --> ⚠ ${cap.limits[0]}` : '';
      lines.push(`- \`${invocation(cap)}\` — ${cap.when}${warn}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

/** Chỉ các capability có giới hạn — phần agent hay bỏ sót nhất. */
function renderLimits() {
  const lines = ['Những tool sau **không làm được việc mà tên gọi gợi ý**. Đọc kỹ trước khi tin kết quả:', ''];
  for (const cap of CAPABILITIES) {
    if (!(cap.limits || []).length) continue;
    lines.push(`- **\`${cap.id}\`** (${invocation(cap)})`);
    for (const limit of cap.limits) lines.push(`  - ${limit}`);
  }
  return lines.join('\n').trimEnd();
}

function renderCoreRules() {
  return CORE_RULES.map((r, i) => `${i + 1}. **${r.id}** — ${r.rule}`).join('\n');
}

function renderCoreMd() {
  return [
    '# CORE — Nguyên tắc bất biến của cc_playable_framework',
    '',
    '> Sinh tự động từ `playable-shared-kit/ai/capabilities.def.cjs`. Không sửa tay.',
    '> Mọi AI agent (Claude, Codex, Gemini, Copilot, Cursor) đều nạp cùng file này',
    '> để ra quyết định giống nhau khi tool không nói rõ.',
    '',
    renderCoreRules(),
    '',
    '## Hợp đồng lệnh',
    '',
    'Danh sách lệnh hợp lệ duy nhất nằm ở `playable-shared-kit/ai/CAPABILITIES.json`.',
    'Nếu một lệnh trong tài liệu khác mâu thuẫn với file đó, **file đó đúng**.',
    'Chạy `npm run ai:contract:verify` để chứng minh manifest khớp với CLI thật.',
    '',
    renderCommandTable(),
    '',
    '## Giới hạn đã biết',
    '',
    renderLimits(),
    '',
  ].join('\n');
}

// ───────────────────────────────────────────────────────────────── writers ──

function writeManifest() {
  const manifest = buildManifest();
  const outJson = path.join(AI_DIR, 'CAPABILITIES.json');
  fs.writeFileSync(outJson, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const outCore = path.join(AI_DIR, 'CORE.md');
  fs.writeFileSync(outCore, renderCoreMd(), 'utf8');

  return { outJson, outCore, count: CAPABILITIES.length };
}

module.exports = {
  CAPABILITIES,
  CORE_RULES,
  buildManifest,
  buildCheatSheet,
  renderCommandTable,
  renderCommandList,
  renderLimits,
  renderCoreRules,
  renderCoreMd,
  writeManifest,
  invocation,
  fullCommand,
};

if (require.main === module) {
  const result = writeManifest();
  console.log(`[capability-manifest] ${result.count} capabilities`);
  console.log(`[capability-manifest] wrote ${path.relative(PROJECT_ROOT, result.outJson)}`);
  console.log(`[capability-manifest] wrote ${path.relative(PROJECT_ROOT, result.outCore)}`);
}
