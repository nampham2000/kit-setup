'use strict';
/**
 * Real GLSL ES compiler backend: headless Chrome/Edge WebGL1 + WebGL2 contexts (ANGLE shader translator).
 *
 * This is the same front-end the Cocos Creator editor (Electron/Chromium) uses for its EFX2406 check
 * (`finalTypeCheck` in shdc-lib: compileShader in a WebGL1 context), and the same one the playable meets in a
 * browser at runtime (WebGL2 -> glsl3, WebGL1 -> glsl1). ANGLE validates GLSL ES before any backend runs, so a
 * software (SwiftShader) context gives the same diagnostics as a GPU one.
 *
 * Transport: --remote-debugging-pipe (fd 3/4, NUL-delimited JSON) so no port or WebSocket is involved.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createRuntimeProfile, closeRuntimeProfile } = require('../lib/runtime-profile.cjs');

const BROWSER_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

function findBrowser(explicit, env = process.env) {
  const wanted = explicit || env.CC_PLAYABLE_GLSL_BROWSER || env.CHROME_PATH;
  if (wanted) {
    if (fs.existsSync(wanted)) return wanted;
    throw new Error(`GLSL compiler browser not found at ${wanted}`);
  }
  const found = BROWSER_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('No Chrome/Edge found for the WebGL GLSL compiler (set CC_PLAYABLE_GLSL_BROWSER). The effect compile gate fails closed.');
  return found;
}

class PipeSession {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.closed = false;
    const input = child.stdio[4];
    input.setEncoding('utf8');
    input.on('data', (chunk) => {
      this.buffer += chunk;
      let end;
      while ((end = this.buffer.indexOf('\0')) >= 0) {
        const text = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        let msg;
        try { msg = JSON.parse(text); } catch (_) { continue; }
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject, timer } = this.pending.get(msg.id);
          clearTimeout(timer);
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
          else resolve(msg.result);
        }
      }
    });
    const fail = (error) => {
      this.closed = true;
      for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(error); }
      this.pending.clear();
    };
    input.on('close', () => fail(new Error('browser pipe closed')));
    child.on('exit', () => fail(new Error('browser exited')));
  }

  send(method, params = {}, sessionId = undefined, timeoutMs = 120000) {
    if (this.closed) return Promise.reject(new Error('browser pipe closed'));
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdio[3].write(`${JSON.stringify(payload)}\0`);
    });
  }

  close() {
    this.closed = true;
    try { this.child.stdio[3].end(); } catch (_) { /* ignore */ }
  }
}

// Runs inside the page. Compiles every job in the requested context and returns info logs.
const PAGE_COMPILER = `(() => {
  const contexts = {};
  function context(kind) {
    if (contexts[kind] !== undefined) return contexts[kind];
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext(kind === 'webgl2' ? 'webgl2' : 'webgl', { depth: true, stencil: true });
    if (gl) gl.getSupportedExtensions().forEach((name) => gl.getExtension(name));
    contexts[kind] = gl || null;
    return contexts[kind];
  }
  window.__ccCompileGlsl = (jobs) => jobs.map((job) => {
    const gl = context(job.api);
    if (!gl) return { id: job.id, ok: false, unavailable: true, log: job.api + ' context unavailable' };
    const compile = (source, type) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      const ok = !!gl.getShaderParameter(shader, gl.COMPILE_STATUS);
      const log = gl.getShaderInfoLog(shader) || '';
      return { shader, ok, log };
    };
    const vs = compile(job.vert, gl.VERTEX_SHADER);
    const fs = compile(job.frag, gl.FRAGMENT_SHADER);
    let link = { ok: true, log: '' };
    if (vs.ok && fs.ok && job.link) {
      const program = gl.createProgram();
      gl.attachShader(program, vs.shader);
      gl.attachShader(program, fs.shader);
      gl.linkProgram(program);
      link = { ok: !!gl.getProgramParameter(program, gl.LINK_STATUS), log: gl.getProgramInfoLog(program) || '' };
      gl.deleteProgram(program);
    }
    gl.deleteShader(vs.shader);
    gl.deleteShader(fs.shader);
    return { id: job.id, ok: vs.ok && fs.ok && link.ok, vert: { ok: vs.ok, log: vs.log }, frag: { ok: fs.ok, log: fs.log }, link };
  });
  const info = {};
  for (const kind of ['webgl', 'webgl2']) {
    const gl = context(kind);
    info[kind] = gl ? { renderer: gl.getParameter(gl.RENDERER), version: gl.getParameter(gl.VERSION),
      maxVertexTextureUnits: gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS),
      derivatives: kind === 'webgl2' || !!gl.getExtension('OES_standard_derivatives') } : null;
  }
  return JSON.stringify(info);
})()`;

/**
 * Start a compiler. Returns { info, compile(jobs) -> results, close() }.
 * job: { id, api: 'webgl'|'webgl2', vert, frag, link }
 */
async function startWebglCompiler(options = {}) {
  const browser = findBrowser(options.browser, options.env);
  const profileRoot = options.profileRoot || path.join(os.tmpdir(), 'cc-playable-glsl');
  process.env.PLAYABLE_RUNTIME_TEMP_DIR = process.env.PLAYABLE_RUNTIME_TEMP_DIR || profileRoot;
  const profile = createRuntimeProfile(profileRoot);
  const child = spawn(browser, [
    '--headless=new',
    '--remote-debugging-pipe',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--mute-audio',
    `--user-data-dir=${profile.directory}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
  const session = new PipeSession(child);
  let sessionId;
  let info;
  try {
    const { targetInfos } = await session.send('Target.getTargets');
    let page = targetInfos.find((t) => t.type === 'page');
    if (!page) page = { targetId: (await session.send('Target.createTarget', { url: 'about:blank' })).targetId };
    sessionId = (await session.send('Target.attachToTarget', { targetId: page.targetId, flatten: true })).sessionId;
    const res = await session.send('Runtime.evaluate', { expression: PAGE_COMPILER, returnByValue: true }, sessionId);
    if (res.exceptionDetails) throw new Error(`WebGL compiler page failed: ${res.exceptionDetails.text}`);
    info = JSON.parse(res.result.value);
    if (!info.webgl && !info.webgl2) throw new Error('headless browser has no WebGL context (SwiftShader disabled?)');
  } catch (error) {
    await closeRuntimeProfile(child, session, profile).catch(() => {});
    throw error;
  }

  async function compile(jobs) {
    const results = [];
    const batchSize = options.batchSize || 24;
    for (let i = 0; i < jobs.length; i += batchSize) {
      const batch = jobs.slice(i, i + batchSize);
      const res = await session.send('Runtime.evaluate', {
        expression: `JSON.stringify(window.__ccCompileGlsl(${JSON.stringify(batch)}))`, returnByValue: true,
      }, sessionId, 300000);
      if (res.exceptionDetails) throw new Error(`WebGL compile evaluation failed: ${res.exceptionDetails.text}`);
      results.push(...JSON.parse(res.result.value));
    }
    return results;
  }

  async function close() {
    await closeRuntimeProfile(child, session, profile).catch(() => {});
  }

  return { browser, info, compile, close };
}

/** Parse ANGLE info logs: "ERROR: 0:12: 'x' : message" -> [{severity, line, message}] */
function parseInfoLog(log) {
  const out = [];
  for (const raw of String(log || '').split(/\r?\n/)) {
    const m = /^(ERROR|WARNING):\s*\d+:(\d+):\s*(.*)$/.exec(raw.trim());
    if (m) out.push({ severity: m[1].toLowerCase(), line: Number(m[2]), message: m[3].trim() });
    else if (raw.trim() && !/^\d+ compilation errors?/.test(raw.trim())) out.push({ severity: 'error', line: 0, message: raw.trim() });
  }
  return out;
}

module.exports = { startWebglCompiler, parseInfoLog, findBrowser };
