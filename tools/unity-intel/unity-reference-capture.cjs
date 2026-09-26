#!/usr/bin/env node
'use strict';

// Deterministic-time Unity reference frames through the shared kit's own
// Unity-MCP: queues CcPlayable.UnityIntelligence.Capture.ReferenceCapture via
// script-execute, then waits for the manifest written when Play Mode ends
// (the MCP connection drops during the Play Mode domain reload).

const fs = require('node:fs');
const path = require('node:path');
const { readUnityMcpConnection } = require('./unity-mcp-config.cjs');
const { mcpCall } = require('./unity-mcp-script.cjs');

const USAGE = `Usage: node playable-shared-kit/tools/unity-intel/unity-reference-capture.cjs --project <UnityProjectRoot> --scene <Assets/...unity> --out <dir> --frames <n,n,...> [--width 1280] [--height 720] [--frame-rate 60] [--camera <path>] [--skybox-face <size>] [--seed <n>] [--spawns <spawns.json>] [--timeout-ms 900000]`;

function parseArgs(argv) {
  const options = { width: 1280, height: 720, frameRate: 60, skyboxFace: 0, seed: 12345, timeoutMs: 900000, camera: '' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${arg} cần một giá trị.`); return v; };
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--project') options.project = next();
    else if (arg === '--scene') options.scene = next();
    else if (arg === '--out') options.out = next();
    else if (arg === '--frames') options.frames = next().split(',').map(Number);
    else if (arg === '--width') options.width = Number(next());
    else if (arg === '--height') options.height = Number(next());
    else if (arg === '--frame-rate') options.frameRate = Number(next());
    else if (arg === '--camera') options.camera = next();
    else if (arg === '--skybox-face') options.skyboxFace = Number(next());
    else if (arg === '--seed') options.seed = Number(next());
    else if (arg === '--spawns') options.spawns = readSpawns(next());
    else if (arg === '--timeout-ms') options.timeoutMs = Number(next());
    else throw new Error(`Option không hỗ trợ: ${arg}`);
  }
  if (options.help) return options;
  if (!options.project || !options.scene || !options.out || !options.frames) throw new Error('Thiếu --project, --scene, --out hoặc --frames.');
  if (!/^Assets\/.+\.unity$/.test(options.scene)) throw new Error('--scene phải là đường dẫn Assets/...unity.');
  if (!options.frames.length || options.frames.some(f => !Number.isInteger(f) || f < 0 || f > 100000)) throw new Error('--frames phải là số nguyên >= 0.');
  for (const key of ['width', 'height', 'frameRate']) {
    if (!Number.isInteger(options[key]) || options[key] < 1 || options[key] > 8192) throw new Error(`--${key} không hợp lệ.`);
  }
  return options;
}

// Demo prefabs that only appear on click/key input: [{prefab: "Assets/...prefab", frame,
// position: [x, y, z], eulerAngles?: [x, y, z]}] in Unity world space.
function readSpawns(file) {
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(list)) throw new Error('--spawns phải là JSON array.');
  const vec = (value, label) => {
    if (!Array.isArray(value) || value.length !== 3 || value.some(v => !Number.isFinite(v))) throw new Error(`--spawns ${label} phải là [x, y, z].`);
    return { x: value[0], y: value[1], z: value[2] };
  };
  return list.map((entry, index) => {
    if (!/^Assets\/.+\.prefab$/.test(entry?.prefab || ''))throw new Error(`--spawns[${index}].prefab phải là Assets/...prefab.`);
    if (!Number.isInteger(entry.frame) || entry.frame < 0) throw new Error(`--spawns[${index}].frame phải là số nguyên >= 0.`);
    return { prefab: entry.prefab, frame: entry.frame, position: vec(entry.position, `[${index}].position`),
      useRotation: !!entry.eulerAngles, eulerAngles: entry.eulerAngles ? vec(entry.eulerAngles, `[${index}].eulerAngles`) : { x: 0, y: 0, z: 0 } };
  });
}

function captureScript(request) {
  const json = JSON.stringify(request).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `public class Script { public static string Main() { return CcPlayable.UnityIntelligence.Capture.ReferenceCapture.Begin("${json}"); } }`;
}

async function waitForManifest(file, timeoutMs, sleep = ms => new Promise(r => setTimeout(r, ms))) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) {
      try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* still being written */ }
    }
    await sleep(1000);
  }
  throw Object.assign(new Error('Unity reference capture did not finish before the deadline.'), { code: 'UNITY_CAPTURE_TIMEOUT' });
}

async function captureUnityReference(options, dependencies = {}) {
  const projectRoot = path.resolve(options.project);
  const connection = (dependencies.readConnection || readUnityMcpConnection)(projectRoot, {});
  if (!connection?.url) throw Object.assign(new Error('Unity-MCP của shared kit chưa được cấu hình; chạy npm run unity:intel:setup.'), { code: 'UNITY_MCP_NOT_CONFIGURED' });
  const outputDir = path.resolve(options.out);
  fs.mkdirSync(outputDir, { recursive: true });
  const manifestFile = path.join(outputDir, 'manifest.json');
  if (fs.existsSync(manifestFile)) fs.unlinkSync(manifestFile);
  const request = {
    scenePath: options.scene,
    outputDir: outputDir.replace(/\\/g, '/'),
    cameraPath: options.camera,
    width: options.width,
    height: options.height,
    frameRate: options.frameRate,
    frames: options.frames,
    randomSeed: options.seed,
    skyboxFaceSize: options.skyboxFace,
    spawns: options.spawns || [],
  };
  const result = await mcpCall(connection, 'script-execute', { csharpCode: captureScript(request), className: 'Script', methodName: 'Main' },
    60000, dependencies.fetch);
  const text = (result?.content || []).map(item => item.text || '').join('\n');
  if (!/capture queued/.test(text)) throw Object.assign(new Error(`Unity refused the capture: ${text.slice(0, 400)}`), { code: 'UNITY_CAPTURE_REJECTED' });
  const manifest = await waitForManifest(manifestFile, options.timeoutMs, dependencies.sleep);
  if (!manifest.complete) throw Object.assign(new Error(`Unity capture failed: ${manifest.error}`), { code: 'UNITY_CAPTURE_FAILED' });
  return manifest;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) { console.log(USAGE); return; }
    const manifest = await captureUnityReference(options);
    console.log(JSON.stringify({ ok: true, frames: manifest.frames.length, camera: manifest.camera, colorSpace: manifest.colorSpace }));
  } catch (error) {
    console.error(`[unity-capture] ${error.code || 'UNITY_CAPTURE_FAILED'}: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { parseArgs, captureScript, captureUnityReference };
