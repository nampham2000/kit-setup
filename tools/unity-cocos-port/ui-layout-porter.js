'use strict';
const path = require('node:path');
const { cocosRef } = require('./core-utils');
// UGUI package GUIDs also resolve when package C# files are absent from the asset index.
const TYPES = {
  '30649d3a9faa99c48a7b1166b86bf2a0': 'HorizontalLayoutGroup',
  '59f8146938fff824cb5fd77236b75775': 'VerticalLayoutGroup',
  '306cc8c2b49d7114eaa3623786fc2126': 'LayoutElement',
};

function emitUnityLayout(c) {
  const { doc, getField: get, hasField: has, unityRefGuid, unityDb, builder, reporter, model, nodeId, componentId } = c;
  const guid = unityRefGuid(get(doc, 'm_Script'));
  const asset = unityDb.get(guid);
  const name = TYPES[guid] || (asset ? path.basename(asset.path, '.cs') : '');
  const group = name === 'HorizontalLayoutGroup' || name === 'VerticalLayoutGroup';
  const element = name === 'LayoutElement' || has(doc, 'm_IgnoreLayout');
  const unsupported = name === 'GridLayoutGroup' || name === 'ContentSizeFitter'
    || name === 'AspectRatioFitter' || has(doc, 'm_HorizontalFit') || has(doc, 'm_AspectMode')
    || (has(doc, 'm_ChildAlignment') && has(doc, 'm_Padding') && !group);
  if (!group && !element && !unsupported) return false;
  if (!Number(get(doc, 'm_Enabled', 1))) {
    reporter.low('UI_LAYOUT_DISABLED', model.file, '', `${name || 'Layout'} is disabled; authored RectTransform retained`);
    return true;
  }
  if (element) {
    if (Number(get(doc, 'm_IgnoreLayout', 0))) {
      if (!builder.unityLayoutIgnoredNodes) builder.unityLayoutIgnoredNodes = new Set();
      builder.unityLayoutIgnoredNodes.add(nodeId);
    }
    return true;
  }
  const flags = ['m_ChildControlWidth', 'm_ChildControlHeight', 'm_ChildForceExpandWidth', 'm_ChildForceExpandHeight'];
  if (unsupported || flags.some(key => Number(get(doc, key, 1)))) {
    reporter.high('UI_LAYOUT_UNSUPPORTED', model.file, '',
      `${name || 'Unknown layout'} needs a source-backed sizing adapter; fixed-size mapping supports childControl/forceExpand=false only`);
    return true;
  }
  const classId = c.ensureLayoutScript?.(c.options, reporter, c.cocosDb);
  if (!classId) {
    reporter.high('UI_LAYOUT_ADAPTER_UNRESOLVED', model.file, '', 'Cannot bind UnityFixedLayoutGroup');
    return true;
  }
  const padding = get(doc, 'm_Padding', {}) || {};
  const id = builder.addComponent(nodeId, classId, {
    vertical: name === 'VerticalLayoutGroup',
    alignment: Number(get(doc, 'm_ChildAlignment', 0)),
    spacing: Number(get(doc, 'm_Spacing', 0)),
    paddingLeft: Number(padding.m_Left || 0), paddingRight: Number(padding.m_Right || 0),
    paddingTop: Number(padding.m_Top || 0), paddingBottom: Number(padding.m_Bottom || 0),
    useScaleWidth: !!Number(get(doc, 'm_ChildScaleWidth', 0)),
    useScaleHeight: !!Number(get(doc, 'm_ChildScaleHeight', 0)),
    reverse: !!Number(get(doc, 'm_ReverseArrangement', 0)), ignoredNodes: [],
  }, componentId, `cmp-layout-${componentId}`);
  if (!builder.unityLayoutComponents) builder.unityLayoutComponents = [];
  builder.unityLayoutComponents.push({ nodeId, id });
  reporter.low('UI_LAYOUT_FIXED_MAPPED', model.file, '', `${name}: runtime fixed-size layout preserves alignment, padding, spacing, pivots, scale and active children`);
  return true;
}

function finalizeUnityLayouts(builder) {
  for (const { nodeId, id } of builder.unityLayoutComponents || []) {
    builder.objects[id].ignoredNodes = (builder.objects[nodeId]._children || [])
      .filter(ref => builder.unityLayoutIgnoredNodes?.has(ref.__id__))
      .map(ref => cocosRef(ref.__id__));
  }
}
module.exports = { emitUnityLayout, finalizeUnityLayouts };
