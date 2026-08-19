'use strict';

/**
 * Static Shader & Effect Validator for Cocos Creator 3.8.8+
 *
 * Checks:
 * - CCEffect YAML frontmatter structure
 * - CCProgram vertex & fragment presence and entry points
 * - Stage IO matching (Varyings in VS match Varyings in FS)
 * - std140 UBO block syntax
 * - Playable Ads resource budgets (texture count, pass count)
 * - Absence of unlowered Unity symbols in GLSL
 */

function validateCceffectStructure(effectText) {
  const errors = [];
  const warnings = [];

  if (!effectText || typeof effectText !== 'string') {
    return { valid: false, errors: ['Empty or non-string effect content'], warnings };
  }

  // 1. Check CCEffect block
  const cceffectMatch = /CCEffect\s*%\{([\s\S]*?)\}%/.exec(effectText);
  if (!cceffectMatch) {
    errors.push('Missing CCEffect %{ ... }% frontmatter block');
  } else {
    const yaml = cceffectMatch[1];
    if (!/techniques:/i.test(yaml)) {
      errors.push('CCEffect frontmatter must declare techniques:');
    }
    if (!/passes:/i.test(yaml)) {
      errors.push('CCEffect frontmatter must declare passes:');
    }
    if (!/vert:\s*vs:vert/i.test(yaml)) {
      errors.push('Pass must reference vertex program (vert: vs:vert)');
    }
    if (!/frag:\s*fs:frag/i.test(yaml)) {
      errors.push('Pass must reference fragment program (frag: fs:frag)');
    }
  }

  // 2. Check CCProgram vs & fs
  const vsMatch = /CCProgram\s+vs\s*%\{([\s\S]*?)\}%/.exec(effectText);
  if (!vsMatch) {
    errors.push('Missing CCProgram vs %{ ... }% block');
  } else {
    const vsCode = vsMatch[1];
    if (!/vec4\s+vert\s*\(/i.test(vsCode)) {
      errors.push('CCProgram vs must contain vec4 vert() entry point');
    }
  }

  const fsMatch = /CCProgram\s+fs\s*%\{([\s\S]*?)\}%/.exec(effectText);
  if (!fsMatch) {
    errors.push('Missing CCProgram fs %{ ... }% block');
  } else {
    const fsCode = fsMatch[1];
    if (!/vec4\s+frag\s*\(/i.test(fsCode)) {
      errors.push('CCProgram fs must contain vec4 frag() entry point');
    }
  }

  // 3. Stage IO Matching (Varyings)
  if (vsMatch && fsMatch) {
    const vsOuts = [];
    const vsOutRegex = /\bout\s+([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)\s*;/g;
    let m;
    while ((m = vsOutRegex.exec(vsMatch[1])) !== null) {
      vsOuts.push({ type: m[1], name: m[2] });
    }

    const fsIns = [];
    const fsInRegex = /\bin\s+([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)\s*;/g;
    while ((m = fsInRegex.exec(fsMatch[1])) !== null) {
      fsIns.push({ type: m[1], name: m[2] });
    }

    for (const outVar of vsOuts) {
      const matchIn = fsIns.find(i => i.name === outVar.name);
      if (!matchIn) {
        warnings.push(`Vertex output varying '${outVar.name}' (${outVar.type}) is not declared in fragment shader input.`);
      } else if (matchIn.type !== outVar.type) {
        errors.push(`Varying type mismatch for '${outVar.name}': VS has ${outVar.type}, FS has ${matchIn.type}.`);
      }
    }
  }

  // 4. Check for residual unlowered Unity syntax in active code
  const residualCheck = [
    { pattern: /\bUnityObjectToClipPos\b/, msg: 'Residual UnityObjectToClipPos found in GLSL' },
    { pattern: /\bTRANSFORM_TEX\b/, msg: 'Residual TRANSFORM_TEX macro found in GLSL' },
    { pattern: /\bSAMPLE_TEXTURE2D\b/, msg: 'Residual SAMPLE_TEXTURE2D macro found in GLSL' },
    { pattern: /\b_Time\.y\b/, msg: 'Residual _Time.y variable found in GLSL' },
    { pattern: /\bunity_ObjectToWorld\b/, msg: 'Residual unity_ObjectToWorld found in GLSL' },
    { pattern: /\bUNITY_MATRIX_MVP\b/, msg: 'Residual UNITY_MATRIX_MVP found in GLSL' },
    { pattern: /\bfixed4\b/, msg: 'Residual fixed4 type found in GLSL' },
    { pattern: /\bhalf4\b/, msg: 'Residual half4 type found in GLSL' },
  ];

  for (const check of residualCheck) {
    if (check.pattern.test(effectText)) {
      warnings.push(check.msg);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

const { lintWebGLPlayable } = require('./webgl-playable-optimizer.cjs');

function lintPlayableShader(docIR, effectText) {
  const result = lintWebGLPlayable(effectText);
  const issues = [...result.issues];

  // Check pass count
  const passMatches = effectText.match(/- vert:\s*vs:vert/g) || [];
  if (passMatches.length > 1) {
    issues.push({
      rule: 'multiPassShader',
      severity: 'low',
      message: `Shader contains ${passMatches.length} passes. Playable ads prefer single-pass rendering to minimize draw calls.`,
    });
  }

  return {
    webgl2: result.webgl2,
    webgl1Fallback: result.webgl1Fallback,
    summary: result.summary,
    issues,
  };
}

const {
  validateWithGlslang,
  validateCocosEffect,
  compareSpirvDiff,
  runShaderFixture,
} = require('./validation-differential-runner.cjs');

module.exports = {
  validateCceffectStructure,
  lintPlayableShader,
  validateWithGlslang,
  validateCocosEffect,
  compareSpirvDiff,
  runShaderFixture,
};
