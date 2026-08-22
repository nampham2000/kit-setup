#!/usr/bin/env node
'use strict';

/**
 * Playable Runtime Smoke Test
 * ===========================
 * Mắt xích còn thiếu giữa "build xong" và "chạy được". Boot file HTML đã build
 * bằng Chrome headless qua DevTools Protocol rồi trả lời ba câu:
 *
 *   1. Có lỗi JavaScript nào lúc khởi động không? (exception + console.error)
 *   2. Engine có thực sự vẽ không? (canvas có kích thước, số frame đếm được, FPS)
 *   3. Khung hình đầu tiên trông thế nào? (ảnh chụp để người/agent xem)
 *
 * Không cần puppeteer/playwright: dùng Chrome/Edge có sẵn trên máy + WebSocket
 * của Node 22. Không thêm dependency nào.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { color } = require('./lib/term-color.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const USAGE = `Playable Runtime Smoke Test

Usage:
  node playable-shared-kit/tools/verify-runtime.cjs [options]
  npm run verify:runtime

Options:
  --file <path>        File HTML cần kiểm tra. Mặc định: bản build/common/ (bản network luôn báo lỗi thiếu SDK).
  --url <url>          Smoke-test một URL đang chạy, vd preview của editor:
                       --url http://localhost:7456/. Dùng khi KHÔNG muốn build.
  --all                Kiểm tra mọi file HTML trong build/.
  --seconds <n>        Thời gian chạy để đo FPS. Default: 6.
  --min-fps <n>        FPS tối thiểu coi là đạt. Default: 20.
  --window-size <WxH>  Kích thước cửa sổ Chrome. Default: 720x1280 (dọc).
  --browser <path>     Đường dẫn Chrome/Edge. Mặc định: tự tìm.
  --screenshot <dir>   Nơi lưu ảnh chụp. Default: .unity/runtime-shots/
  --no-screenshot      Không chụp ảnh.
  --eval <js>          Chạy biểu thức JS TRONG trang sau khi chạy xong và in kết
                       quả (evalResult). Dùng để soi cây scene lúc runtime khi
                       playable boot được nhưng vẽ sai.
  --json               Xuất JSON (dùng cho AI agent / CI).
  --help               Hiện trợ giúp và thoát.

Exit 1 khi có exception, console.error, hoặc không vẽ được frame nào.`;

const BROWSER_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

function findBrowser(explicit) {
  if (explicit) {
    if (fs.existsSync(explicit)) return explicit;
    throw new Error(`Không tìm thấy browser tại ${explicit}`);
  }
  for (const candidate of BROWSER_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    'Không tìm thấy Chrome/Edge. Truyền --browser <đường dẫn> hoặc cài Chrome.'
  );
}

function findBuiltHtml(options) {
  if (options.file) return [path.resolve(PROJECT_ROOT, options.file)];
  const buildRoot = path.join(PROJECT_ROOT, 'build');
  if (!fs.existsSync(buildRoot)) return [];
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (/\.html?$/i.test(entry.name)) found.push(full);
    }
  };
  walk(buildRoot);
  if (!found.length) return [];
  if (options.all) return found.sort();

  const byNewest = found.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  // Bản build cho từng ad network (applovin/facebook/...) LUÔN console.error vì
  // thiếu SDK của host, nên chọn theo mtime sẽ gần như chắc chắn FAIL oan. Chỉ bản
  // `common` là chạy độc lập được — ưu tiên nó, và trong đó ưu tiên bản không
  // minify để stack trace còn đọc được.
  const common = byNewest.filter((f) => /[\\/]common[\\/]/.test(f));
  if (common.length) {
    const readable = common.filter((f) => !/_min\.html?$/i.test(f));
    return [(readable.length ? readable : common)[0]];
  }
  return [byNewest[0]];
}

// ──────────────────────────────────────────────────────────────── CDP ──

/** Client CDP tối giản trên WebSocket có sẵn của Node. */
class CdpSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', (e) => reject(new Error(`WebSocket lỗi: ${e.message || 'unknown'}`)));
      this.ws.addEventListener('message', (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch (_) { return; }
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: res, reject: rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rej(new Error(`${msg.error.message} (${msg.error.code})`));
          else res(msg.result);
          return;
        }
        if (msg.method) {
          for (const fn of this.listeners.get(msg.method) || []) fn(msg.params || {});
        }
      });
    });
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  close() {
    try { this.ws.close(); } catch (_) { /* ignore */ }
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevTools(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      const json = await res.json();
      if (json.webSocketDebuggerUrl) return json;
    } catch (error) {
      lastError = error.message;
    }
    await wait(250);
  }
  throw new Error(`Chrome không mở được cổng debug ${port}: ${lastError}`);
}

/** Script chèn trước khi trang chạy: đếm frame để tính FPS thật. */
const FRAME_COUNTER = `
  (function () {
    window.__playableFrames = 0;
    window.__playableFirstFrameAt = 0;
    var raf = window.requestAnimationFrame;
    function tick(t) {
      window.__playableFrames++;
      if (!window.__playableFirstFrameAt) window.__playableFirstFrameAt = Date.now();
      raf(tick);
    }
    raf(tick);
  })();
`;

/** Đo trong trang: canvas, engine, số frame. */
const PROBE = `
  (function () {
    var canvas = document.querySelector('canvas');
    var gl = null;
    if (canvas) {
      try { gl = canvas.getContext('webgl2') || canvas.getContext('webgl'); } catch (e) {}
    }
    return JSON.stringify({
      hasCanvas: !!canvas,
      canvasWidth: canvas ? canvas.width : 0,
      canvasHeight: canvas ? canvas.height : 0,
      hasWebgl: !!gl,
      frames: window.__playableFrames || 0,
      firstFrameAt: window.__playableFirstFrameAt || 0,
      hasCocos: typeof window.cc !== 'undefined',
      sceneRunning: !!(window.cc && cc.director && cc.director.getScene && cc.director.getScene()),
      title: document.title || ''
    });
  })();
`;

/** True when the target is an http(s) URL rather than a built HTML file. */
function isUrlTarget(target) {
  return /^https?:\/\//i.test(String(target));
}

/**
 * `target` is either a built .html path or an http(s) URL. The URL form is what
 * lets the editor's live preview be smoke-tested without producing a build -
 * same checks, same monochrome-frame heuristic.
 */
async function runOne(target, options) {
  const isUrl = isUrlTarget(target);
  const htmlFile = isUrl ? null : target;
  const browser = findBrowser(options.browser);
  const port = 9400 + Math.floor((Date.now() / 97) % 400);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'playable-runtime-'));

  const child = spawn(browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--mute-audio',
    '--allow-file-access-from-files',
    `--window-size=${options.windowSize || '720,1280'}`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true });

  const result = {
    file: isUrl ? String(target) : path.relative(PROJECT_ROOT, htmlFile).replace(/\\/g, '/'),
    sizeKb: isUrl ? null : Math.round(fs.statSync(htmlFile).size / 1024),
    exceptions: [],
    consoleErrors: [],
    consoleWarnings: [],
    frames: 0,
    fps: 0,
    hasCanvas: false,
    hasWebgl: false,
    hasCocos: false,
    sceneRunning: false,
    screenshot: null,
    screenshotBytes: 0,
    uniformFrame: false,
    ok: false,
  };

  let session = null;
  try {
    const info = await waitForDevTools(port);
    session = new CdpSession(info.webSocketDebuggerUrl);
    await session.connect();

    // Mở một target mới và attach để có sessionId cho page domain.
    const { targetId } = await session.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await session.send('Target.attachToTarget', { targetId, flatten: true });

    session.on('Runtime.exceptionThrown', (params) => {
      const d = params.exceptionDetails || {};
      const text = d.exception?.description || d.text || 'Unknown exception';
      result.exceptions.push(String(text).split('\n')[0]);
    });
    session.on('Runtime.consoleAPICalled', (params) => {
      const text = (params.args || [])
        .map((a) => (a.value !== undefined ? a.value : a.description || a.type))
        .join(' ');
      if (params.type === 'error') result.consoleErrors.push(text.slice(0, 300));
      else if (params.type === 'warning') result.consoleWarnings.push(text.slice(0, 200));
    });
    session.on('Log.entryAdded', (params) => {
      const e = params.entry || {};
      if (e.level === 'error') result.consoleErrors.push(`[${e.source}] ${String(e.text).slice(0, 300)}`);
    });

    await session.send('Runtime.enable', {}, sessionId);
    await session.send('Log.enable', {}, sessionId);
    await session.send('Page.enable', {}, sessionId);
    await session.send('Page.addScriptToEvaluateOnNewDocument', { source: FRAME_COUNTER }, sessionId);

    const targetUrl = isUrl ? String(target) : `file:///${htmlFile.replace(/\\/g, '/')}`;
    await session.send('Page.navigate', { url: targetUrl }, sessionId);

    await wait(Math.max(1, options.seconds) * 1000);

    const probe = await session.send('Runtime.evaluate', {
      expression: PROBE, returnByValue: true, awaitPromise: false,
    }, sessionId);
    const data = JSON.parse(probe?.result?.value || '{}');
    Object.assign(result, {
      frames: data.frames || 0,
      hasCanvas: !!data.hasCanvas,
      hasWebgl: !!data.hasWebgl,
      hasCocos: !!data.hasCocos,
      sceneRunning: !!data.sceneRunning,
      canvasSize: `${data.canvasWidth || 0}x${data.canvasHeight || 0}`,
      title: data.title || '',
    });
    result.fps = Math.round((result.frames / Math.max(1, options.seconds)) * 10) / 10;

    // KHUNG ĐƠN SẮC — kiểm tra này ra đời từ một ca thật: bản build của chính
    // repo này boot được, báo 55 FPS, WebGL bật, scene "đang chạy", nhưng màn
    // hình chỉ có màu nền. Mọi tool khác đều PASS. FPS cao KHÔNG chứng minh là
    // có vẽ nội dung.
    //
    // Không decode PNG (tránh thêm dependency): chụp 3 vùng nhỏ ở ba góc khác
    // nhau; nếu cả ba byte-identical thì khung hình gần như chắc chắn đơn sắc.
    const w = Math.max(1, Number(data.canvasWidth) || 720);
    const h = Math.max(1, Number(data.canvasHeight) || 1280);
    const clips = [
      { x: Math.floor(w * 0.15), y: Math.floor(h * 0.15), width: 16, height: 16, scale: 1 },
      { x: Math.floor(w * 0.50), y: Math.floor(h * 0.50), width: 16, height: 16, scale: 1 },
      { x: Math.floor(w * 0.80), y: Math.floor(h * 0.80), width: 16, height: 16, scale: 1 },
    ];
    const patches = [];
    for (const clip of clips) {
      try {
        const patch = await session.send('Page.captureScreenshot', { format: 'png', clip }, sessionId);
        if (patch && patch.data) patches.push(patch.data);
      } catch (_) { /* vùng nằm ngoài viewport — bỏ qua */ }
    }
    result.uniformFrame = patches.length >= 2 && patches.every((p) => p === patches[0]);

    // --eval: chạy một biểu thức TRONG trang đang chạy và trả kết quả ra JSON.
    //
    // Vì sao cần: khi playable boot được nhưng vẽ sai (node ở nhầm chỗ, material
    // rỗng, prefab chưa nạp), ảnh chụp chỉ cho biết "sai" chứ không nói "sai ở
    // đâu". Không có bước này agent phải rải console.log rồi build lại từng
    // vòng. Đây là đường duy nhất đọc được cây scene lúc chạy mà không cần
    // trình duyệt hiển thị.
    if (options.evalExpression) {
      try {
        const evaluated = await session.send('Runtime.evaluate', {
          expression: options.evalExpression,
          returnByValue: true,
          awaitPromise: true,
        }, sessionId);
        if (evaluated && evaluated.exceptionDetails) {
          result.evalError = evaluated.exceptionDetails.exception
            ? (evaluated.exceptionDetails.exception.description || evaluated.exceptionDetails.text)
            : evaluated.exceptionDetails.text;
        } else {
          result.evalResult = evaluated && evaluated.result ? evaluated.result.value : undefined;
        }
      } catch (err) {
        result.evalError = String(err && err.message ? err.message : err);
      }
    }

    if (!options.noScreenshot) {
      const shot = await session.send('Page.captureScreenshot', { format: 'png' }, sessionId);
      if (shot && shot.data) {
        const dir = path.resolve(PROJECT_ROOT, options.screenshotDir);
        fs.mkdirSync(dir, { recursive: true });
        const stem = isUrl
          ? (String(target).replace(/^https?:\/\//i, '').replace(/[^\w.-]+/g, '_').replace(/_+$/, '') || 'preview')
          : path.basename(htmlFile, path.extname(htmlFile));
        const out = path.join(dir, `${stem}.png`);
        const buffer = Buffer.from(shot.data, 'base64');
        fs.writeFileSync(out, buffer);
        result.screenshot = path.relative(PROJECT_ROOT, out).replace(/\\/g, '/');
        result.screenshotBytes = buffer.length;
      }
    }
  } catch (error) {
    result.exceptions.push(`[verify-runtime] ${error.message}`);
  } finally {
    if (session) session.close();
    try { child.kill(); } catch (_) { /* ignore */ }
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }

  result.ok = result.exceptions.length === 0
    && result.consoleErrors.length === 0
    && result.frames > 0
    && result.fps >= options.minFps
    && !result.uniformFrame;
  return result;
}

// ────────────────────────────────────────────────────────────── runner ──

/** Chấp nhận '1280x720' hoặc '1280,720'; Chrome cần dấu phẩy. */
function normaliseWindowSize(value) {
  const m = /^(\d+)\s*[x,]\s*(\d+)$/i.exec(String(value || '').trim());
  return m ? m[1] + ',' + m[2] : '720,1280';
}

function parseArgs(argv) {
  const o = {
    seconds: 6, minFps: 20, all: false, json: false, noScreenshot: false,
    screenshotDir: path.join('.unity', 'runtime-shots'), help: false, evalExpression: '',
    windowSize: '720,1280',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (a === '--all') { o.all = true; continue; }
    if (a === '--json') { o.json = true; continue; }
    if (a === '--no-screenshot') { o.noScreenshot = true; continue; }
    if (a === '--url') { o.url = argv[++i]; continue; }
    if (a.startsWith('--url=')) { o.url = a.split('=').slice(1).join('='); continue; }
    if (a === '--file') { o.file = argv[++i]; continue; }
    if (a.startsWith('--file=')) { o.file = a.split('=')[1]; continue; }
    if (a === '--seconds') { o.seconds = Number(argv[++i]) || 6; continue; }
    if (a.startsWith('--seconds=')) { o.seconds = Number(a.split('=')[1]) || 6; continue; }
    if (a === '--min-fps') { o.minFps = Number(argv[++i]) || 20; continue; }
    if (a.startsWith('--min-fps=')) { o.minFps = Number(a.split('=')[1]) || 20; continue; }
    if (a === '--window-size') { o.windowSize = normaliseWindowSize(argv[++i]); continue; }
    if (a.startsWith('--window-size=')) { o.windowSize = normaliseWindowSize(a.split('=')[1]); continue; }
    if (a === '--browser') { o.browser = argv[++i]; continue; }
    if (a.startsWith('--browser=')) { o.browser = a.split('=')[1]; continue; }
    if (a === '--eval') { o.evalExpression = argv[++i]; continue; }
    if (a.startsWith('--eval=')) { o.evalExpression = a.slice('--eval='.length); continue; }
    if (a === '--screenshot') { o.screenshotDir = argv[++i]; continue; }
    if (a.startsWith('--screenshot=')) { o.screenshotDir = a.split('=')[1]; continue; }
  }
  return o;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(USAGE); return; }

  const files = options.url ? [options.url] : findBuiltHtml(options);
  if (!files.length) {
    const message = 'Không tìm thấy file HTML nào trong build/. Chạy `npm run build` trước, hoặc truyền --file.';
    if (options.json) console.log(JSON.stringify({ ok: false, tool: 'verify-runtime', summary: { files: 0 }, items: [{ message }], nextActions: ['npm run build'] }, null, 2));
    else console.error(`[verify-runtime] ${message}`);
    process.exit(1);
  }

  const results = [];
  for (const file of files) results.push(await runOne(file, options));

  const failed = results.filter((r) => !r.ok);

  if (options.json) {
    console.log(JSON.stringify({
      ok: failed.length === 0,
      tool: 'verify-runtime',
      summary: { files: results.length, passed: results.length - failed.length, failed: failed.length },
      items: results,
      nextActions: failed.length
        ? ['Mở ảnh chụp trong .unity/runtime-shots/ và sửa exception/console.error được liệt kê.']
        : [],
    }, null, 2));
    if (failed.length) process.exit(1);
    return;
  }

  console.log('');
  console.log('======================================================');
  console.log(' Playable Runtime Smoke Test ');
  console.log('======================================================');
  for (const r of results) {
    const verdict = r.ok ? color('green', 'PASS') : color('red', 'FAIL');
    console.log(`\n[${verdict}] ${r.file}  (${r.sizeKb} KB)`);
    console.log(`   canvas=${r.canvasSize || 'không có'}  webgl=${r.hasWebgl}  cocos=${r.hasCocos}  scene=${r.sceneRunning}`);
    console.log(`   frames=${r.frames} trong ${options.seconds}s => ${r.fps} FPS (ngưỡng ${options.minFps})`);
    if (r.uniformFrame) {
      console.log(`   ${color('red', 'KHUNG ĐƠN SẮC')} — 3 vùng lấy mẫu giống hệt nhau: playable chạy nhưng KHÔNG vẽ nội dung.`);
    }
    if (r.screenshot) console.log(`   ảnh chụp: ${r.screenshot} (${Math.round(r.screenshotBytes / 1024)} KB)`);
    for (const e of r.exceptions.slice(0, 5)) console.log(`   ${color('red', 'exception')} ${e}`);
    for (const e of r.consoleErrors.slice(0, 5)) console.log(`   ${color('red', 'console.error')} ${e}`);
    if (r.consoleWarnings.length) console.log(`   ${color('yellow', 'warning')} ${r.consoleWarnings.length} cảnh báo (dùng --json để xem)`);
  }
  console.log('');
  console.log(`Kết quả: ${results.length - failed.length}/${results.length} PASS`);
  console.log('======================================================');
  console.log('');
  if (failed.length) process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[verify-runtime] ERROR: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { runOne, findBuiltHtml, findBrowser };
