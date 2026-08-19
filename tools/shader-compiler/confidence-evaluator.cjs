'use strict';

/**
 * Shader Family & Confidence Scoring Engine
 * for UCShaderTranspiler
 *
 * Implements:
 * 1. Comprehensive Unity Shader Family Detection:
 *    - CustomVertexFragment, BuiltinUnlit, BuiltinSurface, URPUnlit, URPLit,
 *      ShaderGraphGenerated, Particle, Sprite, PostProcess, Unknown
 * 2. Multi-tier Sub-Score Calculation:
 *    - parse (0-20)
 *    - hlslCompile (0-25)
 *    - semanticMapping (0-25)
 *    - cocosAbi (0-15)
 *    - renderState (0-15)
 *    - visualRiskPenalty (0-100)
 *    - final (0-100) -> Grade A/B/C/D/F
 * 3. Itemized deduction reporting
 */

const UnityShaderFamily = {
  CustomVertexFragment: 'CustomVertexFragment',
  BuiltinUnlit: 'BuiltinUnlit',
  BuiltinSurface: 'BuiltinSurface',
  URPUnlit: 'URPUnlit',
  URPLit: 'URPLit',
  ShaderGraphGenerated: 'ShaderGraphGenerated',
  Particle: 'Particle',
  Sprite: 'Sprite',
  PostProcess: 'PostProcess',
  Unknown: 'Unknown',
};

/**
 * Detects the specific shader family from ShaderLab AST and HLSL source
 */
function detectShaderFamily(docIR, rawHlsl = '') {
  const name = (docIR.shaderName || '').toLowerCase();
  const subShaders = docIR.subShaders || [];
  const tags = (subShaders[0] && subShaders[0].tags) || {};
  const renderType = (tags.RenderType || '').toLowerCase();
  const queue = (tags.Queue || '').toLowerCase();

  // 1. ShaderGraph Generated
  if (/ShaderGraph|SG_[A-Za-z0-9_]+/i.test(name) || /ShaderGraphLibrary|SG_/i.test(rawHlsl)) {
    return UnityShaderFamily.ShaderGraphGenerated;
  }

  // 2. Sprite / UI
  if (/Sprites\/|UI\/|Sprite-/i.test(name) || renderType === 'transparentcutout' || tags.CanUseSpriteAtlas) {
    return UnityShaderFamily.Sprite;
  }

  // 3. Particle
  if (/Particles\/|Particle/i.test(name) || queue.includes('transparent') && /particle/i.test(rawHlsl)) {
    return UnityShaderFamily.Particle;
  }

  // 4. PostProcess / Image Effects
  if (/Hidden\/|PostProcess|ImageEffect|ScreenSpace/i.test(name)) {
    return UnityShaderFamily.PostProcess;
  }

  // 5. URP Lit / Unlit
  if (/Universal Render Pipeline\/|URP\//i.test(name) || /Packages\/com.unity.render-pipelines.universal/i.test(rawHlsl)) {
    if (/\b(?:Lit|SimpleLit)\b/i.test(name) || /GetMainLight|Lighting\.hlsl/i.test(rawHlsl)) {
      return UnityShaderFamily.URPLit;
    }
    return UnityShaderFamily.URPUnlit;
  }

  // 6. Builtin Surface
  if (/#pragma\s+surface\b/i.test(rawHlsl) || /SurfaceOutput/i.test(rawHlsl)) {
    return UnityShaderFamily.BuiltinSurface;
  }

  // 7. Builtin Unlit
  if (/Unlit\//i.test(name) || renderType === 'opaque' && !/#pragma\s+surface/i.test(rawHlsl) && !/Light/i.test(rawHlsl)) {
    return UnityShaderFamily.BuiltinUnlit;
  }

  // 8. Custom Vertex Fragment
  if (/#pragma\s+vertex\b/i.test(rawHlsl) && /#pragma\s+fragment\b/i.test(rawHlsl)) {
    return UnityShaderFamily.CustomVertexFragment;
  }

  return UnityShaderFamily.Unknown;
}

/**
 * Computes multi-tier sub-scores and confidence breakdown
 */
function calculateConfidenceBreakdown(docIR, effectText, validationResult = {}) {
  const deductions = [];

  // 1. Parse Score (0 - 20)
  let parse = 20;
  if (!docIR.shaderName) {
    parse -= 10;
    deductions.push({ category: 'parse', points: -10, reason: 'Missing shader name in ShaderLab' });
  }
  if (!docIR.subShaders || docIR.subShaders.length === 0) {
    parse -= 10;
    deductions.push({ category: 'parse', points: -10, reason: 'No SubShaders declared' });
  }

  // 2. HLSL Compile / Entry Points Score (0 - 25)
  let hlslCompile = 25;
  if (!effectText) {
    hlslCompile = 0;
    deductions.push({ category: 'hlslCompile', points: -25, reason: 'Empty effect text' });
  } else {
    if (!/CCProgram\s+(?:vs|surface-vertex)/i.test(effectText)) {
      hlslCompile -= 12;
      deductions.push({ category: 'hlslCompile', points: -12, reason: 'Missing CCProgram vertex block' });
    }
    if (!/CCProgram\s+(?:fs|surface-fragment)/i.test(effectText)) {
      hlslCompile -= 13;
      deductions.push({ category: 'hlslCompile', points: -13, reason: 'Missing CCProgram fragment block' });
    }
  }

  // 3. Semantic Mapping Score (0 - 25)
  let semanticMapping = 25;
  if (validationResult.warnings) {
    for (const w of validationResult.warnings) {
      if (/Residual\s+Unity/i.test(w)) {
        semanticMapping -= 3;
        deductions.push({ category: 'semanticMapping', points: -3, reason: w });
      }
    }
  }
  semanticMapping = Math.max(0, semanticMapping);

  // 4. Cocos ABI & Descriptor Sets Score (0 - 15)
  let cocosAbi = 15;
  if (validationResult.errors && validationResult.errors.length > 0) {
    for (const e of validationResult.errors) {
      if (/Varying|layout|set/i.test(e)) {
        cocosAbi -= 5;
        deductions.push({ category: 'cocosAbi', points: -5, reason: e });
      }
    }
  }
  cocosAbi = Math.max(0, cocosAbi);

  // 5. Render State Translation Score (0 - 15)
  let renderState = 15;
  const pass = docIR.subShaders && docIR.subShaders[0] && docIR.subShaders[0].passes && docIR.subShaders[0].passes[0];
  if (pass && pass.renderState) {
    if (pass.renderState.blend && pass.renderState.blend.enabled && !pass.renderState.blend.srcRGB) {
      renderState -= 5;
      deductions.push({ category: 'renderState', points: -5, reason: 'Incomplete blend state factors' });
    }
  }
  renderState = Math.max(0, renderState);

  // 6. Visual Risk Penalty
  let visualRiskPenalty = 0;
  const hasGrabPass = (docIR.subShaders || []).some(s => (s.passes || []).some(p => p.isGrabPass));
  if (hasGrabPass) {
    visualRiskPenalty += 30;
    deductions.push({ category: 'visualRisk', points: -30, reason: 'Shader uses GrabPass (requires RenderTexture pipeline in Cocos)' });
  }

  if (validationResult.errors && validationResult.errors.length > 0) {
    const errPenalty = Math.min(validationResult.errors.length * 15, 45);
    visualRiskPenalty += errPenalty;
    deductions.push({ category: 'visualRisk', points: -errPenalty, reason: `Validation errors (${validationResult.errors.length})` });
  }

  // Calculate final score
  const subTotal = parse + hlslCompile + semanticMapping + cocosAbi + renderState;
  const final = Math.max(0, Math.min(100, subTotal - visualRiskPenalty));

  let grade = 'F';
  if (final >= 90) grade = 'A';
  else if (final >= 75) grade = 'B';
  else if (final >= 50) grade = 'C';
  else if (final >= 25) grade = 'D';

  return {
    breakdown: {
      parse,
      hlslCompile,
      semanticMapping,
      cocosAbi,
      renderState,
      visualRiskPenalty,
      final,
    },
    grade,
    deductions,
  };
}

module.exports = {
  UnityShaderFamily,
  detectShaderFamily,
  calculateConfidenceBreakdown,
};
