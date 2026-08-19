#!/usr/bin/env node
'use strict';

/**
 * AI Command Contract Verifier
 * ============================
 * Đối chiếu từng capability trong `playable-shared-kit/ai/capabilities.def.cjs`
 * với CLI THẬT. Đây là thứ chặn "doc drift" — nguyên nhân của lỗi DOC-01
 * (một lệnh shader sai được nhân bản ra 13 file tài liệu).
 *
 * Với mỗi capability, kiểm tra:
 *   1. File tool tồn tại và parse được (`node --check`).
 *   2. probe='help'   -> chạy `<probeCmd> --help`, mọi flag được ghi trong
 *                        manifest phải xuất hiện trong help output.
 *      probe='static' -> đọc source, mọi flag phải xuất hiện dưới dạng literal.
 *   3. Các token trong `expect` phải có mặt.
 *   4. npm script được nhắc tới phải tồn tại trong package.json VÀ trỏ đúng
 *      file tool mà manifest khai báo.
 *   5. status='partial' bắt buộc phải khai báo `limits`.
 *
 * Exit 1 nếu có bất kỳ sai lệch nào.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEF_FILE = path.join(PROJECT_ROOT, 'playable-shared-kit', 'ai', 'capabilities.def.cjs');

const USAGE = `AI Command Contract Verifier

Usage:
  node playable-shared-kit/tools/contract-verify.cjs [options]
  npm run ai:contract:verify

Options:
  --json    Emit the result as JSON (dùng cho CI).
  --help    Show this help and exit.

Verifies every capability in playable-shared-kit/ai/capabilities.def.cjs
against the real CLI. Exit code 1 on any drift.`;

const PROBE_TIMEOUT_MS = 45000;

// ─────────────────────────────────────────────────────────────── helpers ──

/** Rút flag từ danh sách arg dạng '--src <x>' | '-m' | '--provider <a|b>'. */
function extractFlags(list) {
  const flags = [];
  for (const entry of list || []) {
    const match = String(entry).trim().match(/^(--?[A-Za-z][A-Za-z0-9-]*)/);
    if (match) flags.push(match[1]);
  }
  return flags;
}

/** Đường dẫn file .cjs đầu tiên xuất hiện trong một chuỗi lệnh. */
function toolFileFromCommand(cmd) {
  const match = String(cmd || '').match(/([A-Za-z0-9_./-]*playable-shared-kit\/tools\/[A-Za-z0-9_.-]+\.cjs)/);
  return match ? match[1] : null;
}

function runProbe(probeCmd) {
  const parts = String(probeCmd).trim().split(/\s+/);
  const bin = parts[0];
  const argv = [...parts.slice(1), '--help'];
  try {
    const out = execFileSync(bin, argv, {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    return { ok: true, output: out || '' };
  } catch (error) {
    // Nhiều CLI thoát khác 0 khi in usage — vẫn coi output là hợp lệ để đối chiếu.
    const output = `${error.stdout || ''}${error.stderr || ''}`;
    if (output.trim()) return { ok: true, output, exitCode: error.status };
    return { ok: false, output, error: error.message };
  }
}

function nodeSyntaxCheck(file) {
  try {
    execFileSync(process.execPath, ['--check', path.join(PROJECT_ROOT, file)], {
      cwd: PROJECT_ROOT,
      timeout: PROBE_TIMEOUT_MS,
      stdio: 'ignore',
      windowsHide: true,
    });
    return null;
  } catch (error) {
    return `node --check failed: ${String(error.stderr || error.message).split('\n')[0]}`;
  }
}

function loadPackageScripts() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
    return pkg.scripts || {};
  } catch (_) {
    return {};
  }
}

// ───────────────────────────────────────────────────────────── the checks ──

function verifyCapability(cap, scripts, helpCache) {
  const errors = [];
  const warnings = [];

  // (1) file tool tồn tại + parse được
  const toolFile = toolFileFromCommand(cap.cmd) || cap.file;
  if (!toolFile) {
    errors.push(`Không xác định được file tool từ cmd: "${cap.cmd}"`);
  } else if (!fs.existsSync(path.join(PROJECT_ROOT, toolFile))) {
    errors.push(`Tool không tồn tại: ${toolFile}`);
  } else {
    const syntaxError = nodeSyntaxCheck(toolFile);
    if (syntaxError) errors.push(`${toolFile}: ${syntaxError}`);
  }

  // (5) partial phải có limits
  if (cap.status === 'partial' && !(cap.limits || []).length) {
    errors.push("status='partial' nhưng không khai báo `limits` — agent sẽ tin nhầm kết quả.");
  }

  const documentedFlags = [...extractFlags(cap.args), ...extractFlags(cap.optional)];
  const expectTokens = cap.expect || [];

  // (2)(3) đối chiếu flag + token
  if (cap.probe === 'help') {
    const key = cap.probeCmd;
    if (!helpCache.has(key)) helpCache.set(key, runProbe(key));
    const probe = helpCache.get(key);

    if (!probe.ok) {
      errors.push(`Không chạy được help probe: ${probe.error}`);
    } else {
      const haystack = probe.output;
      const lower = haystack.toLowerCase();
      for (const flag of documentedFlags) {
        if (!haystack.includes(flag)) {
          errors.push(`Flag "${flag}" có trong manifest nhưng KHÔNG có trong help của \`${key}\`.`);
        }
      }
      for (const token of expectTokens) {
        if (!lower.includes(String(token).toLowerCase())) {
          errors.push(`Token "${token}" không xuất hiện trong help của \`${key}\`.`);
        }
      }
    }
  } else if (cap.probe === 'static') {
    const file = cap.file || toolFile;
    const full = file ? path.join(PROJECT_ROOT, file) : null;
    if (full && fs.existsSync(full)) {
      const source = fs.readFileSync(full, 'utf8');
      for (const flag of documentedFlags) {
        if (!source.includes(flag)) {
          errors.push(`Flag "${flag}" không tìm thấy trong source ${file}.`);
        }
      }
      for (const token of expectTokens) {
        if (!source.includes(token)) {
          errors.push(`Token "${token}" không tìm thấy trong source ${file}.`);
        }
      }
    }
  } else {
    warnings.push(`Không khai báo probe — capability này không được kiểm chứng.`);
  }

  // (4) npm script khớp manifest
  if (cap.npm) {
    const scriptName = String(cap.npm).replace(/^npm run\s+/, '').split(/\s+/)[0];
    const body = scripts[scriptName];
    if (!body) {
      errors.push(`npm script "${scriptName}" không tồn tại trong package.json.`);
    } else if (toolFile) {
      const scriptTool = toolFileFromCommand(body);
      if (scriptTool && scriptTool !== toolFile) {
        errors.push(`npm script "${scriptName}" chạy ${scriptTool} nhưng manifest ghi ${toolFile}.`);
      }
    }
  }

  return { id: cap.id, errors, warnings };
}

// ───────────────────────────────────────────────────────────────── runner ──

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return;
  }
  const isJson = args.includes('--json');

  if (!fs.existsSync(DEF_FILE)) {
    console.error(`[contract-verify] Không tìm thấy ${path.relative(PROJECT_ROOT, DEF_FILE)}`);
    process.exit(1);
  }

  const { CAPABILITIES } = require(DEF_FILE);
  const scripts = loadPackageScripts();
  const helpCache = new Map();

  const results = CAPABILITIES.map((cap) => verifyCapability(cap, scripts, helpCache));
  const failed = results.filter((r) => r.errors.length);
  const warned = results.filter((r) => !r.errors.length && r.warnings.length);

  if (isJson) {
    console.log(JSON.stringify({
      ok: failed.length === 0,
      tool: 'contract-verify',
      summary: {
        total: results.length,
        passed: results.length - failed.length,
        failed: failed.length,
        warnings: warned.length,
      },
      items: results.filter((r) => r.errors.length || r.warnings.length),
      nextActions: failed.length
        ? ['Sửa playable-shared-kit/ai/capabilities.def.cjs hoặc CLI cho khớp, rồi chạy `npm run ai:sync`.']
        : [],
    }, null, 2));
    if (failed.length) process.exit(1);
    return;
  }

  console.log('\n======================================================');
  console.log(' AI Command Contract Verifier ');
  console.log('======================================================');
  console.log(`Capabilities: ${results.length}\n`);

  for (const result of results) {
    if (result.errors.length) {
      console.log(`[FAIL] ${result.id}`);
      for (const err of result.errors) console.log(`    - ${err}`);
    } else if (result.warnings.length) {
      console.log(`[WARN] ${result.id}`);
      for (const warn of result.warnings) console.log(`    - ${warn}`);
    } else {
      console.log(`[ok]   ${result.id}`);
    }
  }

  console.log('\n------------------------------------------------------');
  if (failed.length) {
    console.log(`Result: FAIL — ${failed.length}/${results.length} capability lệch với CLI thật.`);
    console.log('Sửa playable-shared-kit/ai/capabilities.def.cjs hoặc CLI cho khớp, rồi chạy `npm run ai:sync`.');
    console.log('======================================================\n');
    process.exit(1);
  }
  console.log(`Result: PASS — ${results.length}/${results.length} capability khớp với CLI thật.`);
  console.log('======================================================\n');
}

if (require.main === module) {
  main();
}

module.exports = { extractFlags, toolFileFromCommand, verifyCapability };
