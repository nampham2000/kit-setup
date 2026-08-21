#!/usr/bin/env node
'use strict';

// Bỏ escape ANSI khi output bị pipe (tiết kiệm token cho AI agent).
require('./lib/auto-strip-ansi.cjs');

/**
 * Asset Import Gate.
 *
 * Trả lời một câu hỏi mà không tool nào khác trong kit trả lời được:
 * "Cocos Creator có THỰC SỰ nhận asset này không?"
 *
 * tsc sạch, lint sạch, build exit 0 — playable vẫn có thể trắng màn hình vì một
 * asset bị editor từ chối. Nguồn sự thật duy nhất là cặp:
 *   1. `<asset>.meta` -> `"imported": false`
 *   2. dòng lỗi thật trong log của editor (KHÔNG nằm trong temp/asset-db/log/)
 *
 * Ví dụ đo được: một .effect với `#define _MainTex MainTex` bị từ chối bằng
 * `Error EFX2300: sampler '_DistortTex' does not exist`. Meta ghi imported:false,
 * build vẫn exit 0, runtime chỉ báo "effect not found". Tool này rút thẳng dòng
 * EFX2300 ra.
 *
 * Usage:
 *   node playable-shared-kit/tools/verify-assets.cjs [--json] [--path <dir>] [--quiet]
 */

const fs = require('fs');
const path = require('path');

const USAGE = `Asset Import Gate

Usage:
  node playable-shared-kit/tools/verify-assets.cjs [options]
  npm run ai:verify:assets

Options:
  --path <dir>   Chỉ quét một thư mục con của assets/. Mặc định: toàn bộ assets/.
  --json         Xuất JSON (dùng cho AI agent / CI).
  --quiet        Chỉ in dòng tổng kết.
  --help         Hiện trợ giúp và thoát.

Exit 1 khi có asset chưa import được.`;

function findProjectRoot (startDir) {
    let current = path.resolve(startDir);
    for (;;) {
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

const ASSETS_DIR = path.join(ROOT_DIR, 'assets');

/**
 * Nơi editor ghi lý do từ chối. Thứ tự = độ hữu ích: project.log chứa message
 * đầy đủ của importer; log asset-db chỉ chứa tiến trình import.
 */
const LOG_CANDIDATES = [
    path.join(ROOT_DIR, 'temp', 'logs', 'project.log'),
    path.join(ROOT_DIR, 'temp', 'asset-db', 'log'),
];

function walkMetas (dir, out) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walkMetas(full, out); continue; }
        if (entry.name.endsWith('.meta')) out.push(full);
    }
    return out;
}

/** Gom các file log của editor, mới nhất trước. */
function collectLogFiles () {
    const files = [];
    for (const candidate of LOG_CANDIDATES) {
        let stat;
        try { stat = fs.statSync(candidate); } catch (e) { continue; }
        if (stat.isFile()) { files.push({ file: candidate, mtime: stat.mtimeMs }); continue; }
        if (!stat.isDirectory()) continue;
        for (const name of fs.readdirSync(candidate)) {
            if (!name.endsWith('.log')) continue;
            const full = path.join(candidate, name);
            try { files.push({ file: full, mtime: fs.statSync(full).mtimeMs }); } catch (e) { /* skip */ }
        }
    }
    return files.sort((a, b) => b.mtime - a.mtime).map((f) => f.file);
}

/**
 * Tìm dòng lỗi nhắc tới asset. Log của editor có thể rất lớn và bị xoay vòng, nên
 * chỉ đọc phần đuôi của mỗi file và dừng ở kết quả đầu tiên tìm được.
 */
const LOG_TAIL_BYTES = 512 * 1024;

function readTail (file) {
    try {
        const size = fs.statSync(file).size;
        const start = Math.max(0, size - LOG_TAIL_BYTES);
        const fd = fs.openSync(file, 'r');
        const len = size - start;
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, start);
        fs.closeSync(fd);
        return buf.toString('utf8');
    } catch (e) { return ''; }
}

function findLogReason (basename, logTexts) {
    const needle = basename.toLowerCase();
    for (const text of logTexts) {
        for (const raw of text.split(/\r?\n/)) {
            const line = raw.trim();
            if (!line || line.toLowerCase().indexOf(needle) < 0) continue;
            if (!/error|fail|invalid|cannot|unable/i.test(line)) continue;
            // Bỏ phần timestamp và phần lặp lại "Error: ..." mà logger nối vào cuối.
            return line.replace(/^\d[\d\-: ]*-\s*/, '').split(/Error: \[/)[0].trim().slice(0, 400);
        }
    }
    return null;
}

function run (options = {}) {
    const scanRoot = options.scanPath ? path.resolve(ROOT_DIR, options.scanPath) : ASSETS_DIR;
    const result = {
        name: 'Asset Import Status',
        status: 'PASS',
        errors: [],
        warnings: [],
        details: '',
        scanned: 0,
        failed: [],
        logsRead: [],
    };

    if (!fs.existsSync(scanRoot)) {
        result.status = 'FAIL';
        result.errors.push(`Không tìm thấy thư mục: ${path.relative(ROOT_DIR, scanRoot) || scanRoot}`);
        result.details = 'Đường dẫn quét không tồn tại.';
        return result;
    }

    const metas = walkMetas(scanRoot, []);
    result.scanned = metas.length;

    const notImported = [];
    for (const metaFile of metas) {
        let meta;
        try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch (e) {
            result.errors.push(`${path.relative(ROOT_DIR, metaFile).replace(/\\/g, '/')}: .meta hỏng, không parse được JSON (${e.message})`);
            continue;
        }
        // Meta không có trường `imported` là dạng cũ; coi như chưa biết, bỏ qua.
        if (!('imported' in meta)) continue;
        if (meta.imported === true) continue;
        notImported.push({ metaFile, meta });
    }

    if (notImported.length) {
        const logFiles = collectLogFiles();
        result.logsRead = logFiles.map((f) => path.relative(ROOT_DIR, f).replace(/\\/g, '/'));
        const logTexts = logFiles.map(readTail);

        for (const { metaFile, meta } of notImported) {
            const assetFile = metaFile.slice(0, -'.meta'.length);
            const rel = path.relative(ROOT_DIR, assetFile).replace(/\\/g, '/');
            const reason = findLogReason(path.basename(assetFile), logTexts);
            result.failed.push({
                asset: rel,
                importer: meta.importer || 'unknown',
                uuid: meta.uuid || null,
                reason,
            });
            result.errors.push(reason
                ? `${rel} — CHƯA IMPORT (importer: ${meta.importer || '?'}) — ${reason}`
                : `${rel} — CHƯA IMPORT (importer: ${meta.importer || '?'}) — không tìm thấy lý do trong log; mở Cocos Creator và xem Console.`);
        }
        result.status = 'FAIL';
    }

    if (result.errors.length) result.status = 'FAIL';
    result.details = result.status === 'PASS'
        ? `${result.scanned} asset đã import sạch.`
        : `${result.failed.length}/${result.scanned} asset chưa import được.`;
    return result;
}

function main () {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); return; }

    const options = { quiet: args.includes('--quiet') };
    const pathIdx = args.indexOf('--path');
    if (pathIdx >= 0 && args[pathIdx + 1]) options.scanPath = args[pathIdx + 1];

    const report = run(options);

    if (args.includes('--json')) {
        console.log(JSON.stringify(report, null, 2));
    } else if (options.quiet) {
        console.log(`${report.status}: ${report.details}`);
    } else {
        console.log('');
        console.log('======================================================');
        console.log(' Asset Import Gate ');
        console.log('======================================================');
        console.log(`${report.status === 'PASS' ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${report.details}`);
        for (const err of report.errors) console.log(`  - ${err}`);
        if (report.status === 'FAIL' && report.logsRead.length) {
            console.log(`\n  log đã đọc: ${report.logsRead.slice(0, 3).join(', ')}`);
            console.log('  Lưu ý: log của editor bị xoay vòng khi khởi động lại — lý do có thể đã mất.');
        }
        console.log('======================================================');
    }

    if (report.status === 'FAIL') process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { run };
