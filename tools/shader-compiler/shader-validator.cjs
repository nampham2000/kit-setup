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

const { analyzeEffect } = require('./glsl-static-analyzer.cjs');

function validateCceffectStructure(effectText) {
  const errors = [];
  const warnings = [];

  if (!effectText || typeof effectText !== 'string') {
    return { valid: false, errors: ['Empty or non-string effect content'], warnings };
  }

  // A surface-shader effect has a different, equally valid shape: the entry
  // programs contain only #includes and the engine supplies main().
  const isSurfaceEffect = /CCProgram\s+standard-fs\s*%\{/.test(effectText) &&
    /surfaces\/includes\/(?:common|standard)-fs/.test(effectText);

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
    // Surface-shader effects (--mode surface-pbr) name a program with no
    // `:entry` suffix, because main() comes from the included shading-entry
    // chunk rather than a hand-written vert()/frag(). Demanding vs:vert of them
    // reports four errors on a perfectly valid effect.
    if (!isSurfaceEffect) {
      if (!/vert:\s*vs:vert/i.test(yaml)) {
        errors.push('Pass must reference vertex program (vert: vs:vert)');
      }
      if (!/frag:\s*fs:frag/i.test(yaml)) {
        errors.push('Pass must reference fragment program (frag: fs:frag)');
      }
    } else {
      if (!/vert:\s*standard-vs/i.test(yaml)) {
        errors.push('Surface effect pass must reference vert: standard-vs');
      }
      if (!/frag:\s*standard-fs/i.test(yaml)) {
        errors.push('Surface effect pass must reference frag: standard-fs');
      }
    }
  }

  // 2. Check the stage programs. Surface effects carry a different but equally
  // required set: the surface hooks and the shading-entry includes.
  let vsMatch = null;
  let fsMatch = null;
  if (isSurfaceEffect) {
    vsMatch = /CCProgram\s+surface-vertex\s*%\{([\s\S]*?)\n\}%/.exec(effectText);
    fsMatch = /CCProgram\s+surface-fragment\s*%\{([\s\S]*?)\n\}%/.exec(effectText);
    if (!fsMatch) {
      errors.push('Missing CCProgram surface-fragment %{ ... }% block');
    } else if (!/CC_SURFACES_FRAGMENT_MODIFY_/.test(fsMatch[1])) {
      errors.push('surface-fragment declares no CC_SURFACES_FRAGMENT_MODIFY_* hook, so none of the material channels reach the engine.');
    }
    for (const required of [
      'surfaces/effect-macros/common-macros',
      'surfaces/includes/common-vs',
      'surfaces/includes/standard-vs',
      'shading-entries/main-functions/render-to-scene/vs',
      'surfaces/includes/common-fs',
      'lighting-models/includes/standard',
      'surfaces/includes/standard-fs',
      'shading-entries/main-functions/render-to-scene/fs',
    ]) {
      if (!effectText.includes(`<${required}>`)) {
        errors.push(`Surface effect is missing #include <${required}>; without it the engine supplies no entry point or lighting.`);
      }
    }
  } else {
    vsMatch = /CCProgram\s+vs\s*%\{([\s\S]*?)\}%/.exec(effectText);
    if (!vsMatch) {
      errors.push('Missing CCProgram vs %{ ... }% block');
    } else {
      const vsCode = vsMatch[1];
      if (!/vec4\s+vert\s*\(/i.test(vsCode)) {
        errors.push('CCProgram vs must contain vec4 vert() entry point');
      }
    }

    fsMatch = /CCProgram\s+fs\s*%\{([\s\S]*?)\}%/.exec(effectText);
    if (!fsMatch) {
      errors.push('Missing CCProgram fs %{ ... }% block');
    } else {
      const fsCode = fsMatch[1];
      if (!/vec4\s+frag\s*\(/i.test(fsCode)) {
        errors.push('CCProgram fs must contain vec4 frag() entry point');
      }
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

  // 5. GLSL static analysis.
  // Everything above validates the *shape* of the file. Shape is not
  // correctness: a mis-lowered intrinsic yields a perfectly shaped effect whose
  // GLSL cannot compile (`clamp(dot(a,b))`) or cannot link (`i.wn`). Without
  // this pass the gate reported PASS / confidence 100 on exactly those files,
  // which is worse than no gate -- it tells the caller there is nothing to fix.
  const analysis = analyzeEffect(effectText);
  for (const d of analysis.errors) {
    const where = d.program ? `${d.program}:${d.line}` : 'effect';
    errors.push(`[${d.code}] ${where} -- ${d.message}`);
  }
  for (const d of analysis.warnings) {
    warnings.push(`[${d.code}] ${d.message}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    glslAnalysis: analysis,
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
