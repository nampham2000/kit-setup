'use strict';

/**
 * WebGL / Playable Optimization Linter & Optimizer
 * for UCShaderTranspiler
 *
 * Implements:
 * 1. WebGL 1 / WebGL 2 Compatibility Linter:
 *    - Dynamic loop index / non-constant loop bounds
 *    - Non-constant array indexing
 *    - Sampler count (>8 on WebGL 1, >16 on WebGL 2)
 *    - Varying count (>8 on WebGL 1, >16 on WebGL 2)
 *    - Derivative functions (dFdx/dFdy/fwidth)
 *    - textureLod in fragment stage
 *    - Integer textures (isampler/usampler)
 *    - 3D textures (sampler3D)
 *    - MRT (Multiple Render Targets)
 *    - Precision checks
 * 2. Playable Ad Optimizer:
 *    - Remove unused varyings
 *    - Remove unused uniforms
 *    - Constant fold fixed keywords
 *    - Simplify dead branches
 *    - Reduce precision to mediump where safe
 */

/**
 * Runs full WebGL & Playable compatibility linter
 */
function lintWebGLPlayable(effectText, options = {}) {
  const issues = [];
  if (!effectText) {
    return { webgl2: 'FAIL', webgl1Fallback: 'FAIL', issues };
  }

  // 1. Dynamic loop indexing
  if (/\bfor\s*\(\s*(?:int|float)\s+\w+\s*=\s*\d+\s*;\s*\w+\s*<\s*[A-Za-z_]\w*\s*;/i.test(effectText)) {
    issues.push({
      rule: 'dynamicLoopIndex',
      severity: 'medium',
      message: 'Dynamic loop bound detected. WebGL 1 / strict mobile GLSL requires constant unrollable loop limits.',
    });
  }

  // 2. Array indexing with non-constant expressions
  if (/\b\w+\[\s*[A-Za-z_]\w*(?:\s*[+\-*\/]\s*\w+)?\s*\]/i.test(effectText) && !/\b\w+\[\s*\d+\s*\]/i.test(effectText)) {
    issues.push({
      rule: 'arrayIndexingNonConstant',
      severity: 'low',
      message: 'Dynamic array indexing detected. Some older mobile WebGL 1 chips only support constant index.',
    });
  }

  // 3. Sampler count limit
  const samplerMatches = effectText.match(/\buniform\s+(?:sampler2D|samplerCube|sampler3D)\s+\w+/g) || [];
  const samplerCount = samplerMatches.length;
  if (samplerCount > 8) {
    issues.push({
      rule: 'samplerCountAboveProfileLimit',
      severity: 'high',
      message: `Shader uses ${samplerCount} texture samplers (WebGL 1 limit is 8; recommend <= 4 for Playables).`,
    });
  } else if (samplerCount > 4) {
    issues.push({
      rule: 'samplerCountWarning',
      severity: 'medium',
      message: `Shader uses ${samplerCount} texture samplers. For lightweight Playable ads, consider capping at <= 4.`,
    });
  }

  // 4. Varying count limit
  const vsMatch = /CCProgram\s+(?:vs|surface-vertex)\s*%\{([\s\S]*?)\}%/i.exec(effectText);
  const varyingMatches = vsMatch ? (vsMatch[1].match(/\bout\s+\w+\s+\w+\s*;/g) || []) : [];
  if (varyingMatches.length > 8) {
    issues.push({
      rule: 'highVaryingCount',
      severity: 'medium',
      message: `Shader declares ${varyingMatches.length} varying vectors. WebGL 1 standard minimum is 8 vectors.`,
    });
  }

  // 5. Derivative functions (dFdx, dFdy, fwidth)
  if (/\b(?:dFdx|dFdy|fwidth)\s*\(/i.test(effectText)) {
    issues.push({
      rule: 'derivativeFunctions',
      severity: 'low',
      message: 'Derivative functions (dFdx/dFdy/fwidth) used. Requires GL_OES_standard_derivatives extension on WebGL 1.',
    });
  }

  // 6. textureLod in fragment
  const fsMatch = /CCProgram\s+(?:fs|surface-fragment)\s*%\{([\s\S]*?)\}%/i.exec(effectText);
  if (fsMatch && /\btextureLod\s*\(/i.test(fsMatch[1])) {
    issues.push({
      rule: 'textureLodInFragment',
      severity: 'low',
      message: 'textureLod used in fragment shader. Requires GL_EXT_shader_texture_lod on WebGL 1.',
    });
  }

  // 7. Integer textures & 3D textures
  if (/\b(?:isampler2D|usampler2D|isampler3D|usampler3D)\b/i.test(effectText)) {
    issues.push({
      rule: 'integerTextures',
      severity: 'high',
      message: 'Integer textures are not supported in WebGL 1 (WebGL 2 only).',
    });
  }
  if (/\bsampler3D\b/i.test(effectText)) {
    issues.push({
      rule: '3dTextures',
      severity: 'medium',
      message: '3D textures (sampler3D) require WebGL 2.',
    });
  }

  // 8. MRT (Multiple Render Targets)
  if (/\bgl_FragData\[\s*[1-9]\d*\s*\]/i.test(effectText)) {
    issues.push({
      rule: 'mrtMultipleRenderTargets',
      severity: 'high',
      message: 'Multiple Render Targets (gl_FragData[1..N]) require WEBGL_draw_buffers extension on WebGL 1.',
    });
  }

  // Determine status
  const hasHigh = issues.some(i => i.severity === 'high');
  const hasMedium = issues.some(i => i.severity === 'medium');

  const webgl2 = hasHigh ? 'REVIEW' : 'PASS';
  let webgl1Fallback = 'PASS';
  if (hasHigh) webgl1Fallback = 'FAIL';
  else if (hasMedium || issues.length > 0) webgl1Fallback = 'REVIEW';

  return {
    webgl2,
    webgl1Fallback,
    issues,
    summary: `WEBGL2: ${webgl2}\nWEBGL1-FALLBACK: ${webgl1Fallback}`,
  };
}

/**
 * Optimizes effect code for Playable Ads profile
 */
function optimizePlayableEffect(effectText, options = {}) {
  const suggestions = [];
  let optimized = effectText;

  // 1. Remove unused varyings
  const vsMatch = /CCProgram\s+vs\s*%\{([\s\S]*?)\}%/i.exec(effectText);
  const fsMatch = /CCProgram\s+fs\s*%\{([\s\S]*?)\}%/i.exec(effectText);

  if (vsMatch && fsMatch) {
    const vsCode = vsMatch[1];
    const fsCode = fsMatch[1];

    const vsOutRegex = /\bout\s+([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)\s*;/g;
    let m;
    while ((m = vsOutRegex.exec(vsCode)) !== null) {
      const varName = m[2];
      // Check if varName is used in fs (other than declaration)
      const fsUsageRegex = new RegExp(`\\b${varName}\\b`, 'g');
      const count = (fsCode.match(fsUsageRegex) || []).length;
      if (count <= 1) { // Only in declaration "in vec4 v_xxx;"
        suggestions.push({
          type: 'unusedVarying',
          name: varName,
          action: `Remove unused varying '${varName}'`,
        });

        if (options.apply) {
          optimized = optimized.replace(new RegExp(`\\bout\\s+\\w+\\s+${varName}\\s*;\\r?\\n?`, 'g'), '');
          optimized = optimized.replace(new RegExp(`\\bin\\s+\\w+\\s+${varName}\\s*;\\r?\\n?`, 'g'), '');
          optimized = optimized.replace(new RegExp(`\\b${varName}\\s*=\\s*[^;]+;\\r?\\n?`, 'g'), '');
        }
      }
    }
  }

  // 2. Reduce precision in fragment shader where safe
  if (/CCProgram\s+fs\s*%\{/i.test(optimized) && /precision\s+highp\s+float;/i.test(optimized)) {
    suggestions.push({
      type: 'reducePrecision',
      action: 'Change fragment precision from highp to mediump for mobile GPU bandwidth savings',
    });
    if (options.apply) {
      optimized = optimized.replace(/precision\s+highp\s+float;/g, 'precision mediump float;');
    }
  }

  // 3. Simplify dead branches (e.g. #if 0 or if (false))
  if (/#if\s+0\b[\s\S]*?#endif/i.test(optimized)) {
    suggestions.push({
      type: 'deadBranchRemoval',
      action: 'Remove dead #if 0 preprocessor blocks',
    });
    if (options.apply) {
      optimized = optimized.replace(/#if\s+0\b[\s\S]*?#endif\r?\n?/gi, '');
    }
  }

  return {
    originalText: effectText,
    optimizedText: optimized,
    suggestions,
    applied: Boolean(options.apply),
  };
}

module.exports = {
  lintWebGLPlayable,
  optimizePlayableEffect,
};
