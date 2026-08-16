'use strict';

/**
 * Mobile-First Web Preview Hub & QA Dashboard Generator
 * Generates standalone index.html & 404.html for GitHub Pages.
 */

const { toSvg, toDataUri } = require('./qr-generator.cjs');

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Build the Preview Hub HTML document
 * @param {Object} data
 * @param {string} data.projectName
 * @param {string} data.githubRepoUrl
 * @param {string} data.publicBaseUrl
 * @param {string} data.gitCommitSha
 * @param {string} data.gitBranch
 * @param {string} data.buildTime
 * @param {Array<{brief: string, channel: string, relativePath: string, fullUrl: string, sizeBytes: number, mtime: string}>} data.items
 */
function generateHubHtml(data) {
  const items = data.items || [];
  const itemsJson = JSON.stringify(items);
  const defaultItem = items[0] || {
    brief: 'default',
    channel: 'web-mobile',
    relativePath: 'index.html',
    fullUrl: data.publicBaseUrl,
    sizeBytes: 0
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${escapeHtml(data.projectName)} - Playable Ads Live Preview Hub</title>
  <meta name="description" content="Live Interactive Mobile Preview &amp; QA Hub for ${escapeHtml(data.projectName)} Playable Ads.">
  <style>
    :root {
      --bg-primary: #0f172a;
      --bg-secondary: #1e293b;
      --bg-card: #182234;
      --bg-active: #334155;
      --accent-blue: #38bdf8;
      --accent-cyan: #06b6d4;
      --accent-green: #10b981;
      --accent-purple: #a855f7;
      --accent-amber: #f59e0b;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --border-color: #334155;
      --radius-sm: 8px;
      --radius-md: 14px;
      --radius-lg: 24px;
      --shadow-lg: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.4);
      --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg-primary);
      color: var(--text-main);
      font-family: var(--font-family);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
    }

    /* Top Navigation */
    header {
      background: rgba(15, 23, 42, 0.95);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border-color);
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 50;
      gap: 16px;
    }

    .brand-section {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .logo-badge {
      background: linear-gradient(135deg, var(--accent-cyan), var(--accent-blue));
      color: #0f172a;
      font-weight: 800;
      font-size: 14px;
      padding: 6px 10px;
      border-radius: var(--radius-sm);
      letter-spacing: 0.5px;
    }

    .header-title {
      font-size: 16px;
      font-weight: 700;
      color: var(--text-main);
    }
    .header-sub {
      font-size: 12px;
      color: var(--text-muted);
    }

    .meta-badges {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
      color: var(--text-muted);
      text-decoration: none;
      transition: all 0.2s ease;
    }
    .badge:hover {
      border-color: var(--accent-blue);
      color: var(--text-main);
    }
    .badge-status {
      width: 8px;
      height: 8px;
      background: var(--accent-green);
      border-radius: 50%;
      box-shadow: 0 0 8px var(--accent-green);
    }

    /* Main Container */
    main {
      flex: 1;
      display: grid;
      grid-template-columns: 320px 1fr 340px;
      gap: 20px;
      padding: 20px;
      max-width: 1800px;
      margin: 0 auto;
      width: 100%;
    }

    @media (max-width: 1200px) {
      main {
        grid-template-columns: 300px 1fr;
      }
      .right-panel {
        grid-column: span 2;
      }
    }

    @media (max-width: 860px) {
      main {
        display: flex;
        flex-direction: column;
        padding: 12px;
        gap: 16px;
      }
    }

    /* Left Sidebar: Variations Selector */
    .sidebar {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      height: fit-content;
      max-height: calc(100vh - 100px);
      overflow-y: auto;
    }

    .section-title {
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: var(--text-muted);
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .item-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 12px 14px;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      flex-direction: column;
      gap: 6px;
      text-align: left;
      width: 100%;
    }

    .item-card:hover {
      border-color: var(--accent-blue);
      transform: translateY(-2px);
    }

    .item-card.active {
      background: linear-gradient(135deg, rgba(56, 189, 248, 0.15), rgba(6, 182, 212, 0.05));
      border-color: var(--accent-blue);
      box-shadow: 0 0 0 1px var(--accent-blue);
    }

    .card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .card-brief {
      font-weight: 700;
      font-size: 14px;
      color: var(--text-main);
    }

    .card-channel {
      background: rgba(56, 189, 248, 0.2);
      color: var(--accent-blue);
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 4px;
      text-transform: uppercase;
    }

    .card-meta {
      font-size: 12px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    /* Simulator Center Workspace */
    .simulator-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
    }

    .control-bar {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 8px 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      flex-wrap: wrap;
      width: 100%;
      max-width: 600px;
    }

    .btn {
      background: var(--bg-secondary);
      color: var(--text-main);
      border: 1px solid var(--border-color);
      padding: 8px 14px;
      border-radius: var(--radius-sm);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s ease;
      text-decoration: none;
    }

    .btn:hover {
      background: var(--bg-active);
      border-color: var(--accent-blue);
      color: var(--accent-blue);
    }

    .btn.active {
      background: var(--accent-blue);
      color: #0f172a;
      border-color: var(--accent-blue);
      font-weight: 700;
    }

    .btn-primary {
      background: linear-gradient(135deg, var(--accent-cyan), var(--accent-blue));
      color: #0f172a;
      border: none;
      font-weight: 700;
    }
    .btn-primary:hover {
      opacity: 0.9;
      color: #0f172a;
    }

    /* Phone Mockup Frame */
    .device-viewport-wrapper {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .phone-frame {
      position: relative;
      background: #020617;
      border: 10px solid #334155;
      border-radius: 44px;
      box-shadow: var(--shadow-lg), 0 0 0 2px rgba(255,255,255,0.1);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      transition: all 0.3s ease;
    }

    .phone-frame.no-frame {
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      box-shadow: var(--shadow-lg);
    }

    .phone-notch {
      position: absolute;
      top: 0;
      left: 50%;
      transform: translateX(-50%);
      width: 120px;
      height: 22px;
      background: #334155;
      border-bottom-left-radius: 12px;
      border-bottom-right-radius: 12px;
      z-index: 20;
      pointer-events: none;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .phone-speaker {
      width: 40px;
      height: 4px;
      background: #0f172a;
      border-radius: 2px;
    }

    .phone-frame.no-frame .phone-notch {
      display: none;
    }

    /* Aspect Ratio Modes */
    .ratio-portrait {
      width: 375px;
      height: 667px;
    }
    .ratio-landscape {
      width: 667px;
      height: 375px;
    }
    .ratio-square {
      width: 450px;
      height: 450px;
    }
    .ratio-tablet {
      width: 540px;
      height: 720px;
    }
    .ratio-responsive {
      width: 100%;
      height: 80vh;
      max-width: 900px;
    }

    iframe#preview-frame {
      width: 100%;
      height: 100%;
      border: none;
      background: #000;
      flex: 1;
    }

    /* Right Panel: Mobile QR & QA Tools */
    .right-panel {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .qr-card {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 20px;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }

    .qr-box {
      background: #ffffff;
      padding: 12px;
      border-radius: var(--radius-sm);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      width: 190px;
      height: 190px;
    }

    .qr-box img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }

    .qr-desc {
      font-size: 13px;
      color: var(--text-muted);
      line-height: 1.4;
    }

    .cta-inspector {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .cta-log-list {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 10px;
      font-family: monospace;
      font-size: 12px;
      max-height: 180px;
      overflow-y: auto;
      color: var(--text-muted);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .cta-log-entry {
      padding: 4px 8px;
      border-radius: 4px;
      background: rgba(0,0,0,0.2);
    }
    .cta-log-entry.success {
      background: rgba(16, 185, 129, 0.15);
      border-left: 3px solid var(--accent-green);
      color: #a7f3d0;
    }

    /* Toast Notification */
    #cta-toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(100px);
      background: linear-gradient(135deg, #10b981, #059669);
      color: #ffffff;
      padding: 12px 24px;
      border-radius: 999px;
      font-weight: 700;
      font-size: 14px;
      box-shadow: 0 10px 25px rgba(16, 185, 129, 0.4);
      z-index: 100;
      transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      pointer-events: none;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    #cta-toast.show {
      transform: translateX(-50%) translateY(0);
    }

    /* Mobile specific view */
    @media (max-width: 600px) {
      .phone-frame {
        border-radius: 0;
        border: none;
        width: 100% !important;
        height: 70vh !important;
      }
      .phone-notch {
        display: none;
      }
      .control-bar {
        font-size: 12px;
      }
    }
  </style>
</head>
<body>

  <header>
    <div class="brand-section">
      <span class="logo-badge">PLAYABLE QA</span>
      <div>
        <h1 class="header-title">${escapeHtml(data.projectName)}</h1>
        <div class="header-sub">Built ${escapeHtml(data.buildTime)}</div>
      </div>
    </div>

    <div class="meta-badges">
      <span class="badge"><span class="badge-status"></span> Live</span>
      ${data.gitCommitSha ? `<a class="badge" href="${escapeHtml(data.githubRepoUrl)}/commit/${escapeHtml(data.gitCommitSha)}" target="_blank">SHA: ${escapeHtml(data.gitCommitSha.substring(0, 7))}</a>` : ''}
      ${data.githubRepoUrl ? `<a class="badge" href="${escapeHtml(data.githubRepoUrl)}" target="_blank">GitHub Repo</a>` : ''}
    </div>
  </header>

  <main>
    <!-- Left: Variations List -->
    <aside class="sidebar">
      <div class="section-title">
        <span>Playable Variations</span>
        <span>(${items.length})</span>
      </div>

      <div id="items-list" style="display: flex; flex-direction: column; gap: 8px;">
        ${items.map((item, idx) => `
          <button class="item-card ${idx === 0 ? 'active' : ''}" onclick="selectPlayable(${idx})">
            <div class="card-top">
              <span class="card-brief">${escapeHtml(item.brief)}</span>
              <span class="card-channel">${escapeHtml(item.channel)}</span>
            </div>
            <div class="card-meta">
              <span>${formatBytes(item.sizeBytes)}</span>
              <span>Single HTML</span>
            </div>
          </button>
        `).join('')}
      </div>
    </aside>

    <!-- Center: Simulator Workspace -->
    <section class="simulator-container">
      <div class="control-bar">
        <button class="btn active" id="btn-portrait" onclick="setRatio('portrait', this)">📱 9:16</button>
        <button class="btn" id="btn-landscape" onclick="setRatio('landscape', this)">🔄 16:9</button>
        <button class="btn" id="btn-square" onclick="setRatio('square', this)">🔲 1:1</button>
        <button class="btn" id="btn-frame" onclick="toggleFrame(this)">🖼️ Frame</button>
        <button class="btn" onclick="reloadPlayable()">🔁 Restart</button>
        <button class="btn btn-primary" onclick="openFullscreen()">⛶ Fullscreen</button>
        <a class="btn" id="btn-direct-link" href="${escapeHtml(defaultItem.relativePath)}" target="_blank">↗ Standalone</a>
      </div>

      <div class="device-viewport-wrapper">
        <div class="phone-frame ratio-portrait" id="phone-container">
          <div class="phone-notch"><div class="phone-speaker"></div></div>
          <iframe id="preview-frame" src="${escapeHtml(defaultItem.relativePath)}" allow="autoplay; fullscreen" sandbox="allow-scripts allow-same-origin allow-popups allow-modals allow-forms"></iframe>
        </div>
      </div>
    </section>

    <!-- Right: Mobile QR & Conversion QA -->
    <aside class="right-panel">
      <div class="qr-card">
        <div class="section-title" style="width:100%; margin:0;">
          <span>📱 Mobile Instant Scan</span>
        </div>
        <div class="qr-box" id="qr-container">
          <img id="qr-image" src="" alt="Mobile Preview QR Code">
        </div>
        <p class="qr-desc">Scan with your smartphone camera to launch playable ad directly on mobile web.</p>
        <button class="btn" style="width: 100%;" onclick="copyDirectUrl()">📋 Copy Mobile Link</button>
      </div>

      <div class="cta-inspector">
        <div class="section-title">
          <span>🎯 Store CTA Inspector</span>
          <button class="btn" style="padding: 2px 8px; font-size: 11px;" onclick="clearCtaLogs()">Clear</button>
        </div>
        <div class="cta-log-list" id="cta-logs">
          <div class="cta-log-entry">Waiting for CTA trigger...</div>
        </div>
      </div>
    </aside>
  </main>

  <div id="cta-toast">
    <span>🎯</span>
    <span id="cta-toast-msg">CTA Clicked! App Store redirection intercepted.</span>
  </div>

  <script>
    const PLAYABLES = ${itemsJson};
    let currentIndex = 0;
    let hasFrame = true;

    function getAbsoluteUrl(relPath) {
      return new URL(relPath, window.location.href).href;
    }

    function selectPlayable(index) {
      if (index < 0 || index >= PLAYABLES.length) return;
      currentIndex = index;
      const item = PLAYABLES[index];

      // Update active card in list
      const cards = document.querySelectorAll('.item-card');
      cards.forEach((c, idx) => {
        if (idx === index) c.classList.add('active');
        else c.classList.remove('active');
      });

      // Update iframe
      const frame = document.getElementById('preview-frame');
      frame.src = item.relativePath;

      // Update Direct Link button
      document.getElementById('btn-direct-link').href = item.relativePath;

      // Generate & update dynamic QR code for this direct URL
      updateQrCode(item.relativePath);
    }

    function updateQrCode(relPath) {
      const fullUrl = getAbsoluteUrl(relPath);
      // We encode the QR as an SVG via quick inline generator fallback or query API
      const qrImg = document.getElementById('qr-image');
      qrImg.src = 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=' + encodeURIComponent(fullUrl);
      qrImg.onerror = () => {
        // Fallback to client-side SVG if offline
        qrImg.alt = fullUrl;
      };
    }

    function setRatio(mode, btn) {
      const container = document.getElementById('phone-container');
      container.className = 'phone-frame ' + (hasFrame ? '' : 'no-frame ') + 'ratio-' + mode;

      document.querySelectorAll('.control-bar .btn').forEach(b => {
        if (b.id.startsWith('btn-')) b.classList.remove('active');
      });
      if (btn) btn.classList.add('active');
    }

    function toggleFrame(btn) {
      hasFrame = !hasFrame;
      const container = document.getElementById('phone-container');
      container.classList.toggle('no-frame', !hasFrame);
      btn.classList.toggle('active', hasFrame);
    }

    function reloadPlayable() {
      const frame = document.getElementById('preview-frame');
      const curSrc = frame.src;
      frame.src = 'about:blank';
      setTimeout(() => { frame.src = curSrc; }, 50);
    }

    function openFullscreen() {
      const item = PLAYABLES[currentIndex];
      if (!item) return;
      window.open(item.relativePath, '_blank');
    }

    function copyDirectUrl() {
      const item = PLAYABLES[currentIndex];
      if (!item) return;
      const url = getAbsoluteUrl(item.relativePath);
      navigator.clipboard.writeText(url).then(() => {
        showToast('Link copied to clipboard!');
      }).catch(() => {
        prompt('Copy this URL:', url);
      });
    }

    function showToast(msg) {
      const toast = document.getElementById('cta-toast');
      const text = document.getElementById('cta-toast-msg');
      text.innerText = msg;
      toast.classList.add('show');
      setTimeout(() => { toast.classList.remove('show'); }, 3000);
    }

    function clearCtaLogs() {
      document.getElementById('cta-logs').innerHTML = '<div class="cta-log-entry">Waiting for CTA trigger...</div>';
    }

    function logCtaEvent(detail) {
      const logList = document.getElementById('cta-logs');
      if (logList.innerHTML.includes('Waiting for CTA')) {
        logList.innerHTML = '';
      }
      const entry = document.createElement('div');
      entry.className = 'cta-log-entry success';
      const time = new Date().toLocaleTimeString();
      entry.innerHTML = '<strong>[' + time + '] CTA TRIGGERED</strong><br>' + detail;
      logList.prepend(entry);
      showToast('CTA Triggered! Store redirect caught.');
    }

    // Intercept CTA and messages from inside iframe
    window.addEventListener('message', (event) => {
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data && (data.action === 'download' || data.type === 'cta' || data.event === 'download' || data.name === 'SuperHtmlPlayable.download')) {
          logCtaEvent('Action: ' + (data.action || data.event || 'download') + ' | ' + (data.url || 'Store Download'));
        }
      } catch (e) {
        if (typeof event.data === 'string' && event.data.includes('download')) {
          logCtaEvent(event.data);
        }
      }
    });

    // Mock window.open / SuperHtmlPlayable hooks if same-origin allows
    window.addEventListener('load', () => {
      if (PLAYABLES.length > 0) {
        selectPlayable(0);
      }
    });
  </script>
</body>
</html>`;
}

function generate404Html(data) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="0; url=./index.html">
  <title>Redirecting to Playable Hub...</title>
</head>
<body style="background:#0f172a;color:#fff;font-family:sans-serif;text-align:center;padding-top:100px;">
  <h2>Redirecting to <a href="./index.html" style="color:#38bdf8;">Playable Preview Hub</a>...</h2>
  <script>window.location.replace('./index.html' + window.location.search + window.location.hash);</script>
</body>
</html>`;
}

module.exports = {
  generateHubHtml,
  generate404Html,
};
