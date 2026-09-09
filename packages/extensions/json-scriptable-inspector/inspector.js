'use strict';

/**
 * ScriptableObject-style Visual JSON Inspector for Cocos Creator 3.8.
 * Renders JSON files as editable visual forms with sections, inputs, arrays, and a direct Save button.
 * Automatically hides Cocos Creator's default read-only code preview.
 */

const DEFAULT_PLAYABLE_TEMPLATE = {
  "$schema": "playable-config-v1",
  "title": "Playable Ad Config",
  "version": "1.0.0",
  "cta": {
    "googlePlayUrl": "https://play.google.com/store/apps/details?id=com.playable.ad",
    "appStoreUrl": "https://apps.apple.com/app/id123456789",
    "enableButtonPulse": true,
    "autoRedirectDelay": 0,
    "pulseScaleMultiplier": 1.08,
    "pulseDuration": 0.6
  },
  "audio": {
    "autoPlayBgm": true,
    "bgmVolume": 0.6,
    "sfxVolume": 1.0,
    "bgmSoundPath": "sound/bgm_main",
    "clickSoundPath": "sound/sfx_click",
    "successSoundPath": "sound/sfx_success",
    "winSoundPath": "sound/sfx_win"
  },
  "gameplay": {
    "targetTaps": 3,
    "autoWinTimer": 0,
    "difficulty": "normal"
  },
  "camera": {
    "defaultMode": 0,
    "transitionDuration": 0.5,
    "fovPortrait": 55,
    "fovLandscape": 45,
    "presets": [
      { "position": { "x": 0, "y": 5.5, "z": 7.5 }, "eulerRotation": { "x": -32, "y": 0, "z": 0 } },
      { "position": { "x": 0, "y": 9.5, "z": 1.2 }, "eulerRotation": { "x": -80, "y": 0, "z": 0 } },
      { "position": { "x": 0, "y": 3.2, "z": 4.2 }, "eulerRotation": { "x": -18, "y": 0, "z": 0 } }
    ]
  },
  "hero": {
    "enableIdleAnimation": true,
    "floatHeight": 0.35,
    "floatDuration": 1.4,
    "rotationDuration": 4.0,
    "punchScaleFactor": 1.3
  },
  "tracking": {
    "enableHeartbeat": true,
    "heartbeatInterval": 5,
    "gameId": "cc_playable_game"
  },
  "custom": {}
};

exports.template = `
<div class="json-scriptable-container" tabindex="0">
  <style>
    .json-scriptable-container {
      display: flex;
      flex-direction: column;
      padding: 0 10px 12px 10px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 12px;
      color: #cccccc;
      box-sizing: border-box;
      outline: none;
      position: relative;
    }
    .header-sticky-wrapper {
      position: sticky;
      top: 0;
      z-index: 100;
      background: #252525;
      padding: 10px 0 8px 0;
      margin: 0;
    }
    .header-panel {
      background: #202020;
      border: 1px solid #3a3a3a;
      border-radius: 6px;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
    }
    .header-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .asset-info {
      display: flex;
      align-items: center;
      gap: 6px;
      overflow: hidden;
    }
    .asset-icon {
      font-size: 16px;
    }
    .asset-name {
      font-weight: 600;
      color: #ffffff;
      font-size: 13px;
      white-space: nowrap;
      text-overflow: ellipsis;
      overflow: hidden;
    }
    .badge-so {
      background: #1a4971;
      color: #58a6ff;
      border: 1px solid #2188ff44;
      border-radius: 4px;
      padding: 1px 6px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .status-badge {
      font-size: 10px;
      padding: 2px 7px;
      border-radius: 10px;
      font-weight: 600;
      background: #23863622;
      color: #3fb950;
      border: 1px solid #23863666;
    }
    .status-badge.modified {
      background: #d2992222;
      color: #e3b341;
      border-color: #d2992266;
    }
    .status-badge.error {
      background: #f8514922;
      color: #f85149;
      border-color: #f8514966;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .search-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .search-input {
      flex: 1;
      min-width: 0;
      background: #181818;
      border: 1px solid #3a3a3a;
      border-radius: 4px;
      color: #f0f6fc;
      padding: 5px 8px;
      font: inherit;
    }
    .search-input:focus {
      border-color: #58a6ff;
      outline: none;
    }
    .search-count {
      color: #8b949e;
      font-size: 10px;
      min-width: 48px;
      text-align: right;
    }
    .btn {
      background: #333333;
      color: #e0e0e0;
      border: 1px solid #4a4a4a;
      border-radius: 4px;
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: all 0.15s ease;
      user-select: none;
    }
    .btn:hover {
      background: #3f3f3f;
      border-color: #666666;
      color: #ffffff;
    }
    .btn-primary {
      background: #1f6feb;
      border-color: #388bfd;
      color: #ffffff;
      font-weight: 600;
    }
    .btn-primary:hover {
      background: #388bfd;
    }
    .btn-primary.dirty {
      background: #238636;
      border-color: #2ea043;
      box-shadow: 0 0 8px rgba(46, 160, 67, 0.4);
    }
    .btn-primary.dirty:hover {
      background: #2ea043;
    }
    .btn-secondary {
      background: #2d333b;
      border-color: #444c56;
    }
    .section-card {
      background: #252525;
      border: 1px solid #363636;
      border-radius: 6px;
      margin-bottom: 8px;
      overflow: hidden;
    }
    .section-header {
      background: #2d2d2d;
      padding: 6px 10px;
      font-weight: 600;
      color: #e6edf3;
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      user-select: none;
    }
    .section-header:hover {
      background: #333333;
    }
    .section-title {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .section-content {
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .section-card.collapsed .section-content {
      display: none;
    }
    .nested-group {
      margin-left: 12px;
      border-left: 2px solid #3d3d3d;
      padding-left: 8px;
    }
    .nested-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      color: #8b949e;
      font-weight: 600;
      margin: 4px 0;
      cursor: pointer;
      user-select: none;
    }
    .nested-group.collapsed > .nested-content {
      display: none;
    }
    .search-hidden {
      display: none !important;
    }
    .search-open > .section-content,
    .search-open > .nested-content {
      display: flex !important;
    }
    .field-row {
      display: grid;
      grid-template-columns: 140px 1fr;
      align-items: center;
      gap: 8px;
      padding: 2px 0;
    }
    .field-label {
      color: #9da5b4;
      font-size: 11px;
      text-overflow: ellipsis;
      overflow: hidden;
      white-space: nowrap;
      user-select: none;
    }
    .field-input-box {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .input-text, .input-num, .input-select {
      background: #1c1c1c;
      border: 1px solid #3a3a3a;
      border-radius: 4px;
      color: #f0f6fc;
      padding: 4px 8px;
      font-size: 11px;
      width: 100%;
      box-sizing: border-box;
      font-family: inherit;
    }
    .input-text:focus, .input-num:focus, .input-select:focus {
      border-color: #58a6ff;
      outline: none;
    }
    .input-checkbox {
      width: 16px;
      height: 16px;
      cursor: pointer;
      accent-color: #1f6feb;
    }
    .raw-code-box {
      width: 100%;
      height: 380px;
      background: #181818;
      border: 1px solid #3a3a3a;
      border-radius: 6px;
      color: #79c0ff;
      font-family: Consolas, "Courier New", monospace;
      font-size: 11px;
      padding: 8px;
      box-sizing: border-box;
      resize: vertical;
      line-height: 1.4;
      tab-size: 2;
    }
    .raw-code-box:focus {
      border-color: #58a6ff;
      outline: none;
    }
    .syntax-error-bar {
      color: #f85149;
      background: #3c1414;
      border: 1px solid #8e1515;
      padding: 6px 10px;
      border-radius: 4px;
      margin-top: 6px;
      font-size: 11px;
      display: none;
    }
    .array-list {
      background: #1e1e1e;
      border: 1px solid #303030;
      border-radius: 4px;
      padding: 6px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .array-item-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .btn-icon {
      padding: 2px 6px;
      font-size: 10px;
      background: #333333;
      border: 1px solid #444444;
      border-radius: 3px;
      color: #bbb;
      cursor: pointer;
    }
    .btn-icon:hover {
      background: #444444;
      color: #fff;
    }
    .btn-icon.delete:hover {
      background: #da3633;
      border-color: #f85149;
      color: #fff;
    }
    /* Custom In-Inspector Modal Dialog */
    .custom-modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.75);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .custom-modal-box {
      background: #252525;
      border: 1px solid #58a6ff;
      border-radius: 6px;
      padding: 14px;
      width: 100%;
      max-width: 320px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.6);
    }
    .modal-title {
      font-weight: 600;
      color: #ffffff;
      font-size: 12px;
    }
    .modal-buttons {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
    }
  </style>

  <!-- In-Inspector Modal Dialog -->
  <div class="custom-modal-overlay" id="customModal" style="display: none;">
    <div class="custom-modal-box">
      <div class="modal-title" id="modalTitle">Enter Value</div>
      <input type="text" class="input-text modal-input" id="modalInput" placeholder="Name..." />
      <div class="modal-buttons">
        <button class="btn btn-primary" id="modalBtnConfirm">Confirm</button>
        <button class="btn" id="modalBtnCancel">Cancel</button>
      </div>
    </div>
  </div>

  <!-- Sticky Control Panel Header (Always on top) -->
  <div class="header-sticky-wrapper">
    <div class="header-panel">
      <div class="header-top">
        <div class="asset-info">
          <span class="asset-icon">📜</span>
          <span class="asset-name" id="assetTitle">Scriptable JSON</span>
          <span class="badge-so" id="configModeBadge">Single file</span>
        </div>
        <span class="status-badge" id="statusBadge">Saved</span>
      </div>
      <div class="toolbar">
        <button class="btn btn-primary" id="btnSave">💾 Save (Ctrl+S)</button>
        <button class="btn" id="btnRevert">↺ Revert</button>
        <button class="btn btn-secondary" id="btnToggleMode">👁️ Raw Code</button>
        <button class="btn" id="btnFormat">✨ Format</button>
        <button class="btn" id="btnAddField">➕ Add Field</button>
        <button class="btn" id="btnSplitConfig" title="Move top-level sections into editable resource fragments">🧩 Split Sections</button>
        <button class="btn" id="btnTemplate" title="Apply Default Playable Ad Preset">⚡ Playable Preset</button>
      </div>
      <div class="search-row">
        <input type="search" class="search-input" id="searchInput" placeholder="Search keys or values..." />
        <span class="search-count" id="searchCount"></span>
        <button class="btn-icon" id="btnClearSearch" title="Clear search">✕</button>
      </div>
    </div>
  </div>

  <!-- Content Sections (Scrollable underneath control panel) -->
  <div class="content-sections-container">
    <div id="visualFormView"></div>

    <div id="rawCodeView" style="display: none;">
      <textarea class="raw-code-box" id="rawJsonText" spellcheck="false"></textarea>
      <div class="syntax-error-bar" id="syntaxError"></div>
    </div>
  </div>
</div>
`;

exports.$ = {
  container: '.json-scriptable-container',
  assetTitle: '#assetTitle',
  configModeBadge: '#configModeBadge',
  statusBadge: '#statusBadge',
  btnSave: '#btnSave',
  btnRevert: '#btnRevert',
  btnToggleMode: '#btnToggleMode',
  btnFormat: '#btnFormat',
  btnAddField: '#btnAddField',
  btnSplitConfig: '#btnSplitConfig',
  btnTemplate: '#btnTemplate',
  searchInput: '#searchInput',
  searchCount: '#searchCount',
  btnClearSearch: '#btnClearSearch',
  visualFormView: '#visualFormView',
  rawCodeView: '#rawCodeView',
  rawJsonText: '#rawJsonText',
  syntaxError: '#syntaxError',
  customModal: '#customModal',
  modalTitle: '#modalTitle',
  modalInput: '#modalInput',
  modalBtnConfirm: '#modalBtnConfirm',
  modalBtnCancel: '#modalBtnCancel',
};

const SECTION_ICONS = {
  cta: '🎯',
  audio: '🔊',
  gameplay: '🎮',
  camera: '🎥',
  hero: '🦸',
  tracking: '📊',
  custom: '⚙️',
  general: '📝',
};

function extractUuid(dump) {
  if (!dump) return null;
  if (typeof dump === 'string' && dump.length > 8) return dump;
  if (typeof dump.uuid === 'string') return dump.uuid;
  if (dump.uuid && typeof dump.uuid.value === 'string') return dump.uuid.value;
  if (dump.value && typeof dump.value.uuid === 'string') return dump.value.uuid;
  if (dump.value && dump.value.uuid && typeof dump.value.uuid.value === 'string') return dump.value.uuid.value;
  return null;
}

function searchTextFor(key, value, path = []) {
  const parts = [...path, key].filter(part => part !== undefined && part !== null).map(String);
  if (value && typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      parts.push(searchTextFor(childKey, childValue, [...path, key]));
    }
  } else if (value !== undefined && value !== null) {
    parts.push(String(value));
  }
  return parts.join(' ').toLocaleLowerCase();
}

function buildTopLevelFragmentMap(data, basePath = 'playable-config') {
  const current = data?.$fragments && typeof data.$fragments === 'object' && !Array.isArray(data.$fragments)
    ? { ...data.$fragments }
    : {};
  const targets = Object.keys(current);
  for (const key of Object.keys(data || {})) {
    if (key === '$schema' || key === '$fragments' || key === 'title' || key === 'version') continue;
    const value = data[key];
    if (!value || typeof value !== 'object') continue;
    const overlaps = targets.some(target => target === key || target.startsWith(`${key}.`) || key.startsWith(`${target}.`));
    if (overlaps) continue;
    const slug = key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^A-Za-z0-9_-]+/g, '-').toLowerCase();
    current[key] = `${basePath}/${slug}`;
    targets.push(key);
  }
  return current;
}

function canSplitConfig(data) {
  return data?.$schema === 'playable-config-v1'
    || !!(data?.$fragments && typeof data.$fragments === 'object' && Object.keys(data.$fragments).length > 0);
}

function isDefaultJsonPreview(element, host) {
  if (!element || element === host || (host && host.contains && host.contains(element))) return false;
  const tag = String(element.tagName || '').toLowerCase();
  const src = String(element.getAttribute?.('src') || '').replaceAll('\\', '/').toLowerCase();
  const className = typeof element.className === 'string' ? element.className.toLowerCase() : '';
  return className.split(/\s+/).includes('asset-json')
    || (tag === 'ui-panel' && (src.includes('/assets/json') || src.endsWith('/json.js')));
}

/**
 * Get the host <ui-panel> custom element for this inspector
 */
function getHostPanel(self) {
  if (self && self.tagName === 'UI-PANEL') return self;
  if (self && self.$this && self.$this.tagName) return self.$this;
  if (self && self.$ && self.$.container) {
    const root = self.$.container.getRootNode ? self.$.container.getRootNode() : null;
    if (root && root.host) return root.host;
    if (self.$.container.closest) {
      const p = self.$.container.closest('ui-panel');
      if (p) return p;
    }
  }
  return null;
}

function removeLegacyGlobalHideStyle(self) {
  const host = getHostPanel(self);
  const doc = host?.ownerDocument || (typeof document !== 'undefined' ? document : null);
  const roots = [doc, host?.getRootNode?.(), host?.parentElement?.getRootNode?.()].filter(Boolean);
  for (const root of new Set(roots)) {
    root.querySelector?.('#cc-hide-default-json-preview')?.remove();
  }
}

function restoreDefaultPreview(self) {
  removeLegacyGlobalHideStyle(self);
  if (self.__jsonInspectorTimers) {
    self.__jsonInspectorTimers.forEach(clearTimeout);
    self.__jsonInspectorTimers = [];
  }
  self.__jsonInspectorObserver?.disconnect();
  self.__jsonInspectorObserver = null;
  if (self.__jsonInspectorHidden) {
    for (const [element, cssText] of self.__jsonInspectorHidden) {
      if (element?.style) element.style.cssText = cssText;
    }
    self.__jsonInspectorHidden.clear();
  }
}

/** Hide only the stock JSON preview beside this inspector and restore it on update/close. */
function hideDefaultPreview(self) {
  try {
    const host = getHostPanel(self);
    const parent = host?.parentElement;
    if (!host || !parent || !host.isConnected) return;
    self.__jsonInspectorHidden ??= new Map();
    const hideStockPanels = () => {
      if (!host.isConnected) {
        restoreDefaultPreview(self);
        return;
      }
      for (const child of Array.from(parent.children || [])) {
        if (!isDefaultJsonPreview(child, host) || self.__jsonInspectorHidden.has(child)) continue;
        self.__jsonInspectorHidden.set(child, child.style.cssText);
        child.style.setProperty('display', 'none', 'important');
      }
    };
    hideStockPanels();
    if (!self.__jsonInspectorObserver && typeof MutationObserver !== 'undefined') {
      self.__jsonInspectorObserver = new MutationObserver(hideStockPanels);
      self.__jsonInspectorObserver.observe(parent, { childList: true });
    }
  } catch (e) {
    restoreDefaultPreview(self);
  }
}

function schedulePreviewHide(self) {
  self.__jsonInspectorTimers ??= [];
  for (const delay of [30, 100, 300]) {
    self.__jsonInspectorTimers.push(setTimeout(() => hideDefaultPreview(self), delay));
  }
}

exports.ready = function () {
  const self = this;
  self.isModified = false;
  self.viewMode = 'form';
  self.currentData = null;
  self.originalData = null;
  self.fragmentSources = [];
  self.loadedUuid = null;
  self.isLoadingAsset = false;
  self.searchQuery = '';
  self.collapsedPaths = new Set();
  self.loadGeneration = 0;

  restoreDefaultPreview(self);
  hideDefaultPreview(self);
  schedulePreviewHide(self);

  if (self.$.searchInput) {
    self.$.searchInput.addEventListener('input', () => {
      self.searchQuery = self.$.searchInput.value.trim().toLocaleLowerCase();
      self.applySearch();
    });
  }
  if (self.$.btnClearSearch) {
    self.$.btnClearSearch.addEventListener('click', () => {
      self.searchQuery = '';
      if (self.$.searchInput) {
        self.$.searchInput.value = '';
        self.$.searchInput.focus();
      }
      self.applySearch();
    });
  }
  if (self.$.btnSplitConfig) {
    self.$.btnSplitConfig.addEventListener('click', () => {
      if (!self.currentData || !canSplitConfig(self.currentData)) return;
      const before = Object.keys(self.currentData.$fragments || {}).length;
      const fragmentMap = buildTopLevelFragmentMap(self.currentData);
      self.currentData.$fragments = fragmentMap;
      const after = Object.keys(fragmentMap).length;
      self.markDirty(true);
      self.render();
      if (self.$.configModeBadge) {
        self.$.configModeBadge.textContent = `${after} fragments pending`;
        self.$.configModeBadge.title = after === before
          ? 'All eligible top-level sections already have fragment owners.'
          : 'Save to create/update fragment files under assets/resources/playable-config/.';
      }
    });
  }

  // Save Button
  if (self.$.btnSave) {
    self.$.btnSave.addEventListener('click', () => self.saveAsset());
  }

  // Revert Button
  if (self.$.btnRevert) {
    self.$.btnRevert.addEventListener('click', () => {
      if (self.originalData) {
        self.currentData = JSON.parse(JSON.stringify(self.originalData));
        self.markDirty(false);
        self.render();
      }
    });
  }

  // Format Button
  if (self.$.btnFormat) {
    self.$.btnFormat.addEventListener('click', () => {
      if (self.currentData) {
        if (self.$.rawJsonText) {
          self.$.rawJsonText.value = JSON.stringify(self.currentData, null, 2);
        }
      }
    });
  }

  // Toggle View Mode (Visual Form vs Raw Code)
  if (self.$.btnToggleMode) {
    self.$.btnToggleMode.addEventListener('click', () => {
      if (self.viewMode === 'form') {
        self.viewMode = 'code';
        self.$.btnToggleMode.textContent = '👁️ Visual Form';
        self.$.visualFormView.style.display = 'none';
        self.$.rawCodeView.style.display = 'block';
        self.$.rawJsonText.value = JSON.stringify(self.currentData || {}, null, 2);
      } else {
        try {
          self.currentData = JSON.parse(self.$.rawJsonText.value);
          self.viewMode = 'form';
          self.$.btnToggleMode.textContent = '👁️ Raw Code';
          self.$.visualFormView.style.display = 'block';
          self.$.rawCodeView.style.display = 'none';
          self.$.syntaxError.style.display = 'none';
          self.render();
        } catch (e) {
          self.$.syntaxError.style.display = 'block';
          self.$.syntaxError.textContent = 'Invalid JSON syntax: ' + e.message;
        }
      }
    });
  }

  // Raw Text Change Listener
  if (self.$.rawJsonText) {
    self.$.rawJsonText.addEventListener('input', () => {
      try {
        self.currentData = JSON.parse(self.$.rawJsonText.value);
        self.$.syntaxError.style.display = 'none';
        self.markDirty(true);
      } catch (e) {
        self.$.syntaxError.style.display = 'block';
        self.$.syntaxError.textContent = 'Syntax error: ' + e.message;
      }
    });

    // Support Tab key in textarea
    self.$.rawJsonText.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = self.$.rawJsonText.selectionStart;
        const end = self.$.rawJsonText.selectionEnd;
        self.$.rawJsonText.value = self.$.rawJsonText.value.substring(0, start) + '  ' + self.$.rawJsonText.value.substring(end);
        self.$.rawJsonText.selectionStart = self.$.rawJsonText.selectionEnd = start + 2;
      }
    });
  }

  // Add Field Button (uses in-panel modal instead of window.prompt)
  if (self.$.btnAddField) {
    self.$.btnAddField.addEventListener('click', async () => {
      const fieldName = await self.promptDialog('Enter new property name:', '', 'e.g. speed, difficulty');
      if (fieldName && fieldName.trim()) {
        const key = fieldName.trim();
        if (!self.currentData) self.currentData = {};
        if (!(key in self.currentData)) {
          self.currentData[key] = '';
          self.markDirty(true);
          self.render();
        }
      }
    });
  }

  // Preset Template Button
  if (self.$.btnTemplate) {
    self.$.btnTemplate.addEventListener('click', async () => {
      const ok = await self.confirmDialog('Apply default Playable Ad Config preset? This will populate standard CTA, Audio, Gameplay, Camera & Tracking sections.');
      if (ok) {
        self.currentData = JSON.parse(JSON.stringify(DEFAULT_PLAYABLE_TEMPLATE));
        self.markDirty(true);
        self.render();
      }
    });
  }

  // Global Keyboard Shortcut: Ctrl+S / Cmd+S
  if (self.$.container) {
    self.$.container.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        e.stopPropagation();
        self.saveAsset();
      }
    });
  }
};

exports.update = function (dump) {
  const self = this;
  restoreDefaultPreview(self);
  self.dump = dump;

  let assetName = 'JSON Asset';
  let rawJson = null;

  const previousUuid = self.uuid;
  self.uuid = extractUuid(dump);

  // If uuid not in dump, check Selection
  if (!self.uuid && typeof Editor !== 'undefined' && Editor.Selection) {
    try {
      const last = Editor.Selection.getLastSelected ? Editor.Selection.getLastSelected('asset') : null;
      if (last) self.uuid = last;
    } catch (e) {}
  }
  if (self.uuid !== previousUuid) self.collapsedPaths?.clear();

  if (dump) {
    assetName = dump.name ? (dump.name.value || dump.name) : 'playable-config.json';

    if (dump.value) {
      if (typeof dump.value === 'string') {
        try {
          rawJson = JSON.parse(dump.value);
        } catch (e) {
          rawJson = dump.value;
        }
      } else if (typeof dump.value === 'object') {
        if (dump.value.json && typeof dump.value.json === 'object') {
          rawJson = dump.value.json;
        } else if (dump.value.json && typeof dump.value.json === 'string') {
          try { rawJson = JSON.parse(dump.value.json); } catch (e) { rawJson = dump.value; }
        } else {
          rawJson = dump.value;
        }
      }
    }
  }

  if (self.$.assetTitle) {
    self.$.assetTitle.textContent = assetName;
  }

  hideDefaultPreview(self);
  schedulePreviewHide(self);

  const generation = ++self.loadGeneration;
  const requestedUuid = self.uuid;
  self.isLoadingAsset = true;
  self.loadedUuid = null;
  self.loadAssetData(rawJson, generation, requestedUuid);
};

exports.close = function () {
  this.loadGeneration += 1;
  restoreDefaultPreview(this);
};

// Extension Methods attached to panel context
exports.methods = {
  /**
   * Custom In-Inspector Modal Dialog (replacing window.prompt)
   */
  promptDialog(title, defaultValue = '', placeholder = '') {
    const self = this;
    return new Promise((resolve) => {
      if (!self.$.customModal) {
        resolve(null);
        return;
      }
      self.$.modalTitle.textContent = title;
      self.$.modalInput.style.display = 'block';
      self.$.modalInput.value = defaultValue || '';
      self.$.modalInput.placeholder = placeholder;
      self.$.customModal.style.display = 'flex';
      self.$.modalInput.focus();

      const onConfirm = () => {
        cleanup();
        resolve(self.$.modalInput.value);
      };
      const onCancel = () => {
        cleanup();
        resolve(null);
      };
      const onKeyDown = (e) => {
        if (e.key === 'Enter') onConfirm();
        if (e.key === 'Escape') onCancel();
      };

      const cleanup = () => {
        self.$.customModal.style.display = 'none';
        self.$.modalBtnConfirm.removeEventListener('click', onConfirm);
        self.$.modalBtnCancel.removeEventListener('click', onCancel);
        self.$.modalInput.removeEventListener('keydown', onKeyDown);
      };

      self.$.modalBtnConfirm.addEventListener('click', onConfirm);
      self.$.modalBtnCancel.addEventListener('click', onCancel);
      self.$.modalInput.addEventListener('keydown', onKeyDown);
    });
  },

  /**
   * Custom In-Inspector Confirm Dialog (replacing window.confirm)
   */
  confirmDialog(title) {
    const self = this;
    return new Promise((resolve) => {
      if (!self.$.customModal) {
        resolve(true);
        return;
      }
      self.$.modalTitle.textContent = title;
      self.$.modalInput.style.display = 'none';
      self.$.customModal.style.display = 'flex';

      const onConfirm = () => {
        cleanup();
        resolve(true);
      };
      const onCancel = () => {
        cleanup();
        resolve(false);
      };

      const cleanup = () => {
        self.$.customModal.style.display = 'none';
        self.$.modalInput.style.display = 'block';
        self.$.modalBtnConfirm.removeEventListener('click', onConfirm);
        self.$.modalBtnCancel.removeEventListener('click', onCancel);
      };

      self.$.modalBtnConfirm.addEventListener('click', onConfirm);
      self.$.modalBtnCancel.addEventListener('click', onCancel);
    });
  },

  async loadAssetData(fallbackJson, generation = this.loadGeneration, requestedUuid = this.uuid) {
    const self = this;
    let data = fallbackJson;
    let resolvedName = '';
    let fragmentSources = [];

    if (!self.uuid && typeof Editor !== 'undefined' && Editor.Selection) {
      try {
        const last = Editor.Selection.getLastSelected ? Editor.Selection.getLastSelected('asset') : null;
        if (last) self.uuid = last;
      } catch (e) {}
    }

    if (requestedUuid && typeof Editor !== 'undefined' && Editor.Message) {
      try {
        const res = await Editor.Message.request('json-scriptable-inspector', 'read-json-asset', requestedUuid);
        if (res && res.success && res.content) {
          data = JSON.parse(res.content);
          resolvedName = res.name || '';
          fragmentSources = Array.isArray(res.fragmentSources) ? res.fragmentSources : [];
        }
      } catch (e) {
        // fallback
      }
    }

    if (generation !== self.loadGeneration) return;
    self.isLoadingAsset = false;
    self.loadedUuid = requestedUuid || null;
    if (resolvedName && self.$.assetTitle) self.$.assetTitle.textContent = resolvedName;
    self.fragmentSources = fragmentSources;
    if (self.$.configModeBadge) {
      const count = fragmentSources.length;
      self.$.configModeBadge.textContent = count ? `${count} fragments merged` : 'Single file';
      self.$.configModeBadge.title = count
        ? fragmentSources.map(source => `${source.target} ← ${source.resourcePath}.json`).join('\n')
        : '';
    }

    if (!data) {
      data = JSON.parse(JSON.stringify(DEFAULT_PLAYABLE_TEMPLATE));
    }

    if (self.$.btnSplitConfig) {
      const eligible = canSplitConfig(data);
      self.$.btnSplitConfig.disabled = !eligible;
      self.$.btnSplitConfig.title = eligible
        ? 'Move top-level sections into editable resource fragments'
        : 'Split Sections is available only on the root playable-config manifest.';
    }

    self.currentData = data;
    self.originalData = JSON.parse(JSON.stringify(data));
    self.markDirty(false);
    self.render();
  },

  markDirty(isDirty) {
    const self = this;
    self.isModified = isDirty;

    if (self.$.statusBadge) {
      if (isDirty) {
        self.$.statusBadge.textContent = '● Modified';
        self.$.statusBadge.className = 'status-badge modified';
      } else {
        self.$.statusBadge.textContent = 'Saved';
        self.$.statusBadge.className = 'status-badge';
      }
    }

    if (self.$.btnSave) {
      if (isDirty) {
        self.$.btnSave.classList.add('dirty');
      } else {
        self.$.btnSave.classList.remove('dirty');
      }
    }
  },

  async saveAsset() {
    const self = this;
    if (!self.currentData || self.isLoadingAsset || !self.loadedUuid || self.loadedUuid !== self.uuid) {
      if (self.$.statusBadge) {
        self.$.statusBadge.textContent = 'Wait for asset load';
        self.$.statusBadge.className = 'status-badge error';
      }
      return;
    }

    if (self.viewMode === 'code' && self.$.rawJsonText) {
      try {
        self.currentData = JSON.parse(self.$.rawJsonText.value);
        self.$.syntaxError.style.display = 'none';
      } catch (e) {
        if (self.$.statusBadge) {
          self.$.statusBadge.textContent = 'Syntax Error';
          self.$.statusBadge.className = 'status-badge error';
        }
        return;
      }
    }

    const jsonStr = JSON.stringify(self.currentData, null, 2);

    if (self.$.btnSave) {
      self.$.btnSave.textContent = '⏳ Saving...';
    }

    if (!self.uuid && typeof Editor !== 'undefined' && Editor.Selection) {
      try {
        const last = Editor.Selection.getLastSelected ? Editor.Selection.getLastSelected('asset') : null;
        if (last) self.uuid = last;
      } catch (e) {}
    }

    try {
      let saved = false;
      if (typeof Editor !== 'undefined' && Editor.Message) {
        const res = await Editor.Message.request('json-scriptable-inspector', 'save-json-asset', self.uuid, jsonStr);
        if (res && res.success) {
          saved = true;
          if (res.uuid) self.uuid = res.uuid;
          if (self.$.configModeBadge && Number.isInteger(res.fragmentCount)) {
            self.$.configModeBadge.textContent = res.fragmentCount
              ? `${res.fragmentCount} fragments merged`
              : 'Single file';
          }
        }
      }

      if (!saved && self.uuid && typeof Editor !== 'undefined' && Editor.Message) {
        await Editor.Message.request('asset-db', 'save-asset', self.uuid, jsonStr);
        saved = true;
      }

      if (saved) {
        self.originalData = JSON.parse(JSON.stringify(self.currentData));
        self.markDirty(false);

        if (self.$.statusBadge) {
          self.$.statusBadge.textContent = 'Saved! ✅';
          self.$.statusBadge.className = 'status-badge';
          setTimeout(() => {
            if (!self.isModified && self.$.statusBadge) {
              self.$.statusBadge.textContent = 'Saved';
            }
          }, 2000);
        }
      } else {
        throw new Error('Save handler returned false');
      }
    } catch (err) {
      console.error('[json-scriptable-inspector] Save failed:', err);
      if (self.$.statusBadge) {
        self.$.statusBadge.textContent = 'Save Failed';
        self.$.statusBadge.className = 'status-badge error';
      }
    } finally {
      if (self.$.btnSave) {
        self.$.btnSave.textContent = '💾 Save (Ctrl+S)';
      }
    }
  },

  render() {
    const self = this;
    if (!self.$.visualFormView || !self.currentData) return;

    if (self.$.rawJsonText) {
      self.$.rawJsonText.value = JSON.stringify(self.currentData, null, 2);
    }

    self.$.visualFormView.innerHTML = '';

    const keys = Object.keys(self.currentData);

    for (const key of keys) {
      if (key === '$schema' || key === '$fragments' || key === 'title' || key === 'version') {
        continue;
      }

      const val = self.currentData[key];
      const icon = SECTION_ICONS[key.toLowerCase()] || SECTION_ICONS.general;
      const title = key.toUpperCase();

      const card = document.createElement('div');
      card.className = 'section-card search-node';
      card.dataset.searchText = searchTextFor(key, val);
      const pathId = JSON.stringify([key]);
      if (self.collapsedPaths.has(pathId)) card.classList.add('collapsed');

      // Section Header
      const header = document.createElement('div');
      header.className = 'section-header';
      header.innerHTML = `
        <div class="section-title">
          <span>${icon}</span>
          <span>${title}</span>
        </div>
        <span class="btn-icon">${card.classList.contains('collapsed') ? '▶' : '▼'}</span>
      `;
      header.addEventListener('click', () => {
        card.classList.toggle('collapsed');
        if (card.classList.contains('collapsed')) self.collapsedPaths.add(pathId);
        else self.collapsedPaths.delete(pathId);
        const arrow = header.querySelector('.btn-icon');
        if (arrow) arrow.textContent = card.classList.contains('collapsed') ? '▶' : '▼';
      });
      card.appendChild(header);

      // Section Content
      const content = document.createElement('div');
      content.className = 'section-content';

      if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        self.renderObjectFields(content, val, [key]);
      } else if (Array.isArray(val)) {
        self.renderArrayField(content, val, [key], key);
      } else {
        self.renderPrimitiveField(content, key, val, [key]);
      }

      card.appendChild(content);
      self.$.visualFormView.appendChild(card);
    }

    // Custom / Extra Properties Section
    self.renderAddSectionBtn(self.$.visualFormView);
    self.applySearch();
  },

  renderObjectFields(container, obj, path) {
    const self = this;
    const entries = Object.entries(obj);

    for (const [k, v] of entries) {
      const fieldPath = [...path, k];
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        const subGroup = document.createElement('div');
        subGroup.className = 'nested-group search-node';
        subGroup.dataset.searchText = searchTextFor(k, v, path);
        const pathId = JSON.stringify(fieldPath);
        if (self.collapsedPaths.has(pathId)) subGroup.classList.add('collapsed');
        const header = document.createElement('div');
        header.className = 'nested-header';
        header.innerHTML = `<span>📁 ${k}</span><span class="btn-icon">${subGroup.classList.contains('collapsed') ? '▶' : '▼'}</span>`;
        header.addEventListener('click', () => {
          subGroup.classList.toggle('collapsed');
          if (subGroup.classList.contains('collapsed')) self.collapsedPaths.add(pathId);
          else self.collapsedPaths.delete(pathId);
          header.querySelector('.btn-icon').textContent = subGroup.classList.contains('collapsed') ? '▶' : '▼';
        });
        const content = document.createElement('div');
        content.className = 'nested-content';
        content.style.flexDirection = 'column';
        self.renderObjectFields(content, v, fieldPath);
        subGroup.appendChild(header);
        subGroup.appendChild(content);
        container.appendChild(subGroup);
      } else if (Array.isArray(v)) {
        self.renderArrayField(container, v, fieldPath, k);
      } else {
        self.renderPrimitiveField(container, k, v, fieldPath);
      }
    }
  },

  renderPrimitiveField(container, key, val, path) {
    const self = this;
    const row = document.createElement('div');
    row.className = 'field-row search-node';
    row.dataset.searchText = searchTextFor(key, val, path.slice(0, -1));
    row.dataset.searchLeaf = 'true';

    const label = document.createElement('div');
    label.className = 'field-label';
    label.textContent = key;
    label.title = path.join('.');
    row.appendChild(label);

    const inputBox = document.createElement('div');
    inputBox.className = 'field-input-box';

    if (typeof val === 'boolean') {
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.className = 'input-checkbox';
      chk.checked = val;
      chk.addEventListener('change', () => {
        self.setPathValue(path, chk.checked);
        self.markDirty(true);
      });
      inputBox.appendChild(chk);
    } else if (typeof val === 'number') {
      const numInput = document.createElement('input');
      numInput.type = 'number';
      numInput.className = 'input-num';
      numInput.value = val;
      numInput.step = val % 1 === 0 ? '1' : '0.1';
      numInput.addEventListener('input', () => {
        const parsed = parseFloat(numInput.value);
        self.setPathValue(path, isNaN(parsed) ? 0 : parsed);
        self.markDirty(true);
      });
      inputBox.appendChild(numInput);
    } else {
      const textInput = document.createElement('input');
      textInput.type = 'text';
      textInput.className = 'input-text';
      textInput.value = val || '';

      // Test URL button if field is a URL
      if (typeof val === 'string' && (val.startsWith('http://') || val.startsWith('https://'))) {
        const btnTest = document.createElement('button');
        btnTest.className = 'btn-icon';
        btnTest.textContent = '🔗 Test';
        btnTest.title = 'Open URL in browser';
        btnTest.addEventListener('click', () => {
          if (textInput.value) window.open(textInput.value, '_blank');
        });
        textInput.addEventListener('input', () => {
          self.setPathValue(path, textInput.value);
          self.markDirty(true);
        });
        inputBox.appendChild(textInput);
        inputBox.appendChild(btnTest);
      } else {
        textInput.addEventListener('input', () => {
          self.setPathValue(path, textInput.value);
          self.markDirty(true);
        });
        inputBox.appendChild(textInput);
      }
    }

    row.appendChild(inputBox);
    container.appendChild(row);
  },

  renderArrayField(container, arr, path, labelName) {
    const self = this;
    const arrayBox = document.createElement('div');
    arrayBox.className = 'array-list nested-group search-node';
    arrayBox.dataset.searchText = searchTextFor(labelName, arr, path.slice(0, -1));
    const pathId = JSON.stringify(path);
    if (self.collapsedPaths.has(pathId)) arrayBox.classList.add('collapsed');

    const header = document.createElement('div');
    header.className = 'nested-header';
    header.innerHTML = `
      <span style="font-weight:600; color:#8b949e;">📑 ${labelName} [${arr.length}]</span>
      <span><button class="btn-icon btn-add-item">➕ Add</button> <span class="btn-icon collapse-arrow">${arrayBox.classList.contains('collapsed') ? '▶' : '▼'}</span></span>
    `;
    header.addEventListener('click', () => {
      arrayBox.classList.toggle('collapsed');
      if (arrayBox.classList.contains('collapsed')) self.collapsedPaths.add(pathId);
      else self.collapsedPaths.delete(pathId);
      header.querySelector('.collapse-arrow').textContent = arrayBox.classList.contains('collapsed') ? '▶' : '▼';
    });
    const btnAdd = header.querySelector('.btn-add-item');
    if (btnAdd) {
      btnAdd.addEventListener('click', (event) => {
        event.stopPropagation();
        const templateItem = arr.length > 0 ? JSON.parse(JSON.stringify(arr[0])) : '';
        arr.push(templateItem);
        self.setPathValue(path, arr);
        self.markDirty(true);
        self.render();
      });
    }
    arrayBox.appendChild(header);
    const itemsContent = document.createElement('div');
    itemsContent.className = 'nested-content';
    itemsContent.style.flexDirection = 'column';
    itemsContent.style.gap = '4px';

    arr.forEach((item, idx) => {
      const itemRow = document.createElement('div');
      itemRow.className = 'array-item-row search-node';
      itemRow.dataset.searchText = searchTextFor(String(idx), item, path);

      if (typeof item === 'object' && item !== null) {
        const nestedBox = document.createElement('div');
        nestedBox.className = 'nested-group search-node';
        nestedBox.style.flex = '1';
        const itemPath = [...path, idx];
        nestedBox.dataset.searchText = searchTextFor(String(idx), item, path);
        const itemPathId = JSON.stringify(itemPath);
        if (self.collapsedPaths.has(itemPathId)) nestedBox.classList.add('collapsed');
        const itemHeader = document.createElement('div');
        itemHeader.className = 'nested-header';
        itemHeader.innerHTML = `<span>[${idx}]</span><span class="btn-icon">${nestedBox.classList.contains('collapsed') ? '▶' : '▼'}</span>`;
        itemHeader.addEventListener('click', () => {
          nestedBox.classList.toggle('collapsed');
          if (nestedBox.classList.contains('collapsed')) self.collapsedPaths.add(itemPathId);
          else self.collapsedPaths.delete(itemPathId);
          itemHeader.querySelector('.btn-icon').textContent = nestedBox.classList.contains('collapsed') ? '▶' : '▼';
        });
        const nestedContent = document.createElement('div');
        nestedContent.className = 'nested-content';
        nestedContent.style.flexDirection = 'column';
        if (Array.isArray(item)) self.renderArrayField(nestedContent, item, itemPath, `[${idx}]`);
        else self.renderObjectFields(nestedContent, item, itemPath);
        nestedBox.appendChild(itemHeader);
        nestedBox.appendChild(nestedContent);
        itemRow.appendChild(nestedBox);
      } else {
        itemRow.dataset.searchLeaf = 'true';
        const idxLabel = document.createElement('span');
        idxLabel.style.color = '#6e7681';
        idxLabel.style.fontSize = '10px';
        idxLabel.textContent = `[${idx}]`;
        itemRow.appendChild(idxLabel);
        const inp = document.createElement('input');
        inp.className = 'input-text';
        inp.value = item;
        inp.addEventListener('input', () => {
          arr[idx] = inp.value;
          self.setPathValue(path, arr);
          self.markDirty(true);
        });
        itemRow.appendChild(inp);
      }

      const btnDel = document.createElement('button');
      btnDel.className = 'btn-icon delete';
      btnDel.textContent = '✕';
      btnDel.title = 'Remove Item';
      btnDel.addEventListener('click', () => {
        arr.splice(idx, 1);
        self.setPathValue(path, arr);
        self.markDirty(true);
        self.render();
      });
      itemRow.appendChild(btnDel);

      itemsContent.appendChild(itemRow);
    });

    arrayBox.appendChild(itemsContent);
    container.appendChild(arrayBox);
  },

  applySearch() {
    const self = this;
    const query = self.searchQuery || '';
    const nodes = Array.from(self.$.visualFormView?.querySelectorAll('.search-node') || []);
    let matches = 0;
    for (const node of nodes) {
      const matched = !query || String(node.dataset.searchText || '').includes(query);
      node.classList.toggle('search-hidden', !matched);
      node.classList.toggle('search-open', !!query && matched);
      if (query && matched && node.dataset.searchLeaf === 'true') matches += 1;
    }
    if (self.$.searchCount) self.$.searchCount.textContent = query ? `${matches} match${matches === 1 ? '' : 'es'}` : '';
  },

  renderAddSectionBtn(container) {
    const self = this;
    const addCard = document.createElement('div');
    addCard.style.padding = '8px 0';
    addCard.style.textAlign = 'center';

    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.style.width = '100%';
    btn.style.justifyContent = 'center';
    btn.textContent = '➕ Add New Config Section';
    btn.addEventListener('click', async () => {
      const name = await self.promptDialog('Enter new section name:', '', 'e.g. level, enemy, ui');
      if (name && name.trim()) {
        const k = name.trim().toLowerCase();
        if (!self.currentData) self.currentData = {};
        if (!(k in self.currentData)) {
          self.currentData[k] = {};
          self.markDirty(true);
          self.render();
        }
      }
    });

    addCard.appendChild(btn);
    container.appendChild(addCard);
  },

  setPathValue(path, value) {
    const self = this;
    if (!self.currentData || !path || path.length === 0) return;

    let curr = self.currentData;
    for (let i = 0; i < path.length - 1; i++) {
      const p = path[i];
      if (!(p in curr) || typeof curr[p] !== 'object' || curr[p] === null) {
        curr[p] = {};
      }
      curr = curr[p];
    }
    curr[path[path.length - 1]] = value;
  },
};

exports.__test = {
  extractUuid,
  searchTextFor,
  isDefaultJsonPreview,
  removeLegacyGlobalHideStyle,
  restoreDefaultPreview,
  buildTopLevelFragmentMap,
  canSplitConfig,
};
