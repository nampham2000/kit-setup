#!/usr/bin/env node
'use strict';
/**
 * Live effect import check (needs the project open in Cocos Creator with the cocos-mcp extension).
 *
 * For each effect: remember the project.log size, call Cocos MCP `assetAdvanced_validate_effect_import`
 * (AssetDB reimport + asset type/importer checks), then parse every EFX entry the editor appended to
 * temp/logs/project.log into structured diagnostics: EFX code, program, and for EFX2406/EFX2407 each
 * `ERROR: 0:<line>` message together with the offending line from the numbered source dump. The MCP tool alone
 * returns only headlines.
 *
 * The offline gate (effect-compile-gate.cjs) is the primary check; this is the live confirmation.
 *
 * Usage:
 *   node effect-import-live-check.cjs [--project <CocosProjectRoot>] [files-or-dirs...] [--mcp-url <url>] [--json]
 *   node effect-import-live-check.cjs --parse-log <project.log> [--effect <name-filter>] [--json]
 */
const fs = require('node:fs');
const path = require('node:path');
const { findEffects } = require('./effect-compile-gate.cjs');

const ENTRY_START = /^\d{1,2}-\d{1,2}-\d{4} \d{1,2}:\d{2}:\d{2} - (\w+): /;

/** Split editor log text into entries (a headline line plus its continuation lines). */
function splitLogEntries(text) {
  const entries = [];
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (ENTRY_START.test(line)) {
      if (current) entries.push(current);
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) entries.push(current);
  return entries.map((lines) => lines.join('\n'));
}

/**
 * Parse EFX diagnostics out of project.log text.
 * Returns [{ effect, program, code, severity, message, glsl: [{ severity, line, message, source }] }].
 */
function parseEffectLog(text, options = {}) {
  const out = [];
  for (const entry of splitLogEntries(text)) {
    const head = /\[Assets\]\s+(\S+?\.effect)\s+-\s+(.+?):\s+(Error|Warning)\s+(EFX\d{4}):\s*([^\n]*)/.exec(entry);
    if (!head) continue;
    const [, effect, program, level, code, rawMessage] = head;
    if (options.effect && !effect.includes(options.effect)) continue;
    const message = rawMessage.split('↓↓↓↓↓')[0].replace(/Error: \[Assets\].*$/, '').trim();
    const numbered = new Map();
    for (const m of entry.matchAll(/^(\d+) (.*)$/gm)) if (!numbered.has(Number(m[1]))) numbered.set(Number(m[1]), m[2]);
    const glsl = [];
    const seen = new Set();
    for (const m of entry.matchAll(/^(ERROR|WARNING):\s*\d+:(\d+):\s*(.*)$/gm)) {
      const line = Number(m[2]);
      if (seen.has(`${line}|${m[3]}`)) continue; // the editor repeats the message inside one entry
      seen.add(`${line}|${m[3]}`);
      glsl.push({ severity: m[1].toLowerCase(), line, message: m[3].trim(), source: numbered.has(line) ? numbered.get(line).trim() : null });
    }
    out.push({ effect, program: program.trim(), code, severity: level === 'Error' ? 'error' : 'warning', message, glsl });
  }
  return out;
}

function readFrom(file, offset, maxBytes = 16 * 1024 * 1024) {
  try {
    const size = fs.statSync(file).size;
    const start = size >= offset ? offset : 0;
    const length = Math.min(size - start, maxBytes);
    if (length <= 0) return '';
    const buf = Buffer.alloc(length);
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, buf, 0, length, start); } finally { fs.closeSync(fd); }
    return buf.toString('utf8');
  } catch (_) {
    return '';
  }
}

function logSize(file) {
  try { return fs.statSync(file).size; } catch (_) { return 0; }
}

function unwrapToolResult(result) {
  if (result && result.structuredContent) return result.structuredContent;
  const text = result && Array.isArray(result.content) ? (result.content.find((c) => c.type === 'text') || {}).text : null;
  if (text) { try { return JSON.parse(text); } catch (_) { return { success: !result.isError, message: text }; } }
  return result;
}

async function liveCheck(options) {
  const { createClient } = require('../texture-compression-policy.cjs');
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const assetsRoot = path.join(projectRoot, 'assets');
  const logFile = path.join(projectRoot, 'temp', 'logs', 'project.log');
  const files = [];
  for (const target of options.targets.length ? options.targets : [assetsRoot]) files.push(...findEffects(path.resolve(target)));
  const client = await createClient({ project: projectRoot, mcpUrl: options.mcpUrl, timeoutMs: options.timeoutMs || 120000 });
  const results = [];
  try {
    for (const file of files) {
      const rel = path.relative(assetsRoot, file).split(path.sep).join('/');
      if (rel.startsWith('..')) { results.push({ file, ok: false, error: 'effect is outside assets/' }); continue; }
      const url = `db://assets/${rel}`;
      const offset = logSize(logFile);
      let payload;
      try {
        payload = unwrapToolResult(await client.call('assetAdvanced_validate_effect_import', { effectUrl: url }));
      } catch (error) {
        payload = { success: false, error: error.message };
      }
      const appended = readFrom(logFile, offset);
      const diagnostics = parseEffectLog(appended).filter((d) => rel.endsWith(d.effect) || d.effect.endsWith(path.basename(file)));
      const ok = !!(payload && payload.success) && !diagnostics.some((d) => d.severity === 'error');
      results.push({ file, url, ok, mcp: payload && payload.data ? { complete: payload.data.complete, scope: payload.data.scope, assets: payload.data.assets } : payload, diagnostics });
    }
  } finally {
    await client.close();
  }
  return { ok: results.every((r) => r.ok), logFile, results };
}

function printDiagnostics(prefix, diagnostics) {
  for (const d of diagnostics) {
    console.log(`${prefix}${d.effect} ${d.code} ${d.program}: ${d.message}`);
    for (const g of d.glsl.slice(0, 8)) console.log(`${prefix}  glsl line ${g.line}: ${g.message}${g.source ? `\n${prefix}    > ${g.source}` : ''}`);
  }
}

const USAGE = `Live Cocos effect import check (Cocos MCP reimport + project.log EFX diagnostics)

Usage:
  node effect-import-live-check.cjs [--project <CocosProjectRoot>] [files-or-dirs...] [--mcp-url <url>] [--json]
  node effect-import-live-check.cjs --parse-log <project.log> [--effect <name-filter>] [--json]

Needs the project open in Cocos Creator with cocos-mcp. Exit 0 = every effect reimported with no EFX error.`;

async function main(argv = process.argv.slice(2)) {
  const options = { targets: [], json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') options.projectRoot = argv[++i];
    else if (a === '--mcp-url') options.mcpUrl = argv[++i];
    else if (a === '--json') options.json = true;
    else if (a === '--parse-log') options.parseLog = argv[++i];
    else if (a === '--effect') options.effect = argv[++i];
    else if (a === '--timeout-ms') options.timeoutMs = Number(argv[++i]);
    else if (a === '--help' || a === '-h') { console.log(USAGE); return 0; }
    else if (a.startsWith('--')) { console.error(`unknown option ${a}\n${USAGE}`); return 2; }
    else options.targets.push(a);
  }
  if (options.parseLog) {
    const diagnostics = parseEffectLog(fs.readFileSync(options.parseLog, 'utf8'), { effect: options.effect });
    if (options.json) console.log(JSON.stringify(diagnostics, null, 2));
    else printDiagnostics('', diagnostics);
    return diagnostics.some((d) => d.severity === 'error') ? 1 : 0;
  }
  let report;
  try {
    report = await liveCheck(options);
  } catch (error) {
    console.error(`live effect check unavailable: ${error.message}`);
    return 2;
  }
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    for (const r of report.results) {
      console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.url || r.file}${r.error ? `  ${r.error}` : ''}`);
      if (!r.ok) printDiagnostics('    ', r.diagnostics);
    }
    console.log(`${report.results.filter((r) => r.ok).length}/${report.results.length} effects import cleanly (live)`);
  }
  return report.ok ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }, (error) => { console.error(error && error.stack || error); process.exitCode = 2; });
}

module.exports = { parseEffectLog, splitLogEntries, liveCheck, main };
