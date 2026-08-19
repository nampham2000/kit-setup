'use strict';

/**
 * AI-Polish Context & Structured Patch Generator
 * for UCShaderTranspiler
 *
 * Implements:
 * 1. Per-shader `ucst-ai.json` metadata generator
 * 2. Structured patch format export (`chunks` with nodeId, startLine, endLine, patch)
 * 3. Minimal context `README.ai-polish.md` generator
 * 4. Helper/Tool query APIs:
 *    - get_cocos_shader_api
 *    - query_hlsl_mapping
 *    - get_unity_builtin_mapping
 *    - get_shader_confidence
 */

const { calculateConfidenceBreakdown } = require('./confidence-evaluator.cjs');

/**
 * Generates per-shader `ucst-ai.json`
 */
function generateUcstAiJson(docIR, effectText, validationResult = {}, scoreInfo = {}, options = {}) {
  const todos = [];

  // Check validation errors and warnings for actionable todos
  const errors = validationResult.errors || [];
  const warnings = validationResult.warnings || [];

  errors.forEach((err, idx) => {
    todos.push({
      code: `UCST-ERR-${String(idx + 1).padStart(3, '0')}`,
      sourceRange: `${docIR.sourceFile || docIR.shaderName || 'unknown'}:0:0`,
      originalSnippet: '',
      generatedSnippet: '',
      diagnostic: err,
    });
  });

  warnings.forEach((warn, idx) => {
    if (/Residual/i.test(warn)) {
      todos.push({
        code: `UCST-WARN-${String(idx + 1).padStart(3, '0')}`,
        sourceRange: `${docIR.sourceFile || docIR.shaderName || 'unknown'}:0:0`,
        originalSnippet: warn,
        generatedSnippet: '',
        diagnostic: warn,
      });
    }
  });

  const includes = [];
  for (const s of docIR.subShaders || []) {
    for (const p of s.passes || []) {
      for (const inc of p.program.includes || []) {
        if (!includes.includes(inc)) includes.push(inc);
      }
    }
  }

  const resources = (docIR.properties || [])
    .filter(p => p.type === '2D' || p.type === 'Cube' || p.type === '3D')
    .map(p => p.name);

  return {
    shader: docIR.shaderName,
    sourceFile: docIR.sourceFile || `${docIR.shaderName}.shader`,
    confidence: scoreInfo.score !== undefined ? scoreInfo.score : 100,
    grade: scoreInfo.grade || 'A',
    family: docIR.family || 'Unknown',
    todos,
    dependencies: {
      includes,
      resources,
    },
  };
}

/**
 * Exports structured patch format for fine-grained AI chunk edits
 */
function generateStructuredPatch(docIR, effectText, faultyChunks = []) {
  const chunks = [];
  const lines = (effectText || '').split(/\r?\n/);

  // Locate fragment shader body
  let fsStart = -1;
  let fsEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    if (/CCProgram\s+(?:fs|surface-fragment)/i.test(lines[i])) {
      fsStart = i + 1;
    } else if (fsStart !== -1 && lines[i].includes('}%')) {
      fsEnd = i + 1;
      break;
    }
  }

  if (fsStart !== -1 && fsEnd !== -1) {
    chunks.push({
      nodeId: 'fragment:body',
      startLine: fsStart,
      endLine: fsEnd,
      patch: 'replace',
      description: 'Fragment program entry point and color calculations',
    });
  }

  return {
    file: `${pathBasename(docIR.sourceFile || docIR.shaderName)}.effect`,
    chunks: faultyChunks.length > 0 ? faultyChunks : chunks,
  };
}

function pathBasename(p) {
  if (!p) return 'Shader';
  const parts = p.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1].replace(/\.[^.]+$/, '');
}

/**
 * Generates minimal context `README.ai-polish.md`
 */
function generateReadmeAiPolishMd(docIR, rawSource, effectText, validationResult = {}, scoreInfo = {}, options = {}) {
  const intentDesc = detectShaderIntent(docIR, rawSource);

  return [
    `# AI Polish Context: ${docIR.shaderName}`,
    '',
    `## Original Shader`,
    '```shaderlab',
    (rawSource || '').trim(),
    '```',
    '',
    `## Generated Cocos Effect`,
    '```glsl',
    (effectText || '').trim(),
    '```',
    '',
    `## Detected Intent`,
    intentDesc,
    '',
    `## Automatic Changes`,
    `- Converted ShaderLab properties to std140 UBO and texture bindings (Set 2).`,
    `- Mapped Unity coordinate conventions and matrix operations to Cocos Creator 3.8.8+ GLSL 300 ES.`,
    `- Lowered blend modes, depth testing, and cull states.`,
    '',
    `## Unresolved Diagnostics`,
    (validationResult.warnings && validationResult.warnings.length > 0)
      ? validationResult.warnings.map(w => `- ${w}`).join('\n')
      : '- None (All static checks passed cleanly).',
    '',
    `## Required Preservation`,
    `- Keep material property names.`,
    `- Target Cocos Creator 3.8.8+ (.effect GLSL 300 ES).`,
    `- Keep WebGL2 compatible with graceful WebGL1 fallback.`,
    `- Do not increase draw calls (preserve single-pass rendering).`,
    `- Keep zero-GC execution in runtime game loop.`,
  ].join('\n');
}

function detectShaderIntent(docIR, rawSource = '') {
  const intents = [];
  const props = (docIR.properties || []).map(p => p.name.toLowerCase());

  if (props.some(p => p.includes('dissolve') || p.includes('noise'))) intents.push('Dissolve / Noise wipe');
  if (props.some(p => p.includes('cutoff') || p.includes('alphatest'))) intents.push('Alpha clip / cutout');
  if (props.some(p => p.includes('emission') || p.includes('glow'))) intents.push('Emissive edge / glow');
  if (props.some(p => p.includes('metallic') || p.includes('smoothness') || p.includes('roughness'))) intents.push('PBR Surface reflection');
  if (props.some(p => p.includes('speed') || p.includes('wave') || p.includes('wobble'))) intents.push('Vertex displacement wobble / UV scroll');

  if (intents.length === 0) return 'Standard Unlit / Forward opaque surface shading.';
  return intents.join(' + ') + '.';
}

// ============================================================================
// Tool Query Interfaces
// ============================================================================

function getCocosShaderApi() {
  return {
    version: 'Cocos Creator 3.8.8+',
    format: 'CCEffect YAML + CCProgram GLSL 300 ES',
    descriptorSets: {
      global: 'layout(set = 0) uniform cc-global',
      local: 'layout(set = 1) uniform cc-local',
      materialUbo: 'layout(set = 2, binding = 0) uniform Constants { ... }',
      materialSamplers: 'layout(set = 2, binding = 1..N) uniform sampler2D ...',
    },
    builtins: [
      'cc_matViewProj',
      'cc_matWorld',
      'cc_matWorldIT',
      'cc_cameraPos',
      'cc_time',
      'cc_screenSize',
      'cc_nearFar',
    ],
  };
}

function queryHlslMapping(symbol) {
  const mappings = {
    'UnityObjectToClipPos': 'cc_matViewProj * cc_matWorld * vec4(pos, 1.0)',
    'TRANSFORM_TEX': '(uv.xy * _ST.xy + _ST.zw)',
    'tex2D': 'texture(tex, uv)',
    'tex2Dproj': 'textureProj(tex, uv)',
    'tex2Dlod': 'textureLod(tex, uv.xy, lod)',
    'UNITY_MATRIX_MVP': '(cc_matViewProj * cc_matWorld)',
    'UNITY_MATRIX_V': 'cc_matView',
    'UNITY_MATRIX_P': 'cc_matProj',
    'UNITY_MATRIX_M': 'cc_matWorld',
    '_Time': 'vec4(cc_time.x * 0.05, cc_time.x, cc_time.x * 2.0, cc_time.x * 3.0)',
    '_WorldSpaceCameraPos': 'cc_cameraPos.xyz',
    '_ScreenParams': 'cc_screenSize',
    'fixed4': 'vec4',
    'half4': 'vec4',
    'float4': 'vec4',
    'float3x3': 'mat3',
    'float4x4': 'mat4',
  };

  return mappings[symbol] || null;
}

function getUnityBuiltinMapping(builtinName) {
  return queryHlslMapping(builtinName);
}

function getShaderConfidence(docIR, effectText, validationResult) {
  return calculateConfidenceBreakdown(docIR, effectText, validationResult);
}

module.exports = {
  generateUcstAiJson,
  generateStructuredPatch,
  generateReadmeAiPolishMd,
  getCocosShaderApi,
  queryHlslMapping,
  getUnityBuiltinMapping,
  getShaderConfidence,
};
