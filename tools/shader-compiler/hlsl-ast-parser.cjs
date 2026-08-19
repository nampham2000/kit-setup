'use strict';

/**
 * HLSL / Cg AST Parser for Unity -> Cocos Creator Transpiler
 *
 * Extracts and analyzes:
 * - HLSL Structs with field types, semantics (POSITION, NORMAL, TANGENT, COLOR, COLOR0/1, TEXCOORD0..7, SV_POSITION, SV_VertexID, SV_InstanceID, SV_Target0..7)
 * - Interpolation qualifiers (nointerpolation -> flat, centroid, sample, noperspective, linear)
 * - Uniform & Texture declarations (sampler2D, TEXTURE2D, SAMPLER, float4, half, fixed, matrices)
 * - Functions and entry points (vert, frag, helper functions)
 */

/**
 * Strips comments from HLSL code
 */
function stripHlslComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\r\n]*/g, ' ');
}

const INTERPOLATION_QUALIFIER_MAP = {
  nointerpolation: 'flat',
  centroid: 'centroid',
  sample: 'sample',
  noperspective: '', // Not supported in GLES3, emits warning/fallback
  linear: '',
};

/**
 * Parses HLSL struct definitions with interpolation qualifiers and extended semantics
 */
function parseStructs(hlslCode) {
  const structs = [];
  const clean = stripHlslComments(hlslCode);

  const structRegex = /\bstruct\s+([A-Za-z_]\w*)\s*\{([\s\S]*?)\}\s*;/g;
  let match;

  while ((match = structRegex.exec(clean)) !== null) {
    const structName = match[1];
    const body = match[2];
    const fields = [];

    // Split fields by semicolon
    const fieldLines = body.split(';');
    for (const rawField of fieldLines) {
      const fieldStr = rawField.trim();
      if (!fieldStr) continue;

      // Match optional interpolation qualifier: [nointerpolation|centroid|sample|noperspective|linear] Type Name [: Semantic]
      // Examples:
      // float4 vertex : POSITION;
      // nointerpolation float4 customData : TEXCOORD3;
      // centroid float2 uv : TEXCOORD0;
      // float4 pos : SV_POSITION;
      // uint vertexID : SV_VertexID;
      const fieldMatch = /^(?:(nointerpolation|centroid|sample|noperspective|linear)\s+)?([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)(?:\s*:\s*([A-Za-z0-9_]+))?$/i.exec(fieldStr);
      if (fieldMatch) {
        const qualifier = fieldMatch[1] ? fieldMatch[1].toLowerCase() : '';
        const type = fieldMatch[2];
        const name = fieldMatch[3];
        const semantic = fieldMatch[4] ? fieldMatch[4].toUpperCase() : '';

        const glslQualifier = qualifier ? (INTERPOLATION_QUALIFIER_MAP[qualifier] !== undefined ? INTERPOLATION_QUALIFIER_MAP[qualifier] : qualifier) : '';

        fields.push({
          type,
          name,
          semantic,
          qualifier,
          glslQualifier,
        });
      }
    }

    structs.push({
      name: structName,
      fields,
    });
  }

  return structs;
}

/**
 * Parses global uniforms and textures declared in HLSL
 */
function parseUniformsAndSamplers(hlslCode) {
  const uniforms = [];
  const samplers = [];
  const clean = stripHlslComments(hlslCode);

  // 1. Texture macros: TEXTURE2D(name); SAMPLER(sampler_name); TEXTURECUBE(name);
  const tex2dMacroRegex = /\b(?:TEXTURE2D|Texture2D)\s*\(\s*([A-Za-z_]\w*)\s*\)\s*;/g;
  let texMatch;
  while ((texMatch = tex2dMacroRegex.exec(clean)) !== null) {
    samplers.push({
      name: texMatch[1],
      type: 'sampler2D',
      macro: true,
    });
  }

  const texCubeMacroRegex = /\b(?:TEXTURECUBE|TextureCube)\s*\(\s*([A-Za-z_]\w*)\s*\)\s*;/g;
  while ((texMatch = texCubeMacroRegex.exec(clean)) !== null) {
    samplers.push({
      name: texMatch[1],
      type: 'samplerCube',
      macro: true,
    });
  }

  const tex3dMacroRegex = /\b(?:TEXTURE3D|Texture3D)\s*\(\s*([A-Za-z_]\w*)\s*\)\s*;/g;
  while ((texMatch = tex3dMacroRegex.exec(clean)) !== null) {
    samplers.push({
      name: texMatch[1],
      type: 'sampler3D',
      macro: true,
    });
  }

  // 2. Legacy sampler declarations: sampler2D _MainTex; samplerCube _CubeMap; sampler3D _Volume;
  const legacySamplerRegex = /\b(sampler2D|samplerCube|sampler3D)\s+([A-Za-z_]\w*)\s*;/g;
  while ((texMatch = legacySamplerRegex.exec(clean)) !== null) {
    if (!samplers.some(s => s.name === texMatch[2])) {
      samplers.push({
        name: texMatch[2],
        type: texMatch[1],
        macro: false,
      });
    }
  }

  // 3. Scalar and vector uniforms: float _Speed; float4 _Color; half3 _Tint; float4x4 _CustomMat;
  const uniformDeclRegex = /\b(float|half|fixed|int|bool|min16float|float2|float3|float4|half2|half3|half4|fixed2|fixed3|fixed4|float4x4|float3x3|float2x2|matrix)\s+([A-Za-z_]\w*)(?:\s*\[\s*(\d+)\s*\])?\s*;/g;
  let uMatch;
  while ((uMatch = uniformDeclRegex.exec(clean)) !== null) {
    const rawType = uMatch[1];
    const name = uMatch[2];
    const arraySize = uMatch[3] ? parseInt(uMatch[3], 10) : undefined;

    // Filter out common local var patterns or builtins
    if (!name.startsWith('gl_') && !name.startsWith('unity_') && !name.startsWith('UNITY_')) {
      uniforms.push({
        name,
        rawType,
        type: rawType,
        arraySize,
      });
    }
  }

  return { uniforms, samplers };
}

/**
 * Finds the index of the matching closing brace for an open brace
 */
function findMatchingBrace(text, openIndex) {
  let depth = 1;
  let inString = false;
  let quoteChar = '';

  for (let i = openIndex + 1; i < text.length; i++) {
    const ch = text[i];
    const prev = text[i - 1] || '';

    if (!inString && (ch === '"' || ch === "'")) {
      inString = true;
      quoteChar = ch;
      continue;
    }
    if (inString && ch === quoteChar && prev !== '\\') {
      inString = false;
      continue;
    }
    if (!inString) {
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return i;
      }
    }
  }
  return -1;
}

/**
 * Parses functions in HLSL block
 */
function parseFunctions(hlslCode) {
  const functions = [];
  const clean = stripHlslComments(hlslCode);

  // Match function signature: ReturnType Name ( Params ) [: Semantic] {
  const funcSigRegex = /\b([A-Za-z0-9_]+)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)(?:\s*:\s*([A-Za-z0-9_]+))?\s*\{/g;
  let match;

  while ((match = funcSigRegex.exec(clean)) !== null) {
    const returnType = match[1];
    const name = match[2];
    const rawParams = match[3];
    const semantic = match[4] || '';

    // Exclude control structures
    if (['if', 'for', 'while', 'switch', 'struct'].includes(name)) {
      continue;
    }

    const openBrace = match.index + match[0].length - 1;
    const closeBrace = findMatchingBrace(clean, openBrace);
    if (closeBrace <= openBrace) continue;

    const body = clean.slice(openBrace + 1, closeBrace);

    // Parse parameters
    const params = [];
    if (rawParams.trim()) {
      const pTokens = rawParams.split(',');
      for (const p of pTokens) {
        const pTrim = p.trim();
        const pMatch = /^(?:(in|out|inout)\s+)?([A-Za-z0-9_]+)\s+([A-Za-z_]\w*)(?:\s*:\s*([A-Za-z0-9_]+))?$/i.exec(pTrim);
        if (pMatch) {
          params.push({
            qualifier: pMatch[1] || 'in',
            type: pMatch[2],
            name: pMatch[3],
            semantic: pMatch[4] ? pMatch[4].toUpperCase() : '',
          });
        }
      }
    }

    functions.push({
      name,
      returnType,
      semantic,
      params,
      body,
      raw: clean.slice(match.index, closeBrace + 1),
    });
  }

  return functions;
}

/**
 * Complete analysis of an HLSL Program IR
 */
function analyzeHlslProgram(programIR) {
  const code = programIR.rawHlsl || '';
  if (!code) return programIR;

  const structs = parseStructs(code);
  const { uniforms, samplers } = parseUniformsAndSamplers(code);
  const functions = parseFunctions(code);

  programIR.structs = structs;
  programIR.uniforms = uniforms;
  programIR.samplers = samplers;
  programIR.functions = functions;

  return programIR;
}

module.exports = {
  stripHlslComments,
  parseStructs,
  parseUniformsAndSamplers,
  parseFunctions,
  analyzeHlslProgram,
  INTERPOLATION_QUALIFIER_MAP,
};
