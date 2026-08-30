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
 * của Node. Node 20 có WebSocket sau cờ --experimental-websocket; tool tự
 * khởi động lại đúng một lần với cờ đó thay vì báo lỗi giả trước khi mở trang.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { color } = require('./lib/term-color.cjs');

const WEBSOCKET_REEXEC_ENV = 'PLAYABLE_VERIFY_RUNTIME_WEBSOCKET_REEXEC';

/**
 * Node 20 bundles a standards-compatible WebSocket implementation but keeps it
 * behind --experimental-websocket. The project still supports Node 20, so make
 * the CLI self-healing instead of requiring every npm script/agent to know the
 * runtime flag. Returning false means the parent process already forwarded all
 * output and should exit with the child's status.
 */
function ensureWebSocketRuntime() {
  if (typeof globalThis.WebSocket === 'function') return true;
  if (process.env[WEBSOCKET_REEXEC_ENV] === '1') {
    throw new Error(
      `WebSocket không khả dụng trên ${process.version}. `
      + 'Dùng Node >=22, hoặc Node 20 có hỗ trợ --experimental-websocket.',
    );
  }

  const child = spawnSync(
    process.execPath,
    ['--experimental-websocket', __filename, ...process.argv.slice(2)],
    {
      stdio: 'inherit',
      windowsHide: true,
      env: { ...process.env, [WEBSOCKET_REEXEC_ENV]: '1' },
    },
  );
  if (child.error) throw child.error;
  process.exitCode = Number.isInteger(child.status) ? child.status : 1;
  return false;
}

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
  --preview-device <name>
                       Chọn device trong toolbar Cocos preview (vd
                       "WebpageFullScreen") trước eval/gesture/screenshot.
  --browser <path>     Đường dẫn Chrome/Edge. Mặc định: tự tìm.
  --screenshot <dir>   Nơi lưu ảnh chụp. Default: .unity/runtime-shots/
  --no-screenshot      Không chụp ảnh.
  --eval <js>          Chạy biểu thức JS TRONG trang sau khi chạy xong và in kết
                       quả (evalResult). Dùng để soi cây scene lúc runtime khi
                       playable boot được nhưng vẽ sai.
  --eval-before <js>   Chạy biểu thức trước gesture và trả evalBeforeResult.
  --gesture <spec>     Phát touch thật qua CDP: x1,y1,x2,y2,durationMs[,steps].
                       Tọa độ 0..1 là tỉ lệ trong canvas; số >1 là viewport px.
  --gesture-hold-before-move <ms>
                       Giữ touch đứng yên tại điểm bắt đầu trước khi phát các
                       touchMove; dùng để kiểm flow hold-then-drag thật.
  --gesture-keep-pressed
                       Giữ touch sau gesture để --eval và screenshot quan sát
                       trạng thái hold; tool tự nhả touch sau khi chụp.
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

function pushUniqueBounded(list, value, limit = 50, keyOf = (item) => String(item)) {
  const key = keyOf(value);
  if (list.some((item) => keyOf(item) === key)) return;
  if (list.length < limit) list.push(value);
}

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

function parseGesture(value) {
  if (!value) return null;
  const parts = String(value).split(',').map((item) => Number(item.trim()));
  if (parts.length < 5 || parts.length > 6 || parts.some((item) => !Number.isFinite(item))) {
    throw new Error('--gesture cần x1,y1,x2,y2,durationMs[,steps]');
  }
  const [x1, y1, x2, y2] = parts;
  const durationMs = Math.max(16, Math.min(5000, Math.round(parts[4])));
  const steps = Math.max(1, Math.min(120, Math.round(parts[5] || Math.max(4, durationMs / 16))));
  const normalized = [x1, y1, x2, y2].every((item) => item >= 0 && item <= 1);
  return { x1, y1, x2, y2, durationMs, steps, normalized };
}

async function evaluatePage(session, sessionId, expression) {
  const evaluated = await session.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, sessionId);
  if (evaluated && evaluated.exceptionDetails) {
    const detail = evaluated.exceptionDetails;
    throw new Error(detail.exception
      ? (detail.exception.description || detail.text)
      : detail.text);
  }
  return evaluated && evaluated.result ? evaluated.result.value : undefined;
}

async function selectCocosPreviewDevice(session, sessionId, device, timing = {}) {
  const requested = String(device || '').trim();
  if (!requested) throw new Error('preview device must be a non-empty string');
  const waitFor = timing.wait || wait;
  const persistenceWaitMs = Math.max(0, Number(timing.persistenceWaitMs ?? 250));
  const settleMs = Math.max(0, Number(timing.settleMs ?? 1000));
  const reloadPage = timing.reloadPage !== false;
  const selectedJson = await evaluatePage(session, sessionId, `JSON.stringify((function () {
    var requested = ${JSON.stringify(requested)};
    var selector = document.querySelector('#view-select');
    var previous = selector ? selector.getAttribute('value') : null;
    var options = document.querySelectorAll('li[data-device]');
    var option = null;
    for (var index = 0; index < options.length; index += 1) {
      if (options[index].getAttribute('data-device') === requested) { option = options[index]; break; }
    }
    if (!option) {
      var available = Array.prototype.map.call(options, function (item) {
        return item.getAttribute('data-device');
      });
      return { ok: false, requested: requested, available: available };
    }
    var changed = previous !== requested;
    if (changed) option.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return { ok: !!selector && selector.getAttribute('value') === requested, requested: requested,
      previous: previous, selected: selector ? selector.getAttribute('value') : null, changed: changed };
  })())`);
  const selected = JSON.parse(selectedJson || 'null');
  if (!selected?.ok) {
    const available = Array.isArray(selected?.available) ? `; available=${selected.available.join(', ')}` : '';
    throw new Error(`Cocos preview device unavailable: ${requested}${available}`);
  }
  let reloaded = false;
  if (selected.changed && reloadPage) {
    if (persistenceWaitMs > 0) await waitFor(persistenceWaitMs);
    await session.send('Page.reload', {}, sessionId);
    reloaded = true;
  }
  if (settleMs > 0) await waitFor(settleMs);
  const settledJson = await evaluatePage(session, sessionId, `JSON.stringify((function () {
    var selector = document.querySelector('#view-select');
    var canvas = document.querySelector('canvas');
    var rect = canvas ? canvas.getBoundingClientRect() : null;
    return { selected: selector ? selector.getAttribute('value') : null,
      readyState: document.readyState,
      sceneRunning: !!(window.cc && cc.director && cc.director.getScene && cc.director.getScene()),
      canvas: canvas ? { width: canvas.width, height: canvas.height,
        cssWidth: rect ? rect.width : 0, cssHeight: rect ? rect.height : 0 } : null };
  })())`);
  const settled = JSON.parse(settledJson || 'null');
  if (settled?.selected !== requested) {
    throw new Error(`Cocos preview device did not settle: requested=${requested}, selected=${settled?.selected || 'none'}`);
  }
  return { requested, previous: selected.previous || null, changed: !!selected.changed, reloaded,
    selected: settled.selected, readyState: settled.readyState || '',
    sceneRunning: !!settled.sceneRunning, canvas: settled.canvas || null };
}

async function dispatchTouchGesture(session, sessionId, gesture, timing = {}) {
  const now = timing.now || Date.now;
  const waitFor = timing.wait || wait;
  const keepPressed = timing.keepPressed === true;
  const postGestureWaitMs = timing.postGestureWaitMs === undefined ? 100
    : Math.max(0, Math.min(5000, Math.round(Number(timing.postGestureWaitMs) || 0)));
  const holdBeforeMoveMs = Math.max(0, Math.min(5000,
    Math.round(Number(timing.holdBeforeMoveMs) || 0)));
  // Headless desktop targets do not expose touch input unless emulation is
  // enabled explicitly; dispatchTouchEvent may otherwise succeed but deliver
  // nothing to the Cocos input system.
  await session.send('Emulation.setTouchEmulationEnabled', {
    enabled: true, maxTouchPoints: 5,
  }, sessionId);
  const rectJson = await evaluatePage(session, sessionId, `JSON.stringify((function () {
    var canvas = document.querySelector('canvas');
    if (!canvas) return null;
    var r = canvas.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  })())`);
  const rect = JSON.parse(rectJson || 'null');
  if (!rect || rect.width <= 0 || rect.height <= 0) throw new Error('Không tìm thấy canvas để phát gesture');
  const point = (x, y) => ({
    x: gesture.normalized ? rect.left + x * rect.width : x,
    y: gesture.normalized ? rect.top + y * rect.height : y,
  });
  const start = point(gesture.x1, gesture.y1);
  const end = point(gesture.x2, gesture.y2);
  const touch = (p) => ({ x: p.x, y: p.y, radiusX: 1, radiusY: 1, force: 1, id: 1 });
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [touch(start)],
  }, sessionId);
  if (holdBeforeMoveMs > 0) await waitFor(holdBeforeMoveMs);
  const stepDuration = gesture.durationMs / gesture.steps;
  // Keep the requested wall-clock duration stable. Waiting stepDuration after
  // every CDP round trip makes a 500 ms gesture take 1-2 seconds on Windows,
  // which materially changes inertia/rotation behavior in the game under test.
  const startedAt = now();
  const moveAcks = [];
  for (let i = 1; i <= gesture.steps; i += 1) {
    const t = i / gesture.steps;
    const current = {
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
    };
    const delay = Math.max(0, startedAt + stepDuration * i - now());
    if (delay > 0) await waitFor(delay);
    // CdpSession.send writes to the WebSocket synchronously and returns an ACK
    // promise. Do not await every ACK here: slow Editor/CDP round trips would
    // stretch the physical gesture even when deadline waits are compensated.
    moveAcks.push(session.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [touch(current)],
    }, sessionId));
  }
  const endAck = keepPressed ? null
    : session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId);
  const dispatchEnqueueElapsedMs = Math.max(0, now() - startedAt);
  await Promise.all(endAck ? [...moveAcks, endAck] : moveAcks);
  const dispatchElapsedMs = Math.max(0, now() - startedAt);
  if (postGestureWaitMs > 0) await waitFor(postGestureWaitMs);
  return {
    ...gesture,
    scheduledDurationMs: gesture.durationMs,
    dispatchEnqueueElapsedMs,
    dispatchElapsedMs,
    holdBeforeMoveMs,
    keepPressed,
    postGestureWaitMs,
    canvasRect: rect,
    start,
    end,
  };
}

async function dispatchTouchGestureSequence(session, sessionId, gestures, timing = {}) {
  if (!Array.isArray(gestures) || gestures.length < 1 || gestures.length > 8) {
    throw new Error('gesture sequence phải có 1-8 gesture');
  }
  const waitFor = timing.wait || wait;
  const gapMs = Math.max(0, Math.min(5000, Math.round(Number(timing.gapMs) || 0)));
  const results = [];
  for (let index = 0; index < gestures.length; index += 1) {
    results.push(await dispatchTouchGesture(session, sessionId, gestures[index], {
      now: timing.now,
      wait: waitFor,
      holdBeforeMoveMs: gestures.length === 1 ? timing.holdBeforeMoveMs : 0,
      keepPressed: gestures.length === 1 && timing.keepPressed === true,
      // Inter-gesture timing is governed only by gapMs. Keep the historical
      // 100 ms settle after the final lifecycle, immediately before eval.
      postGestureWaitMs: index + 1 < gestures.length ? 0 : timing.postGestureWaitMs,
    }));
    if (index + 1 < gestures.length && gapMs > 0) await waitFor(gapMs);
  }
  return { gapMs, gestures: results };
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
    exceptionDetails: [],
    consoleErrors: [],
    consoleWarnings: [],
    eventCounts: { exceptions: 0, consoleErrors: 0, consoleWarnings: 0 },
    frames: 0,
    fps: 0,
    hasCanvas: false,
    hasWebgl: false,
    hasCocos: false,
    sceneRunning: false,
    screenshot: null,
    screenshotBytes: 0,
    uniformFrame: false,
    previewDevice: null,
    previewDeviceError: '',
    previewDeviceRestored: null,
    previewDeviceRestoreError: '',
    ok: false,
  };

  let session = null;
  let attachedSessionId = null;
  let gesturePressed = false;
  try {
    const info = await waitForDevTools(port);
    session = new CdpSession(info.webSocketDebuggerUrl);
    await session.connect();

    // Mở một target mới và attach để có sessionId cho page domain.
    const { targetId } = await session.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await session.send('Target.attachToTarget', { targetId, flatten: true });
    attachedSessionId = sessionId;

    session.on('Runtime.exceptionThrown', (params) => {
      const d = params.exceptionDetails || {};
      const description = String(d.exception?.description || d.text || 'Unknown exception');
      const message = description.split('\n')[0];
      const frames = Array.isArray(d.stackTrace?.callFrames) ? d.stackTrace.callFrames : [];
      const stack = frames.slice(0, 12).map((frame) => ({
        functionName: frame.functionName || '<anonymous>',
        url: frame.url || d.url || '',
        line: Number(frame.lineNumber ?? d.lineNumber ?? -1) + 1,
        column: Number(frame.columnNumber ?? d.columnNumber ?? -1) + 1,
      }));
      const detail = {
        message,
        url: d.url || '',
        line: Number(d.lineNumber ?? -1) + 1,
        column: Number(d.columnNumber ?? -1) + 1,
        stack,
      };
      result.eventCounts.exceptions += 1;
      pushUniqueBounded(result.exceptions, message, 50);
      pushUniqueBounded(
        result.exceptionDetails,
        detail,
        20,
        (item) => `${item.message}|${item.url}|${item.line}|${item.column}`,
      );
    });
    session.on('Runtime.consoleAPICalled', (params) => {
      const text = (params.args || [])
        .map((a) => (a.value !== undefined ? a.value : a.description || a.type))
        .join(' ');
      if (params.type === 'error') {
        result.eventCounts.consoleErrors += 1;
        pushUniqueBounded(result.consoleErrors, text.slice(0, 300), 50);
      } else if (params.type === 'warning') {
        result.eventCounts.consoleWarnings += 1;
        pushUniqueBounded(result.consoleWarnings, text.slice(0, 200), 50);
      }
    });
    session.on('Log.entryAdded', (params) => {
      const e = params.entry || {};
      if (e.level === 'error') {
        result.eventCounts.consoleErrors += 1;
        pushUniqueBounded(result.consoleErrors, `[${e.source}] ${String(e.text).slice(0, 300)}`, 50);
      }
    });

    await session.send('Runtime.enable', {}, sessionId);
    await session.send('Log.enable', {}, sessionId);
    await session.send('Page.enable', {}, sessionId);
    await session.send('Page.addScriptToEvaluateOnNewDocument', { source: FRAME_COUNTER }, sessionId);
    if (options.gesture || options.gestures?.length) {
      // Enable before navigation so Cocos detects touch capability while its
      // browser input sources are being constructed.
      await session.send('Emulation.setTouchEmulationEnabled', {
        enabled: true, maxTouchPoints: 5,
      }, sessionId);
    }

    const targetUrl = isUrl ? String(target) : `file:///${htmlFile.replace(/\\/g, '/')}`;
    await session.send('Page.navigate', { url: targetUrl }, sessionId);

    await wait(Math.max(1, options.seconds) * 1000);

    if (options.previewDevice) {
      try {
        result.previewDevice = await selectCocosPreviewDevice(session, sessionId, options.previewDevice);
        if (result.previewDevice.reloaded) await wait(Math.max(1, options.seconds) * 1000);
      } catch (error) {
        result.previewDeviceError = String(error && error.message ? error.message : error);
      }
    }

    if (options.evalBeforeExpression) {
      try {
        result.evalBeforeResult = await evaluatePage(session, sessionId, options.evalBeforeExpression);
      } catch (error) {
        result.evalBeforeError = error.message;
      }
    }
    const gestureSequence = options.gestures?.length ? options.gestures
      : (options.gesture ? [options.gesture] : []);
    if (gestureSequence.length) {
      try {
        const sequence = await dispatchTouchGestureSequence(session, sessionId, gestureSequence, {
          gapMs: options.gestureGapMs,
          holdBeforeMoveMs: options.gestureHoldBeforeMoveMs,
          keepPressed: options.gestureKeepPressed === true,
        });
        result.gestures = sequence.gestures;
        result.gestureGapMs = sequence.gapMs;
        result.gesture = sequence.gestures[0] || null;
        gesturePressed = sequence.gestures.length === 1
          && sequence.gestures[0].keepPressed === true;
      } catch (error) {
        result.gestureError = error.message;
        result.eventCounts.exceptions += 1;
        pushUniqueBounded(result.exceptions, `[gesture] ${error.message}`, 50);
      }
    }
    const postActionSeconds = Math.max(0, Math.min(60, Number(options.postActionSeconds) || 0));
    if (postActionSeconds > 0) await wait(postActionSeconds * 1000);

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
    // FRAME_COUNTER is reinstalled on every navigation/reload, so measuring
    // from its first frame keeps FPS tied to the current preview document even
    // when selecting a Cocos preview device reloads the page.
    result.observationSeconds = data.firstFrameAt > 0
      ? Math.max(0.001, (Date.now() - data.firstFrameAt) / 1000)
      : Math.max(1, Number(options.seconds) || 1);
    result.fps = Math.round((result.frames / result.observationSeconds) * 10) / 10;

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
        result.evalResult = await evaluatePage(session, sessionId, options.evalExpression);
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
    if (gesturePressed) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId);
      gesturePressed = false;
    }
  } catch (error) {
    result.eventCounts.exceptions += 1;
    pushUniqueBounded(result.exceptions, `[verify-runtime] ${error.message}`, 50);
  } finally {
    if (session && attachedSessionId && gesturePressed) {
      try {
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, attachedSessionId);
      } catch (_) { /* best-effort release before closing the isolated target */ }
    }
    if (session && attachedSessionId && result.previewDevice?.previous
      && result.previewDevice.previous !== result.previewDevice.selected) {
      try {
        result.previewDeviceRestored = await selectCocosPreviewDevice(
          session, attachedSessionId, result.previewDevice.previous,
        );
      } catch (error) {
        result.previewDeviceRestoreError = String(error && error.message ? error.message : error);
      }
    }
    if (session) session.close();
    try { child.kill(); } catch (_) { /* ignore */ }
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }

  result.ok = result.exceptions.length === 0
    && result.consoleErrors.length === 0
    && !result.previewDeviceError
    && !result.previewDeviceRestoreError
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
    evalBeforeExpression: '', gesture: null, gestureHoldBeforeMoveMs: 0, gestureKeepPressed: false,
    previewDevice: '',
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
    if (a === '--preview-device') { o.previewDevice = String(argv[++i] || ''); continue; }
    if (a.startsWith('--preview-device=')) { o.previewDevice = a.slice('--preview-device='.length); continue; }
    if (a === '--browser') { o.browser = argv[++i]; continue; }
    if (a.startsWith('--browser=')) { o.browser = a.split('=')[1]; continue; }
    if (a === '--eval') { o.evalExpression = argv[++i]; continue; }
    if (a.startsWith('--eval=')) { o.evalExpression = a.slice('--eval='.length); continue; }
    if (a === '--eval-before') { o.evalBeforeExpression = argv[++i]; continue; }
    if (a.startsWith('--eval-before=')) { o.evalBeforeExpression = a.slice('--eval-before='.length); continue; }
    if (a === '--gesture') { o.gesture = parseGesture(argv[++i]); continue; }
    if (a.startsWith('--gesture=')) { o.gesture = parseGesture(a.slice('--gesture='.length)); continue; }
    if (a === '--gesture-hold-before-move') {
      o.gestureHoldBeforeMoveMs = Math.max(0, Math.min(5000, Math.round(Number(argv[++i]) || 0)));
      continue;
    }
    if (a.startsWith('--gesture-hold-before-move=')) {
      o.gestureHoldBeforeMoveMs = Math.max(0, Math.min(5000,
        Math.round(Number(a.slice('--gesture-hold-before-move='.length)) || 0)));
      continue;
    }
    if (a === '--gesture-keep-pressed') { o.gestureKeepPressed = true; continue; }
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
  try {
    if (ensureWebSocketRuntime()) {
      main().catch((error) => {
        console.error(`[verify-runtime] ERROR: ${error.message}`);
        process.exit(1);
      });
    }
  } catch (error) {
    console.error(`[verify-runtime] ERROR: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  runOne, findBuiltHtml, findBrowser, ensureWebSocketRuntime,
  parseGesture, dispatchTouchGesture, dispatchTouchGestureSequence, selectCocosPreviewDevice,
};
