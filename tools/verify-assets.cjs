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
 *   1. `<asset>.meta` hoặc một `subMetas.*` -> `"imported": false`
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
const { auditResourceBoundary } = require('./resource-boundary.cjs');

const FONT_MAX_BYTES = 100 * 1024;

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
function collectLogFiles (projectRoot = ROOT_DIR) {
    const files = [];
    const candidates = projectRoot === ROOT_DIR
        ? LOG_CANDIDATES
        : [
            path.join(projectRoot, 'temp', 'logs', 'project.log'),
            path.join(projectRoot, 'temp', 'asset-db', 'log'),
        ];
    for (const candidate of candidates) {
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

function stableJsonStringify (value) {
    if (Array.isArray(value)) {
        return `[${value.map(stableJsonStringify).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        const keys = Object.keys(value).sort();
        return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

/**
 * Cocos 3.8.x stores a plain JSON import at
 * `library/<uuid-prefix>/<uuid>.json` as a cc.JsonAsset wrapper. A source edit
 * can leave `.meta.imported=true` while this cache still contains the previous
 * object; preview then executes stale gameplay config even though every
 * source-only verifier is green.
 */
function inspectJsonAssetCache (projectRoot, assetFile, meta) {
    if (meta?.importer !== 'json' || meta.imported !== true || path.extname(assetFile).toLowerCase() !== '.json') {
        return null;
    }
    const uuid = String(meta.uuid || '').trim();
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(uuid)) {
        return { status: 'invalid-meta', cacheFile: null, detail: 'JSON meta thiếu UUID chuẩn của Cocos.' };
    }
    const cacheFile = path.join(projectRoot, 'library', uuid.slice(0, 2), `${uuid}.json`);
    if (!fs.existsSync(cacheFile)) {
        return { status: 'missing', cacheFile, detail: 'Không tìm thấy cc.JsonAsset cache tương ứng trong library/.' };
    }
    try {
        const source = JSON.parse(fs.readFileSync(assetFile, 'utf8').replace(/^\uFEFF/, ''));
        const imported = JSON.parse(fs.readFileSync(cacheFile, 'utf8').replace(/^\uFEFF/, ''));
        if (imported?.__type__ !== 'cc.JsonAsset' || !Object.prototype.hasOwnProperty.call(imported, 'json')) {
            return { status: 'invalid-cache', cacheFile, detail: 'Cache không phải wrapper cc.JsonAsset hợp lệ.' };
        }
        if (stableJsonStringify(source) !== stableJsonStringify(imported.json)) {
            return { status: 'stale', cacheFile, detail: 'Nội dung source JSON khác object Cocos đang dùng trong preview.' };
        }
        return { status: 'fresh', cacheFile, detail: null };
    } catch (error) {
        return { status: 'invalid-cache', cacheFile, detail: `Không parse được source/cache JSON (${error.message}).` };
    }
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

/**
 * Cocos can mark the root image/model meta imported while one generated texture,
 * sprite-frame, mesh, material or animation sub-asset is still rejected. Those
 * sub-assets are the UUIDs referenced by prefabs/materials, so root-only checks
 * produce a false PASS and the preview fails later with a missing UUID.
 */
function collectImportFailures (meta, subPath = [], out = [], stats = { checked: 0 }) {
    if (!meta || typeof meta !== 'object') return { failures: out, checked: stats.checked };
    if ('imported' in meta) {
        stats.checked += 1;
        if (meta.imported !== true) {
            out.push({ meta, subPath: [...subPath] });
            // A failed parent already covers all of its nested importer state.
            return { failures: out, checked: stats.checked };
        }
    }
    for (const [id, subMeta] of Object.entries(meta.subMetas || {})) {
        collectImportFailures(subMeta, [...subPath, id], out, stats);
    }
    return { failures: out, checked: stats.checked };
}

function run (options = {}) {
    const projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : ROOT_DIR;
    const assetsDir = path.join(projectRoot, 'assets');
    const scanRoot = options.scanPath ? path.resolve(projectRoot, options.scanPath) : assetsDir;
    const result = {
        name: 'Asset Import Status',
        status: 'PASS',
        errors: [],
        warnings: [],
        details: '',
        scanned: 0,
        importerStatesScanned: 0,
        failed: [],
        logsRead: [],
        jsonCacheStatesScanned: 0,
        staleJsonAssets: [],
        fontFilesScanned: 0,
        overBudgetFonts: [],
        resourceBoundary: null,
    };

    if (!fs.existsSync(scanRoot)) {
        result.status = 'FAIL';
        result.errors.push(`Không tìm thấy thư mục: ${path.relative(projectRoot, scanRoot) || scanRoot}`);
        result.details = 'Đường dẫn quét không tồn tại.';
        return result;
    }

    const metas = walkMetas(scanRoot, []);
    result.scanned = metas.length;

    const notImported = [];
    const libraryAvailable = fs.existsSync(path.join(projectRoot, 'library'));
    for (const metaFile of metas) {
        let meta;
        try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch (e) {
            result.errors.push(`${path.relative(projectRoot, metaFile).replace(/\\/g, '/')}: .meta hỏng, không parse được JSON (${e.message})`);
            continue;
        }
        const inspected = collectImportFailures(meta);
        result.importerStatesScanned += inspected.checked;
        for (const failure of inspected.failures) {
            notImported.push({ metaFile, meta: failure.meta, subPath: failure.subPath });
        }

        const assetFile = metaFile.slice(0, -'.meta'.length);
        if (path.extname(assetFile).toLowerCase() === '.ttf' && fs.existsSync(assetFile)) {
            result.fontFilesScanned += 1;
            const size = fs.statSync(assetFile).size;
            if (size > FONT_MAX_BYTES) {
                const asset = path.relative(projectRoot, assetFile).replace(/\\/g, '/');
                result.overBudgetFonts.push({ asset, size, maxBytes: FONT_MAX_BYTES });
                result.errors.push(`${asset} — FONT OVER BUDGET — ${(size / 1024).toFixed(1)} KiB vượt hard limit 100 KiB. `
                    + 'Tạo subset source-bound bằng font:subset và verify glyph/visual trước preview.');
            }
        }

        if (libraryAvailable) {
            const cacheState = inspectJsonAssetCache(projectRoot, assetFile, meta);
            if (cacheState) {
                result.jsonCacheStatesScanned += 1;
                if (cacheState.status !== 'fresh') {
                    const asset = path.relative(projectRoot, assetFile).replace(/\\/g, '/');
                    const cache = cacheState.cacheFile
                        ? path.relative(projectRoot, cacheState.cacheFile).replace(/\\/g, '/')
                        : null;
                    result.staleJsonAssets.push({ asset, cache, status: cacheState.status });
                    result.errors.push(`${asset} — JSON CACHE ${cacheState.status.toUpperCase()} — ${cacheState.detail} `
                        + 'Reimport asset qua Cocos AssetDB trước khi chạy preview.');
                }
            }
        }
    }

    if (!libraryAvailable) {
        result.warnings.push('Chưa có library/ nên chưa thể chứng minh cc.JsonAsset cache khớp source; mở Cocos và reimport trước preview.');
    }

    if (notImported.length) {
        const logFiles = collectLogFiles(projectRoot);
        result.logsRead = logFiles.map((f) => path.relative(projectRoot, f).replace(/\\/g, '/'));
        const logTexts = logFiles.map(readTail);

        for (const { metaFile, meta, subPath } of notImported) {
            const assetFile = metaFile.slice(0, -'.meta'.length);
            const rel = path.relative(projectRoot, assetFile).replace(/\\/g, '/');
            const subAsset = subPath.length ? `${rel}#subMeta:${subPath.join('/')}` : rel;
            const reason = findLogReason(path.basename(assetFile), logTexts);
            result.failed.push({
                asset: subAsset,
                importer: meta.importer || 'unknown',
                uuid: meta.uuid || null,
                reason,
            });
            result.errors.push(reason
                ? `${subAsset} — CHƯA IMPORT (importer: ${meta.importer || '?'}) — ${reason}`
                : `${subAsset} — CHƯA IMPORT (importer: ${meta.importer || '?'}) — không tìm thấy lý do trong log; mở Cocos Creator và xem Console.`);
        }
        result.status = 'FAIL';
    }

    const boundaryManifest = path.join(projectRoot, 'tools', 'resource-boundary.json');
    if (fs.existsSync(boundaryManifest)) {
        try {
            const boundary = auditResourceBoundary(projectRoot, 'tools/resource-boundary.json');
            result.resourceBoundary = {
                status: boundary.status,
                manifestSha256: boundary.manifestSha256,
                dynamicRootCount: boundary.dynamicRootCount,
                dynamicFileCount: boundary.dynamicFileCount,
                staticCatalogEntryCount: boundary.staticCatalogEntryCount,
                catalog: boundary.catalog,
                moveStates: boundary.moveStates,
                misplacedStaticCount: boundary.misplacedStatic.length,
                unclassifiedCount: boundary.unclassified.length,
            };
            for (const error of boundary.errors) {
                result.errors.push(`RESOURCE BOUNDARY — ${error}`);
            }
        } catch (error) {
            result.resourceBoundary = { status: 'FAIL', error: error.message };
            result.errors.push(`RESOURCE BOUNDARY — ${error.message}`);
        }
    }

    if (result.errors.length) result.status = 'FAIL';
    result.details = result.status === 'PASS'
        ? `${result.scanned} asset / ${result.importerStatesScanned} importer state đã import sạch; `
            + `${result.jsonCacheStatesScanned} cc.JsonAsset cache khớp source; ${result.fontFilesScanned} TTF trong budget; `
            + `${result.resourceBoundary?.staticCatalogEntryCount || 0} static asset qua resource boundary.`
        : `${result.failed.length} importer state lỗi, ${result.staleJsonAssets.length} JSON cache lỗi `
            + `và ${result.overBudgetFonts.length} font quá budget trong ${result.scanned} asset.`;
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

module.exports = { FONT_MAX_BYTES, run, collectImportFailures, inspectJsonAssetCache, stableJsonStringify };
