'use strict';

const fs = require('fs');
const path = require('path');
const {
  stableUuid,
  ensureDir,
  readJsonIfExists,
  escapeRegex,
  cocosRef,
  vec2,
  vec3,
  color,
  size,
  finiteNumber,
  unityNumber,
  sanitizeFileId,
  sanitizeAssetDisplayName,
  toPosix,
} = require('./core-utils');

module.exports = function createAnimationPorter(deps) {
  const {
    parseUnityYaml,
    getField,
    parseUnityScalar,
    unityRefGuid,
    unityRefFileId,
    ensureDirectoryMetas,
  } = deps;

  function getIndentedBlock(doc, key) {
    const pattern = new RegExp(`^(\\s*)${escapeRegex(key)}\\s*:\\s*(.*)$`);
    for (let i = 0; i < doc.lines.length; i++) {
      const match = pattern.exec(doc.lines[i]);
      if (!match) continue;
      if (match[2].trim() === '[]') return [];
      const baseIndent = match[1].length;
      const block = [];
      for (let j = i + 1; j < doc.lines.length; j++) {
        const line = doc.lines[j];
        if (!line.trim()) continue;
        const indent = line.match(/^\s*/)[0].length;
        const trimmed = line.trim();
        if (indent < baseIndent) break;
        if (indent === baseIndent && !trimmed.startsWith('- ')) break;
        block.push(line);
      }
      return block;
    }
    return [];
  }

  function readUnityFieldFromLines(lines, key, fallback = '') {
    const pattern = new RegExp(`^\\s*(?:-\\s*)?${escapeRegex(key)}\\s*:\\s*(.*)$`);
    const line = lines.find((item) => pattern.test(item));
    if (!line) return fallback;
    const match = pattern.exec(line);
    return match ? parseUnityScalar(match[1]) : fallback;
  }

  function splitUnityListEntries(lines) {
    const firstItem = lines.find((line) => /^\s*-\s+/.test(line));
    if (!firstItem) return [];
    const itemIndent = firstItem.match(/^\s*/)[0].length;
    const entries = [];
    let current = null;
    for (const line of lines) {
      if (new RegExp(`^\\s{${itemIndent}}-\\s+`).test(line)) {
        if (current) entries.push(current);
        current = [line];
        continue;
      }
      if (current) current.push(line);
    }
    if (current) entries.push(current);
    return entries;
  }

  function parseUnityCurveKeyframes(entryLines) {
    const keyframes = [];
    for (let i = 0; i < entryLines.length; i++) {
      const timeMatch = /^\s*time:\s*(.*)$/.exec(entryLines[i]);
      if (!timeMatch) continue;
      const keyframe = {
        time: unityNumber(timeMatch[1]),
        value: null,
      };
      for (let j = i + 1; j < entryLines.length; j++) {
        if (/^\s*time:\s*/.test(entryLines[j])) break;
        const valueMatch = /^\s*value:\s*(.*)$/.exec(entryLines[j]);
        if (valueMatch) keyframe.value = parseUnityScalar(valueMatch[1]);
        const inSlopeMatch = /^\s*inSlope:\s*(.*)$/.exec(entryLines[j]);
        if (inSlopeMatch) keyframe.inSlope = parseUnityScalar(inSlopeMatch[1]);
        const outSlopeMatch = /^\s*outSlope:\s*(.*)$/.exec(entryLines[j]);
        if (outSlopeMatch) keyframe.outSlope = parseUnityScalar(outSlopeMatch[1]);
        const weightedModeMatch = /^\s*weightedMode:\s*(.*)$/.exec(entryLines[j]);
        if (weightedModeMatch) keyframe.weightedMode = parseUnityScalar(weightedModeMatch[1]);
        const inWeightMatch = /^\s*inWeight:\s*(.*)$/.exec(entryLines[j]);
        if (inWeightMatch) keyframe.inWeight = parseUnityScalar(inWeightMatch[1]);
        const outWeightMatch = /^\s*outWeight:\s*(.*)$/.exec(entryLines[j]);
        if (outWeightMatch) keyframe.outWeight = parseUnityScalar(outWeightMatch[1]);
      }
      if (keyframe.value != null) keyframes.push(keyframe);
    }
    return keyframes;
  }

  function parseUnityVectorCurveEntries(doc, key) {
    const entries = [];
    for (const entryLines of splitUnityListEntries(getIndentedBlock(doc, key))) {
      const pathValue = String(readUnityFieldFromLines(entryLines, 'path', ''));
      const keyframes = parseUnityCurveKeyframes(entryLines)
        .filter((keyframe) => keyframe.value && typeof keyframe.value === 'object');
      if (keyframes.length) entries.push({ path: pathValue, keyframes });
    }
    return entries;
  }

  function parseUnityFloatCurveEntries(doc, key) {
    const entries = [];
    for (const entryLines of splitUnityListEntries(getIndentedBlock(doc, key))) {
      const attribute = String(readUnityFieldFromLines(entryLines, 'attribute', ''));
      const pathValue = String(readUnityFieldFromLines(entryLines, 'path', ''));
      const classId = Number(readUnityFieldFromLines(entryLines, 'classID', 0) || 0);
      const scriptGuid = unityRefGuid(readUnityFieldFromLines(entryLines, 'script', null));
      const keyframes = parseUnityCurveKeyframes(entryLines)
        .filter((keyframe) => typeof keyframe.value === 'number');
      if (keyframes.length) entries.push({ attribute, path: pathValue, classId, scriptGuid, keyframes });
    }
    return entries;
  }

  function unityClipSettingsValue(doc, key, fallback = 0) {
    const settings = getIndentedBlock(doc, 'm_AnimationClipSettings');
    for (const line of settings) {
      const match = new RegExp(`^\\s*${escapeRegex(key)}\\s*:\\s*(.*)$`).exec(line);
      if (match) return parseUnityScalar(match[1]);
    }
    return fallback;
  }

  function curveChannelNumber(value, channel = '', fallback = 0) {
    if (value == null) return fallback;
    if (typeof value === 'number') return finiteNumber(value, fallback);
    if (channel && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, channel)) {
      return finiteNumber(value[channel], fallback);
    }
    return fallback;
  }

  function cocosRealKeyframeValue(keyframe, channel = '') {
    const value = curveChannelNumber(keyframe?.value, channel, 0);
    const hasTangentData = keyframe
      && (keyframe.inSlope != null
        || keyframe.outSlope != null
        || keyframe.inWeight != null
        || keyframe.outWeight != null
        || keyframe.weightedMode != null);
    if (!hasTangentData) return { __type__: 'cc.RealKeyframeValue', value };
    return {
      __type__: 'cc.RealKeyframeValue',
      interpolationMode: 2,
      tangentWeightMode: curveChannelNumber(keyframe.weightedMode, channel, 0),
      value,
      leftTangent: curveChannelNumber(keyframe.inSlope, channel, 0),
      leftTangentWeight: curveChannelNumber(keyframe.inWeight, channel, 0.33333334),
      rightTangent: curveChannelNumber(keyframe.outSlope, channel, 0),
      rightTangentWeight: curveChannelNumber(keyframe.outWeight, channel, 0.33333334),
    };
  }

  function cocosRealCurve(keyframes, channel = '') {
    return {
      __type__: 'cc.RealCurve',
      _times: keyframes.map((keyframe) => finiteNumber(keyframe.time)),
      _values: keyframes.map((keyframe) => cocosRealKeyframeValue(keyframe, channel)),
      preExtrapolation: 1,
      postExtrapolation: 1,
    };
  }

  function cocosChannel(keyframes, channel = '') {
    return {
      __type__: 'cc.animation.Channel',
      _curve: cocosRealCurve(keyframes, channel),
    };
  }

  function cocosTrackPathForUnityPath(unityPath, property, component = '') {
    const paths = [];
    for (const segment of String(unityPath || '').split('/').filter(Boolean)) {
      paths.push({ __type__: 'cc.animation.HierarchyPath', path: segment });
    }
    if (component) paths.push({ __type__: 'cc.animation.ComponentPath', component });
    paths.push(property);
    return { __type__: 'cc.animation.TrackPath', _paths: paths };
  }

  function convertUnityAnimationVectorValue(property, value) {
    const x = finiteNumber(value?.x);
    const y = finiteNumber(value?.y);
    const z = finiteNumber(value?.z);
    if (property === 'position') return { x, y, z: -z };
    if (property === 'eulerAngles') return { x: -x, y, z };
    return { x, y, z };
  }

  function mapUnityVectorKeyframes(property, keyframes) {
    return keyframes.map((keyframe) => ({
      ...keyframe,
      value: convertUnityAnimationVectorValue(property, keyframe.value),
      inSlope: keyframe.inSlope == null ? keyframe.inSlope : convertUnityAnimationVectorValue(property, keyframe.inSlope),
      outSlope: keyframe.outSlope == null ? keyframe.outSlope : convertUnityAnimationVectorValue(property, keyframe.outSlope),
    }));
  }

  function mapUnityScalarKeyframes(keyframes, transforms = {}) {
    const mapValue = transforms.value || ((value) => finiteNumber(value));
    const mapSlope = transforms.slope || ((value) => finiteNumber(value));
    return keyframes.map((keyframe) => ({
      ...keyframe,
      value: mapValue(keyframe.value),
      inSlope: keyframe.inSlope == null ? keyframe.inSlope : mapSlope(keyframe.inSlope),
      outSlope: keyframe.outSlope == null ? keyframe.outSlope : mapSlope(keyframe.outSlope),
    }));
  }

  function cocosVectorTrack(unityPath, property, keyframes) {
    const convertedKeyframes = mapUnityVectorKeyframes(property, keyframes);
    return {
      __type__: 'cc.animation.VectorTrack',
      _binding: {
        __type__: 'cc.animation.TrackBinding',
        path: cocosTrackPathForUnityPath(unityPath, property),
      },
      _channels: [
        cocosChannel(convertedKeyframes, 'x'),
        cocosChannel(convertedKeyframes, 'y'),
        cocosChannel(convertedKeyframes, 'z'),
        cocosChannel([], 'w'),
      ],
      _nComponents: 3,
    };
  }

  function cocosScalarVectorTrack(unityPath, component, property, keyedChannels, nComponents) {
    const channel = (name) => {
      const keyframes = keyedChannels[name] || [];
      return cocosChannel(mapUnityScalarKeyframes(keyframes));
    };
    return {
      __type__: 'cc.animation.VectorTrack',
      _binding: {
        __type__: 'cc.animation.TrackBinding',
        path: cocosTrackPathForUnityPath(unityPath, property, component),
      },
      _channels: [channel('x'), channel('y'), channel('z'), channel('w')],
      _nComponents: nComponents,
    };
  }

  function cocosSizeTrack(unityPath, component, property, keyedChannels) {
    const channel = (name) => {
      const keyframes = keyedChannels[name] || [];
      return cocosChannel(mapUnityScalarKeyframes(keyframes));
    };
    return {
      __type__: 'cc.animation.SizeTrack',
      _binding: {
        __type__: 'cc.animation.TrackBinding',
        path: cocosTrackPathForUnityPath(unityPath, property, component),
      },
      _channels: [channel('x'), channel('y')],
    };
  }

  function cocosObjectCurve(times, values) {
    return {
      __type__: 'cc.ObjectCurve',
      _times: times.map((time) => finiteNumber(time)),
      _values: values,
    };
  }

  function cocosObjectTrack(unityPath, property, keyframes, convertValue) {
    return {
      __type__: 'cc.animation.ObjectTrack',
      _binding: {
        __type__: 'cc.animation.TrackBinding',
        path: cocosTrackPathForUnityPath(unityPath, property),
      },
      _channel: {
        __type__: 'cc.animation.Channel',
        _curve: cocosObjectCurve(
          keyframes.map((keyframe) => keyframe.time),
          keyframes.map((keyframe) => convertValue(keyframe.value))
        ),
      },
    };
  }

  function cocosColorTrack(unityPath, component, property, keyedChannels) {
    const colorChannelValue = (value) => Math.max(0, Math.min(255, Math.round(finiteNumber(value) * 255)));
    const channel = (name) => {
      const keyframes = keyedChannels[name] || [];
      return cocosChannel(mapUnityScalarKeyframes(keyframes, {
        value: colorChannelValue,
        slope: (value) => finiteNumber(value) * 255,
      }));
    };
    return {
      __type__: 'cc.animation.ColorTrack',
      _binding: {
        __type__: 'cc.animation.TrackBinding',
        path: cocosTrackPathForUnityPath(unityPath, property, component),
      },
      _channels: [channel('r'), channel('g'), channel('b'), channel('a')],
    };
  }

  function unityRendererComponentForColorCurve(entry) {
    if (Number(entry?.classId) === 212) return 'cc.SpriteRenderer';
    if (Number(entry?.classId) === 114 && entry?.scriptGuid === 'fe87c0e1cc204ed48ad3b37840f39efc') return 'cc.Sprite';
    return '';
  }

  function unityColorCurveChannel(attribute) {
    const match = /^m_Color\.([rgba])$/.exec(String(attribute || ''));
    return match ? match[1] : '';
  }

  function unityRectTransformFloatCurve(attribute) {
    const anchoredPosition = /^m_AnchoredPosition\.([xy])$/.exec(String(attribute || ''));
    if (anchoredPosition) {
      return { component: '', property: 'position', channel: anchoredPosition[1], nComponents: 3 };
    }
    const pivot = /^m_Pivot\.([xy])$/.exec(String(attribute || ''));
    if (pivot) {
      return { component: 'cc.UITransform', property: 'anchorPoint', channel: pivot[1], nComponents: 2 };
    }
    const sizeDelta = /^m_SizeDelta\.([xy])$/.exec(String(attribute || ''));
    if (sizeDelta) {
      return { component: 'cc.UITransform', property: 'contentSize', channel: sizeDelta[1], nComponents: 2 };
    }
    return null;
  }

  function unityRectTransformCurveChannel(attribute) {
    const match = /^m_(AnchoredPosition|Pivot|AnchorMin|AnchorMax|SizeDelta)\.([xy])$/.exec(String(attribute || ''));
    if (!match) return null;
    const properties = {
      AnchoredPosition: 'anchoredPosition',
      Pivot: 'pivot',
      AnchorMin: 'anchorMin',
      AnchorMax: 'anchorMax',
      SizeDelta: 'sizeDelta',
    };
    return { property: properties[match[1]], channel: match[2] };
  }

  function sortedUnionTimes(curves) {
    const times = new Set();
    for (const curve of curves) {
      for (const keyframe of curve || []) times.add(finiteNumber(keyframe.time));
    }
    return [...times].sort((a, b) => a - b);
  }

  function rectCurveGroupsKey(group) {
    if (!group) return '__missing__';
    return group.path === '' ? '__root__' : String(group.path || '__missing__');
  }

  function collectRectDependencyTimes(group, rectCurveGroups, visited = new Set()) {
    if (!group) return [];
    const key = rectCurveGroupsKey(group);
    if (visited.has(key)) return [];
    visited.add(key);

    const curves = [];
    for (const propertyChannels of Object.values(group.curves || {})) {
      for (const keyframes of Object.values(propertyChannels || {})) curves.push(keyframes);
    }

    const parentPath = group.base?.parentPath;
    if (parentPath != null && rectCurveGroups?.has(parentPath)) {
      curves.push(...collectRectDependencyTimes(rectCurveGroups.get(parentPath), rectCurveGroups, visited));
    }

    return curves;
  }

  function evaluateScalarCurve(keyframes, time, fallback) {
    if (!Array.isArray(keyframes) || !keyframes.length) return finiteNumber(fallback);
    const sorted = [...keyframes].sort((a, b) => finiteNumber(a.time) - finiteNumber(b.time));
    if (time <= finiteNumber(sorted[0].time)) return finiteNumber(sorted[0].value);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const next = sorted[i];
      const prevTime = finiteNumber(prev.time);
      const nextTime = finiteNumber(next.time);
      if (time > nextTime) continue;
      if (Math.abs(nextTime - prevTime) < 1e-6) return finiteNumber(next.value);
      const ratio = (time - prevTime) / (nextTime - prevTime);
      return finiteNumber(prev.value) + ((finiteNumber(next.value) - finiteNumber(prev.value)) * ratio);
    }
    return finiteNumber(sorted[sorted.length - 1].value);
  }

  function rectGroupCurve(group, property, channel) {
    return group.curves?.[property]?.[channel] || [];
  }

  function rectGroupHasCurve(group, property, channel) {
    return rectGroupCurve(group, property, channel).length > 0;
  }

  function rectStateAtTime(group, time, rectCurveGroups = null, stateCache = null, visiting = null) {
    const base = group.base;
    const sampleTime = finiteNumber(time);
    const cacheKey = stateCache ? `${rectCurveGroupsKey(group)}\0${sampleTime}` : '';
    if (cacheKey && stateCache.has(cacheKey)) return stateCache.get(cacheKey);
    if (cacheKey) {
      if (!visiting) visiting = new Set();
      if (visiting.has(cacheKey)) return stateCache.get(cacheKey) || null;
      visiting.add(cacheKey);
    }

    const vector = (property, fallback) => ({
      x: evaluateScalarCurve(rectGroupCurve(group, property, 'x'), sampleTime, fallback.x),
      y: evaluateScalarCurve(rectGroupCurve(group, property, 'y'), sampleTime, fallback.y),
    });
    const localPosition = {
      x: finiteNumber(base.localPosition?.x, 0),
      y: finiteNumber(base.localPosition?.y, 0),
      z: finiteNumber(base.localPosition?.z, 0),
    };
    const anchoredPosition = vector('anchoredPosition', base.anchoredPosition || localPosition);
    const sizeDelta = vector('sizeDelta', base.sizeDelta || { x: 100, y: 100 });
    const anchorMin = vector('anchorMin', base.anchorMin || { x: 0.5, y: 0.5 });
    const anchorMax = vector('anchorMax', base.anchorMax || anchorMin);
    const pivot = vector('pivot', base.anchor || { x: 0.5, y: 0.5 });

    let parentSize = base.parentSize
      ? {
        x: finiteNumber(base.parentSize.x, 0),
        y: finiteNumber(base.parentSize.y, 0),
      }
      : null;
    let parentAnchor = base.parentAnchor
      ? {
        x: finiteNumber(base.parentAnchor.x, 0.5),
        y: finiteNumber(base.parentAnchor.y, 0.5),
      }
      : null;

    const parentPath = group.base?.parentPath;
    if (parentPath != null && rectCurveGroups?.has(parentPath)) {
      const parentState = rectStateAtTime(rectCurveGroups.get(parentPath), sampleTime, rectCurveGroups, stateCache, visiting);
      if (parentState?.size) {
        parentSize = {
          x: finiteNumber(parentState.size.x, parentSize?.x ?? 0),
          y: finiteNumber(parentState.size.y, parentSize?.y ?? 0),
        };
      }
      if (parentState?.anchor) {
        parentAnchor = {
          x: finiteNumber(parentState.anchor.x, parentAnchor?.x ?? 0.5),
          y: finiteNumber(parentState.anchor.y, parentAnchor?.y ?? 0.5),
        };
      }
    }

    let state = null;
    if (!parentSize) {
      state = {
        position: { x: anchoredPosition.x, y: anchoredPosition.y, z: localPosition.z },
        size: sizeDelta,
        anchor: pivot,
      };
    } else {
      const stretch = {
        x: anchorMax.x - anchorMin.x,
        y: anchorMax.y - anchorMin.y,
      };
      state = {
        position: {
          x: (((anchorMin.x + (stretch.x * pivot.x)) - parentAnchor.x) * parentSize.x) + anchoredPosition.x,
          y: (((anchorMin.y + (stretch.y * pivot.y)) - parentAnchor.y) * parentSize.y) + anchoredPosition.y,
          z: localPosition.z,
        },
        size: {
          x: sizeDelta.x + (parentSize.x * stretch.x),
          y: sizeDelta.y + (parentSize.y * stretch.y),
        },
        anchor: pivot,
      };
    }

    if (cacheKey) {
      stateCache.set(cacheKey, state);
      visiting.delete(cacheKey);
    }
    return state;
  }

  function rectDerivedChannel(group, outputProperty, channel, times, rectCurveGroups, stateCache) {
    return times.map((time) => ({
      time,
      value: rectStateAtTime(group, time, rectCurveGroups, stateCache)[outputProperty][channel],
    }));
  }

  function hasAnyKeyframes(channels) {
    return Object.values(channels).some((keyframes) => Array.isArray(keyframes) && keyframes.length);
  }

  function emitComputedRectTransformTracks(group, rectCurveGroups) {
    const tracks = [];
    const dependencyTimes = sortedUnionTimes(collectRectDependencyTimes(group, rectCurveGroups));
    const stateCache = new Map();
    const anchorChannels = {
      x: rectGroupCurve(group, 'pivot', 'x'),
      y: rectGroupCurve(group, 'pivot', 'y'),
    };
    if (hasAnyKeyframes(anchorChannels)) {
      tracks.push(cocosScalarVectorTrack(group.path, 'cc.UITransform', 'anchorPoint', anchorChannels, 2));
    }

    const positionChannels = {
      x: rectDerivedChannel(group, 'position', 'x', dependencyTimes, rectCurveGroups, stateCache),
      y: rectDerivedChannel(group, 'position', 'y', dependencyTimes, rectCurveGroups, stateCache),
    };
    if (hasAnyKeyframes(positionChannels)) {
      tracks.push(cocosScalarVectorTrack(group.path, '', 'position', positionChannels, 3));
    }

    const sizeChannels = {
      x: rectDerivedChannel(group, 'size', 'x', dependencyTimes, rectCurveGroups, stateCache),
      y: rectDerivedChannel(group, 'size', 'y', dependencyTimes, rectCurveGroups, stateCache),
    };
    if (hasAnyKeyframes(sizeChannels)) {
      tracks.push(cocosSizeTrack(group.path, 'cc.UITransform', 'contentSize', sizeChannels));
    }
    return tracks;
  }

  function addRectCurveGroup(rectCurveGroups, entry, rectCurve, baseLayout) {
    const key = entry.path;
    if (!rectCurveGroups.has(key)) {
      rectCurveGroups.set(key, { path: entry.path, base: baseLayout, curves: {} });
    }
    const group = rectCurveGroups.get(key);
    if (!group.curves[rectCurve.property]) group.curves[rectCurve.property] = {};
    group.curves[rectCurve.property][rectCurve.channel] = entry.keyframes;
  }

  function addFallbackRectCurve(vectorCurveGroups, sizeCurveGroups, entry) {
    const rectCurve = unityRectTransformFloatCurve(entry.attribute);
    if (!rectCurve) return false;
    const key = `${entry.path}\0${rectCurve.component}\0${rectCurve.property}`;
    const groups = rectCurve.property === 'contentSize' ? sizeCurveGroups : vectorCurveGroups;
    if (!groups.has(key)) {
      groups.set(key, {
        path: entry.path,
        component: rectCurve.component,
        property: rectCurve.property,
        nComponents: rectCurve.nComponents,
        channels: {},
      });
    }
    groups.get(key).channels[rectCurve.channel] = entry.keyframes;
    return true;
  }

  function parseUnityAnimationClip(file, reporter, animationContext = null) {
    const docs = parseUnityYaml(file);
    const doc = docs.find((item) => item.classId === 74) || docs[0];
    if (!doc) return null;
    const name = String(getField(doc, 'm_Name', path.basename(file, '.anim')) || path.basename(file, '.anim'));
    const sample = Number(getField(doc, 'm_SampleRate', 60) || 60);
    const stopTime = Number(unityClipSettingsValue(doc, 'm_StopTime', 0) || 0);
    const loopTime = Number(unityClipSettingsValue(doc, 'm_LoopTime', 0) || 0);
    const tracks = [];

    for (const entry of parseUnityVectorCurveEntries(doc, 'm_PositionCurves')) tracks.push(cocosVectorTrack(entry.path, 'position', entry.keyframes));
    for (const entry of parseUnityVectorCurveEntries(doc, 'm_ScaleCurves')) tracks.push(cocosVectorTrack(entry.path, 'scale', entry.keyframes));
    for (const entry of parseUnityVectorCurveEntries(doc, 'm_EulerCurves')) tracks.push(cocosVectorTrack(entry.path, 'eulerAngles', entry.keyframes));

    const colorCurveGroups = new Map();
    const vectorCurveGroups = new Map();
    const sizeCurveGroups = new Map();
    const rectCurveGroups = new Map();
    const objectTracks = [];
    for (const entry of parseUnityFloatCurveEntries(doc, 'm_FloatCurves')) {
      const channel = unityColorCurveChannel(entry.attribute);
      const component = unityRendererComponentForColorCurve(entry);
      if (channel && component) {
        const property = 'color';
        const trackComponent = component === 'cc.SpriteRenderer'
          ? 'UnitySpriteRendererColorAdapter'
          : component;
        const key = `${entry.path}\0${trackComponent}\0${property}`;
        if (!colorCurveGroups.has(key)) {
          colorCurveGroups.set(key, { path: entry.path, component: trackComponent, property, channels: {} });
        }
        colorCurveGroups.get(key).channels[channel] = entry.keyframes;
        continue;
      }

      if (Number(entry.classId) === 224) {
        const rectCurve = unityRectTransformCurveChannel(entry.attribute);
        if (rectCurve) {
          const baseLayout = animationContext?.rectLayoutsByPath?.get(entry.path);
          if (baseLayout) {
            addRectCurveGroup(rectCurveGroups, entry, rectCurve, baseLayout);
            continue;
          }
          if (addFallbackRectCurve(vectorCurveGroups, sizeCurveGroups, entry)) continue;
        }
      }

      if (Number(entry.classId) === 1 && entry.attribute === 'm_IsActive') {
        objectTracks.push(cocosObjectTrack(entry.path, 'active', entry.keyframes, (value) => finiteNumber(value) !== 0));
        continue;
      }

      reporter.low('ANIMATION_FLOAT_CURVE_SKIPPED', file, entry.path, `Unity float curve "${entry.attribute}" is not mapped to a Cocos track yet`);
    }
    for (const group of vectorCurveGroups.values()) {
      tracks.push(cocosScalarVectorTrack(group.path, group.component, group.property, group.channels, group.nComponents));
    }
    for (const group of sizeCurveGroups.values()) {
      tracks.push(cocosSizeTrack(group.path, group.component, group.property, group.channels));
    }
    for (const group of rectCurveGroups.values()) {
      tracks.push(...emitComputedRectTransformTracks(group, rectCurveGroups));
    }
    for (const track of objectTracks) tracks.push(track);
    for (const group of colorCurveGroups.values()) tracks.push(cocosColorTrack(group.path, group.component, group.property, group.channels));

    const rotationCurves = getIndentedBlock(doc, 'm_RotationCurves');
    if (rotationCurves.length) {
      reporter.low('ANIMATION_ROTATION_CURVE_SKIPPED', file, name, 'Unity quaternion rotation curves are not mapped yet');
    }

    let duration = stopTime;
    for (const track of tracks) {
      for (const channel of track._channels || []) {
        for (const time of channel._curve?._times || []) duration = Math.max(duration, Number(time) || 0);
      }
      for (const time of track._channel?._curve?._times || []) duration = Math.max(duration, Number(time) || 0);
    }

    return {
      __type__: 'cc.AnimationClip',
      _name: name,
      _objFlags: 0,
      _native: '',
      sample,
      speed: 1,
      wrapMode: loopTime ? 2 : 1,
      enableTrsBlending: false,
      _duration: duration,
      _hash: 0,
      _tracks: tracks,
      _events: [],
    };
  }

  function ensureAnimationClipMeta(file, name, uuid) {
    const metaFile = `${file}.meta`;
    const existing = readJsonIfExists(metaFile) || {};
    const meta = {
      ver: existing.ver || '2.0.4',
      importer: 'animation-clip',
      imported: true,
      uuid: existing.uuid || uuid || stableUuid(`animation-clip:${file}`),
      files: Array.isArray(existing.files) && existing.files.length ? existing.files : ['.bin'],
      subMetas: existing.subMetas || {},
      userData: { ...(existing.userData || {}), name },
    };
    fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
    return meta;
  }

  function ensureAnimationGraphMeta(file, uuid) {
    const metaFile = `${file}.meta`;
    const existing = readJsonIfExists(metaFile) || {};
    const meta = {
      ver: existing.ver || '1.2.0',
      importer: 'animation-graph',
      imported: true,
      uuid: existing.uuid || uuid || stableUuid(`animation-graph:${file}`),
      files: Array.isArray(existing.files) && existing.files.length ? existing.files : ['.json'],
      subMetas: existing.subMetas || {},
      userData: existing.userData || {},
    };
    fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
    return meta;
  }

  function animationOutputDirForController(options, controllerAsset) {
    return path.join(options.cocosRoot, 'assets', 'animations', sanitizeFileId(controllerAsset.stem).toLowerCase());
  }

  function writeConvertedAnimationClip(clipAsset, outDir, options, reporter, animationContext = null) {
    const clip = parseUnityAnimationClip(clipAsset.path, reporter, animationContext);
    if (!clip) {
      reporter.medium('ANIMATION_CLIP_PARSE_FAILED', clipAsset.relativePath, '', 'Unity animation clip could not be parsed');
      return '';
    }

    dropUnresolvedTrackBindings(clip, clipAsset.relativePath, reporter, animationContext);

    const fileName = `${sanitizeAssetDisplayName(clip._name, clipAsset.stem)}.anim`;
    const outFile = path.join(outDir, fileName);
    let uuid = stableUuid(`unity-animation-clip:${clipAsset.guid}`);
    if (!options.dryRun) {
      fs.writeFileSync(outFile, `${JSON.stringify(clip, null, 2)}\n`, 'utf8');
      uuid = ensureAnimationClipMeta(outFile, clip._name, uuid).uuid;
    }
    reporter.low('ANIMATION_CLIP_CONVERTED', clipAsset.relativePath, toPosix(path.relative(options.cocosRoot, outFile)), 'Unity AnimationClip converted to Cocos AnimationClip');
    return { uuid, name: clip._name };
  }

  function parseAnimatorParameters(doc) {
    const entries = splitUnityListEntries(getIndentedBlock(doc, 'm_AnimatorParameters'));
    return entries.map((lines) => ({
      name: String(readUnityFieldFromLines(lines, 'm_Name', '')),
      type: Number(readUnityFieldFromLines(lines, 'm_Type', 9) || 9),
      defaultBool: Number(readUnityFieldFromLines(lines, 'm_DefaultBool', 0) || 0),
      defaultFloat: Number(readUnityFieldFromLines(lines, 'm_DefaultFloat', 0) || 0),
      defaultInt: Number(readUnityFieldFromLines(lines, 'm_DefaultInt', 0) || 0),
    })).filter((param) => param.name);
  }

  function parseAnimatorTransitionConditions(doc) {
    return splitUnityListEntries(getIndentedBlock(doc, 'm_Conditions')).map((lines) => ({
      event: String(readUnityFieldFromLines(lines, 'm_ConditionEvent', '')),
      mode: Number(readUnityFieldFromLines(lines, 'm_ConditionMode', 0) || 0),
      threshold: Number(readUnityFieldFromLines(lines, 'm_EventTreshold', 0) || 0),
    })).filter((condition) => condition.event);
  }

  function parseUnityAnimatorController(file, unityDb, reporter, options) {
    const docs = parseUnityYaml(file);
    const controllerDoc = docs.find((doc) => doc.classId === 91);
    const stateMachineDoc = docs.find((doc) => doc.classId === 1107);
    const controllerName = String(getField(controllerDoc || { lines: [] }, 'm_Name', path.basename(file, '.controller')));
    const states = new Map();
    const transitions = new Map();

    for (const doc of docs) {
      if (doc.classId === 1102) {
        const motionRef = getField(doc, 'm_Motion');
        states.set(doc.fileId, {
          fileId: doc.fileId,
          name: String(getField(doc, 'm_Name', 'State')),
          motionGuid: unityRefGuid(motionRef),
          motionFileId: unityRefFileId(motionRef),
          transitionIds: deps.getNestedList(doc, 'm_Transitions').map(unityRefFileId).filter(Boolean),
        });
      } else if (doc.classId === 1101) {
        transitions.set(doc.fileId, {
          fileId: doc.fileId,
          dstStateId: unityRefFileId(getField(doc, 'm_DstState')),
          dstStateMachineId: unityRefFileId(getField(doc, 'm_DstStateMachine')),
          duration: finiteNumber(getField(doc, 'm_TransitionDuration', 0), 0),
          exitTime: finiteNumber(getField(doc, 'm_ExitTime', 1), 1),
          hasExitTime: Number(getField(doc, 'm_HasExitTime', 0) || 0) !== 0,
          conditions: parseAnimatorTransitionConditions(doc),
        });
      }
    }

    const childStateIds = stateMachineDoc
      ? splitUnityListEntries(getIndentedBlock(stateMachineDoc, 'm_ChildStates'))
        .map((lines) => unityRefFileId(readUnityFieldFromLines(lines, 'm_State', null)))
        .filter(Boolean)
      : [...states.keys()];

    const anyStateTransitionIds = stateMachineDoc
      ? deps.getNestedList(stateMachineDoc, 'm_AnyStateTransitions').map(unityRefFileId).filter(Boolean)
      : [];
    const defaultStateId = stateMachineDoc ? unityRefFileId(getField(stateMachineDoc, 'm_DefaultState')) : childStateIds[0] || '';
    const parameters = controllerDoc ? parseAnimatorParameters(controllerDoc) : [];
    return { name: controllerName, parameters, states, transitions, childStateIds, anyStateTransitionIds, defaultStateId };
  }

  function cocosConditionFromUnity(condition) {
    return { __type__: 'cc.animation.TriggerCondition', trigger: condition.event };
  }

  function buildCocosAnimationGraph(controller, clipInfoByState) {
    const objects = [];
    const add = (object) => {
      objects.push(object);
      return objects.length - 1;
    };

    const variables = {};
    for (const param of controller.parameters) {
      variables[param.name] = { __type__: 'cc.animation.TriggerVariable', _flags: 0 };
    }

    add({
      __type__: 'cc.animation.AnimationGraph',
      _name: controller.name,
      _objFlags: 0,
      _native: '',
      _layers: [{ __id__: 1 }],
      _variables: variables,
    });
    add({
      __type__: 'cc.animation.Layer',
      _stateMachine: { __id__: 2 },
      name: 'Base Layer',
      weight: 1,
      mask: null,
      additive: false,
    });
    const stateMachineId = add({
      __type__: 'cc.animation.StateMachine',
      _states: [],
      _transitions: [],
      _entryState: { __id__: 3 },
      _exitState: { __id__: 4 },
      _anyState: { __id__: 5 },
    });
    add({ __type__: 'cc.animation.State', name: 'Entry' });
    add({ __type__: 'cc.animation.State', name: 'Exit' });
    add({ __type__: 'cc.animation.State', name: 'Any' });

    const motionIdByState = new Map();
    for (const stateId of controller.childStateIds) {
      const state = controller.states.get(stateId);
      if (!state) continue;
      const clipInfo = clipInfoByState.get(stateId);
      const clipUuid = clipInfo?.uuid || '';
      const motionName = clipInfo?.name || state.name;
      const motionId = add({
        __type__: 'cc.animation.Motion',
        name: motionName,
        motion: clipUuid
          ? {
            __type__: 'cc.animation.ClipMotion',
            clip: { __expectedType__: 'cc.AnimationClip', __uuid__: clipUuid },
          }
          : null,
      });
      motionIdByState.set(stateId, motionId);
    }

    const stateMachine = objects[stateMachineId];
    stateMachine._states = [3, 4, 5, ...motionIdByState.values()].map(cocosRef);

    const addTransition = (transitionObject) => {
      const id = add(transitionObject);
      stateMachine._transitions.push(cocosRef(id));
      return id;
    };

    const defaultMotionId = motionIdByState.get(controller.defaultStateId);
    if (defaultMotionId != null) {
      addTransition({ __type__: 'cc.animation.Transition', from: cocosRef(3), to: cocosRef(defaultMotionId), conditions: [] });
    }

    const emitUnityTransition = (fromId, transition) => {
      if (!transition) return;
      const toId = motionIdByState.get(transition.dstStateId);
      if (fromId == null || toId == null) return;
      addTransition({
        __type__: 'cc.animation.AnimationTransition',
        from: cocosRef(fromId),
        to: cocosRef(toId),
        conditions: transition.conditions.map(cocosConditionFromUnity),
        destinationStart: 0,
        relativeDestinationStart: false,
        duration: transition.duration,
        relativeDuration: false,
        exitConditionEnabled: transition.hasExitTime,
        _exitCondition: transition.exitTime,
      });
    };

    for (const transitionId of controller.anyStateTransitionIds) emitUnityTransition(5, controller.transitions.get(transitionId));
    for (const [stateId, motionId] of motionIdByState.entries()) {
      const state = controller.states.get(stateId);
      for (const transitionId of state?.transitionIds || []) emitUnityTransition(motionId, controller.transitions.get(transitionId));
    }

    return objects;
  }

  function silentReporter() {
    return {
      add() {},
      low() {},
      medium() {},
      high() {},
    };
  }

  function trackBindingInfo(track) {
    const hierarchy = [];
    let component = '';
    let property = '';
    for (const item of track?._binding?.path?._paths || []) {
      if (typeof item === 'string') {
        property = item;
      } else if (item?.__type__ === 'cc.animation.HierarchyPath') {
        hierarchy.push(item.path);
      } else if (item?.__type__ === 'cc.animation.ComponentPath') {
        component = item.component;
      }
    }
    return { unityPath: hierarchy.join('/'), component, property };
  }

  function reportDroppedTrackBindings(unresolved, source, reporter) {
    if (!reporter) return;
    for (const [unityPath, labels] of unresolved.entries()) {
      reporter.low(
        'ANIMATION_TRACK_PATH_DROPPED',
        source,
        unityPath || '<root>',
        `Animation track path "${unityPath || '<root>'}" does not exist in the converted prefab hierarchy; dropped the binding to avoid Cocos Creator instantiation warnings`,
        [...labels].sort().join(', ')
      );
    }
  }

  function dropUnresolvedTrackBindings(clip, source, reporter, animationContext) {
    if (!clip || !animationContext?.nodeIdByPath) return;

    const unresolved = new Map();
    const resolvedTracks = [];
    for (const track of clip._tracks || []) {
      const binding = trackBindingInfo(track);
      if (animationContext.nodeIdByPath.has(binding.unityPath)) {
        resolvedTracks.push(track);
        continue;
      }

      const key = binding.unityPath;
      if (!unresolved.has(key)) unresolved.set(key, new Set());
      const label = binding.component ? `${binding.component}.${binding.property}` : binding.property || '(unknown)';
      unresolved.get(key).add(label);
    }

    if (unresolved.size) {
      clip._tracks = resolvedTracks;
      reportDroppedTrackBindings(unresolved, source, reporter);
    }
  }

  function realCurveValueAt(curve, time, fallback) {
    const times = curve?._times || [];
    const values = curve?._values || [];
    if (!times.length || !values.length) return fallback;
    const sampleTime = finiteNumber(time);
    if (sampleTime <= finiteNumber(times[0])) return finiteNumber(values[0]?.value, fallback);
    for (let i = 1; i < times.length; i++) {
      const prevTime = finiteNumber(times[i - 1]);
      const nextTime = finiteNumber(times[i]);
      const prevValue = finiteNumber(values[i - 1]?.value, fallback);
      const nextValue = finiteNumber(values[i]?.value, prevValue);
      if (sampleTime > nextTime) continue;
      if (Math.abs(nextTime - prevTime) < 1e-6) return nextValue;
      const ratio = (sampleTime - prevTime) / (nextTime - prevTime);
      return prevValue + ((nextValue - prevValue) * ratio);
    }
    return finiteNumber(values[values.length - 1]?.value, fallback);
  }

  function objectCurveValueAt(curve, time, fallback) {
    const times = curve?._times || [];
    const values = curve?._values || [];
    if (!times.length || !values.length) return fallback;
    const sampleTime = finiteNumber(time);
    if (sampleTime <= finiteNumber(times[0])) return values[0];
    for (let i = 1; i < times.length; i++) {
      if (sampleTime <= finiteNumber(times[i])) return values[i - 1];
    }
    return values[values.length - 1];
  }

  function nodeComponent(builder, nodeId, componentType) {
    const node = builder.objects[nodeId];
    for (const componentRef of node?._components || []) {
      const component = builder.objects[componentRef.__id__];
      if (component?.__type__ === componentType) return component;
    }
    return null;
  }

  function nodeUnitySpriteRendererColorAdapter(builder, nodeId) {
    const node = builder.objects[nodeId];
    for (const componentRef of node?._components || []) {
      const component = builder.objects[componentRef.__id__];
      if (!component) continue;
      if (component.__type__ === 'UnitySpriteRendererColorAdapter') return component;
      if (component.applyMaterialColor === true && component.color?.__type__ === 'cc.Color') return component;
    }
    return null;
  }

  function evaluateVectorTrack(track, current, time) {
    const channels = track?._channels || [];
    return {
      x: realCurveValueAt(channels[0]?._curve, time, finiteNumber(current?.x, 0)),
      y: realCurveValueAt(channels[1]?._curve, time, finiteNumber(current?.y, 0)),
      z: realCurveValueAt(channels[2]?._curve, time, finiteNumber(current?.z, 0)),
    };
  }

  function evaluateSizeTrack(track, current, time) {
    const channels = track?._channels || [];
    return {
      width: realCurveValueAt(channels[0]?._curve, time, finiteNumber(current?.width, 0)),
      height: realCurveValueAt(channels[1]?._curve, time, finiteNumber(current?.height, 0)),
    };
  }

  function evaluateColorTrack(track, current, time) {
    const channels = track?._channels || [];
    return {
      r: Math.round(realCurveValueAt(channels[0]?._curve, time, finiteNumber(current?.r, 255))),
      g: Math.round(realCurveValueAt(channels[1]?._curve, time, finiteNumber(current?.g, 255))),
      b: Math.round(realCurveValueAt(channels[2]?._curve, time, finiteNumber(current?.b, 255))),
      a: Math.round(realCurveValueAt(channels[3]?._curve, time, finiteNumber(current?.a, 255))),
    };
  }

  function applyAnimationClipPoseToPrefab(clip, builder, animationContext, time = 0) {
    if (!clip || !builder || !animationContext?.nodeIdByPath) return false;
    let applied = false;
    for (const track of clip._tracks || []) {
      const binding = trackBindingInfo(track);
      const nodeId = animationContext.nodeIdByPath.get(binding.unityPath);
      if (nodeId == null) continue;
      const node = builder.objects[nodeId];
      if (!node) continue;

      if (!binding.component) {
        if (track.__type__ === 'cc.animation.VectorTrack' && binding.property === 'position') {
          const value = evaluateVectorTrack(track, node._lpos, time);
          node._lpos = vec3(value.x, value.y, value.z);
          applied = true;
        } else if (track.__type__ === 'cc.animation.VectorTrack' && binding.property === 'scale') {
          const value = evaluateVectorTrack(track, node._lscale, time);
          node._lscale = vec3(value.x, value.y, value.z);
          applied = true;
        } else if (track.__type__ === 'cc.animation.VectorTrack' && binding.property === 'eulerAngles') {
          const value = evaluateVectorTrack(track, node._euler, time);
          node._euler = vec3(value.x, value.y, value.z);
          applied = true;
        } else if (track.__type__ === 'cc.animation.ObjectTrack' && binding.property === 'active') {
          node._active = Boolean(objectCurveValueAt(track._channel?._curve, time, node._active));
          applied = true;
        }
        continue;
      }

      if (binding.component === 'cc.UITransform') {
        const uiTransform = nodeComponent(builder, nodeId, 'cc.UITransform');
        if (!uiTransform) continue;
        if (track.__type__ === 'cc.animation.VectorTrack' && binding.property === 'anchorPoint') {
          const value = evaluateVectorTrack(track, uiTransform._anchorPoint, time);
          uiTransform._anchorPoint = vec2(value.x, value.y);
          applied = true;
        } else if (track.__type__ === 'cc.animation.SizeTrack' && binding.property === 'contentSize') {
          const value = evaluateSizeTrack(track, uiTransform._contentSize, time);
          uiTransform._contentSize = size(value.width, value.height);
          applied = true;
        }
      } else if (binding.component === 'cc.Sprite' && track.__type__ === 'cc.animation.ColorTrack' && binding.property === 'color') {
        const sprite = nodeComponent(builder, nodeId, 'cc.Sprite');
        if (!sprite) continue;
        const value = evaluateColorTrack(track, sprite._color, time);
        sprite._color = color(value.r, value.g, value.b, value.a);
        applied = true;
      } else if (binding.component === 'UnitySpriteRendererColorAdapter' && track.__type__ === 'cc.animation.ColorTrack' && binding.property === 'color') {
        const adapter = nodeUnitySpriteRendererColorAdapter(builder, nodeId);
        if (!adapter) continue;
        const value = evaluateColorTrack(track, adapter.color, time);
        adapter.color = color(value.r, value.g, value.b, value.a);
        applied = true;
      }
    }
    return applied;
  }

  function bakeAnimatorDefaultPose(controllerAsset, controller, builder, animationContext, unityDb, reporter) {
    const defaultState = controller?.states?.get(controller.defaultStateId);
    const clipAsset = defaultState?.motionGuid ? unityDb.get(defaultState.motionGuid) : null;
    if (!clipAsset?.path || !fs.existsSync(clipAsset.path)) return;
    const clip = parseUnityAnimationClip(clipAsset.path, silentReporter(), animationContext);
    if (!clip) return;
    if (applyAnimationClipPoseToPrefab(clip, builder, animationContext, 0)) {
      reporter.low(
        'ANIMATOR_DEFAULT_POSE_BAKED',
        controllerAsset.relativePath,
        defaultState.name,
        'Default Animator state first pose was baked into the generated Cocos prefab so the editor view matches Unity before playback'
      );
    }
  }

  function convertAnimatorControllerAsset(
    controllerAsset,
    options,
    reporter,
    unityDb,
    animationContext = null,
    cocosDb = null,
  ) {
    if (!controllerAsset?.path || !fs.existsSync(controllerAsset.path)) return '';
    const outDir = animationOutputDirForController(options, controllerAsset);
    const graphFile = path.join(outDir, `${sanitizeAssetDisplayName(controllerAsset.stem, 'Animator')}.animgraph`);
    const graphUuid = stableUuid(`unity-animation-graph:${controllerAsset.guid}`);
    if (options.dryRun) return graphUuid;

    ensureDir(outDir);
    ensureDirectoryMetas(outDir, path.join(options.cocosRoot, 'assets'));

    const controller = parseUnityAnimatorController(controllerAsset.path, unityDb, reporter, options);
    const clipInfoByState = new Map();
    const convertedClipGuids = new Set();
    for (const [stateId, state] of controller.states.entries()) {
      if (!state.motionGuid) continue;
      const clipAsset = unityDb.get(state.motionGuid);
      if (!clipAsset) {
        reporter.medium('ANIMATION_CLIP_GUID_UNRESOLVED', controllerAsset.relativePath, state.name, 'Animator state motion guid was not found in Unity meta database', state.motionGuid);
        continue;
      }
      let clipInfo = null;
      if (['.fbx', '.gltf', '.glb'].includes(clipAsset.ext)) {
        clipInfo = cocosDb?.resolveModelAnimationByStem(clipAsset.stem, state.name) || null;
        if (clipInfo?.uuid) {
          clipInfo = { ...clipInfo, name: state.name };
          reporter.low(
            'ANIMATOR_EMBEDDED_MODEL_CLIP_WIRED',
            clipAsset.relativePath,
            state.name,
            'Animator state was wired to the matching animation sub-asset of the imported Cocos model',
            clipInfo.uuid,
          );
        } else {
          reporter.medium(
            'ANIMATOR_EMBEDDED_MODEL_CLIP_UNRESOLVED',
            clipAsset.relativePath,
            state.name,
            'Animator state references an embedded model clip that has no matching imported Cocos animation sub-asset',
            state.motionFileId,
          );
        }
      } else {
        clipInfo = writeConvertedAnimationClip(clipAsset, outDir, options, reporter, animationContext);
      }
      if (clipInfo?.uuid) {
        clipInfoByState.set(stateId, clipInfo);
        convertedClipGuids.add(`${clipAsset.guid}:${state.motionFileId || stateId}`);
      }
    }
    if (animationContext) {
      animationContext.clipInfos = controller.childStateIds
        .map((stateId) => clipInfoByState.get(stateId))
        .filter((clipInfo) => clipInfo?.uuid);
      animationContext.defaultClipInfo = clipInfoByState.get(controller.defaultStateId) || animationContext.clipInfos[0] || null;
    }

    const graph = buildCocosAnimationGraph(controller, clipInfoByState);
    fs.writeFileSync(graphFile, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');
    const graphMeta = ensureAnimationGraphMeta(graphFile, graphUuid);
    reporter.low(
      'ANIMATOR_CONTROLLER_CONVERTED',
      controllerAsset.relativePath,
      toPosix(path.relative(options.cocosRoot, graphFile)),
      `Unity AnimatorController converted to Cocos AnimationGraph with ${convertedClipGuids.size} clip(s)`
    );
    return graphMeta.uuid;
  }

  function buildAnimationRectLayoutContext(model, animatorGameObject, builder) {
    const rootTransform = model?.transforms?.get(animatorGameObject?.transformId);
    if (!rootTransform) return null;
    const rectLayoutsByPath = new Map();
    const nodeIdByPath = new Map();
    const visit = (transform, unityPath, parentPath = null) => {
      const nodeId = builder?.nodeMapByTransform?.get(transform.fileId);
      if (nodeId != null) nodeIdByPath.set(unityPath, nodeId);
      if (transform?.isRect) {
        const parent = model.transforms.get(transform.parentId);
        rectLayoutsByPath.set(unityPath, {
          parentPath,
          localPosition: transform.localPosition || { x: 0, y: 0, z: 0 },
          anchoredPosition: transform.anchoredPosition || transform.localPosition || { x: 0, y: 0 },
          sizeDelta: transform.sizeDelta || { x: 100, y: 100 },
          anchorMin: transform.anchorMin || { x: 0.5, y: 0.5 },
          anchorMax: transform.anchorMax || transform.anchorMin || { x: 0.5, y: 0.5 },
          anchor: transform.anchor || { x: 0.5, y: 0.5 },
          parentSize: parent?.resolvedLayout?.size || null,
          parentAnchor: parent?.resolvedLayout?.anchor || null,
        });
      }
      for (const childId of transform.children || []) {
        const child = model.transforms.get(childId);
        const childGameObject = model.gameObjects.get(child?.gameObjectId);
        if (!child || !childGameObject) continue;
        const childPath = unityPath ? `${unityPath}/${childGameObject.name}` : childGameObject.name;
        visit(child, childPath, unityPath);
      }
    };
    visit(rootTransform, '', null);
    return { rectLayoutsByPath, nodeIdByPath };
  }

  function emitAnimator(nodeId, componentId, doc, builder, reporter, options, unityDb, cocosDb, gameObject = null, model = null) {
    const controllerRef = getField(doc, 'm_Controller');
    const controllerAsset = unityDb.get(unityRefGuid(controllerRef));
    const animationContext = buildAnimationRectLayoutContext(model, gameObject, builder);
    let controller = null;
    let graphUuid = '';
    if (controllerAsset) {
      controller = parseUnityAnimatorController(controllerAsset.path, unityDb, reporter, options);
      if (options.overwrite) graphUuid = convertAnimatorControllerAsset(controllerAsset, options, reporter, unityDb, animationContext, cocosDb);
      if (!graphUuid) graphUuid = cocosDb.resolveAnimationGraphByStem(controllerAsset.stem);
      if (!graphUuid) {
        graphUuid = convertAnimatorControllerAsset(controllerAsset, options, reporter, unityDb, animationContext, cocosDb);
        if (!graphUuid) reporter.medium('ANIMATOR_GRAPH_UNRESOLVED', controllerAsset.relativePath, '', 'Animator controller has no matching Cocos animation graph');
      }
      bakeAnimatorDefaultPose(controllerAsset, controller, builder, animationContext, unityDb, reporter);
    }
    if (animationContext?.clipInfos?.length && typeof builder.addAnimation === 'function') {
      builder.addAnimation(nodeId, animationContext.clipInfos, animationContext.defaultClipInfo, `cmp-animation-${componentId}`);
    }
    builder.addAnimationController(nodeId, componentId, graphUuid, `cmp-animation-controller-${componentId}`);
  }

  return {
    parseUnityAnimationClip,
    ensureAnimationClipMeta,
    ensureAnimationGraphMeta,
    animationOutputDirForController,
    writeConvertedAnimationClip,
    parseUnityAnimatorController,
    buildCocosAnimationGraph,
    convertAnimatorControllerAsset,
    emitAnimator,
  };
};
