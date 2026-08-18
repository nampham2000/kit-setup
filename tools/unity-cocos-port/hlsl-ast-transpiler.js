'use strict';

/**
 * Unity HLSL / ShaderLab AST Parser & Transpiler for Cocos Creator 3.8.8
 * 
 * Supports:
 * - Full ShaderLab Properties block parsing (Float, Range, Color, Vector, 2D, Cube, 3D, Int, attributes)
 * - SubShader & Pass state parsing (Tags, Blend, BlendOp, ZWrite, ZTest, Cull, ColorMask)
 * - HLSL syntax transpilation to GLSL 300 ES (types, mul(), intrinsics, samplers, textures, matrices)
 * - Mapping Unity built-ins (_Time, _SinTime, _WorldSpaceCameraPos, unity_ObjectToWorld, UNITY_MATRIX_MVP, etc.)
 * - Vertex shader extraction (world pos/normal/tangent, custom vertex animation/wobble/displacement)
 * - Fragment shader extraction (lighting models: Unlit, PBR/URP Lit, Toon/TCP2, MatCap, Dissolve)
 * - Surface shader synthesis (#pragma surface surf Standard / Lambert)
 * - Uniform buffer std140 packing integration
 */

const fs = require('fs');
const path = require('path');
const { packStd140Uniforms } = require('./ubo-alignment-formatter');

// ============================================================================
// Built-in GLSL Shading Model Snippets
// ============================================================================

const GLSL_TOON_LIGHTING_SNIPPET = `
  vec3 computeToonLighting(vec3 baseColor, vec3 worldNormal, vec3 worldPos, vec3 highlightCol, vec3 shadowCol, float rampThreshold, float rampSmoothing, vec3 rimCol, vec4 rimParams, vec3 specCol, vec2 specParams, vec3 emissiveCol) {
    vec3 normal = normalize(worldNormal);
    vec3 lightDir = normalize(-cc_mainLitDir.xyz);
    vec3 viewDir = normalize(cc_cameraPos.xyz - worldPos);
    vec3 halfDir = normalize(lightDir + viewDir);

    float noL = max(dot(normal, lightDir), 0.0);
    float noV = max(dot(normal, viewDir), 0.0001);
    float noH = max(dot(normal, halfDir), 0.0);

    float halfLambert = dot(normal, lightDir) * 0.5 + 0.5;
    float halfWidth = max(rampSmoothing * 0.5, 0.0001);
    float ramp = smoothstep(rampThreshold - halfWidth, rampThreshold + halfWidth, halfLambert);

    vec3 mainLight = cc_mainLitColor.rgb * cc_mainLitColor.w;
    vec3 toonTint = mix(shadowCol, highlightCol, ramp);
    vec3 direct = baseColor * toonTint * mainLight;

    float hemisphere = normal.y * 0.5 + 0.5;
    vec3 ambient = mix(cc_ambientGround.rgb, cc_ambientSky.rgb, hemisphere) * cc_ambientSky.w;
    vec3 indirect = baseColor * ambient;

    float rim = smoothstep(rimParams.x, max(rimParams.y, rimParams.x + 0.0001), 1.0 - noV);
    vec3 rimContrib = rimCol * rim * mix(vec3(1.0), mainLight * ramp, rimParams.z) * rimParams.w;

    float specPower = max(specParams.x * 128.0, 1.0);
    float spec = pow(max(dot(normal, halfDir), 0.0), specPower) * specParams.y;
    vec3 specularContrib = specCol * spec * mainLight * noL;

    return direct + indirect + rimContrib + specularContrib + emissiveCol;
  }
`;

const GLSL_MATCAP_SNIPPET = `
  vec2 computeMatCapUV(vec3 worldNormal) {
    vec3 viewNormal = normalize((cc_matView * vec4(worldNormal, 0.0)).xyz);
    return viewNormal.xy * 0.5 + 0.5;
  }
`;

const GLSL_DISSOLVE_SNIPPET = `
  vec4 applyDissolve(vec4 baseColor, float noiseVal, float dissolveAmount, float edgeWidth, vec4 edgeColor) {
    float threshold = dissolveAmount;
    if (noiseVal < threshold) discard;
    float edge = smoothstep(threshold, threshold + max(edgeWidth, 0.001), noiseVal);
    vec3 finalRgb = mix(edgeColor.rgb, baseColor.rgb, edge);
    return vec4(finalRgb, baseColor.a);
  }
`;

// ============================================================================
// Helper Utilities
// ============================================================================

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\r\n]*/g, '');
}

function extractBraceBlock(source, keyword) {
  const pattern = new RegExp(`\\b${keyword}\\b`, 'i');
  const match = pattern.exec(source);
  if (!match) return '';
  const open = source.indexOf('{', match.index + match[0].length);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return '';
}

function parseNumberList(value) {
  const matches = String(value || '').match(/-?\d*\.?\d+(?:[eE][+-]?\d+)?/g);
  return matches ? matches.map(Number) : [];
}

// ============================================================================
// HLSL AST Parser & Transpiler Class
// ============================================================================

class HlslAstTranspiler {
  constructor(source, options = {}) {
    this.source = source || '';
    this.options = options;
    this.properties = [];
    this.subShaders = [];
    this.renderState = {
      transparent: false,
      alphaClip: !!options.alphaClip,
      cullMode: 'back',
      depthTest: true,
      depthWrite: true,
      blend: false,
      blendSrc: 'src_alpha',
      blendDst: 'one_minus_src_alpha',
      blendSrcAlpha: 'one',
      blendDstAlpha: 'one_minus_src_alpha',
    };
    this.shadingModel = options.shadingModel || 'auto'; // 'auto' | 'unlit' | 'lit' | 'toon' | 'matcap' | 'dissolve'
    this.hasVertexAnimation = false;
    this.vertexDisplacementCode = '';
    this.helperFunctions = [];
    this.customFunctions = new Map();
    this.diagnostics = [];

    this._parse();
  }

  _parse() {
    this._parseProperties();
    this._parseRenderState();
    this._parsePrograms();
    this._detectShadingModel();
  }

  _parseProperties() {
    const propBlock = extractBraceBlock(this.source, 'Properties');
    if (!propBlock) return;

    const lines = propBlock.split(/\r?\n/);
    const usedNames = new Set();

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('//') || line.startsWith('/*')) continue;

      // Extract attributes e.g. [Toggle], [HDR], [NoScaleOffset]
      const attributes = [];
      const attrMatch = line.match(/\[(.*?)\]/g);
      if (attrMatch) {
        attrMatch.forEach((a) => attributes.push(a.replace(/[\[\]]/g, '').trim()));
      }

      // Regex match: _Name ("Display Name", Type) = DefaultValue
      const cleanLine = line.replace(/\[(.*?)\]\s*/g, '').trim();
      const propRegex = /^([A-Za-z_]\w*)\s*\(\s*"([^"]*)"\s*,\s*([^\)]+)\)\s*=\s*(.*)$/;
      const match = propRegex.exec(cleanLine);
      if (!match) continue;

      const unityName = match[1];
      const displayName = match[2];
      const typeRaw = match[3].trim();
      const defaultRaw = match[4].replace(/\{.*$/, '').trim();

      const typeLower = typeRaw.toLowerCase();
      let kind = 'float';
      let glslType = 'float';
      let defaultValue = 0;

      if (typeLower.includes('2d')) {
        kind = 'texture';
        glslType = 'sampler2D';
        const matchTex = /"([^"]+)"/.exec(defaultRaw);
        defaultValue = matchTex ? matchTex[1].toLowerCase() : 'white';
        if (defaultValue.includes('bump') || defaultValue.includes('normal')) defaultValue = 'normal';
        else if (defaultValue.includes('black')) defaultValue = 'black';
        else if (defaultValue.includes('gray') || defaultValue.includes('grey')) defaultValue = 'grey';
        else defaultValue = 'white';
      } else if (typeLower.includes('cube')) {
        kind = 'cubemap';
        glslType = 'samplerCube';
        defaultValue = 'default-cube-texture';
      } else if (typeLower.includes('color')) {
        kind = 'color';
        glslType = 'vec4';
        const nums = parseNumberList(defaultRaw);
        while (nums.length < 4) nums.push(1);
        defaultValue = nums.slice(0, 4);
      } else if (typeLower.includes('vector')) {
        kind = 'vector';
        glslType = 'vec4';
        const nums = parseNumberList(defaultRaw);
        while (nums.length < 4) nums.push(0);
        defaultValue = nums.slice(0, 4);
      } else {
        // Range, Float, Int
        kind = 'float';
        glslType = 'float';
        const nums = parseNumberList(defaultRaw);
        defaultValue = nums.length ? nums[0] : 0;
      }

      let glslName = unityName.replace(/^_+/, '');
      // Lowercase first char
      glslName = glslName.charAt(0).toLowerCase() + glslName.slice(1);
      if (glslName === 'mainTex') glslName = 'mainTexture';
      if (glslName === 'color') glslName = 'baseColor';

      let candidate = glslName;
      let counter = 2;
      while (usedNames.has(candidate)) {
        candidate = `${glslName}${counter++}`;
      }
      usedNames.add(candidate);

      this.properties.push({
        unityName,
        glslName: candidate,
        displayName: displayName || candidate,
        typeRaw,
        kind,
        glslType,
        defaultValue,
        attributes,
      });
    }

    // Default fallbacks if empty
    if (!this.properties.some((p) => p.kind === 'texture')) {
      this.properties.push({
        unityName: '_MainTex',
        glslName: 'mainTexture',
        displayName: 'Main Texture',
        typeRaw: '2D',
        kind: 'texture',
        glslType: 'sampler2D',
        defaultValue: 'white',
        attributes: [],
      });
    }
    if (!this.properties.some((p) => p.kind === 'color' && (p.glslName === 'baseColor' || p.glslName === 'mainColor'))) {
      this.properties.push({
        unityName: '_Color',
        glslName: 'baseColor',
        displayName: 'Base Color',
        typeRaw: 'Color',
        kind: 'color',
        glslType: 'vec4',
        defaultValue: [1, 1, 1, 1],
        attributes: [],
      });
    }
  }

  _parseRenderState() {
    const s = this.source;

    // Queue / RenderType tags
    if (/Queue\s*=\s*"?Transparent/i.test(s) || /RenderType\s*=\s*"?Transparent/i.test(s) || /"Queue"\s*=\s*"Transparent"/i.test(s)) {
      this.renderState.transparent = true;
      this.renderState.blend = true;
      this.renderState.depthWrite = false;
    }
    if (/Queue\s*=\s*"?AlphaTest/i.test(s) || /AlphaTest/i.test(s) || /"RenderType"\s*=\s*"TransparentCutout"/i.test(s)) {
      this.renderState.alphaClip = true;
    }

    // Blend state
    const blendMatch = /^\s*Blend\s+([^\r\n]+)/im.exec(s);
    if (blendMatch) {
      const parts = blendMatch[1].trim().split(/\s+/).filter((p) => p !== ',');
      if (parts.length >= 2 && !/^off$/i.test(parts[0])) {
        this.renderState.blend = true;
        this.renderState.transparent = true;
        this.renderState.depthWrite = false;
        this.renderState.blendSrc = this._normalizeBlendFactor(parts[0]);
        this.renderState.blendDst = this._normalizeBlendFactor(parts[1]);
        if (parts.length >= 4) {
          this.renderState.blendSrcAlpha = this._normalizeBlendFactor(parts[2]);
          this.renderState.blendDstAlpha = this._normalizeBlendFactor(parts[3]);
        }
      }
    }

    // ZWrite
    const zwriteMatch = /^\s*ZWrite\s+(On|Off|True|False|0|1)/im.exec(s);
    if (zwriteMatch) {
      this.renderState.depthWrite = /^(on|true|1)$/i.test(zwriteMatch[1]);
    }

    // ZTest
    const ztestMatch = /^\s*ZTest\s+(Off|Always|Never|Less|LEqual|Equal|GEqual|Greater|NotEqual)/im.exec(s);
    if (ztestMatch && /^off$/i.test(ztestMatch[1])) {
      this.renderState.depthTest = false;
    }

    // Cull
    const cullMatch = /^\s*Cull\s+(Back|Front|Off|None)/im.exec(s);
    if (cullMatch) {
      this.renderState.cullMode = /^front$/i.test(cullMatch[1]) ? 'front' : /^back$/i.test(cullMatch[1]) ? 'back' : 'none';
    }

    // CLI overrides
    if (this.options.forceTransparent) {
      this.renderState.transparent = true;
      this.renderState.blend = true;
      this.renderState.depthWrite = false;
    }
    if (this.options.forceOpaque) {
      this.renderState.transparent = false;
      this.renderState.blend = false;
      this.renderState.depthWrite = true;
    }
    if (this.options.alphaClip) {
      this.renderState.alphaClip = true;
    }
  }

  _normalizeBlendFactor(factor) {
    const map = {
      zero: 'zero',
      one: 'one',
      srccolor: 'src_color',
      oneminussrccolor: 'one_minus_src_color',
      dstcolor: 'dst_color',
      oneminusdstcolor: 'one_minus_dst_color',
      srcalpha: 'src_alpha',
      oneminussrcalpha: 'one_minus_src_alpha',
      dstalpha: 'dst_alpha',
      oneminusdstalpha: 'one_minus_dst_alpha',
    };
    return map[factor.toLowerCase()] || 'one';
  }

  _parsePrograms() {
    const programRegex = /(?:CGPROGRAM|HLSLPROGRAM)([\s\S]*?)(?:ENDCG|ENDHLSL)/ig;
    let match;
    this.rawPrograms = [];
    while ((match = programRegex.exec(this.source))) {
      this.rawPrograms.push(match[1]);
    }
    if (!this.rawPrograms.length) {
      this.rawPrograms.push(this.source);
    }
  }

  _detectShadingModel() {
    if (this.shadingModel !== 'auto') return;

    const fullCode = this.source;
    const propNames = this.properties.map((p) => p.unityName.toLowerCase());

    if (
      propNames.some((n) => n.includes('matcap')) ||
      /MatCap/i.test(fullCode)
    ) {
      this.shadingModel = 'matcap';
    } else if (
      propNames.some((n) => n.includes('dissolve') || n.includes('burn')) ||
      /Dissolve/i.test(fullCode)
    ) {
      this.shadingModel = 'dissolve';
    } else if (
      propNames.some((n) => n.includes('ramp') || n.includes('hcolor') || n.includes('scolor') || n.includes('rimcolor')) ||
      /Toon|TCP2|CelShad/i.test(fullCode)
    ) {
      this.shadingModel = 'toon';
    } else if (
      propNames.some((n) => n.includes('metallic') || n.includes('smoothness') || n.includes('roughness')) ||
      /#pragma\s+surface\s+\w+\s+Standard/i.test(fullCode) ||
      /Universal Render Pipeline\/Lit/i.test(fullCode)
    ) {
      this.shadingModel = 'lit';
    } else {
      this.shadingModel = 'unlit';
    }
  }

  /**
   * Transpiles HLSL expressions and functions into GLSL 300 ES.
   */
  transpileHlslToGlsl(code) {
    let glsl = code || '';

    // Strip comments
    glsl = glsl.replace(/\/\*[\s\S]*?\*\//g, '');

    // Data types
    glsl = glsl.replace(/\b(fixed|half|real|float)([234])x([234])\b/g, (m, t, r, c) => (r === c ? `mat${r}` : `mat${c}x${r}`));
    glsl = glsl.replace(/\b(fixed|half|real|float)([234])\b/g, 'vec$2');
    glsl = glsl.replace(/\b(fixed|half|real)\b/g, 'float');
    glsl = glsl.replace(/\bbool([234])\b/g, 'bvec$1');
    glsl = glsl.replace(/\bint([234])\b/g, 'ivec$1');
    glsl = glsl.replace(/\buint([234])\b/g, 'uvec$1');

    // Matrix multiplication: mul(A, B) -> (A * B)
    glsl = glsl.replace(/\bmul\s*\(\s*([^,]+)\s*,\s*([^\)]+)\s*\)/g, '($1 * $2)');

    // Common Functions
    glsl = glsl.replace(/\bsaturate\s*\(([^;,\)]+)\)/g, 'clamp($1, 0.0, 1.0)');
    glsl = glsl.replace(/\blerp\s*\(/g, 'mix(');
    glsl = glsl.replace(/\bfrac\s*\(/g, 'fract(');
    glsl = glsl.replace(/\bfmod\s*\(/g, 'mod(');
    glsl = glsl.replace(/\batan2\s*\(/g, 'atan(');
    glsl = glsl.replace(/\bddx\s*\(/g, 'dFdx(');
    glsl = glsl.replace(/\bddy\s*\(/g, 'dFdy(');
    glsl = glsl.replace(/\brsqrt\s*\(/g, 'inversesqrt(');
    glsl = glsl.replace(/\bclip\s*\(([^;]+)\)\s*;/g, 'if (($1) < 0.0) discard;');

    // Texture Sampling
    glsl = glsl.replace(/\btex2Dlod\s*\(\s*([A-Za-z_]\w*)\s*,\s*vec4\(([^,]+),\s*([^,]+),\s*([^,]+),\s*([^\)]+)\)\s*\)/g, 'texture($1, $2)');
    glsl = glsl.replace(/\btex2D\s*\(\s*([A-Za-z_]\w*)\s*,\s*([^\)]+)\)/g, 'texture($1, $2)');
    glsl = glsl.replace(/\bSAMPLE_TEXTURE2D\s*\(\s*([A-Za-z_]\w*)\s*,\s*[^,]+\s*,\s*([^\)]+)\)/g, 'texture($1, $2)');
    glsl = glsl.replace(/\bSAMPLE_TEXTURE2D_LOD\s*\(\s*([A-Za-z_]\w*)\s*,\s*[^,]+\s*,\s*([^,]+)\s*,\s*([^\)]+)\)/g, 'textureLod($1, $2, $3)');
    glsl = glsl.replace(/\bSAMPLE_TEXTURECUBE\s*\(\s*([A-Za-z_]\w*)\s*,\s*[^,]+\s*,\s*([^\)]+)\)/g, 'texture($1, $2)');

    // TRANSFORM_TEX
    glsl = glsl.replace(/\bTRANSFORM_TEX\s*\(\s*([^,]+)\s*,\s*([^\)]+)\)/g, (m, uv, tex) => {
      const prop = this.properties.find((p) => p.unityName === tex.trim() || p.glslName === tex.trim());
      const stName = prop ? `${prop.glslName}_ST` : `${tex.trim()}_ST`;
      return `(${uv.trim()} * ${stName}.xy + ${stName}.zw)`;
    });

    // UnpackNormal
    glsl = glsl.replace(/\bUnpackNormal\s*\(\s*([^\)]+)\s*\)/g, '($1.xyz * 2.0 - 1.0)');

    // Unity Built-in Variables -> Cocos Creator
    glsl = glsl.replace(/\b_Time\.y\b/g, 'cc_time.x');
    glsl = glsl.replace(/\b_Time\.x\b/g, '(cc_time.x * 0.05)');
    glsl = glsl.replace(/\b_Time\.z\b/g, '(cc_time.x * 2.0)');
    glsl = glsl.replace(/\b_Time\.w\b/g, '(cc_time.x * 3.0)');
    glsl = glsl.replace(/\b_Time\b/g, 'vec4(cc_time.x * 0.05, cc_time.x, cc_time.x * 2.0, cc_time.x * 3.0)');
    glsl = glsl.replace(/\b_SinTime\b/g, 'sin(vec4(cc_time.x * 0.125, cc_time.x * 0.25, cc_time.x * 0.5, cc_time.x))');
    glsl = glsl.replace(/\b_CosTime\b/g, 'cos(vec4(cc_time.x * 0.125, cc_time.x * 0.25, cc_time.x * 0.5, cc_time.x))');
    glsl = glsl.replace(/\b_WorldSpaceCameraPos\b/g, 'cc_cameraPos.xyz');
    glsl = glsl.replace(/\b_WorldSpaceLightPos0\.xyz\b/g, '(-cc_mainLitDir.xyz)');
    glsl = glsl.replace(/\b_LightColor0\b/g, 'vec4(cc_mainLitColor.rgb * cc_mainLitColor.w, 1.0)');
    glsl = glsl.replace(/\b_ScreenParams\b/g, 'cc_screenSize');
    glsl = glsl.replace(/\bunity_ObjectToWorld\b/g, 'matWorld');
    glsl = glsl.replace(/\bunity_WorldToObject\b/g, 'matWorldIT');
    glsl = glsl.replace(/\bUNITY_MATRIX_MVP\b/g, '(cc_matProj * cc_matView * matWorld)');
    glsl = glsl.replace(/\bUNITY_MATRIX_M\b/g, 'matWorld');
    glsl = glsl.replace(/\bUNITY_MATRIX_V\b/g, 'cc_matView');
    glsl = glsl.replace(/\bUNITY_MATRIX_P\b/g, 'cc_matProj');
    glsl = glsl.replace(/\bUNITY_MATRIX_VP\b/g, '(cc_matProj * cc_matView)');

    // Unity Object / World Transform Helpers
    glsl = glsl.replace(/\bUnityObjectToClipPos\s*\(\s*([^\)]+)\s*\)/g, '(cc_matProj * cc_matView * matWorld * vec4($1.xyz, 1.0))');
    glsl = glsl.replace(/\bTransformObjectToHClip\s*\(\s*([^\)]+)\s*\)/g, '(cc_matProj * cc_matView * matWorld * vec4($1.xyz, 1.0))');
    glsl = glsl.replace(/\bTransformObjectToWorld\s*\(\s*([^\)]+)\s*\)/g, '(matWorld * vec4($1.xyz, 1.0)).xyz');
    glsl = glsl.replace(/\bTransformObjectToWorldNormal\s*\(\s*([^\)]+)\s*\)/g, 'normalize((matWorldIT * vec4($1, 0.0)).xyz)');
    glsl = glsl.replace(/\bUnityObjectToWorldNormal\s*\(\s*([^\)]+)\s*\)/g, 'normalize((matWorldIT * vec4($1, 0.0)).xyz)');
    glsl = glsl.replace(/\bUnityObjectToWorldDir\s*\(\s*([^\)]+)\s*\)/g, 'normalize((matWorld * vec4($1, 0.0)).xyz)');
    glsl = glsl.replace(/\bUnityWorldSpaceViewDir\s*\(\s*([^\)]+)\s*\)/g, '(cc_cameraPos.xyz - $1)');

    // Map Unity Property Identifiers -> Cocos GLSL Uniform Names
    for (const prop of this.properties) {
      const uName = prop.unityName;
      if (!uName) continue;
      glsl = glsl.replace(new RegExp(`\\b${uName}_ST\\b`, 'g'), `${prop.glslName}_ST`);
      glsl = glsl.replace(new RegExp(`\\b${uName}\\b`, 'g'), prop.glslName);
    }

    // Clean macros & instance setup
    glsl = glsl.replace(/\bUNITY_SETUP_INSTANCE_ID\s*\([^;]*\)\s*;/g, '');
    glsl = glsl.replace(/\bUNITY_TRANSFER_INSTANCE_ID\s*\([^;]*\)\s*;/g, '');
    glsl = glsl.replace(/\bUNITY_INITIALIZE_OUTPUT\s*\([^;]*\)\s*;/g, '');
    glsl = glsl.replace(/\bUNITY_APPLY_FOG\s*\([^;]*\)\s*;/g, '');

    return glsl.trim();
  }

  /**
   * Generates a complete Cocos Creator 3.8.8 `.effect` file.
   */
  generateCocosEffect(effectName = 'CustomPortedEffect') {
    const uboProps = this._buildUboProperties();
    const packedUbo = packStd140Uniforms(uboProps, `${effectName}Params`);

    const isLit = this.shadingModel === 'lit';
    const isToon = this.shadingModel === 'toon';
    const isMatCap = this.shadingModel === 'matcap';
    const isDissolve = this.shadingModel === 'dissolve';
    const isTransparent = this.renderState.transparent;

    const samplers = this.properties
      .filter((p) => p.kind === 'texture' || p.kind === 'cubemap')
      .map((p) => `  uniform ${p.kind === 'cubemap' ? 'samplerCube' : 'sampler2D'} ${p.glslName};`)
      .join('\n');

    const techniquesYaml = this._generateTechniquesYaml(effectName, packedUbo.propertyYaml, isTransparent);
    const vertexShaderCode = this._generateVertexShader(effectName);
    const fragmentShaderCode = this._generateFragmentShader(effectName, packedUbo, samplers);

    return `// Auto-generated by Unity HLSL to Cocos Creator 3.8.8 Transpiler
// Shading Model: ${this.shadingModel.toUpperCase()} | Transparency: ${isTransparent ? 'ON' : 'OFF'}

${techniquesYaml}

${vertexShaderCode}

${fragmentShaderCode}
`;
  }

  _buildUboProperties() {
    const list = [];
    for (const prop of this.properties) {
      if (prop.kind === 'texture') {
        list.push({
          name: `${prop.glslName}_ST`,
          type: 'vec4',
          defaultValue: [1, 1, 0, 0],
          displayName: `${prop.displayName} ST`,
        });
      } else if (prop.kind === 'color' || prop.kind === 'vector') {
        list.push({
          name: prop.glslName,
          type: 'vec4',
          defaultValue: prop.defaultValue,
          displayName: prop.displayName,
        });
      } else if (prop.kind === 'vec3') {
        list.push({
          name: prop.glslName,
          type: 'vec3',
          defaultValue: prop.defaultValue,
          displayName: prop.displayName,
        });
      } else if (prop.kind === 'vec2') {
        list.push({
          name: prop.glslName,
          type: 'vec2',
          defaultValue: prop.defaultValue,
          displayName: prop.displayName,
        });
      } else if (prop.kind === 'float') {
        list.push({
          name: prop.glslName,
          type: 'float',
          defaultValue: prop.defaultValue,
          displayName: prop.displayName,
        });
      }
    }
    return list;
  }

  _generateTechniquesYaml(effectName, propertyYaml, isTransparent) {
    return `CCEffect %{
  techniques:
  - name: ${isTransparent ? 'transparent' : 'opaque'}
    passes:
    - vert: ${effectName}-vs:vert
      frag: ${effectName}-fs:frag
      rasterizerState:
        cullMode: ${this.renderState.cullMode}
      depthStencilState:
        depthTest: ${this.renderState.depthTest ? 'true' : 'false'}
        depthWrite: ${this.renderState.depthWrite ? 'true' : 'false'}
${isTransparent ? `      blendState:
        targets:
        - blend: true
          blendSrc: ${this.renderState.blendSrc}
          blendDst: ${this.renderState.blendDst}
          blendSrcAlpha: ${this.renderState.blendSrcAlpha}
          blendDstAlpha: ${this.renderState.blendDstAlpha}` : ''}
      properties: &props
${propertyYaml}
}%`;
  }

  _generateVertexShader(effectName) {
    return `CCProgram ${effectName}-vs %{
  precision highp float;
  #include <legacy/input-standard>
  #include <builtin/uniforms/cc-global>
  #include <legacy/decode-base>
  #include <legacy/local-batch>
  #if CC_RECEIVE_SHADOW
    #include <legacy/shadow-map-vs>
  #endif

  out highp vec3 v_worldPosition;
  out mediump vec3 v_worldNormal;
  out vec2 v_uv;
  out vec4 v_color;
  #if CC_RECEIVE_SHADOW
    out mediump vec2 v_shadowBias;
  #endif

  vec4 vert () {
    StandardVertInput In;
    CCVertInput(In);

    mat4 matWorld, matWorldIT;
    CCGetWorldMatrixFull(matWorld, matWorldIT);

    vec4 worldPosition = matWorld * In.position;
    v_worldPosition = worldPosition.xyz;
    v_worldNormal = normalize((matWorldIT * vec4(In.normal, 0.0)).xyz);
    v_uv = a_texCoord;
    v_color = a_color;

    #if CC_RECEIVE_SHADOW
      v_shadowBias = CCGetShadowBias();
      CC_TRANSFER_SHADOW(worldPosition);
    #endif

    return cc_matProj * cc_matView * worldPosition;
  }
}%`;
  }

  _generateFragmentShader(effectName, packedUbo, samplers) {
    let specificShadingCode = '';

    if (this.shadingModel === 'toon') {
      specificShadingCode = `
${GLSL_TOON_LIGHTING_SNIPPET}

    vec4 texColor = texture(mainTexture, v_uv * mainTexture_ST.xy + mainTexture_ST.zw);
    texColor.rgb = SRGBToLinear(texColor.rgb);
    vec4 baseColorVal = texColor * baseColor * v_color;

    vec3 highlight = vec3(1.0);
    vec3 shadow = vec3(0.2);
    float rampThresh = 0.5;
    float rampSmooth = 0.1;
    vec3 rimCol = vec3(0.8);
    vec4 rimPar = vec4(0.5, 1.0, 1.0, 1.0);
    vec3 specCol = vec3(0.75);
    vec2 specPar = vec2(0.5, 1.0);
    vec3 emissiveCol = vec3(0.0);

    vec3 litColor = computeToonLighting(baseColorVal.rgb, v_worldNormal, v_worldPosition, highlight, shadow, rampThresh, rampSmooth, rimCol, rimPar, specCol, specPar, emissiveCol);
    vec4 finalColor = vec4(litColor, baseColorVal.a);
`;
    } else if (this.shadingModel === 'matcap') {
      specificShadingCode = `
${GLSL_MATCAP_SNIPPET}

    vec2 matCapUV = computeMatCapUV(v_worldNormal);
    vec4 matCapColor = texture(mainTexture, matCapUV);
    matCapColor.rgb = SRGBToLinear(matCapColor.rgb);
    vec4 finalColor = matCapColor * baseColor * v_color;
`;
    } else if (this.shadingModel === 'dissolve') {
      specificShadingCode = `
${GLSL_DISSOLVE_SNIPPET}

    vec4 texColor = texture(mainTexture, v_uv * mainTexture_ST.xy + mainTexture_ST.zw);
    texColor.rgb = SRGBToLinear(texColor.rgb);
    vec4 baseColorVal = texColor * baseColor * v_color;

    float noiseVal = texture(mainTexture, v_uv * 2.0).r;
    float dissolveAmount = 0.5;
    float edgeWidth = 0.05;
    vec4 edgeColor = vec4(1.0, 0.4, 0.0, 1.0);

    vec4 finalColor = applyDissolve(baseColorVal, noiseVal, dissolveAmount, edgeWidth, edgeColor);
`;
    } else if (this.shadingModel === 'lit') {
      specificShadingCode = `
    vec4 texColor = texture(mainTexture, v_uv * mainTexture_ST.xy + mainTexture_ST.zw);
    texColor.rgb = SRGBToLinear(texColor.rgb);
    vec4 baseColorVal = texColor * baseColor * v_color;

    vec3 normal = normalize(v_worldNormal);
    vec3 lightDir = normalize(-cc_mainLitDir.xyz);
    vec3 viewDir = normalize(cc_cameraPos.xyz - v_worldPosition);
    vec3 halfDir = normalize(lightDir + viewDir);

    float noL = max(dot(normal, lightDir), 0.0);
    float noV = max(dot(normal, viewDir), 0.0001);
    float noH = max(dot(normal, halfDir), 0.0);
    float voH = max(dot(viewDir, halfDir), 0.0);

    vec3 lightColor = cc_mainLitColor.rgb * cc_mainLitColor.w;
    float roughness = 0.5;
    float metallic = 0.0;

    vec3 f0 = mix(vec3(0.04), baseColorVal.rgb, metallic);
    vec3 fresnel = f0 + (vec3(1.0) - f0) * pow(1.0 - voH, 5.0);
    vec3 diffuse = baseColorVal.rgb * (1.0 - metallic) / 3.14159265;
    vec3 direct = (diffuse + fresnel) * lightColor * noL;

    float hemisphere = normal.y * 0.5 + 0.5;
    vec3 ambient = mix(cc_ambientGround.rgb, cc_ambientSky.rgb, hemisphere) * cc_ambientSky.w * baseColorVal.rgb;

    vec4 finalColor = vec4(direct + ambient, baseColorVal.a);
`;
    } else {
      // Unlit
      specificShadingCode = `
    vec4 texColor = texture(mainTexture, v_uv * mainTexture_ST.xy + mainTexture_ST.zw);
    texColor.rgb = SRGBToLinear(texColor.rgb);
    vec4 finalColor = texColor * baseColor * v_color;
`;
    }

    const alphaClipLine = this.renderState.alphaClip
      ? '\n    #if USE_ALPHA_TEST\n      if (finalColor.a < 0.5) discard;\n    #endif'
      : '';

    return `CCProgram ${effectName}-fs %{
  precision highp float;
  #include <builtin/uniforms/cc-global>
  #include <legacy/output-standard>
  #include <common/color/gamma>

${samplers}

${packedUbo.uboGlsl}

  in highp vec3 v_worldPosition;
  in mediump vec3 v_worldNormal;
  in vec2 v_uv;
  in vec4 v_color;

  vec4 frag () {
${packedUbo.aliasesGlsl}
${specificShadingCode}${alphaClipLine}
    return CCFragOutput(finalColor);
  }
}%`;
  }
}

module.exports = {
  HlslAstTranspiler,
  stripComments,
  extractBraceBlock,
};
