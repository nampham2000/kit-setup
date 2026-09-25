'use strict';
const { particleRendererContract } = require('./particle-renderer-contract');
const { particleNoiseContract } = require('./particle-noise-contract');
const { particleOrbitContract } = require('./particle-orbit-contract');
const { particleLimitVelocityContract } = require('./particle-limit-velocity-binding');

const { particleShapeRotation } = require('./particle-shape-rotation');

const DEG_TO_RAD = Math.PI / 180;
const UNITY_CURVE_MODE_TO_COCOS = {
  0: 0, // Constant
  1: 1, // Curve
  2: 2, // TwoCurves
  3: 3, // TwoConstants
};
const UNITY_GRADIENT_MODE_TO_COCOS = {
  0: 0, // Color
  1: 1, // Gradient
  2: 2, // TwoColors
  3: 3, // TwoGradients
  4: 4, // RandomColor
};
const COCOS_EXTRAPOLATION_CONSTANT = 1;
const UNITY_WRAP_MODE_TO_COCOS = {
  0: COCOS_EXTRAPOLATION_CONSTANT,
  1: 1,
  2: COCOS_EXTRAPOLATION_CONSTANT,
  4: 3,
  8: COCOS_EXTRAPOLATION_CONSTANT,
};
const UNITY_RENDER_MODE_TO_COCOS = {
  0: 0, // Billboard
  1: 1, // Stretch
  2: 2, // Horizontal billboard
  3: 3, // Vertical billboard
  4: 4, // Mesh
  5: 0, // None
};
const UNITY_GRAVITY_ACCELERATION = 9.81;
const COCOS_TRAIL_MIN_LIFETIME = 1;
// cc.ShapeModule.emit() dispatches per shape and each emitter only implements a
// subset of cc.ParticleEmitLocation (Base 0 / Edge 1 / Shell 2 / Volume 3).
// An unsupported pair warns once per emitted particle, so every shape write has
// to be normalised to a location the emitter actually handles.
const COCOS_SHAPE_EMIT_LOCATIONS = {
  0: { allowed: [1, 2, 3], fallback: 3 }, // Box: Edge / Shell / Volume
  1: { allowed: [0, 1, 2, 3], fallback: 0 }, // Circle ignores emitFrom
  2: { allowed: [0, 2, 3], fallback: 0 }, // Cone: Base / Shell / Volume
  3: { allowed: [2, 3], fallback: 3 }, // Sphere: Shell / Volume
  4: { allowed: [2, 3], fallback: 3 }, // Hemisphere: Shell / Volume
};

function splitTopLevel(text, delimiter) {
  const result = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '{' || ch === '[') depth += 1;
    if (ch === '}' || ch === ']') depth -= 1;
    if (ch === delimiter && depth === 0) {
      result.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() !== '') result.push(current.trim());
  return result;
}

function parseScalar(raw, keyHint = '') {
  let value = String(raw ?? '').trim();
  if (value === '') return '';
  if (keyHint === 'guid') return value;
  if (keyHint === 'fileID') return value === '0' ? '' : value;
  if (value === '[]') return [];
  if (value === '{}') return {};
  if (value === 'null') return null;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value.startsWith('{') && value.endsWith('}')) {
    value = value.slice(1, -1).trim();
    if (!value) return {};
    const obj = {};
    for (const part of splitTopLevel(value, ',')) {
      const idx = part.indexOf(':');
      if (idx < 0) continue;
      const key = part.slice(0, idx).trim();
      obj[key] = parseScalar(part.slice(idx + 1), key);
    }
    return obj;
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    value = value.slice(1, -1).trim();
    if (!value) return [];
    return splitTopLevel(value, ',').map((item) => parseScalar(item));
  }
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) return Number(value);
  return value;
}

function lineIndent(line) {
  return String(line || '').match(/^\s*/)?.[0]?.length || 0;
}

function parseKeyValue(text) {
  const idx = text.indexOf(':');
  if (idx < 0) return null;
  return {
    key: text.slice(0, idx).trim(),
    value: text.slice(idx + 1).trim(),
  };
}

function nextMeaningful(lines, index) {
  for (let i = index; i < lines.length; i += 1) {
    if (String(lines[i] || '').trim()) return i;
  }
  return -1;
}

function parseYamlNode(lines, startIndex, indent) {
  const firstIndex = nextMeaningful(lines, startIndex);
  if (firstIndex < 0) return { value: {}, index: startIndex };
  const trimmed = String(lines[firstIndex]).trim();
  if (lineIndent(lines[firstIndex]) < indent) return { value: {}, index: firstIndex };
  if (trimmed.startsWith('- ')) return parseYamlSequence(lines, firstIndex, lineIndent(lines[firstIndex]));
  return parseYamlMap(lines, firstIndex, lineIndent(lines[firstIndex]));
}

function parseYamlMap(lines, startIndex, indent) {
  const obj = {};
  let i = startIndex;
  while (i < lines.length) {
    const raw = String(lines[i] || '');
    const trimmed = raw.trim();
    if (!trimmed) {
      i += 1;
      continue;
    }
    const currentIndent = lineIndent(raw);
    if (currentIndent < indent) break;
    if (currentIndent > indent) {
      i += 1;
      continue;
    }
    if (trimmed.startsWith('- ')) break;

    const parsed = parseKeyValue(trimmed);
    if (!parsed) {
      i += 1;
      continue;
    }

    if (parsed.value !== '') {
      obj[parsed.key] = parseScalar(parsed.value, parsed.key);
      i += 1;
      continue;
    }

    const childIndex = nextMeaningful(lines, i + 1);
    if (childIndex < 0 || lineIndent(lines[childIndex]) < currentIndent) {
      obj[parsed.key] = {};
      i += 1;
      continue;
    }

    const childIndent = lineIndent(lines[childIndex]);
    const childTrimmed = String(lines[childIndex] || '').trim();
    if (childIndent === currentIndent && !childTrimmed.startsWith('- ')) {
      obj[parsed.key] = {};
      i += 1;
      continue;
    }

    const child = parseYamlNode(lines, childIndex, childIndent);
    obj[parsed.key] = child.value;
    i = child.index;
  }
  return { value: obj, index: i };
}

function parseYamlSequence(lines, startIndex, indent) {
  const list = [];
  let i = startIndex;
  while (i < lines.length) {
    const raw = String(lines[i] || '');
    const trimmed = raw.trim();
    if (!trimmed) {
      i += 1;
      continue;
    }
    const currentIndent = lineIndent(raw);
    if (currentIndent < indent) break;
    if (currentIndent !== indent || !trimmed.startsWith('- ')) break;

    const itemText = trimmed.slice(2).trim();
    let item;
    let nextIndex = i + 1;
    if (!itemText) {
      const childIndex = nextMeaningful(lines, nextIndex);
      if (childIndex >= 0 && lineIndent(lines[childIndex]) > currentIndent) {
        const child = parseYamlNode(lines, childIndex, lineIndent(lines[childIndex]));
        item = child.value;
        nextIndex = child.index;
      } else {
        item = {};
      }
    } else {
      const isInlineCollection = (itemText.startsWith('{') && itemText.endsWith('}'))
        || (itemText.startsWith('[') && itemText.endsWith(']'));
      const parsed = isInlineCollection ? null : parseKeyValue(itemText);
      if (parsed) {
        item = {};
        if (parsed.value !== '') item[parsed.key] = parseScalar(parsed.value, parsed.key);
        const childIndex = nextMeaningful(lines, nextIndex);
        if (childIndex >= 0 && lineIndent(lines[childIndex]) > currentIndent) {
          const child = parseYamlNode(lines, childIndex, lineIndent(lines[childIndex]));
          if (child.value && typeof child.value === 'object' && !Array.isArray(child.value)) {
            item = { ...item, ...child.value };
          }
          nextIndex = child.index;
        }
      } else {
        item = parseScalar(itemText);
      }
    }
    list.push(item);
    i = nextIndex;
  }
  return { value: list, index: i };
}

function unflattenObject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key.includes('.')) {
      const parts = key.split('.');
      let cur = result;
      for (let i = 0; i < parts.length - 1; i++) {
        cur[parts[i]] = cur[parts[i]] || {};
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = value;
    } else {
      result[key] = (value && typeof value === 'object' && !Array.isArray(value)) ? unflattenObject(value) : value;
    }
  }
  return result;
}

function parseUnityParticleDoc(doc) {
  if (!doc) return {};
  let lines = null;
  if (Array.isArray(doc.lines)) {
    lines = doc.lines;
  } else if (typeof doc === 'string') {
    lines = doc.split(/\r?\n/);
  }
  if (lines && lines.length > 0) {
    const parsed = parseYamlNode(lines, 0, 0).value || {};
    return parsed.ParticleSystem || parsed.ParticleSystemForceField || parsed;
  }
  if (typeof doc === 'object') {
    const unflattened = unflattenObject(doc);
    return unflattened.ParticleSystem || unflattened.ParticleSystemForceField || unflattened;
  }
  return {};
}

function parseUnityRendererDoc(doc) {
  if (!doc) return {};
  let lines = null;
  if (Array.isArray(doc.lines)) {
    lines = doc.lines;
  } else if (typeof doc === 'string') {
    lines = doc.split(/\r?\n/);
  }
  if (lines && lines.length > 0) {
    const parsed = parseYamlNode(lines, 0, 0).value || {};
    return parsed.ParticleSystemRenderer || parsed;
  }
  if (typeof doc === 'object') {
    const unflattened = unflattenObject(doc);
    return unflattened.ParticleSystemRenderer || unflattened;
  }
  return {};
}

function serializedPropertyTokens(propertyPath) {
  return String(propertyPath || '')
    .replace(/^['"]|['"]$/g, '')
    .replace(/\.Array\.data\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
    .map((token) => (/^\d+$/.test(token) ? Number(token) : token));
}

function setUnitySerializedProperty(root, propertyPath, value) {
  if (!root || typeof root !== 'object' || !propertyPath) return false;
  const sizePath = String(propertyPath).match(/^(.*)\.Array\.size$/);
  const tokens = serializedPropertyTokens(sizePath ? sizePath[1] : propertyPath);
  if (!tokens.length) return false;

  let target = root;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index];
    const nextIsIndex = typeof tokens[index + 1] === 'number';
    if (target[token] == null || typeof target[token] !== 'object') {
      target[token] = nextIsIndex ? [] : {};
    }
    target = target[token];
  }

  const key = tokens[tokens.length - 1];
  if (sizePath) {
    if (!Array.isArray(target[key])) target[key] = [];
    const size = Math.max(0, Math.floor(num(value, 0)));
    target[key].length = size;
    for (let index = 0; index < size; index += 1) {
      if (target[key][index] == null) target[key][index] = {};
    }
    return true;
  }
  target[key] = value;
  return true;
}

function applyUnitySerializedOverrides(root, properties) {
  const entries = Object.entries(properties || {});
  let applied = 0;
  for (const [propertyPath, value] of entries.filter(([path]) => path.endsWith('.Array.size'))) {
    if (setUnitySerializedProperty(root, propertyPath, value)) applied += 1;
  }
  for (const [propertyPath, value] of entries.filter(([path]) => !path.endsWith('.Array.size'))) {
    if (setUnitySerializedProperty(root, propertyPath, value)) applied += 1;
  }
  return applied;
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return Number(value) !== 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep01(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - (2 * t));
}

function color(value, fallback = { r: 1, g: 1, b: 1, a: 1 }) {
  const source = value && typeof value === 'object' ? value : fallback;
  return {
    __type__: 'cc.Color',
    r: Math.round(clamp(num(source.r, fallback.r) * 255, 0, 255)),
    g: Math.round(clamp(num(source.g, fallback.g) * 255, 0, 255)),
    b: Math.round(clamp(num(source.b, fallback.b) * 255, 0, 255)),
    a: Math.round(clamp(num(source.a, fallback.a) * 255, 0, 255)),
  };
}

function vec3(value, fallback = { x: 0, y: 0, z: 0 }) {
  const source = value && typeof value === 'object' ? value : fallback;
  return {
    __type__: 'cc.Vec3',
    x: num(source.x, fallback.x),
    y: num(source.y, fallback.y),
    z: num(source.z, fallback.z),
  };
}

function unityVectorToCocos(value, fallback = { x: 0, y: 0, z: 0 }) {
  if (!value || typeof value !== 'object') return vec3(fallback);
  return vec3({
    x: num(value.x, fallback.x),
    y: num(value.y, fallback.y),
    z: -num(value.z, fallback.z),
  }, fallback);
}

function cocosRef(id) {
  return { __id__: id };
}

function uuidRef(uuid, expectedType = '') {
  if (!uuid) return null;
  return expectedType ? { __uuid__: uuid, __expectedType__: expectedType } : { __uuid__: uuid };
}

function refObject(objects, ref) {
  if (ref && typeof ref === 'object' && !('__id__' in ref)) return ref;
  const id = Number(ref?.__id__);
  return Number.isInteger(id) ? objects[id] : null;
}

function setKnown(obj, names, value) {
  if (!obj) return;
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(obj, name)) obj[name] = value;
  }
  if (!names.some((name) => Object.prototype.hasOwnProperty.call(obj, name))) obj[names[0]] = value;
}

function addObject(builder, obj) {
  if (builder && typeof builder.add === 'function') return builder.add(obj);
  return -1;
}

function flatRealKeyframeValue(value) {
  return {
    __type__: 'cc.RealKeyframeValue',
    interpolationMode: 2,
    tangentWeightMode: 0,
    value: num(value?.value, 0),
    leftTangent: 0,
    leftTangentWeight: 0.33333334,
    rightTangent: 0,
    rightTangentWeight: 0.33333334,
  };
}

function clampRealCurveToLifetime(curve) {
  if (!curve?._times?.length || !curve?._values?.length) return;

  const firstTime = curve._times[0];
  const firstValue = curve._values[0];
  if (firstTime > 0 && num(curve.preExtrapolation, COCOS_EXTRAPOLATION_CONSTANT) !== COCOS_EXTRAPOLATION_CONSTANT) {
    firstValue.leftTangent = 0;
    curve._times.unshift(0);
    curve._values.unshift(flatRealKeyframeValue(firstValue));
  }

  const lastIndex = curve._times.length - 1;
  const lastTime = curve._times[lastIndex];
  const lastValue = curve._values[lastIndex];
  if (lastTime < 1 && num(curve.postExtrapolation, COCOS_EXTRAPOLATION_CONSTANT) !== COCOS_EXTRAPOLATION_CONSTANT) {
    lastValue.rightTangent = 0;
    curve._times.push(1);
    curve._values.push(flatRealKeyframeValue(lastValue));
  }
}

function addRealCurve(builder, unityCurve) {
  const keys = Array.isArray(unityCurve?.m_Curve) ? unityCurve.m_Curve : [];
  const curve = {
    __type__: 'cc.RealCurve',
    _times: [],
    _values: [],
    preExtrapolation: UNITY_WRAP_MODE_TO_COCOS[num(unityCurve?.m_PreInfinity, 2)] ?? 1,
    postExtrapolation: UNITY_WRAP_MODE_TO_COCOS[num(unityCurve?.m_PostInfinity, 2)] ?? 1,
  };

  for (const key of keys) {
    curve._times.push(num(key.time, 0));
    curve._values.push({
      __type__: 'cc.RealKeyframeValue',
      interpolationMode: 2,
      tangentWeightMode: num(key.weightedMode, 0),
      value: num(key.value, 0),
      leftTangent: num(key.inSlope, 0),
      leftTangentWeight: num(key.inWeight, 0.33333334),
      rightTangent: num(key.outSlope, 0),
      rightTangentWeight: num(key.outWeight, 0.33333334),
    });
  }

  if (!curve._times.length) {
    curve._times.push(0, 1);
    curve._values.push(
      flatRealKeyframeValue({ value: 1 }),
      flatRealKeyframeValue({ value: 1 }),
    );
  }
  clampRealCurveToLifetime(curve);

  const id = addObject(builder, curve);
  return id >= 0 ? cocosRef(id) : curve;
}

function applyCurveRange(builder, curveRange, data, multiplier = 1) {
  if (!curveRange || !data || typeof data !== 'object') return false;

  const mode = UNITY_CURVE_MODE_TO_COCOS[num(data.minMaxState, 0)] ?? 0;
  delete curveRange.constant;
  delete curveRange.constantMin;
  delete curveRange.constantMax;
  delete curveRange.spline;
  delete curveRange.splineMin;
  delete curveRange.splineMax;

  curveRange.mode = mode;
  curveRange.multiplier = 1;

  if (mode === 0) {
    curveRange.constant = num(data.scalar, 0) * multiplier;
  } else if (mode === 3) {
    const first = num(data.minScalar, 0) * multiplier;
    const second = num(data.scalar, num(data.minScalar, 0)) * multiplier;
    curveRange.constantMin = Math.min(first, second);
    curveRange.constantMax = Math.max(first, second);
  } else if (mode === 1) {
    curveRange.spline = addRealCurve(builder, data.maxCurve);
    curveRange.multiplier = num(data.scalar, 1) * multiplier;
  } else if (mode === 2) {
    curveRange.splineMin = addRealCurve(builder, data.minCurve);
    curveRange.splineMax = addRealCurve(builder, data.maxCurve);
    curveRange.multiplier = num(data.scalar, 1) * multiplier;
  }
  return true;
}

function applyCurveByRef(builder, particle, prop, data, multiplier = 1) {
  return applyCurveRange(builder, refObject(builder.objects, particle?.[prop]), data, multiplier);
}

function addCurveRange(builder, data, multiplier = 1) {
  const id = addObject(builder, { __type__: 'cc.CurveRange' });
  if (id < 0) return null;
  applyCurveRange(builder, builder.objects[id], data, multiplier);
  return cocosRef(id);
}

function curveRangeConstantValue(data) {
  if (!data || typeof data !== 'object') return 0;
  const mode = num(data.minMaxState, 0);
  if (mode === 3) {
    return (num(data.minScalar, 0) + num(data.scalar, 0)) * 0.5;
  }
  return num(data.scalar, 0);
}

function unityCurveScalar(data, fallback = 0) {
  if (!data || typeof data !== 'object') return num(data, fallback);
  if (data.minMaxState == null && data.scalar == null && data.minScalar == null) return fallback;
  return curveRangeConstantValue(data);
}

function cocosCurveRangeConstantValue(data, fallback = 0) {
  if (!data || typeof data !== 'object') return fallback;
  const mode = num(data.mode ?? data._mode, 0);
  if (mode === 0) return num(data.constant, fallback);
  if (mode === 3) return (num(data.constantMin, fallback) + num(data.constantMax, fallback)) * 0.5;
  return fallback;
}

function cocosCurveRangeMaxValue(data, fallback = 0) {
  if (!data || typeof data !== 'object') return fallback;
  const mode = num(data.mode ?? data._mode, 0);
  if (mode === 0) return num(data.constant, fallback);
  if (mode === 3) return num(data.constantMax, fallback);
  return num(data.multiplier, fallback);
}

function curveRangeLooksZero(data) {
  return Math.abs(curveRangeConstantValue(data)) < 1e-6;
}

function ensureCocosCurveRangeMaxAtLeast(builder, curveRange, minimum) {
  if (!curveRange || !Number.isFinite(minimum)) return false;
  const mode = num(curveRange.mode ?? curveRange._mode, 0);
  if (mode === 0) {
    if (num(curveRange.constant, 0) >= minimum) return false;
    const value=curveRange.constant/minimum;
    curveRange.mode=1;curveRange.multiplier=minimum;
    curveRange.spline=addRealCurve(builder,{m_Curve:[unityCurveKey(0,value),unityCurveKey(1,value)]});
    delete curveRange.constant;
    return true;
  }
  if (mode === 3) {
    if (num(curveRange.constantMax, 0) >= minimum) return false;
    curveRange.mode=2;curveRange.multiplier=minimum;
    curveRange.splineMin=addRealCurve(builder,{m_Curve:[unityCurveKey(0,curveRange.constantMin/minimum),unityCurveKey(1,curveRange.constantMin/minimum)]});
    curveRange.splineMax=addRealCurve(builder,{m_Curve:[unityCurveKey(0,curveRange.constantMax/minimum),unityCurveKey(1,curveRange.constantMax/minimum)]});
    delete curveRange.constantMin;delete curveRange.constantMax;
    return true;
  }
  if (num(curveRange.multiplier, 0) >= minimum) return false;
  const scale=curveRange.multiplier/minimum;
  for(const key of ['spline','splineMin','splineMax']){
    const curve=refObject(builder.objects,curveRange[key]);
    if(curve)for(const value of curve._values){
      value.value*=scale;
      for(const side of ['left','right']){
        const slope=value[side+'Tangent'];
        if(Number.isFinite(slope))value[side+'TangentWeight']*=Math.hypot(1,slope*scale)/Math.hypot(1,slope);
        value[side+'Tangent']*=scale;
      }
    }
  }
  curveRange.multiplier = minimum;
  return true;
}

function curveRangeIsConstant(data) {
  return Boolean(data && typeof data === 'object' && num(data.minMaxState, 0) === 0);
}

function migrateSimpleWorldForceToGravity(initialGravity, forceData) {
  if (!forceData || typeof forceData !== 'object' || !bool(forceData.enabled, false)) {
    return { gravityData: initialGravity, forceData };
  }
  if (!bool(forceData.inWorldSpace, false)) {
    return { gravityData: initialGravity, forceData };
  }
  if (!curveRangeIsConstant(forceData.x) || !curveRangeIsConstant(forceData.y) || !curveRangeIsConstant(forceData.z)) {
    return { gravityData: initialGravity, forceData };
  }

  const forceX = curveRangeConstantValue(forceData.x);
  const forceY = curveRangeConstantValue(forceData.y);
  const forceZ = curveRangeConstantValue(forceData.z);
  if (Math.abs(forceX) > 1e-6 || Math.abs(forceZ) > 1e-6 || forceY >= -1e-6) {
    return { gravityData: initialGravity, forceData };
  }

  const hasInitialGravity = Boolean(initialGravity && typeof initialGravity === 'object');
  if (hasInitialGravity && !curveRangeIsConstant(initialGravity) && !curveRangeLooksZero(initialGravity)) {
    return { gravityData: initialGravity, forceData };
  }

  const baseGravity = hasInitialGravity ? curveRangeConstantValue(initialGravity) : 0;
  const gravityModifier = baseGravity + ((-forceY) / UNITY_GRAVITY_ACCELERATION);
  return {
    gravityData: constantCurveRange(gravityModifier),
    forceData: {
      enabled: false,
      inWorldSpace: forceData.inWorldSpace,
      x: constantCurveRange(0),
      y: constantCurveRange(0),
      z: constantCurveRange(0),
    },
    migrated: true,
  };
}

// If VelocityModule is a simple constant world-space Y-only force, fold it into gravityModifier and disable it.
// In Cocos, VelocityOvertimeModule adds its value to ultimateVelocity each frame without dt-scaling,
// making it behave as an acceleration rather than a velocity offset. Absorbing it into gravity gives
// the same net vertical trajectory as Unity for particles within their lifetime.
function migrateSimpleWorldVelocityYToGravity(gravityData, velocityData) {
  if (!velocityData || typeof velocityData !== 'object' || !bool(velocityData.enabled, false)) {
    return { gravityData, velocityData };
  }
  if (!bool(velocityData.inWorldSpace, false)) {
    return { gravityData, velocityData };
  }
  if (!curveRangeIsConstant(velocityData.x) || !curveRangeIsConstant(velocityData.y) || !curveRangeIsConstant(velocityData.z)) {
    return { gravityData, velocityData };
  }
  if (velocityData.speedModifier && !curveRangeIsConstant(velocityData.speedModifier)) {
    return { gravityData, velocityData };
  }
  const speedModifier = velocityData.speedModifier ? curveRangeConstantValue(velocityData.speedModifier) : 1;
  if (Math.abs(speedModifier - 1) > 1e-6) {
    return { gravityData, velocityData };
  }

  const velX = curveRangeConstantValue(velocityData.x);
  const velY = curveRangeConstantValue(velocityData.y);
  const velZ = curveRangeConstantValue(velocityData.z);
  // Only migrate Y-only constant velocity (no X/Z components), and only non-zero Y
  if (Math.abs(velX) > 1e-6 || Math.abs(velZ) > 1e-6 || Math.abs(velY) < 1e-6) {
    return { gravityData, velocityData };
  }

  const hasGravity = Boolean(gravityData && typeof gravityData === 'object');
  if (hasGravity && !curveRangeIsConstant(gravityData) && !curveRangeLooksZero(gravityData)) {
    return { gravityData, velocityData };
  }

  // Fold velY into gravity: positive velY (upward) reduces effective gravity,
  // negative velY (downward) increases it. Same sign convention as ForceModule.
  const baseGravity = hasGravity ? curveRangeConstantValue(gravityData) : 0;
  const adjustedGravity = baseGravity - (velY / UNITY_GRAVITY_ACCELERATION);
  return {
    gravityData: constantCurveRange(Math.max(0, adjustedGravity)),
    velocityData: {
      ...velocityData,
      enabled: false,
      x: constantCurveRange(0),
      y: constantCurveRange(0),
      z: constantCurveRange(0),
    },
    migrated: true,
  };
}

function twoConstantCurveRange(minValue, maxValue) {
  return {
    minMaxState: 3,
    minScalar: minValue,
    scalar: maxValue,
  };
}

function unityCurveKey(time, value, inSlope = 0, outSlope = 0) {
  return {
    serializedVersion: 3,
    time,
    value,
    inSlope,
    outSlope,
    tangentMode: 0,
    weightedMode: 0,
    inWeight: 0.33333334,
    outWeight: 0.33333334,
  };
}

function unityRealCurve(samples) {
  const keys = samples.map(({ time, value }, index) => {
    const previous = samples[Math.max(index - 1, 0)];
    const next = samples[Math.min(index + 1, samples.length - 1)];
    const inDeltaTime = Math.max(time - previous.time, 1e-6);
    const outDeltaTime = Math.max(next.time - time, 1e-6);
    const inSlope = index > 0 ? (value - previous.value) / inDeltaTime : (next.value - value) / outDeltaTime;
    const outSlope = index < samples.length - 1 ? (next.value - value) / outDeltaTime : (value - previous.value) / inDeltaTime;
    return unityCurveKey(time, value, inSlope, outSlope);
  });

  return {
    serializedVersion: 2,
    m_Curve: keys,
    m_PreInfinity: 2,
    m_PostInfinity: 2,
    m_RotationOrder: 4,
  };
}

function curveRangeFromSamples(samples) {
  return {
    minMaxState: 1,
    scalar: 1,
    maxCurve: unityRealCurve(samples),
  };
}

function curveRangeFromTwoSamples(minSamples, maxSamples) {
  return {
    minMaxState: 2,
    scalar: 1,
    minCurve: unityRealCurve(minSamples),
    maxCurve: unityRealCurve(maxSamples),
  };
}

function constantCurveRange(value) {
  return {
    minMaxState: 0,
    scalar: value,
  };
}

function shapeSupportsArcApproximation(shapeModule) {
  const shapeType = num(shapeModule?._shapeType ?? shapeModule?.shapeType, -1);
  return shapeType === 1 || shapeType === 2;
}

function normalizeShapeEmitFrom(shapeModule) {
  if (!shapeModule) return false;
  const rule = COCOS_SHAPE_EMIT_LOCATIONS[shapeTypeValue(shapeModule)];
  if (!rule || rule.allowed.includes(num(shapeModule.emitFrom, rule.fallback))) return false;
  shapeModule.emitFrom = rule.fallback;
  return true;
}

function shapeTypeValue(shapeModule) {
  return num(shapeModule?._shapeType ?? shapeModule?.shapeType, -1);
}

function shapeScaleValue(shapeModule) {
  const scale = shapeModule?._scale || {};
  return Math.max(Math.abs(num(scale.x, 1)), Math.abs(num(scale.y, 1)), Math.abs(num(scale.z, 1)), 1);
}

function gradientTime(value) {
  return clamp(num(value, 0) / 65535, 0, 1);
}

function addColorKey(builder, colorValue, time) {
  const id = addObject(builder, {
    __type__: 'cc.ColorKey',
    color: color(colorValue),
    time: gradientTime(time),
  });
  return cocosRef(id);
}

function addAlphaKey(builder, alpha, time) {
  const id = addObject(builder, {
    __type__: 'cc.AlphaKey',
    alpha: Math.round(clamp(num(alpha, 1) * 255, 0, 255)),
    time: gradientTime(time),
  });
  return cocosRef(id);
}

function addGradient(builder, unityGradient) {
  if (!unityGradient || typeof unityGradient !== 'object') return null;
  const colorKeys = [];
  const alphaKeys = [];
  const colorCount = clamp(Math.floor(num(unityGradient.m_NumColorKeys, 0)), 0, 8);
  const alphaCount = clamp(Math.floor(num(unityGradient.m_NumAlphaKeys, 0)), 0, 8);

  for (let i = 0; i < colorCount; i += 1) {
    colorKeys.push(addColorKey(builder, unityGradient[`key${i}`], unityGradient[`ctime${i}`]));
  }
  for (let i = 0; i < alphaCount; i += 1) {
    const key = unityGradient[`key${i}`] || {};
    alphaKeys.push(addAlphaKey(builder, key.a, unityGradient[`atime${i}`]));
  }

  if (!colorKeys.length) colorKeys.push(addColorKey(builder, { r: 1, g: 1, b: 1, a: 1 }, 0));
  if (!alphaKeys.length) alphaKeys.push(addAlphaKey(builder, 1, 0));

  // Unity clamps outside authored key times. Cocos interpolates from/to
  // transparent black at 0/1, so materialize the two constant endpoints.
  for (const keys of [colorKeys, alphaKeys]) {
    const first = builder.objects[keys[0].__id__];
    const last = builder.objects[keys[keys.length - 1].__id__];
    if (first.time > 0) keys.unshift(cocosRef(addObject(builder, { ...first, time: 0 })));
    if (last.time < 1) keys.push(cocosRef(addObject(builder, { ...last, time: 1 })));
  }

  const id = addObject(builder, {
    __type__: 'cc.Gradient',
    colorKeys,
    alphaKeys,
    mode: num(unityGradient.m_Mode, 0),
  });
  return cocosRef(id);
}

function applyGradientRange(builder, gradientRange, data) {
  if (!gradientRange || !data || typeof data !== 'object') return false;

  const mode = UNITY_GRADIENT_MODE_TO_COCOS[num(data.minMaxState, 0)] ?? 0;
  delete gradientRange.color;
  delete gradientRange.colorMin;
  delete gradientRange.colorMax;
  delete gradientRange.gradient;
  delete gradientRange.gradientMin;
  delete gradientRange.gradientMax;
  gradientRange._mode = mode;

  if (mode === 0) {
    gradientRange.color = color(data.maxColor || data.color);
  } else if (mode === 2) {
    gradientRange.colorMin = color(data.minColor);
    gradientRange.colorMax = color(data.maxColor || data.color);
  } else if (mode === 1 || mode === 4) {
    gradientRange.gradient = addGradient(builder, data.maxGradient);
  } else if (mode === 3) {
    gradientRange.gradientMin = addGradient(builder, data.minGradient);
    gradientRange.gradientMax = addGradient(builder, data.maxGradient);
  }
  return true;
}

function applyGradientByRef(builder, owner, prop, data) {
  return applyGradientRange(builder, refObject(builder.objects, owner?.[prop]), data);
}

function getShapeMapping(unityType) {
  switch (Number(unityType)) {
    case 0: return { shapeType: 3, emitFrom: 3 }; // Sphere
    case 1: return { shapeType: 3, emitFrom: 2 }; // Sphere shell
    case 2: return { shapeType: 4, emitFrom: 3 }; // Hemisphere
    case 3: return { shapeType: 4, emitFrom: 2 }; // Hemisphere shell
    case 4: return { shapeType: 2, emitFrom: 0 }; // Cone
    case 5: return { shapeType: 0, emitFrom: 3 }; // Box
    case 7: return { shapeType: 2, emitFrom: 2 }; // Cone shell
    case 8: return { shapeType: 2, emitFrom: 3 }; // Cone volume
    case 9: return { shapeType: 2, emitFrom: 2 }; // Cone volume shell
    case 10: return { shapeType: 1, emitFrom: 0 }; // Circle
    case 11: return { shapeType: 1, emitFrom: 1 }; // Circle edge
    case 12: return { shapeType: 0, emitFrom: 1 }; // Single-sided edge approximation
    case 6: // Mesh
    case 13: // Mesh renderer
    case 14: // Skinned mesh renderer
    case 19: // Sprite
    case 20: // Sprite renderer
      return { shapeType: 0, emitFrom: 3 };
    case 15: return { shapeType: 0, emitFrom: 2 }; // Box shell
    case 16: return { shapeType: 0, emitFrom: 1 }; // Box edge
    case 17: return { shapeType: 1, emitFrom: 0 }; // Donut approximation
    case 18: return { shapeType: 0, emitFrom: 1 }; // Rectangle approximation
    default: return { shapeType: 0, emitFrom: 3 };
  }
}

function radiusValue(value, fallback = 1) {
  if (value && typeof value === 'object' && value.value != null) return num(value.value, fallback);
  return num(value, fallback);
}

function unityRefIsEmpty(value) {
  if (!value || typeof value !== 'object') return true;
  return !Number(value.fileID || value.fileId || 0) && !String(value.guid || '').trim();
}

function shapeHasUnitySource(data) {
  switch (Number(data?.type)) {
    case 6: return !unityRefIsEmpty(data.m_Mesh);
    case 13: return !unityRefIsEmpty(data.m_MeshRenderer);
    case 14: return !unityRefIsEmpty(data.m_SkinnedMeshRenderer);
    case 19: return !unityRefIsEmpty(data.m_Sprite);
    case 20: return !unityRefIsEmpty(data.m_SpriteRenderer);
    default: return true;
  }
}

function shouldUsePointShapeFallback(data) {
  return !shapeHasUnitySource(data);
}

function applyShapeModule(builder, particle, data) {
  const module = refObject(builder.objects, particle?._shapeModule);
  if (!module || !data || typeof data !== 'object') return false;
  const enabled = bool(data.enabled, false);
  setKnown(module, ['_enable', 'enable'], enabled);

  const mapping = getShapeMapping(data.type);
  setKnown(module, ['_shapeType'], mapping.shapeType);
  setKnown(module, ['shapeType'], mapping.shapeType);
  module.emitFrom = mapping.emitFrom;

  module.radius = radiusValue(data.radius, module.radius ?? 1);
  module.radiusThickness = num(data.radiusThickness, module.radiusThickness ?? 1);
  module.length = num(data.length, module.length ?? 5);
  module.boxThickness = vec3(data.boxThickness, module.boxThickness || { x: 0, y: 0, z: 0 });
  module.alignToDirection = bool(data.alignToDirection, false);
  module.randomDirectionAmount = num(data.randomDirectionAmount, 0);
  module.sphericalDirectionAmount = num(data.sphericalDirectionAmount, 0);
  module.randomPositionAmount = num(data.randomPositionAmount, 0);
  module.arcMode = num(data.arc?.mode, module.arcMode ?? 0);
  module.arcSpread = num(data.arc?.spread, module.arcSpread ?? 0);
  module._arc = radiusValue(data.arc, 360) * DEG_TO_RAD;
  module._angle = num(data.angle, 0) * DEG_TO_RAD;
  module._position = unityVectorToCocos(data.m_Position || data.position, module._position || { x: 0, y: 0, z: 0 });
  const rotation = vec3(data.m_Rotation || data.rotation, { x: 0, y: 0, z: 0 });
  module._rotation = vec3(particleShapeRotation(rotation), { x: 0, y: 0, z: 0 });
  module._scale = vec3(data.m_Scale || data.scale, module._scale || { x: 1, y: 1, z: 1 });
  if (!enabled || shouldUsePointShapeFallback(data)) {
    setKnown(module, ['_shapeType'], 0);
    setKnown(module, ['shapeType'], 0);
    // Cocos' box emitter accepts Edge/Shell/Volume only. A zero-sized Volume
    // is the point-emitter equivalent used when Unity's mesh source cannot be
    // represented, without producing one warning per emitted particle.
    module.emitFrom = 3;
    module.radius = 0;
    module.length = 0;
    module.randomPositionAmount = 0;
    module._scale = vec3({ x: 0, y: 0, z: 0 }, module._scale);
  }
  normalizeShapeEmitFrom(module);
  applyCurveRange(builder, refObject(builder.objects, module.arcSpeed), data.arc?.speed);
  return true;
}

function applySizeModule(builder, particle, data) {
  const module = refObject(builder.objects, particle?._sizeOvertimeModule);
  if (!module || !data || typeof data !== 'object') return false;
  const enabled = bool(data.enabled, false);
  setKnown(module, ['_enable', 'enable'], enabled);
  module.separateAxes = bool(data.separateAxes, false);
  applyCurveRange(builder, refObject(builder.objects, module.size), data.curve);
  if (module.separateAxes) {
    // Unity serializes size X as `curve`, including separate-axis mode.
    applyCurveRange(builder, refObject(builder.objects, module.x), data.x || data.curve);
    applyCurveRange(builder, refObject(builder.objects, module.y), data.y);
    applyCurveRange(builder, refObject(builder.objects, module.z), data.z);
  } else {
    applyCurveRange(builder, refObject(builder.objects, module.x), data.curve);
    applyCurveRange(builder, refObject(builder.objects, module.y), data.curve);
    applyCurveRange(builder, refObject(builder.objects, module.z), data.curve);
  }
  return true;
}

function applyRotationModule(builder, particle, data, rendererContract = null) {
  const module = refObject(builder.objects, particle?._rotationOvertimeModule);
  if (!module || !data || typeof data !== 'object') return false;
  const separateAxes = bool(data.separateAxes, false);
  setKnown(module, ['_enable', 'enable'], bool(data.enabled, false));
  setKnown(module, ['_separateAxes', 'separateAxes'], separateAxes);
  if (separateAxes) {
    applyCurveRange(builder, refObject(builder.objects, module.x), data.x, rendererContract?.eulerSigns[0] ?? -1);
    applyCurveRange(builder, refObject(builder.objects, module.y), data.y, rendererContract?.eulerSigns[1] ?? 1);
    applyCurveRange(builder, refObject(builder.objects, module.z), data.z || data.curve, rendererContract?.eulerSigns[2] ?? -1);
  } else {
    applyCurveRange(builder, refObject(builder.objects, module.x), data.x, -1);
    applyCurveRange(builder, refObject(builder.objects, module.y), data.y);
    applyCurveRange(builder, refObject(builder.objects, module.z), data.curve || data.z, rendererContract?.eulerSigns[2] ?? 1);
  }
  return true;
}

function applyVelocityModule(builder, particle, data) {
  const module = refObject(builder.objects, particle?._velocityOvertimeModule);
  if (!module || !data || typeof data !== 'object') return false;
  const enabled = bool(data.enabled, false);
  setKnown(module, ['_enable', 'enable'], enabled);
  module.space = bool(data.inWorldSpace, false) ? 0 : 1;
  applyCurveRange(builder, refObject(builder.objects, module.x), data.x);
  applyCurveRange(builder, refObject(builder.objects, module.y), data.y);
  applyCurveRange(builder, refObject(builder.objects, module.z), data.z, -1);
  applyCurveRange(builder, refObject(builder.objects, module.speedModifier), data.speedModifier);
  if (!enabled) return true;

  // Orbital is integrated from position by UnityParticleOrbit, never by
  // invented lateral velocities or mutations of the emission shape.
  return true;
}

function applyForceModule(builder, particle, data) {
  const module = refObject(builder.objects, particle?._forceOvertimeModule);
  if (!module || !data || typeof data !== 'object') return false;
  setKnown(module, ['_enable', 'enable'], bool(data.enabled, false));
  module.space = bool(data.inWorldSpace, false) ? 0 : 1;
  applyCurveRange(builder, refObject(builder.objects, module.x), data.x);
  applyCurveRange(builder, refObject(builder.objects, module.y), data.y);
  applyCurveRange(builder, refObject(builder.objects, module.z), data.z, -1);
  return true;
}

function applyLimitVelocityModule(builder, particle, data) {
  const module = refObject(builder.objects, particle?._limitVelocityOvertimeModule);
  if (!module || !data || typeof data !== 'object') return false;
  setKnown(module, ['_enable', 'enable'], bool(data.enabled, false));
  module.space = bool(data.inWorldSpace, false) ? 0 : 1;
  // Unity serializes this module's flag as `separateAxis` (singular).
  module.separateAxes = bool(data.separateAxis ?? data.separateAxes, false);
  module.dampen = num(data.dampen, module.dampen ?? 0);
  applyCurveRange(builder, refObject(builder.objects, module.limit), data.magnitude);
  applyCurveRange(builder, refObject(builder.objects, module.limitX), data.x);
  applyCurveRange(builder, refObject(builder.objects, module.limitY), data.y);
  applyCurveRange(builder, refObject(builder.objects, module.limitZ), data.z);
  return true;
}

function applyColorModule(builder, particle, data) {
  const module = refObject(builder.objects, particle?._colorOverLifetimeModule);
  if (!module || !data || typeof data !== 'object') return false;
  setKnown(module, ['_enable', 'enable'], bool(data.enabled, false));
  applyGradientRange(builder, refObject(builder.objects, module.color), data.gradient);
  return true;
}

function applyTextureAnimationModule(builder, particle, data) {
  const module = refObject(builder.objects, particle?._textureAnimationModule);
  if (!module || !data || typeof data !== 'object') return false;
  if (Number(data.mode) === 1 && bool(data.enabled, false)) {
    // Sprite lists do not use tilesX/Y. The porter resolves a single full-image
    // sprite as a scoped material; sliced/multiple sprites require atlas baking.
    setKnown(module, ['_enable', 'enable'], false);
    setKnown(module, ['_numTilesX', 'numTilesX'], 1);
    setKnown(module, ['_numTilesY', 'numTilesY'], 1);
    return true;
  }
  const tileCount = num(data.tilesX, 1) * num(data.tilesY, 1);
  const cycleCount = num(data.cycles, module.cycleCount ?? 1);
  setKnown(module, ['_enable', 'enable'], bool(data.enabled, false));
  setKnown(module, ['_mode', 'mode'], 0);
  module.animation = num(data.animationType, module.animation ?? 0);
  setKnown(module, ['_numTilesX', 'numTilesX'], num(data.tilesX, module.numTilesX ?? 1));
  setKnown(module, ['_numTilesY', 'numTilesY'], num(data.tilesY, module.numTilesY ?? 1));
  module.randomRow = Number(data.rowMode) === 1;
  module.rowIndex = num(data.rowIndex, module.rowIndex ?? 0);
  module.cycleCount = 1;
  setKnown(module, ['_uvChannelMask', 'uvChannelMask'], num(data.uvChannelMask, -1));
  applyCurveRange(builder, refObject(builder.objects, module.frameOverTime), data.frameOverTime, cycleCount);
  applyCurveRange(builder, refObject(builder.objects, module.startFrame), data.startFrame, tileCount);
  return true;
}

function defaultNoiseModule() {
  return {
    __type__: 'cc.NoiseModule',
    _enable: false,
    _strengthX: 10,
    _strengthY: 10,
    _strengthZ: 10,
    _noiseSpeedX: 0,
    _noiseSpeedY: 0,
    _noiseSpeedZ: 0,
    _noiseFrequency: 1,
    _remapX: 0,
    _remapY: 0,
    _remapZ: 0,
    _octaves: 1,
    _octaveMultiplier: 0.5,
    _octaveScale: 2,
  };
}

function ensureNoiseModule(builder, particle) {
  if (!particle) return null;
  let module = refObject(builder.objects, particle._noiseModule);
  if (module) return module;

  const id = addObject(builder, defaultNoiseModule());
  if (id < 0) return null;
  particle._noiseModule = cocosRef(id);
  module = builder.objects[id];
  return module;
}

function applyNoiseModule(builder, particle, data) {
  if (!data || typeof data !== 'object') return false;
  const module = ensureNoiseModule(builder, particle);
  if (!module) return false;

  const enabled = bool(data.enabled, false);
  const separateAxes = bool(data.separateAxes, false);
  const positionAmount = Math.max(0, unityCurveScalar(data.positionAmount, 1));
  const rawStrengthX = Math.max(0, unityCurveScalar(data.strength, module._strengthX ?? 10));
  const rawStrengthY = Math.max(0, unityCurveScalar(data.strengthY, rawStrengthX));
  const rawStrengthZ = Math.max(0, unityCurveScalar(data.strengthZ, rawStrengthX));
  const strengthX = rawStrengthX * positionAmount;
  const strengthY = rawStrengthY * positionAmount;
  const strengthZ = rawStrengthZ * positionAmount;
  const speedX = Math.max(0, unityCurveScalar(data.scrollSpeed, module._noiseSpeedX ?? 0));
  const speedY = Math.max(0, unityCurveScalar(data.scrollSpeedY, speedX));
  const speedZ = Math.max(0, unityCurveScalar(data.scrollSpeedZ, speedX));
  const remapEnabled = bool(data.remapEnabled, false);
  const remapX = remapEnabled ? clamp(unityCurveScalar(data.remap, module._remapX ?? 0), 0, 1) : 0;
  const remapY = remapEnabled ? clamp(unityCurveScalar(data.remapY, remapX), 0, 1) : 0;
  const remapZ = remapEnabled ? clamp(unityCurveScalar(data.remapZ, remapX), 0, 1) : 0;

  setKnown(module, ['_enable', 'enable'], enabled);
  module._strengthX = strengthX;
  module._strengthY = separateAxes ? strengthY : strengthX;
  module._strengthZ = separateAxes ? strengthZ : strengthX;
  module._noiseSpeedX = speedX;
  module._noiseSpeedY = separateAxes ? speedY : speedX;
  module._noiseSpeedZ = separateAxes ? speedZ : speedX;
  module._noiseFrequency = Math.max(0, num(data.frequency, module._noiseFrequency ?? 1));
  module._remapX = remapX;
  module._remapY = separateAxes ? remapY : remapX;
  module._remapZ = separateAxes ? remapZ : remapX;
  module._octaves = clamp(Math.floor(num(data.octaves, module._octaves ?? 1)), 1, 4);
  module._octaveMultiplier = clamp(num(data.octaveMultiplier, module._octaveMultiplier ?? 0.5), 0, 1);
  module._octaveScale = clamp(num(data.octaveScale, module._octaveScale ?? 2), 1, 4);
  return true;
}

function applyTrailModule(builder, particle, data) {
  const module = refObject(builder.objects, particle?._trailModule);
  if (!module || !data || typeof data !== 'object') return false;
  setKnown(module, ['_enable', 'enable'], bool(data.enabled, false));
  module.mode = num(data.mode, module.mode ?? 0);
  setKnown(module, ['_space', 'space'], bool(data.worldSpace, false) ? 0 : 1);
  setKnown(module, ['_minParticleDistance', 'minParticleDistance'], num(data.minVertexDistance, 0.1));
  module.existWithParticles = !bool(data.dieWithParticles, false);
  module.colorFromParticle = bool(data.inheritParticleColor, false);
  module.widthFromParticle = bool(data.sizeAffectsWidth, true);
  module.textureMode = num(data.textureMode, module.textureMode ?? 0);
  const lifeTime = refObject(builder.objects, module.lifeTime);
  // Unity stores the trail lifetime as a multiplier of the owning particle's
  // lifetime; cc.TrailModule.lifeTime is an absolute time in seconds.
  const startLifetime = cocosCurveRangeMaxValue(refObject(builder.objects, particle?.startLifetime), 1);
  applyCurveRange(builder, lifeTime, data.lifetime, startLifetime > 0 ? startLifetime : 1);
  // getMax() is an allocation envelope for curve modes, not their evaluated
  // value. Preserve authored lifetime while reserving at least one second.
  ensureCocosCurveRangeMaxAtLeast(builder, lifeTime, COCOS_TRAIL_MIN_LIFETIME);
  applyCurveRange(builder, refObject(builder.objects, module.widthRatio), data.widthOverTrail);
  applyGradientRange(builder, refObject(builder.objects, module.colorOverTrail), data.colorOverTrail);
  applyGradientRange(builder, refObject(builder.objects, module.colorOvertime), data.colorOverLifetime);
  return true;
}

function applyEmission(builder, particle, data) {
  if (!data || typeof data !== 'object') return false;
  if (!bool(data.enabled, true)) {
    applyCurveByRef(builder, particle, 'rateOverTime', { minMaxState: 0, scalar: 0 });
    applyCurveByRef(builder, particle, 'rateOverDistance', { minMaxState: 0, scalar: 0 });
    particle.bursts = [];
    return true;
  }

  applyCurveByRef(builder, particle, 'rateOverTime', data.rateOverTime);
  applyCurveByRef(builder, particle, 'rateOverDistance', data.rateOverDistance);
  const bursts = Array.isArray(data.m_Bursts) ? data.m_Bursts : [];
  particle.bursts = bursts.slice(0, Math.max(0, num(data.m_BurstCount, bursts.length))).map((burst) => {
    const burstId = addObject(builder, {
      __type__: 'cc.Burst',
      _time: num(burst.time, 0),
      _repeatCount: Math.max(1, num(burst.cycleCount, 1)),
      repeatInterval: Math.max(0, num(burst.repeatInterval, 0.01)),
      count: addCurveRange(builder, burst.countCurve || burst.count || { minMaxState: 0, scalar: 0 }),
    });
    return cocosRef(burstId);
  });
  return true;
}

function applyRenderer(builder, particle, data) {
  const renderer = refObject(builder.objects, particle?.renderer);
  if (!renderer || !data || typeof data !== 'object') return false;
  // Renderer visibility does not disable simulation, collision callbacks or
  // sub-emission. A nonserialized marker is consumed by the runtime porter.
  Object.defineProperty(particle, 'unityRendererHidden', {
    value: !bool(data.m_Enabled, true) || Number(data.m_RenderMode) === 5,
    configurable: true, enumerable: false,
  });
  Object.defineProperty(particle, 'unityTrailsVisible', {
    value: bool(data.m_Enabled, true), configurable: true, enumerable: false,
  });
  renderer._renderMode = UNITY_RENDER_MODE_TO_COCOS[num(data.m_RenderMode, 0)] ?? 0;
  // Unity View=0, World=1, Local=2. Cocos CPU World=0 reads the
  // emitter WORLD rotation (including its ancestors), while View=2 uses
  // the camera. Local=1 only reads the immediate node's local rotation.
  // World/Facing/Velocity and local billboards require a shader adapter;
  // particle-porter reports those paths instead of silently claiming parity.
  const alignment = num(data.m_RenderAlignment, 0);
  renderer._alignSpace = alignment === 0 ? 2 : alignment === 2 ? 0 : 1;
  renderer._velocityScale = num(data.m_VelocityScale, renderer._velocityScale ?? 1);
  renderer._lengthScale = num(data.m_LengthScale, renderer._lengthScale ?? 1);
  // Unity GPU instancing is a renderer batching option. Cocos _useGPU switches to
  // the GPU particle simulation pipeline and requires a particle-gpu material.
  renderer._useGPU = false;
  renderer._mesh = null;
  return true;
}

function applyParticleRendererMaterial(builder, particleId, materialUuid, textureUuid = '', materialSlot = 0) {
  const particle = builder?.objects?.[particleId];
  if (!particle || !materialUuid) return false;

  const renderer = refObject(builder.objects, particle.renderer);
  const materialRef = uuidRef(materialUuid, 'cc.Material');
  const slot = Math.max(0, Math.floor(num(materialSlot, 0)));
  // Slot 0 starts a fresh renderer assignment. This prevents a reused template
  // or an earlier port from leaking an obsolete trail material into emitters
  // whose Unity TrailModule is disabled.
  if (slot === 0 || !Array.isArray(particle._materials)) particle._materials = [];
  particle._materials[slot] = materialRef;
  if (renderer && slot === 0) {
    renderer._cpuMaterial = materialRef;
    renderer._gpuMaterial = null;
    renderer._useGPU = false;
    if (textureUuid) renderer._mainTexture = uuidRef(textureUuid, 'cc.Texture2D');
  }
  return true;
}

function applyParticleRendererMesh(builder, particleId, meshUuid) {
  const particle = builder?.objects?.[particleId];
  if (!particle || !meshUuid) return false;

  const renderer = refObject(builder.objects, particle.renderer);
  if (!renderer) return false;
  renderer._mesh = uuidRef(meshUuid, 'cc.Mesh');
  return true;
}

function isMeshParticleRenderer(rendererData) {
  return num(rendererData?.m_RenderMode, 0) === 4;
}

function applyUnityParticleDataToCocos(builder, particleId, data = {}, rendererData = {}) {
  const particle = builder?.objects?.[particleId];
  if (!particle) return { applied: 0 };

  const forceMeshCommon3D = isMeshParticleRenderer(rendererData);
  const initial = data.InitialModule || {};
  let gravityData = initial.gravityModifier;
  let forceData = data.ForceModule;
  let velocityData = data.VelocityModule;
  const migratedForce = migrateSimpleWorldForceToGravity(gravityData, forceData);
  gravityData = migratedForce.gravityData;
  forceData = migratedForce.forceData;
  const migratedVelocity = migrateSimpleWorldVelocityYToGravity(gravityData, velocityData);
  gravityData = migratedVelocity.gravityData;
  velocityData = migratedVelocity.velocityData;
  let applied = 0;
  const count = (didApply) => {
    if (didApply) applied += 1;
  };

  if (data.lengthInSec != null) {
    particle.duration = num(data.lengthInSec, particle.duration ?? 1);
    applied += 1;
  }
  if (data.looping != null) {
    particle.loop = bool(data.looping, particle.loop ?? true);
    applied += 1;
  }
  if (data.playOnAwake != null) {
    particle.playOnAwake = bool(data.playOnAwake, particle.playOnAwake ?? true);
    applied += 1;
  }
  if (data.prewarm != null) {
    particle._prewarm = bool(data.prewarm, particle._prewarm ?? false);
    applied += 1;
  }
  if (data.simulationSpeed != null) {
    particle.simulationSpeed = num(data.simulationSpeed, particle.simulationSpeed ?? 1);
    applied += 1;
  }
  if (data.moveWithTransform != null) {
    // Unity serializes its enum in this misleadingly named field: Local=0,
    // World=1, Custom=2. Cocos uses World=0, Local=1, Custom=2.
    const space = Number(data.moveWithTransform);
    particle._simulationSpace = space === 0 ? 1 : space === 1 ? 0 : 2;
    applied += 1;
  }
  if (data.scalingMode != null) {
    particle.scaleSpace = Number(data.scalingMode) === 1 ? 1 : 0;
    applied += 1;
  }
  if (initial.maxNumParticles != null) {
    particle._capacity = Math.max(1, Math.floor(num(initial.maxNumParticles, particle._capacity ?? 100)));
    applied += 1;
  }

  count(applyCurveByRef(builder, particle, 'startDelay', data.startDelay));
  count(applyCurveByRef(builder, particle, 'startLifetime', initial.startLifetime));
  count(applyGradientByRef(builder, particle, 'startColor', initial.startColor));

  const unityStartSize3D = bool(initial.size3D, false);
  particle.startSize3D = forceMeshCommon3D || unityStartSize3D;
  if (particle.startSize3D) {
    count(applyCurveByRef(builder, particle, 'startSizeX', initial.startSize));
    count(applyCurveByRef(builder, particle, 'startSizeY', unityStartSize3D ? initial.startSizeY : initial.startSize));
    count(applyCurveByRef(builder, particle, 'startSizeZ', unityStartSize3D ? initial.startSizeZ : initial.startSize));
  } else {
    count(applyCurveByRef(builder, particle, 'startSizeX', initial.startSize));
    count(applyCurveByRef(builder, particle, 'startSizeY', initial.startSize));
    count(applyCurveByRef(builder, particle, 'startSizeZ', initial.startSize));
  }

  count(applyCurveByRef(builder, particle, 'startSpeed', initial.startSpeed));
  const unityStartRotation3D = bool(initial.rotation3D, false);
  particle.startRotation3D = forceMeshCommon3D || unityStartRotation3D;
  if (particle.startRotation3D) {
    count(applyCurveByRef(builder, particle, 'startRotationX', unityStartRotation3D ? initial.startRotationX : constantCurveRange(0), particleRendererContract(data, rendererData).eulerSigns[0]));
    // Mesh coordinates are reflected in Z. Axial rotations consequently map
    // (-X,-Y,+Z), unlike the camera-facing billboard convention.
    count(applyCurveByRef(builder, particle, 'startRotationY', unityStartRotation3D ? initial.startRotationY : constantCurveRange(0), forceMeshCommon3D ? -1 : 1));
    count(applyCurveByRef(builder, particle, 'startRotationZ', initial.startRotation || constantCurveRange(0), forceMeshCommon3D ? 1 : -1));
  } else {
    count(applyCurveByRef(builder, particle, 'startRotationZ', initial.startRotation, -1));
  }
  count(applyCurveByRef(builder, particle, 'gravityModifier', gravityData));

  count(applyShapeModule(builder, particle, data.ShapeModule));
  count(applyEmission(builder, particle, data.EmissionModule));
  count(applySizeModule(builder, particle, data.SizeModule));
  count(applyRotationModule(builder, particle, data.RotationModule, particleRendererContract(data, rendererData)));
  count(applyColorModule(builder, particle, data.ColorModule));
  count(applyTextureAnimationModule(builder, particle, data.UVModule));
  count(applyNoiseModule(builder, particle, data.NoiseModule));
  count(applyVelocityModule(builder, particle, velocityData));
  count(applyForceModule(builder, particle, forceData));
  count(applyLimitVelocityModule(builder, particle, data.ClampVelocityModule));
  count(applyTrailModule(builder, particle, data.TrailModule));
  count(applyRenderer(builder, particle, rendererData));
  const rendererContract = particleRendererContract(data, rendererData);
  const targetRenderer = refObject(builder.objects, particle.renderer);
  if (targetRenderer) targetRenderer._alignSpace = rendererContract.cocosAlignment;
  Object.defineProperty(particle, 'unityRendererContract', { value: rendererContract, configurable: true });
  Object.defineProperty(particle, 'unityOrbitContract', { value: particleOrbitContract(data), configurable: true });
  Object.defineProperty(particle, 'unityNoiseContract', { value: particleNoiseContract(data), configurable: true });
  Object.defineProperty(particle, 'unityLimitVelocityContract', { value: particleLimitVelocityContract(data), configurable: true });

  return { applied };
}

function applyUnityParticleSystemToCocos(builder, particleId, unityDoc, rendererDoc = null) {
  return applyUnityParticleDataToCocos(
    builder,
    particleId,
    parseUnityParticleDoc(unityDoc),
    parseUnityRendererDoc(rendererDoc),
  );
}

function restoreOrbitalSourceModules(builder, particleId, data) {
  const particle=builder.objects[particleId];
  applyCurveByRef(builder,particle,'startSpeed',data.InitialModule.startSpeed);
  applyShapeModule(builder,particle,data.ShapeModule);
  applyVelocityModule(builder,particle,data.VelocityModule);
}

module.exports = {
  applyTrailModule,
  restoreOrbitalSourceModules,
  applyUnityParticleDataToCocos,
  applyUnityParticleSystemToCocos,
  applyUnitySerializedOverrides,
  applyParticleRendererMesh,
  applyParticleRendererMaterial,
  parseUnityParticleDoc,
  parseUnityRendererDoc,
};
