#!/usr/bin/env node
'use strict';

/**
 * UI Sibling Removal Audit
 * ========================
 * When a playable drops or defers a Unity UI control (rule
 * interactive-affordance-parity), the controls that stay behind still carry
 * anchoredPositions authored for the full group. A lone survivor of a
 * Home/TryAgain pair keeps its pair-relative x and renders off-centre; a
 * LayoutGroup that would have re-flowed survivors is replaced by stale
 * pre-layout positions. A tap regression still passes because it taps the
 * runtime position, so nothing catches it.
 *
 * This static audit reads the Unity prefab, finds the sibling group every
 * removed node belonged to (same parent + same row/column, or a LayoutGroup
 * parent), and reports survivors, the original group centre and the survivor
 * centre offset. An unbalanced group without a declared Cocos adapter layout is
 * `UI_SIBLING_REMOVED_UNBALANCED` (high).
 *
 * Mode contract (rule generator-cli-readonly-idempotence): arguments are parsed
 * and validated before any file is read; --help only prints usage; --check never
 * writes; --out writes only when the report bytes change.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseUnityFile } = require('../lib/unity-yaml.cjs');

const MAX_PREFAB_BYTES = 16 * 1024 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_PREFABS = 64;
const MAX_REMOVED = 256;
const DEFAULT_TOLERANCE_PX = 8;
const DEFAULT_ROW_TOLERANCE_PX = 24;
const DEFAULT_REFERENCE = { width: 1080, height: 1920 };
const ADAPTER_STRATEGIES = new Set(['source-layout', 'recenter', 'reflow', 'explicit-position']);
const MANIFEST_KIND = 'ui-sibling-removal-audit';
const REPORT_KIND = 'ui-sibling-removal-report';

// UGUI script GUIDs (package C# is usually absent from Assets).
const LAYOUT_GUIDS = {
  '30649d3a9faa99c48a7b1166b86bf2a0': 'HorizontalLayoutGroup',
  '59f8146938fff824cb5fd77236b75775': 'VerticalLayoutGroup',
  '8a8695521f0d02e499659fee002a26c2': 'GridLayoutGroup',
};
const LAYOUT_ELEMENT_GUID = '306cc8c2b49d7114eaa3623786fc2126';
const CANVAS_SCALER_GUID = '0cd44c1031e13a943bb63640046fad76';

const USAGE = `UI Sibling Removal Audit

Find Unity UI sibling groups that lose a member in the playable (removed or
deferred control) and report whether the survivors stay balanced. Read-only
unless --out is given.

Usage:
  node playable-shared-kit/tools/unity-cocos-port/ui-sibling-removal-audit.cjs \\
    --config <audit.json> --unity-project <UnityProjectRoot> [--check] [--out <report.json>] [--json]

  node playable-shared-kit/tools/unity-cocos-port/ui-sibling-removal-audit.cjs \\
    --prefab <file.prefab> --removed <nodePathOrName> [--removed ...] [--adapters <adapters.json>] [options]

Options:
  --config <file>              Manifest (kind "${MANIFEST_KIND}") listing prefabs, removed nodes and adapters.
  --unity-project <dir>        Root that manifest prefab paths (Assets/...) resolve against.
  --prefab <file>              Direct mode: one Unity prefab.
  --removed <path|name>        Direct mode: removed/deferred node (repeatable). Accepts full path,
                               path suffix (Content/HomeBtn) or a unique name.
  --shown <path|name>          Node inactive in the prefab that the playable variant activates (repeatable).
  --adapters <file>            Direct mode: {"adapters":[...]} Cocos-side adapter declarations.
  --tolerance <px>             Survivor centre offset allowed before flagging (default ${DEFAULT_TOLERANCE_PX}).
  --row-tolerance <px>         Max centre delta that still counts as the same row/column (default ${DEFAULT_ROW_TOLERANCE_PX}).
  --reference-resolution <WxH> Root rect when no CanvasScaler is serialized (default 1080x1920).
  --check                      Read-only gate: exit 1 on unresolved high findings, or when --out is stale.
  --out <file>                 Write the JSON report (skipped when bytes are identical).
  --json                       Print JSON only.
  --help                       Show this help.

Manifest schema:
  {
    "schemaVersion": 1,
    "kind": "${MANIFEST_KIND}",
    "prefabs": [{
      "prefab": "Assets/_Game/Prefabs/UI/PopupLose.prefab",
      "removed": ["Content/HomeBtn"],
      "shown": [],                             // prefab-inactive nodes the playable activates
      "adapters": [{
        "removed": "Content/HomeBtn",          // or "group": "PopupLose/Content"
        "strategy": "recenter",                 // source-layout | recenter | reflow | explicit-position
        "reason": "HomeBtn deferred (meta); TryAgain re-centred",
        "sourceValues": { "HomeBtn.x": -243, "TryAgainButton.x": 191 },
        "configPath": "screw.popups.lose.tryAgainX"
      }]
    }]
  }

Findings:
  high   UI_SIBLING_REMOVED_UNBALANCED    survivor row/column off the original group centre, no adapter
  high   UI_SIBLING_REMOVED_LAYOUT_REFLOW LayoutGroup parent lost a child; survivors need re-flow
  high   UI_SIBLING_REMOVED_NODE_MISSING  removed entry does not resolve to exactly one node
  high   UI_SIBLING_SHOWN_NODE_MISSING    shown entry does not resolve to exactly one node
  high   UI_SIBLING_ADAPTER_INVALID       adapter lacks strategy/reason/sourceValues
  medium UI_SIBLING_REMOVED_GAP           interior member removed; survivors balanced but spaced for N
  low    UI_SIBLING_REMOVED_RESOLVED      group declared resolved by a valid adapter`;

function auditError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// ───────────────────────────────────────────────────────────── arguments ──

function parseArgs(argv) {
  const out = {
    help: false, check: false, json: false, removed: [], shown: [],
    tolerance: DEFAULT_TOLERANCE_PX, rowTolerance: DEFAULT_ROW_TOLERANCE_PX, reference: null,
  };
  const takeValue = (index, flag) => {
    const value = argv[index + 1];
    if (value === undefined || String(value).startsWith('--')) {
      throw auditError('UI_AUDIT_ARG_INVALID', `${flag} cần giá trị.`);
    }
    return value;
  };
  const number = (value, flag, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      throw auditError('UI_AUDIT_ARG_INVALID', `${flag} phải nằm trong ${min}-${max}.`);
    }
    return parsed;
  };
  const single = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    let arg = String(argv[index]);
    let inline;
    const eq = arg.indexOf('=');
    if (arg.startsWith('--') && eq > 0) { inline = arg.slice(eq + 1); arg = arg.slice(0, eq); }
    const value = () => {
      if (inline !== undefined) return inline;
      const next = takeValue(index, arg);
      index += 1;
      return next;
    };
    const once = () => {
      if (single.has(arg)) throw auditError('UI_AUDIT_ARG_INVALID', `${arg} chỉ được khai báo một lần.`);
      single.add(arg);
    };
    switch (arg) {
      case '--help': case '-h': out.help = true; break;
      case '--check': out.check = true; break;
      case '--json': out.json = true; break;
      case '--config': once(); out.config = value(); break;
      case '--unity-project': once(); out.unityProject = value(); break;
      case '--prefab': once(); out.prefab = value(); break;
      case '--adapters': once(); out.adapters = value(); break;
      case '--out': once(); out.out = value(); break;
      case '--removed': out.removed.push(value()); break;
      case '--shown': out.shown.push(value()); break;
      case '--tolerance': once(); out.tolerance = number(value(), arg, 0, 2000); break;
      case '--row-tolerance': once(); out.rowTolerance = number(value(), arg, 0, 2000); break;
      case '--reference-resolution': {
        once();
        const match = /^(\d{2,5})x(\d{2,5})$/i.exec(value());
        if (!match) throw auditError('UI_AUDIT_ARG_INVALID', '--reference-resolution phải có dạng WxH.');
        out.reference = { width: Number(match[1]), height: Number(match[2]) };
        break;
      }
      default: throw auditError('UI_AUDIT_ARG_UNKNOWN', `Argument không hỗ trợ: ${argv[index]}`);
    }
  }
  if (out.help) return out;
  if (out.config && (out.prefab || out.removed.length || out.shown.length || out.adapters)) {
    throw auditError('UI_AUDIT_ARG_CONFLICT', '--config không dùng chung với --prefab/--removed/--shown/--adapters.');
  }
  if (!out.config && !out.prefab) throw auditError('UI_AUDIT_ARG_INVALID', 'Cần --config hoặc --prefab.');
  if (out.prefab && out.removed.length === 0) {
    throw auditError('UI_AUDIT_ARG_INVALID', 'Direct mode cần ít nhất một --removed.');
  }
  if (out.removed.length > MAX_REMOVED) throw auditError('UI_AUDIT_ARG_INVALID', `Tối đa ${MAX_REMOVED} --removed.`);
  if (out.config && !out.unityProject) {
    throw auditError('UI_AUDIT_ARG_INVALID', '--config cần --unity-project để resolve đường dẫn Assets/... portable.');
  }
  return out;
}

// ─────────────────────────────────────────────────────────── file input ──

function readBounded(file, maxBytes, code) {
  let stat;
  try { stat = fs.statSync(file); } catch { throw auditError(code, `Không tìm thấy file: ${file}`); }
  if (!stat.isFile() || stat.size > maxBytes) throw auditError(code, `File vượt giới hạn ${maxBytes} bytes: ${file}`);
  return fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
}

function readJson(file, code) {
  try { return JSON.parse(readBounded(file, MAX_JSON_BYTES, code)); } catch (error) {
    if (error.code === code) throw error;
    throw auditError(code, `JSON không đọc được (${file}): ${error.message}`);
  }
}

function resolvePortablePrefab(unityProject, relative) {
  const text = String(relative || '').replace(/\\/g, '/');
  if (!/^(Assets|Packages)\//.test(text) || text.split('/').includes('..') || path.isAbsolute(text)) {
    throw auditError('UI_AUDIT_MANIFEST_INVALID', `prefab phải là đường dẫn portable Assets/... : ${relative}`);
  }
  if (!/\.prefab$/i.test(text)) throw auditError('UI_AUDIT_MANIFEST_INVALID', `prefab phải có đuôi .prefab: ${relative}`);
  return path.join(path.resolve(unityProject), ...text.split('/'));
}

function normalizeManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || manifest.kind !== MANIFEST_KIND
      || !Array.isArray(manifest.prefabs) || manifest.prefabs.length < 1 || manifest.prefabs.length > MAX_PREFABS) {
    throw auditError('UI_AUDIT_MANIFEST_INVALID',
      `Manifest cần schemaVersion=1, kind="${MANIFEST_KIND}" và 1-${MAX_PREFABS} prefabs.`);
  }
  return manifest.prefabs.map((entry, index) => {
    if (!entry || typeof entry.prefab !== 'string' || !Array.isArray(entry.removed)
        || entry.removed.some(item => typeof item !== 'string' || !item.trim())
        || (entry.shown !== undefined && (!Array.isArray(entry.shown) || entry.shown.some(item => typeof item !== 'string' || !item.trim())))
        || (entry.adapters !== undefined && !Array.isArray(entry.adapters))) {
      throw auditError('UI_AUDIT_MANIFEST_INVALID', `prefabs[${index}] cần prefab, removed[] string, shown[]/adapters[] (tùy chọn).`);
    }
    return {
      prefab: entry.prefab, removed: entry.removed.map(item => item.trim()),
      shown: (entry.shown || []).map(item => item.trim()), adapters: entry.adapters || [],
    };
  });
}

// ──────────────────────────────────────────────────────────── prefab model ──

const num = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const vec = (value, fallback) => ({
  x: num(value?.x, fallback.x),
  y: num(value?.y, fallback.y),
});
const ref = value => String(value?.fileID ?? '0');

/** Apply PrefabInstance modifications that target the instance root transform/object. */
function instanceOverrides(instance, strippedTransform) {
  const mods = instance?.data?.m_Modification?.m_Modifications || [];
  const rootTarget = ref(strippedTransform.data.m_CorrespondingSourceObject);
  const values = {};
  let name = null;
  let active = null;
  for (const mod of mods) {
    const property = String(mod?.propertyPath || '');
    if (property === 'm_Name' && name === null) name = String(mod.value ?? '');
    if (property === 'm_IsActive' && active === null) active = num(mod.value, 1) !== 0;
    if (ref(mod?.target) !== rootTarget) continue;
    const match = /^(m_AnchoredPosition|m_SizeDelta|m_AnchorMin|m_AnchorMax|m_Pivot|m_LocalScale)\.(x|y)$/.exec(property);
    if (match) (values[match[1]] ||= {})[match[2]] = num(mod.value);
  }
  return { name, active, values };
}

function buildModel(text, options = {}) {
  const docs = parseUnityFile(text);
  const byId = new Map(docs.map(doc => [doc.fileID, doc]));
  const nodes = new Map(); // transform fileID -> node
  let referenceResolution = null;
  for (const doc of docs) {
    if (doc.typeName !== 'MonoBehaviour') continue;
    const guid = String(doc.data?.m_Script?.guid || '');
    if (guid === CANVAS_SCALER_GUID || doc.data?.m_ReferenceResolution) {
      const resolution = vec(doc.data?.m_ReferenceResolution, { x: 0, y: 0 });
      if (resolution.x > 0 && resolution.y > 0) referenceResolution = { width: resolution.x, height: resolution.y };
    }
  }
  for (const doc of docs) {
    if (doc.typeName !== 'RectTransform') continue;
    const data = doc.data || {};
    const instanceId = ref(data.m_PrefabInstance);
    if (instanceId !== '0' && !data.m_AnchoredPosition) {
      const instance = byId.get(instanceId);
      const overrides = instanceOverrides(instance, doc);
      const v = overrides.values;
      nodes.set(doc.fileID, {
        id: doc.fileID,
        name: overrides.name || `PrefabInstance(${instanceId})`,
        active: overrides.active ?? true,
        parentId: ref(instance?.data?.m_Modification?.m_TransformParent),
        anchorMin: vec(v.m_AnchorMin, { x: 0.5, y: 0.5 }),
        anchorMax: vec(v.m_AnchorMax, { x: 0.5, y: 0.5 }),
        anchoredPosition: vec(v.m_AnchoredPosition, { x: 0, y: 0 }),
        sizeDelta: vec(v.m_SizeDelta, { x: 0, y: 0 }),
        pivot: vec(v.m_Pivot, { x: 0.5, y: 0.5 }),
        scale: vec(v.m_LocalScale, { x: 1, y: 1 }),
        sizeKnown: !!v.m_SizeDelta,
        nestedInstance: true,
        gameObjectId: null,
      });
      continue;
    }
    const gameObject = byId.get(ref(data.m_GameObject));
    nodes.set(doc.fileID, {
      id: doc.fileID,
      name: String(gameObject?.data?.m_Name ?? `RectTransform(${doc.fileID})`),
      active: num(gameObject?.data?.m_IsActive, 1) !== 0,
      parentId: ref(data.m_Father),
      anchorMin: vec(data.m_AnchorMin, { x: 0.5, y: 0.5 }),
      anchorMax: vec(data.m_AnchorMax, { x: 0.5, y: 0.5 }),
      anchoredPosition: vec(data.m_AnchoredPosition, { x: 0, y: 0 }),
      sizeDelta: vec(data.m_SizeDelta, { x: 0, y: 0 }),
      pivot: vec(data.m_Pivot, { x: 0.5, y: 0.5 }),
      scale: vec(data.m_LocalScale, { x: 1, y: 1 }),
      sizeKnown: true,
      nestedInstance: false,
      gameObjectId: ref(data.m_GameObject),
    });
  }
  // Components per GameObject: LayoutGroup + LayoutElement.ignoreLayout.
  const layoutByGameObject = new Map();
  const ignoreByGameObject = new Set();
  for (const doc of docs) {
    if (doc.typeName !== 'MonoBehaviour') continue;
    const data = doc.data || {};
    const owner = ref(data.m_GameObject);
    const guid = String(data.m_Script?.guid || '');
    const enabled = num(data.m_Enabled, 1) !== 0;
    let kind = LAYOUT_GUIDS[guid] || null;
    if (!kind && data.m_CellSize) kind = 'GridLayoutGroup';
    if (!kind && data.m_ChildAlignment !== undefined && data.m_Spacing !== undefined && data.m_Padding) kind = 'LayoutGroup';
    if (kind && enabled) {
      const padding = data.m_Padding || {};
      layoutByGameObject.set(owner, {
        kind,
        spacing: num(data.m_Spacing, 0),
        childAlignment: num(data.m_ChildAlignment, 0),
        padding: {
          left: num(padding.m_Left), right: num(padding.m_Right),
          top: num(padding.m_Top), bottom: num(padding.m_Bottom),
        },
        reverse: num(data.m_ReverseArrangement, 0) !== 0,
        childControl: ['m_ChildControlWidth', 'm_ChildControlHeight', 'm_ChildForceExpandWidth', 'm_ChildForceExpandHeight']
          .some(key => num(data[key], 0) !== 0),
      });
    }
    if ((guid === LAYOUT_ELEMENT_GUID || data.m_IgnoreLayout !== undefined) && enabled && num(data.m_IgnoreLayout, 0) !== 0) {
      ignoreByGameObject.add(owner);
    }
  }
  // Children in serialized sibling order where available.
  const children = new Map();
  for (const node of nodes.values()) {
    if (!children.has(node.parentId)) children.set(node.parentId, []);
    children.get(node.parentId).push(node);
  }
  for (const doc of docs) {
    if (doc.typeName !== 'RectTransform' || !Array.isArray(doc.data?.m_Children)) continue;
    const order = doc.data.m_Children.map(ref);
    const list = children.get(doc.fileID);
    if (list) list.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }
  for (const node of nodes.values()) {
    node.layout = node.gameObjectId ? layoutByGameObject.get(node.gameObjectId) || null : null;
    node.ignoreLayout = node.gameObjectId ? ignoreByGameObject.has(node.gameObjectId) : false;
  }
  // Popups often serialize m_LocalScale 0 for an Animator pop-in; layout intent is the
  // animated-in scale 1, so a zero component is treated as 1 and reported.
  for (const node of nodes.values()) {
    node.scaleAssumed = node.scale.x === 0 || node.scale.y === 0;
    if (node.scale.x === 0) node.scale.x = 1;
    if (node.scale.y === 0) node.scale.y = 1;
  }
  const roots = [...nodes.values()].filter(node => !nodes.has(node.parentId));
  const reference = options.reference || referenceResolution || DEFAULT_REFERENCE;
  // Resolve rect sizes and centres (relative to the parent rect centre) top-down.
  const visit = (node, parentSize, parentPath) => {
    node.path = parentPath ? `${parentPath}/${node.name}` : node.name;
    const stretch = { x: node.anchorMax.x - node.anchorMin.x, y: node.anchorMax.y - node.anchorMin.y };
    node.size = {
      width: stretch.x * parentSize.width + node.sizeDelta.x,
      height: stretch.y * parentSize.height + node.sizeDelta.y,
    };
    const pivotX = (node.anchorMin.x + stretch.x * node.pivot.x) * parentSize.width + node.anchoredPosition.x;
    const pivotY = (node.anchorMin.y + stretch.y * node.pivot.y) * parentSize.height + node.anchoredPosition.y;
    node.center = {
      x: pivotX + (0.5 - node.pivot.x) * node.size.width * node.scale.x - 0.5 * parentSize.width,
      y: pivotY + (0.5 - node.pivot.y) * node.size.height * node.scale.y - 0.5 * parentSize.height,
    };
    node.extent = {
      width: Math.abs(node.size.width * node.scale.x),
      height: Math.abs(node.size.height * node.scale.y),
    };
    node.parentSize = parentSize;
    node.stretched = { x: stretch.x > 1e-6, y: stretch.y > 1e-6 };
    node.children = children.get(node.id) || [];
    for (const child of node.children) visit(child, node.size, node.path);
  };
  for (const root of roots) {
    visit(root, { width: reference.width, height: reference.height }, '');
    // A root rect with zero size (prefab root stretched in no parent) behaves as the canvas.
    if (!(root.size.width > 0) || !(root.size.height > 0)) {
      root.size = { width: reference.width, height: reference.height };
      for (const child of root.children) visit(child, root.size, root.path);
    }
  }
  return { nodes, roots, reference, referenceSource: options.reference ? 'argument' : (referenceResolution ? 'CanvasScaler' : 'default') };
}

function resolveRemoved(model, entry) {
  const text = String(entry).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const all = [...model.nodes.values()];
  let matches = all.filter(node => node.path === text);
  if (!matches.length && text.includes('/')) matches = all.filter(node => node.path.endsWith(`/${text}`));
  if (!matches.length && !text.includes('/')) matches = all.filter(node => node.name === text);
  return matches;
}

// ─────────────────────────────────────────────────────────── grouping ──

const round = value => Math.round(value * 1000) / 1000;

function bbox(members, axis) {
  const key = axis === 'x' ? 'width' : 'height';
  let min = Infinity;
  let max = -Infinity;
  for (const member of members) {
    const half = member.sizeKnown ? member.extent[key] / 2 : 0;
    min = Math.min(min, member.center[axis] - half);
    max = Math.max(max, member.center[axis] + half);
  }
  return { min, max, center: (min + max) / 2 };
}

/** Siblings in the same row (axis x) or column (axis y) as the removed node. */
function lineGroup(parentChildren, removed, rowTolerance) {
  const eligible = parentChildren.filter(node => node.active && !node.ignoreLayout);
  const eligibleRow = node => !node.stretched.x && node.extent.width < 0.9 * node.parentSize.width;
  const eligibleCol = node => !node.stretched.y && node.extent.height < 0.9 * node.parentSize.height;
  const row = eligible.filter(node => eligibleRow(node) && eligibleRow(removed)
    && Math.abs(node.center.y - removed.center.y) <= rowTolerance);
  if (row.length >= 2 && row.includes(removed)) return { axis: 'x', members: row };
  const column = eligible.filter(node => eligibleCol(node) && eligibleCol(removed)
    && Math.abs(node.center.x - removed.center.x) <= rowTolerance);
  if (column.length >= 2 && column.includes(removed)) return { axis: 'y', members: column };
  return null;
}

/** Expected fixed-size re-flow of survivors for Horizontal/Vertical layout groups. */
function expectedReflow(parent, survivors) {
  const layout = parent.layout;
  if (!layout || layout.childControl || !/^(Horizontal|Vertical)LayoutGroup$/.test(layout.kind)) return null;
  const horizontal = layout.kind === 'HorizontalLayoutGroup';
  const key = horizontal ? 'width' : 'height';
  const ordered = layout.reverse ? [...survivors].reverse() : survivors;
  const total = ordered.reduce((sum, node) => sum + node.extent[key], 0) + layout.spacing * Math.max(0, ordered.length - 1);
  const pad = horizontal ? layout.padding.left + layout.padding.right : layout.padding.top + layout.padding.bottom;
  const inner = parent.size[key] - pad;
  const alignIndex = horizontal ? layout.childAlignment % 3 : Math.floor(layout.childAlignment / 3);
  const fraction = alignIndex / 2; // 0 start, .5 centre, 1 end
  // Horizontal: start = left edge; vertical: start = top edge (UGUI flows downward).
  const start = horizontal
    ? -parent.size.width / 2 + layout.padding.left + (inner - total) * fraction
    : parent.size.height / 2 - layout.padding.top - (inner - total) * fraction;
  const positions = [];
  let cursor = start;
  for (const node of ordered) {
    const extent = node.extent[key];
    const centre = horizontal ? cursor + extent / 2 : cursor - extent / 2;
    positions.push({ path: node.path, [horizontal ? 'centerX' : 'centerY']: round(centre) });
    cursor = horizontal ? cursor + extent + layout.spacing : cursor - extent - layout.spacing;
  }
  return { axis: horizontal ? 'x' : 'y', positions, contentExtent: round(total) };
}

function validateAdapter(adapter) {
  return !!adapter && typeof adapter === 'object'
    && ADAPTER_STRATEGIES.has(adapter.strategy)
    && typeof adapter.reason === 'string' && adapter.reason.trim().length >= 8
    && adapter.sourceValues && typeof adapter.sourceValues === 'object' && !Array.isArray(adapter.sourceValues)
    && Object.keys(adapter.sourceValues).length > 0
    && (typeof adapter.removed === 'string' || typeof adapter.group === 'string');
}

function adapterMatches(adapter, group, model) {
  if (typeof adapter.group === 'string') {
    const target = adapter.group.replace(/\\/g, '/');
    return group.parentPath === target || group.parentPath.endsWith(`/${target}`);
  }
  const resolved = resolveRemoved(model, adapter.removed);
  return resolved.length === 1 && group.removedIds.has(resolved[0].id);
}

// ──────────────────────────────────────────────────────────────── audit ──

function auditPrefabText(text, spec, options = {}) {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE_PX;
  const rowTolerance = options.rowTolerance ?? DEFAULT_ROW_TOLERANCE_PX;
  const model = buildModel(text, options);
  const label = spec.label;
  const findings = [];
  const adapters = spec.adapters || [];
  adapters.forEach((adapter, index) => {
    if (!validateAdapter(adapter)) {
      findings.push({
        severity: 'high', code: 'UI_SIBLING_ADAPTER_INVALID', prefab: label,
        message: `adapters[${index}] cần removed|group, strategy (${[...ADAPTER_STRATEGIES].join('|')}), reason và sourceValues không rỗng.`,
      });
    }
  });
  const validAdapters = adapters.filter(validateAdapter);
  // Runtime variant state: nodes the playable activates although the prefab serializes them off.
  for (const entry of spec.shown || []) {
    const matches = resolveRemoved(model, entry);
    if (matches.length !== 1) {
      findings.push({
        severity: 'high', code: 'UI_SIBLING_SHOWN_NODE_MISSING', prefab: label, shown: entry,
        message: matches.length ? `"${entry}" khớp ${matches.length} node` : `"${entry}" không có trong prefab.`,
      });
    } else {
      matches[0].active = true;
    }
  }
  const groups = new Map();
  for (const entry of spec.removed) {
    const matches = resolveRemoved(model, entry);
    if (matches.length !== 1) {
      findings.push({
        severity: 'high', code: 'UI_SIBLING_REMOVED_NODE_MISSING', prefab: label, removed: entry,
        message: matches.length ? `"${entry}" khớp ${matches.length} node: ${matches.map(n => n.path).join(', ')}` : `"${entry}" không có trong prefab.`,
      });
      continue;
    }
    const node = matches[0];
    if (!node.active) {
      findings.push({ severity: 'low', code: 'UI_SIBLING_REMOVED_INACTIVE', prefab: label, removed: node.path,
        message: 'Node đã inactive trong source; bỏ nó không đổi layout.' });
      continue;
    }
    const parent = model.nodes.get(node.parentId);
    if (!parent) continue;
    let group;
    if (parent.layout && !node.ignoreLayout) {
      group = { axis: parent.layout.kind === 'VerticalLayoutGroup' ? 'y' : 'x', layout: parent.layout,
        members: parent.children.filter(child => child.active && !child.ignoreLayout) };
    } else {
      group = lineGroup(parent.children, node, rowTolerance);
    }
    if (!group) {
      findings.push({ severity: 'low', code: 'UI_SIBLING_REMOVED_ALONE', prefab: label, removed: node.path,
        message: 'Không có sibling cùng hàng/cột hoặc LayoutGroup; không cần re-balance.' });
      continue;
    }
    const key = `${parent.id}:${group.axis}:${group.layout ? 'layout' : group.members.map(m => m.id).sort().join(',')}`;
    if (!groups.has(key)) groups.set(key, { ...group, parent, parentPath: parent.path, removedIds: new Set() });
    groups.get(key).removedIds.add(node.id);
  }
  for (const group of groups.values()) {
    const survivors = group.members.filter(member => !group.removedIds.has(member.id));
    const removed = group.members.filter(member => group.removedIds.has(member.id));
    const axis = group.axis;
    const original = bbox(group.members, axis);
    const survivorBox = survivors.length ? bbox(survivors, axis) : null;
    const offset = survivorBox ? survivorBox.center - original.center : 0;
    const adapter = validAdapters.find(item => adapterMatches(item, group, model)) || null;
    const base = {
      prefab: label,
      parent: group.parentPath,
      axis,
      layoutGroup: group.layout ? group.layout.kind : null,
      removed: removed.map(node => node.path),
      survivors: survivors.map(node => ({ path: node.path, [axis === 'x' ? 'centerX' : 'centerY']: round(node.center[axis]) })),
      ...(group.members.some(node => node.scaleAssumed)
        ? { zeroScaleAssumedOne: group.members.filter(node => node.scaleAssumed).map(node => node.path) } : {}),
      originalGroupCenter: round(original.center),
      survivorCenter: survivorBox ? round(survivorBox.center) : null,
      survivorCenterOffsetPx: round(offset),
      parentCenterOffsetPx: survivorBox ? round(survivorBox.center) : null,
      tolerancePx: tolerance,
    };
    if (!survivors.length) {
      findings.push({ ...base, severity: 'low', code: 'UI_SIBLING_GROUP_REMOVED',
        message: 'Toàn bộ group bị bỏ; không còn survivor.' });
      continue;
    }
    if (group.layout) {
      const reflow = expectedReflow(group.parent, survivors);
      // Layout-driven RectTransforms are serialized snapshots of the last UGUI pass (stale when
      // childControl/forceExpand drive sizes); offsets here are indicative, expectedReflow and the
      // runtime ui-layout metric are authoritative.
      const finding = {
        ...base, expectedReflow: reflow,
        layoutDrivenSnapshot: true, childControl: group.layout.childControl,
      };
      if (adapter) {
        findings.push({ ...finding, severity: 'low', code: 'UI_SIBLING_REMOVED_RESOLVED', adapter: pickAdapter(adapter),
          message: `LayoutGroup ${group.layout.kind} có adapter ${adapter.strategy}.` });
      } else {
        findings.push({ ...finding, severity: 'high', code: 'UI_SIBLING_REMOVED_LAYOUT_REFLOW',
          message: `${group.layout.kind} mất ${removed.length} child; survivors phải re-flow bằng source layout `
            + '(UnityFixedLayoutGroup) hoặc adapter có reason/sourceValues, không giữ anchoredPosition pre-removal.' });
      }
      continue;
    }
    const unbalanced = Math.abs(offset) > tolerance;
    const interior = removed.some(node => survivors.some(s => s.center[axis] < node.center[axis])
      && survivors.some(s => s.center[axis] > node.center[axis]));
    if (adapter) {
      findings.push({ ...base, severity: 'low', code: 'UI_SIBLING_REMOVED_RESOLVED', adapter: pickAdapter(adapter),
        message: `Group có adapter ${adapter.strategy}; acceptance vẫn cần runtime centerOffsetPx ở >=2 viewport.` });
    } else if (unbalanced) {
      findings.push({ ...base, severity: axis === 'x' ? 'high' : 'medium', code: 'UI_SIBLING_REMOVED_UNBALANCED',
        message: `Survivor lệch ${round(offset)}px (trục ${axis}) so với tâm group gốc; pair/row-relative `
          + 'anchoredPosition không được giữ cho survivor. Khai báo adapter recenter/reflow có reason + sourceValues trong config.' });
    } else if (interior) {
      findings.push({ ...base, severity: 'medium', code: 'UI_SIBLING_REMOVED_GAP',
        message: 'Member ở giữa bị bỏ: survivors vẫn cân nhưng spacing còn chừa chỗ; quyết định reflow hoặc ghi reason.' });
    } else {
      findings.push({ ...base, severity: 'low', code: 'UI_SIBLING_REMOVED_BALANCED',
        message: 'Survivors vẫn cân trong tolerance.' });
    }
  }
  return {
    prefab: label,
    referenceResolution: model.reference,
    referenceSource: model.referenceSource,
    removed: spec.removed,
    shown: spec.shown || [],
    findings,
  };
}

function pickAdapter(adapter) {
  return {
    ...(adapter.removed ? { removed: adapter.removed } : { group: adapter.group }),
    strategy: adapter.strategy, reason: adapter.reason,
    ...(adapter.configPath ? { configPath: adapter.configPath } : {}),
  };
}

function summarize(results, inputDigest) {
  const findings = results.flatMap(result => result.findings);
  const count = severity => findings.filter(item => item.severity === severity).length;
  const high = count('high');
  return {
    schemaVersion: 1,
    kind: REPORT_KIND,
    ok: high === 0,
    decision: high === 0 ? 'pass' : 'fail',
    counts: { high, medium: count('medium'), low: count('low') },
    inputDigest,
    prefabs: results,
  };
}

function runAudit(args, cwd = process.cwd()) {
  const hash = crypto.createHash('sha256');
  const options = { tolerance: args.tolerance, rowTolerance: args.rowTolerance, reference: args.reference };
  const results = [];
  if (args.config) {
    const manifest = readJson(path.resolve(cwd, args.config), 'UI_AUDIT_MANIFEST_INVALID');
    for (const spec of normalizeManifest(manifest)) {
      const file = resolvePortablePrefab(path.resolve(cwd, args.unityProject), spec.prefab);
      const text = readBounded(file, MAX_PREFAB_BYTES, 'UI_AUDIT_PREFAB_MISSING');
      hash.update(spec.prefab).update('\0').update(text.replace(/\r\n/g, '\n')).update('\0');
      results.push(auditPrefabText(text, { ...spec, label: spec.prefab }, options));
    }
    hash.update(JSON.stringify(manifest));
  } else {
    const file = path.resolve(cwd, args.prefab);
    const text = readBounded(file, MAX_PREFAB_BYTES, 'UI_AUDIT_PREFAB_MISSING');
    let adapters = [];
    if (args.adapters) {
      const declared = readJson(path.resolve(cwd, args.adapters), 'UI_AUDIT_MANIFEST_INVALID');
      if (!declared || !Array.isArray(declared.adapters)) {
        throw auditError('UI_AUDIT_MANIFEST_INVALID', '--adapters cần JSON {"adapters":[...]}');
      }
      adapters = declared.adapters;
    }
    const label = path.basename(file);
    hash.update(label).update('\0').update(text.replace(/\r\n/g, '\n')).update('\0')
      .update(JSON.stringify({ removed: args.removed, shown: args.shown, adapters }));
    results.push(auditPrefabText(text, { removed: args.removed, shown: args.shown, adapters, label }, options));
  }
  hash.update(JSON.stringify(options));
  return summarize(results, hash.digest('hex'));
}

function writeIfChanged(file, content) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, content);
  fs.renameSync(temp, file);
  return true;
}

function formatText(report) {
  const lines = [`UI sibling removal audit: ${report.decision.toUpperCase()} `
    + `(high ${report.counts.high}, medium ${report.counts.medium}, low ${report.counts.low})`];
  for (const prefab of report.prefabs) {
    lines.push(`- ${prefab.prefab}`);
    for (const item of prefab.findings) {
      const where = item.parent ? ` [${item.parent} axis ${item.axis}]` : '';
      lines.push(`  ${item.severity.padEnd(6)} ${item.code}${where}: ${item.message}`);
      if (item.survivors) {
        lines.push(`         removed=${item.removed.join(', ')} survivors=${item.survivors.map(s => `${s.path}@${s.centerX ?? s.centerY}`).join(', ')}`);
        lines.push(`         originalGroupCenter=${item.originalGroupCenter} survivorCenter=${item.survivorCenter} offset=${item.survivorCenterOffsetPx}px`);
      }
    }
  }
  return lines.join('\n');
}

function main(argv = process.argv.slice(2)) {
  let args;
  try { args = parseArgs(argv); } catch (error) {
    process.stderr.write(`${error.code || 'UI_AUDIT_ERROR'}: ${error.message}\n\n${USAGE}\n`);
    return 2;
  }
  if (args.help) { process.stdout.write(`${USAGE}\n`); return 0; }
  let report;
  try { report = runAudit(args); } catch (error) {
    const payload = { ok: false, code: error.code || 'UI_AUDIT_ERROR', message: error.message };
    process.stderr.write(`${args.json ? JSON.stringify(payload) : `${payload.code}: ${payload.message}`}\n`);
    return 2;
  }
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  let exitCode = report.ok ? 0 : 1;
  let outState = null;
  if (args.out) {
    const outFile = path.resolve(args.out);
    if (args.check) {
      const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : null;
      outState = current === serialized ? 'current' : 'stale';
      if (outState === 'stale') exitCode = 1;
    } else {
      outState = writeIfChanged(outFile, serialized) ? 'written' : 'unchanged';
    }
  }
  if (args.json) process.stdout.write(`${JSON.stringify({ ...report, ...(outState ? { out: outState } : {}) })}\n`);
  else process.stdout.write(`${formatText(report)}${outState ? `\nreport: ${outState}` : ''}\n`);
  return exitCode;
}

if (require.main === module) process.exitCode = main();

module.exports = {
  ADAPTER_STRATEGIES, MANIFEST_KIND, REPORT_KIND, USAGE,
  auditPrefabText, buildModel, expectedReflow, main, parseArgs, runAudit,
};
