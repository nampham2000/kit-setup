'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Unity LineRenderer (class 120) -> runtime/UnityLineRenderer.ts contract. Cocos has no
// line renderer; the runtime rebuilds a camera-facing strip each frame, so scripts that
// move the points (Hovl_Laser) keep their Unity semantics. Positions and the gradient
// come from the serialized YAML; the material is resolved by the caller.
const names = ['UnityLineRenderer'];

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Unity Gradient: key0..key7 {r,g,b,a}, ctime0..7 / atime0..7 in 0..65535.
function gradientKeys(gradient = {}) {
  const colors = [], alphas = [];
  const colorCount = Math.max(1, Math.min(8, num(gradient.m_NumColorKeys, 2)));
  const alphaCount = Math.max(1, Math.min(8, num(gradient.m_NumAlphaKeys, 2)));
  for (let i = 0; i < colorCount; i++) {
    const key = gradient[`key${i}`] || {};
    colors.push({ time: num(gradient[`ctime${i}`]) / 65535, r: num(key.r, 1), g: num(key.g, 1), b: num(key.b, 1) });
  }
  for (let i = 0; i < alphaCount; i++) {
    const key = gradient[`key${i}`] || {};
    alphas.push({ time: num(gradient[`atime${i}`]) / 65535, a: num(key.a, 1) });
  }
  colors.sort((a, b) => a.time - b.time);
  alphas.sort((a, b) => a.time - b.time);
  return { colors, alphas };
}

function curveKeys(curve = {}) {
  const keys = (curve.m_Curve || []).map((key) => ({ time: num(key.time), value: num(key.value, 1) }));
  return keys.length ? keys.sort((a, b) => a.time - b.time) : [{ time: 0, value: 1 }];
}

/** Contract from the parsed LineRenderer YAML map (parseUnityRendererDoc(doc).LineRenderer). */
function lineRendererContract(line = {}) {
  const parameters = line.m_Parameters || {};
  const gradient = gradientKeys(parameters.colorGradient);
  return {
    colorKeys: gradient.colors,
    alphaKeys: gradient.alphas,
    widthMultiplier: num(parameters.widthMultiplier, 1),
    widthKeys: curveKeys(parameters.widthCurve),
    textureMode: num(parameters.textureMode, 0),
    alignment: num(parameters.alignment, 0),
    numCapVertices: num(parameters.numCapVertices, 0),
    numCornerVertices: num(parameters.numCornerVertices, 0),
    loop: num(line.m_Loop, 0) === 1,
    useWorldSpace: num(line.m_UseWorldSpace, 1) === 1,
  };
}

/** Unity positions -> Cocos (Z reflected), as cc.Vec3 objects. */
function cocosLinePositions(line = {}) {
  return (line.m_Positions || []).map((p) => ({ __type__: 'cc.Vec3', x: num(p?.x), y: num(p?.y), z: -num(p?.z) || 0 }));
}

function stageLineRendererRuntime(options) {
  if (options.dryRun) return;
  for (const name of names) {
    const target = path.join(options.cocosRoot, 'assets/script', `${name}.ts`);
    const text = fs.readFileSync(path.join(__dirname, 'runtime', `${name}.ts`), 'utf8');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // AssetDB owns .meta creation and UUIDs; a first import needs a refresh and another porter pass.
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) fs.writeFileSync(target, text);
  }
}

module.exports = { lineRendererContract, cocosLinePositions, gradientKeys, stageLineRendererRuntime };
