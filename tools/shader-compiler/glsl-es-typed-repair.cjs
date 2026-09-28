'use strict';
/**
 * Typed GLSL ES repair for transpiled Cocos effects (the HLSL -> GLSL `shader.convert` path).
 *
 * Runs every CCProgram body through the ShaderGraph typed pass (shadergraph/sg-program.cjs): declarations,
 * assignments, returns, conditions and calls get HLSL's implicit conversions made explicit (int literals in float
 * math, scalar splats, vector truncation, scalar swizzles, float/vector predicates, component-wise compares, mixed
 * scalar/vector intrinsic arguments, out-argument temporaries), float literal suffixes (1.0f) are dropped, and
 * HLSL output semantics on helper signatures are removed. Constructs it does not understand pass through verbatim.
 *
 * Writers call repairEffectText() only when the original fails the effect compile gate and keep the repair only
 * when the repaired text passes (see pickPublishableEffectSync), so a repair can never make a passing effect worse.
 */
const { Program } = require('./shadergraph/sg-program.cjs');

// Types of the Cocos engine uniforms/attributes transpiled effects use (engine chunks are not parsed here).
const COCOS_GLOBALS = [
  ['cc_time', 'vec4'], ['cc_screenSize', 'vec4'], ['cc_nativeSize', 'vec4'], ['cc_cameraPos', 'vec4'], ['cc_nearFar', 'vec4'],
  ['cc_matView', 'mat4'], ['cc_matViewInv', 'mat4'], ['cc_matProj', 'mat4'], ['cc_matProjInv', 'mat4'],
  ['cc_matViewProj', 'mat4'], ['cc_matViewProjInv', 'mat4'], ['cc_matWorld', 'mat4'], ['cc_matWorldIT', 'mat4'],
  ['cc_mainLitDir', 'vec4'], ['cc_mainLitColor', 'vec4'], ['cc_ambientSky', 'vec4'], ['cc_ambientGround', 'vec4'],
  ['cc_fogColor', 'vec4'], ['cc_fogBase', 'vec4'], ['cc_fogAdd', 'vec4'], ['cc_exposure', 'vec4'],
  ['a_position', 'vec3'], ['a_normal', 'vec3'], ['a_tangent', 'vec4'], ['a_color', 'vec4'], ['a_texCoord', 'vec2'],
  ['a_texCoord1', 'vec2'], ['a_texCoord2', 'vec2'], ['a_texCoord3', 'vec2'],
];

/** Repair one CCProgram body. Returns { text, diagnostics }. */
function repairProgramBody(body) {
  const program = new Program({ globals: COCOS_GLOBALS });
  const text = program.transform(body);
  return { text, diagnostics: program.diagnostics };
}

/** Repair every CCProgram block of an effect. Returns { text, changed, diagnostics }. */
function repairEffectText(effect) {
  const diagnostics = [];
  let changed = false;
  const text = String(effect).replace(/(CCProgram\s+[\w-]+\s*%\{)([\s\S]*?)(\n\s*\}%)/g, (whole, head, body, tail) => {
    let repaired;
    try {
      repaired = repairProgramBody(body);
    } catch (error) {
      diagnostics.push({ severity: 'medium', code: 'ES_REPAIR_SKIPPED', message: `${head.trim()} ${error.message}` });
      return whole;
    }
    diagnostics.push(...repaired.diagnostics.map((d) => ({ ...d, program: head.trim() })));
    const out = `${head}\n${repaired.text.split('\n').map((l) => (l ? `  ${l}` : l)).join('\n')}${tail}`;
    if (out !== whole) changed = true;
    return out;
  });
  return { text, changed, diagnostics };
}

/**
 * Choose what a writer may publish: the original when it passes the compile gate, otherwise the typed repair when
 * that passes. Returns { text, repaired, result } where result is the gate result of the chosen text; throws the
 * gate error (EFFECT_COMPILE_GATE_FAILED, with the ORIGINAL diagnostics) when neither passes.
 */
function pickPublishableEffectSync(effect, outPath, options = {}) {
  const { assertEffectCompilesSync } = require('./effect-compile-gate.cjs');
  try {
    return { text: effect, repaired: false, result: assertEffectCompilesSync(effect, outPath, options) };
  } catch (error) {
    if (error.code !== 'EFFECT_COMPILE_GATE_FAILED' || error.unavailable) throw error;
    const repair = repairEffectText(effect);
    if (!repair.changed) throw error;
    try {
      return { text: repair.text, repaired: true, result: assertEffectCompilesSync(repair.text, outPath, options) };
    } catch (_) {
      throw error;
    }
  }
}

module.exports = { repairEffectText, repairProgramBody, pickPublishableEffectSync, COCOS_GLOBALS };
