'use strict';

/**
 * Cocos Creator 3.8.8+ .effect Generator (EffectEmitter)
 *
 * Emits complete, valid Cocos Creator `.effect` files:
 * - CCEffect YAML frontmatter (techniques, passes, rasterizerState, depthStencilState, blendState, properties)
 * - CCProgram vs / CCProgram fs with 3-tier Descriptor Sets (Set 0, Set 1, Set 2)
 * - Cocos Surface Shader mode (CCProgram surface-vertex, CCProgram surface-fragment)
 * - Single-pass Lighting lowering & Normal map unpack helpers
 * - Optional Cocos .mtl material generator
 */

const { buildStd140Ubo } = require('./ubo-layout-builder.cjs');
const { lowerHlslToGlsl } = require('./unity-semantic-lowering.cjs');
const { allocateBindings } = require('./binding-allocator.cjs');
const { extractSurfaceShaderIntent, detectPackedMaps } = require('./surface-shader-intent-extractor.cjs');

// ============================================================================
// Built-in Shading Model Snippets
// ============================================================================

const GLSL_SIMPLE_LIGHTING_SNIPPET = `
  vec3 CalculateSimpleLighting(vec3 worldNormal, vec3 albedo, vec3 emission) {
    vec3 N = normalize(worldNormal);
    vec3 L = normalize(-cc_mainLitDir.xyz);
    float NdotL = max(dot(N, L), 0.0);
    vec3 directDiffuse = albedo * cc_mainLitColor.rgb * (NdotL * cc_mainLitColor.w);
    vec3 ambient = albedo * cc_ambientSky.rgb;
    return directDiffuse + ambient + emission;
  }
`;

const GLSL_NORMAL_UNPACK_SNIPPET = `
  vec3 UnpackNormalMap(vec4 packedNormal, float scale) {
    #if USE_DXT5NM_NORMAL
      vec2 normalXY = (packedNormal.wy * 2.0 - 1.0) * scale;
    #else
      vec2 normalXY = (packedNormal.xy * 2.0 - 1.0) * scale;
    #endif
    float normalZ = sqrt(max(1.0 - dot(normalXY, normalXY), 0.0));
    return normalize(vec3(normalXY, normalZ));
  }
`;

const GLSL_TOON_SNIPPET = `
  vec3 computeToonLighting(vec3 baseColor, vec3 worldNormal, vec3 worldPos, vec3 highlightCol, vec3 shadowCol, float rampThreshold, float rampSmoothing, vec3 rimCol, vec4 rimParams, vec3 specCol, vec2 specParams, vec3 emissiveCol) {
    vec3 normal = normalize(worldNormal);
    vec3 lightDir = normalize(-cc_mainLitDir.xyz);
    vec3 viewDir = normalize(cc_cameraPos.xyz - worldPos);
    vec3 halfDir = normalize(lightDir + viewDir);

    float noL = max(dot(normal, lightDir), 0.0);
    float noV = max(dot(normal, viewDir), 0.0001);

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

/**
 * Maps property default value to YAML string representation
 */
function formatYamlPropertyValue(prop) {
  if (prop.type === 'Color' || prop.type === 'Vector') {
    const val = Array.isArray(prop.defaultValue) ? prop.defaultValue : [1, 1, 1, 1];
    return `[${val.join(', ')}]`;
  }
  if (prop.type === '2D' || prop.type === 'Cube' || prop.type === '3D') {
    return prop.textureDefault || 'white';
  }
  if (typeof prop.defaultValue === 'number') {
    return String(prop.defaultValue);
  }
  return '0.0';
}

/**
 * Builds CCEffect YAML frontmatter
 */
function buildCceffectYaml(docIR, passIR, uboInfo, options = {}) {
  const isTransparent = passIR.renderState.blend && passIR.renderState.blend.enabled;
  const techniqueName = isTransparent ? 'transparent' : 'opaque';
  const isSurface = options.mode === 'surface-pbr';

  const lines = [
    'CCEffect %{',
    '  techniques:',
    `  - name: ${techniqueName}`,
    '    passes:',
    `    - vert: ${isSurface ? 'surface-vertex:vert' : 'vs:vert'}`,
    `      frag: ${isSurface ? 'surface-fragment:frag' : 'fs:frag'}`,
  ];

  // Rasterizer State
  const cull = passIR.renderState.cull || 'back';
  lines.push('      rasterizerState:');
  lines.push(`        cullMode: ${cull}`);
  if (passIR.renderState.depthBias !== undefined && passIR.renderState.depthBias !== 0) {
    lines.push(`        depthBias: ${passIR.renderState.depthBias}`);
  }
  if (passIR.renderState.depthBiasSlope !== undefined && passIR.renderState.depthBiasSlope !== 0) {
    lines.push(`        depthBiasSlope: ${passIR.renderState.depthBiasSlope}`);
  }

  // Depth Stencil State
  lines.push('      depthStencilState:');
  lines.push(`        depthTest: ${passIR.renderState.zTest !== 'Off'}`);
  lines.push(`        depthWrite: ${passIR.renderState.zWrite}`);
  if (passIR.renderState.zTest && passIR.renderState.zTest !== 'LEqual' && passIR.renderState.zTest !== 'Off') {
    lines.push(`        depthFunc: ${passIR.renderState.zTest.toLowerCase()}`);
  }
  if (passIR.renderState.stencil && passIR.renderState.stencil.enabled) {
    const st = passIR.renderState.stencil;
    lines.push('        stencilTest: true');
    lines.push(`        stencilFuncFront: ${st.compFront || st.comp || 'always'}`);
    lines.push(`        stencilRefFront: ${st.ref !== undefined ? st.ref : 1}`);
    lines.push(`        stencilReadMaskFront: ${st.readMask !== undefined ? st.readMask : 255}`);
    lines.push(`        stencilWriteMaskFront: ${st.writeMask !== undefined ? st.writeMask : 255}`);
    lines.push(`        stencilPassOpFront: ${st.passFront || st.pass || 'keep'}`);
    lines.push(`        stencilFailOpFront: ${st.failFront || st.fail || 'keep'}`);
    lines.push(`        stencilZFailOpFront: ${st.zFailFront || st.zFail || 'keep'}`);
    lines.push(`        stencilFuncBack: ${st.compBack || st.comp || 'always'}`);
    lines.push(`        stencilRefBack: ${st.ref !== undefined ? st.ref : 1}`);
    lines.push(`        stencilReadMaskBack: ${st.readMask !== undefined ? st.readMask : 255}`);
    lines.push(`        stencilWriteMaskBack: ${st.writeMask !== undefined ? st.writeMask : 255}`);
    lines.push(`        stencilPassOpBack: ${st.passBack || st.pass || 'keep'}`);
    lines.push(`        stencilFailOpBack: ${st.failBack || st.fail || 'keep'}`);
    lines.push(`        stencilZFailOpBack: ${st.zFailBack || st.zFail || 'keep'}`);
  }

  // Blend State
  if (isTransparent) {
    lines.push('      blendState:');
    lines.push('        targets:');
    lines.push('        - blend: true');
    lines.push(`          blendSrc: ${passIR.renderState.blend.srcRGB || 'src_alpha'}`);
    lines.push(`          blendDst: ${passIR.renderState.blend.dstRGB || 'one_minus_src_alpha'}`);
    lines.push(`          blendSrcAlpha: ${passIR.renderState.blend.srcAlpha || 'src_alpha'}`);
    lines.push(`          blendDstAlpha: ${passIR.renderState.blend.dstAlpha || 'one_minus_src_alpha'}`);
    if (passIR.renderState.blend.opRGB && passIR.renderState.blend.opRGB !== 'add') {
      lines.push(`          blendEq: ${passIR.renderState.blend.opRGB}`);
    }
    if (passIR.renderState.blend.opAlpha && passIR.renderState.blend.opAlpha !== 'add') {
      lines.push(`          blendAlphaEq: ${passIR.renderState.blend.opAlpha}`);
    }
  }

  // Properties Block
  if (docIR.properties.length > 0) {
    lines.push('      properties:');
    for (const prop of docIR.properties) {
      const pName = prop.cocosName || prop.name;
      const valStr = formatYamlPropertyValue(prop);

      if (prop.editor && (prop.editor.type || prop.editor.range || prop.editor.displayName)) {
        const editorParts = [];
        if (prop.editor.type) editorParts.push(`type: ${prop.editor.type}`);
        if (prop.editor.range) editorParts.push(`range: [${prop.editor.range.join(', ')}]`);
        if (prop.editor.step) editorParts.push(`step: ${prop.editor.step}`);
        if (prop.editor.displayName) editorParts.push(`displayName: "${prop.editor.displayName}"`);

        lines.push(`        ${pName}: { value: ${valStr}, editor: { ${editorParts.join(', ')} } }`);
      } else {
        lines.push(`        ${pName}: { value: ${valStr} }`);
      }
    }
  }

  lines.push('}%');
  return lines.join('\n');
}

/**
 * Emits Cocos Creator Surface Shader mode (--mode surface-pbr)
 */
function emitSurfaceShaderEffect(docIR, passIR, options = {}) {
  const uboFields = [];
  const samplers = [];

  for (const prop of docIR.properties) {
    const cName = prop.cocosName || prop.name;
    if (prop.type === '2D' || prop.type === 'Cube' || prop.type === '3D') {
      samplers.push({ name: cName, type: prop.cocosType || 'sampler2D', originalName: prop.name });
      uboFields.push({ name: `${cName}_ST`, type: 'vec4' });
    } else {
      uboFields.push({ name: cName, type: prop.cocosType || 'float' });
    }
  }

  const ubo = buildStd140Ubo(uboFields, true, { explicitBindings: true, set: 2, binding: 0 });
  const yaml = buildCceffectYaml(docIR, passIR, ubo, { mode: 'surface-pbr' });

  let samplerIdx = 1;
  const samplerDecls = samplers.map(s => `  layout(set = 2, binding = ${samplerIdx++}) uniform ${s.type} ${s.name};`).join('\n');

  const vsLines = [
    'CCProgram surface-vertex %{',
    '  precision highp float;',
    '  #include <builtin/uniforms/cc-global>',
    '  #include <builtin/uniforms/cc-local>',
    '',
    ubo.glsl ? '  ' + ubo.glsl.split('\n').join('\n  ') : '',
    '',
    '  #define CC_SURFACES_VERTEX_MODIFY_WORLD_POS',
    '  vec3 SurfacesVertexModifyWorldPos(SurfacesVertexData surfaceData) {',
    '    return surfaceData.worldPos;',
    '  }',
    '}%',
  ];

  const fsLines = [
    'CCProgram surface-fragment %{',
    '  precision mediump float;',
    '  #include <builtin/uniforms/cc-global>',
    '',
    ubo.glsl ? '  ' + ubo.glsl.split('\n').join('\n  ') : '',
    '',
    samplerDecls,
    '',
    '  #define CC_SURFACES_FRAGMENT_MODIFY_BASECOLOR_AND_ALPHA',
    '  void SurfacesFragmentModifyBaseColorAndAlpha(inout vec4 baseColor, inout float alpha) {',
    samplers.length > 0 ? `    baseColor *= texture(${samplers[0].name}, v_uv);` : '',
    docIR.properties.some(p => p.type === 'Color') ? '    baseColor *= baseColor;' : '',
    '  }',
    '',
    '  #define CC_SURFACES_FRAGMENT_MODIFY_PBRPARAMS',
    '  void SurfacesFragmentModifyPBRParams(inout SurfacesPBRData pbrData) {',
    docIR.properties.some(p => p.name.toLowerCase().includes('smoothness')) ? '    pbrData.roughness = 1.0 - smoothness;' : '    pbrData.roughness = 0.5;',
    docIR.properties.some(p => p.name.toLowerCase().includes('metallic')) ? '    pbrData.metallic = metallic;' : '    pbrData.metallic = 0.0;',
    '  }',
    '}%',
  ];

  return `${yaml}\n\n${vsLines.join('\n')}\n\n${fsLines.join('\n')}\n`;
}

/**
 * Generates vertex & fragment CCProgram blocks
 */
function generateCocosPrograms(docIR, passIR, options = {}) {
  const programIR = passIR.program;
  const rawCode = programIR.rawHlsl || '';
  const loweredCode = lowerHlslToGlsl(rawCode);

  // 1. Gather all properties and ST vectors for UBO
  const uboFields = [];
  const samplers = [];
  const propertyNameMap = new Map();

  for (const prop of docIR.properties) {
    const cName = prop.cocosName || prop.name;
    propertyNameMap.set(prop.name, cName);

    if (prop.type === '2D' || prop.type === 'Cube' || prop.type === '3D') {
      samplers.push({
        name: cName,
        type: prop.cocosType || 'sampler2D',
        originalName: prop.name,
      });

      // Add corresponding tiling & offset vector (_ST)
      uboFields.push({
        name: `${cName}_ST`,
        type: 'vec4',
      });
      propertyNameMap.set(`${prop.name}_ST`, `${cName}_ST`);
    } else {
      uboFields.push({
        name: cName,
        type: prop.cocosType || 'float',
      });
    }
  }

  // Also include any explicit HLSL uniforms that weren't in Properties block
  for (const u of programIR.uniforms || []) {
    if (!propertyNameMap.has(u.name) && !uboFields.some(f => f.name === u.name)) {
      uboFields.push({
        name: u.name,
        type: u.type,
      });
    }
  }

  // Build std140 UBO layout with explicit descriptor set binding (Set 2, Binding 0)
  const ubo = buildStd140Ubo(uboFields, true, {
    explicitBindings: options.explicitBindings !== undefined ? options.explicitBindings : true,
    set: 2,
    binding: 0,
  });

  // 2. Determine Vertex Attributes needed
  const attributes = [
    'in vec3 a_position;',
    'in vec2 a_texCoord;',
  ];
  if (/NORMAL|worldNormal|a_normal/i.test(rawCode) || docIR.family === 'Toon' || docIR.family === 'MatCap' || docIR.family === 'PBR') {
    attributes.push('in vec3 a_normal;');
  }
  if (/TANGENT|a_tangent/i.test(rawCode)) {
    attributes.push('in vec4 a_tangent;');
  }
  if (/COLOR|a_color/i.test(rawCode)) {
    attributes.push('in vec4 a_color;');
  }

  // 3. Determine Varyings (Stage IO)
  const varyings = [
    'out vec2 v_uv;',
  ];
  if (attributes.some(a => a.includes('a_color'))) {
    varyings.push('out vec4 v_color;');
  }
  if (attributes.some(a => a.includes('a_normal')) || /v_worldNormal|normalWS/i.test(loweredCode)) {
    varyings.push('out vec3 v_worldNormal;');
  }
  if (/worldPos|positionWS|v_worldPos/i.test(loweredCode) || docIR.family === 'Toon' || docIR.family === 'PBR') {
    varyings.push('out vec3 v_worldPos;');
  }
  if (/screenPos|ComputeScreenPos/i.test(rawCode)) {
    varyings.push('out vec4 v_screenPos;');
  }

  // Helper to replace Unity identifiers with Cocos names in code body
  function remapIdentifiers(codeStr) {
    let res = codeStr;
    for (const [uName, cName] of propertyNameMap.entries()) {
      if (uName !== cName) {
        res = res.replace(new RegExp(`\\b${uName}\\b`, 'g'), cName);
      }
    }
    return res;
  }

  // 4. Translate Helper Functions in source
  const helperFunctions = [];
  for (const func of programIR.functions || []) {
    if (func.name !== programIR.vertexEntry && func.name !== programIR.fragmentEntry) {
      let funcGlsl = lowerHlslToGlsl(func.raw);
      funcGlsl = remapIdentifiers(funcGlsl);
      helperFunctions.push(funcGlsl);
    }
  }

  // 5. Generate Vertex Program (CCProgram vs)
  const vsIncludes = [
    '  #include <builtin/uniforms/cc-global>',
    '  #include <builtin/uniforms/cc-local>',
  ];
  if (/cc_fog|cc_fogColor|UNITY_FOG/i.test(rawCode)) vsIncludes.push('  #include <builtin/uniforms/cc-fog>');
  if (/cc_shadow|TRANSFER_SHADOW|SHADOW_COORDS/i.test(rawCode)) vsIncludes.push('  #include <builtin/uniforms/cc-shadow>');
  if (/cc_joints|cc_jointTexture|a_joints|a_weights/i.test(rawCode)) vsIncludes.push('  #include <builtin/uniforms/cc-skinning>');

  const vsLines = [
    'CCProgram vs %{',
    '  precision highp float;',
    ...vsIncludes,
    '',
    '  ' + attributes.join('\n  '),
    '',
    '  ' + varyings.join('\n  '),
    '',
  ];

  if (ubo.glsl) {
    vsLines.push('  ' + ubo.glsl.split('\n').join('\n  '));
    vsLines.push('');
  }

  // Insert helper functions in VS if any
  if (helperFunctions.length > 0) {
    vsLines.push('  ' + helperFunctions.join('\n\n  '));
    vsLines.push('');
  }

  // Vertex Main Entry
  const vertFunc = (programIR.functions || []).find(f => f.name === programIR.vertexEntry);
  vsLines.push('  vec4 vert () {');
  vsLines.push('    vec4 pos = vec4(a_position, 1.0);');
  vsLines.push('    v_uv = a_texCoord;');
  if (varyings.some(v => v.includes('v_color'))) {
    vsLines.push('    v_color = a_color;');
  }
  if (varyings.some(v => v.includes('v_worldPos'))) {
    vsLines.push('    v_worldPos = (cc_matWorld * pos).xyz;');
  }
  if (varyings.some(v => v.includes('v_worldNormal'))) {
    vsLines.push('    v_worldNormal = normalize((cc_matWorldIT * vec4(a_normal, 0.0)).xyz);');
  }

  let customVertAssignedClipPos = false;

  if (vertFunc && vertFunc.body) {
    // Translate custom vertex body
    let vBody = lowerHlslToGlsl(vertFunc.body);
    vBody = remapIdentifiers(vBody);

    // Strip struct local var declaration like "Varyings o;" or "v2f o;" or "Vertex_Stage_Output output;"
    vBody = vBody.replace(/\b(?:Varyings|v2f|appdata|Attributes|\w+_Output|\w+_Input)\s+\w+\s*;?/g, '');

    // Replace param references with attributes
    if (vertFunc.params.length > 0) {
      const pName = vertFunc.params[0].name;
      vBody = vBody.replace(new RegExp(`\\b${pName}\\.vertex\\.xyz\\b`, 'g'), 'a_position');
      vBody = vBody.replace(new RegExp(`\\b${pName}\\.vertex\\b`, 'g'), 'vec4(a_position, 1.0)');
      vBody = vBody.replace(new RegExp(`\\b${pName}\\.pos\\.xyz\\b`, 'g'), 'a_position');
      vBody = vBody.replace(new RegExp(`\\b${pName}\\.pos\\b`, 'g'), 'a_position');
      vBody = vBody.replace(new RegExp(`\\b${pName}\\.positionOS\\.xyz\\b`, 'g'), 'a_position');
      vBody = vBody.replace(new RegExp(`\\b${pName}\\.positionOS\\b`, 'g'), 'vec4(a_position, 1.0)');
      vBody = vBody.replace(new RegExp(`\\b${pName}\\.texcoord\\b`, 'g'), 'vec4(a_texCoord, 0.0, 0.0)');
      vBody = vBody.replace(new RegExp(`\\b${pName}\\.uv\\b`, 'g'), 'a_texCoord');
      vBody = vBody.replace(new RegExp(`\\b${pName}\\.normal\\b`, 'g'), 'a_normal');
      vBody = vBody.replace(new RegExp(`\\b${pName}\\.normalOS\\b`, 'g'), 'a_normal');
      vBody = vBody.replace(new RegExp(`\\b${pName}\\.color\\b`, 'g'), 'a_color');
    }

    // Clean any residual vec4(vec4(a_position, 1.0).xyz, 1.0)
    vBody = vBody.replace(/vec4\s*\(\s*vec4\s*\(\s*a_position\s*,\s*1\.0\s*\)\.xyz\s*,\s*1\.0\s*\)/g, 'vec4(a_position, 1.0)');

    if (/\b(?:positionHCS|pos|vertex)\s*=\s*\(+cc_matViewProj/i.test(vBody)) {
      customVertAssignedClipPos = true;
    }

    // Remap output struct assignments
    vBody = vBody.replace(/\b\w+\.vertex\s*=\s*/g, 'pos = ');
    vBody = vBody.replace(/\b\w+\.positionHCS\s*=\s*/g, 'pos = ');
    vBody = vBody.replace(/\b\w+\.pos\s*=\s*/g, 'pos = ');
    vBody = vBody.replace(/\b\w+\.texcoord\s*=\s*/g, 'v_uv = ');
    vBody = vBody.replace(/\b\w+\.uv\s*=\s*/g, 'v_uv = ');
    vBody = vBody.replace(/\b\w+\.color\s*=\s*/g, 'v_color = ');
    vBody = vBody.replace(/\b\w+\.screenPos\s*=\s*/g, 'v_screenPos = ');
    vBody = vBody.replace(/\b\w+\.normalWS\s*=\s*/g, 'v_worldNormal = ');
    vBody = vBody.replace(/\b\w+\.positionWS\s*=\s*/g, 'v_worldPos = ');
    vBody = vBody.replace(/\b\w+\.viewDirWS\s*=\s*[^;]+;?/g, '');
    vBody = vBody.replace(/\b\w+\.positionHCS\b/g, 'pos');
    vBody = vBody.replace(/\breturn\s+\w+\s*;/g, '');

    const trimmedBody = vBody.trim();
    if (trimmedBody) {
      vsLines.push('    // Custom vertex logic:');
      vsLines.push('    ' + trimmedBody.split('\n').map(l => l.trimEnd()).join('\n    '));
    }
  }

  if (customVertAssignedClipPos) {
    vsLines.push('    return pos;');
  } else if (varyings.some(v => v.includes('v_screenPos')) && !vertFunc) {
    vsLines.push('    vec4 clipPos = cc_matViewProj * cc_matWorld * pos;');
    vsLines.push('    v_screenPos = vec4(vec2(clipPos.x, clipPos.y) * 0.5 + vec2(clipPos.w * 0.5), clipPos.zw);');
    vsLines.push('    return clipPos;');
  } else {
    vsLines.push('    return cc_matViewProj * cc_matWorld * pos;');
  }
  vsLines.push('  }');
  vsLines.push('}%');

  // 6. Generate Fragment Program (CCProgram fs)
  const fsVaryings = varyings.map(v => v.replace(/^out\s+/, 'in '));
  const fsIncludes = [
    '  #include <builtin/uniforms/cc-global>',
  ];
  if (/cc_fog|cc_fogColor|UNITY_APPLY_FOG/i.test(rawCode)) fsIncludes.push('  #include <builtin/uniforms/cc-fog>');
  if (/cc_shadow|SHADOW_ATTENUATION/i.test(rawCode)) fsIncludes.push('  #include <builtin/uniforms/cc-shadow>');
  if (/cc_mainLitDir|Shade4PointLights|cc_forward_light/i.test(rawCode)) fsIncludes.push('  #include <builtin/uniforms/cc-forward-light>');
  if (docIR.family === 'PBR' || /cc-pbr|StandardPBR/i.test(rawCode)) fsIncludes.push('  #include <builtin/includes/cc-pbr>');

  const fsLines = [
    'CCProgram fs %{',
    '  precision mediump float;',
    ...fsIncludes,
    '',
    '  ' + fsVaryings.join('\n  '),
    '',
  ];

  if (ubo.glsl) {
    fsLines.push('  ' + ubo.glsl.split('\n').join('\n  '));
    fsLines.push('');
  }

  // Samplers with deterministic descriptor allocation
  if (samplers.length > 0) {
    const bindingAlloc = allocateBindings(samplers, options);
    for (const s of samplers) {
      const bindingInfo = bindingAlloc.manifest[s.name] || { set: 2, binding: 1 };
      if (options.explicitBindings !== false) {
        fsLines.push(`  layout(set = ${bindingInfo.set}, binding = ${bindingInfo.binding}) uniform ${s.type} ${s.name};`);
      } else {
        fsLines.push(`  uniform ${s.type} ${s.name};`);
      }
    }
    fsLines.push('');
  }

  // Shading Model & Helper Snippets
  if (docIR.family === 'Toon') {
    fsLines.push(GLSL_TOON_SNIPPET);
  } else if (docIR.family === 'MatCap') {
    fsLines.push(GLSL_MATCAP_SNIPPET);
  } else if (docIR.family === 'Dissolve') {
    fsLines.push(GLSL_DISSOLVE_SNIPPET);
  } else if (rawCode.includes('UnpackNormal')) {
    fsLines.push(GLSL_NORMAL_UNPACK_SNIPPET);
  }

  // Insert helper functions in FS
  if (helperFunctions.length > 0) {
    fsLines.push('  ' + helperFunctions.join('\n\n  '));
    fsLines.push('');
  }

  // Fragment Main Entry
  const fragFunc = (programIR.functions || []).find(f => f.name === programIR.fragmentEntry);
  fsLines.push('  vec4 frag () {');

  if (fragFunc && fragFunc.body) {
    let fBody = lowerHlslToGlsl(fragFunc.body);
    fBody = remapIdentifiers(fBody);

    // Replace param references with varyings
    if (fragFunc.params.length > 0) {
      const pName = fragFunc.params[0].name;
      fBody = fBody.replace(new RegExp(`\\b${pName}\\.uv\\b`, 'g'), 'v_uv');
      fBody = fBody.replace(new RegExp(`\\b${pName}\\.texcoord\\b`, 'g'), 'v_uv');
      fBody = fBody.replace(new RegExp(`\\b${pName}\\.color\\b`, 'g'), 'v_color');
      fBody = fBody.replace(new RegExp(`\\b${pName}\\.normalWS\\b`, 'g'), 'v_worldNormal');
      fBody = fBody.replace(new RegExp(`\\b${pName}\\.viewDirWS\\b`, 'g'), 'normalize(cc_cameraPos.xyz - v_worldPos)');
      fBody = fBody.replace(new RegExp(`\\b${pName}\\.screenPos\\b`, 'g'), 'v_screenPos');
      fBody = fBody.replace(new RegExp(`\\b${pName}\\.positionWS\\b`, 'g'), 'v_worldPos');
    }

    // Remap texture names to Cocos names
    for (const s of samplers) {
      if (s.originalName && s.originalName !== s.name) {
        fBody = fBody.replace(new RegExp(`\\b${s.originalName}\\b`, 'g'), s.name);
      }
    }

    // Wrap returns
    fBody = fBody.replace(/\breturn\s+fixed4\s*\(/g, 'return vec4(');
    fBody = fBody.replace(/\breturn\s+half4\s*\(/g, 'return vec4(');

    fsLines.push('    ' + fBody.trim().split('\n').map(l => l.trimEnd()).join('\n    '));
  } else {
    // Default fragment fallback based on properties and family
    const hasTexture = samplers.length > 0;
    const texName = hasTexture ? samplers[0].name : '';
    const colorProp = docIR.properties.find(p => p.type === 'Color');
    const colorName = colorProp ? (colorProp.cocosName || colorProp.name) : 'baseColor';

    if (hasTexture) {
      fsLines.push(`    vec4 col = texture(${texName}, v_uv);`);
      if (colorProp) {
        fsLines.push(`    col *= ${colorName};`);
      }
      fsLines.push('    return col;');
    } else if (colorProp) {
      fsLines.push(`    return ${colorName};`);
    } else {
      fsLines.push('    return vec4(1.0, 1.0, 1.0, 1.0);');
    }
  }

  fsLines.push('  }');
  fsLines.push('}%');

  return {
    vsCode: vsLines.join('\n'),
    fsCode: fsLines.join('\n'),
    ubo,
  };
}

/**
 * Emits full .effect source code from ShaderDocumentIR
 */
function emitCocosEffect(docIR, options = {}) {
  if (options.mode === 'surface-pbr') {
    return emitSurfaceShaderEffect(docIR, docIR.subShaders[0]?.passes[0] || { renderState: {} }, options);
  }

  const subShader = docIR.subShaders[0] || { passes: [{ renderState: {}, program: {} }] };
  const pass = subShader.passes[0] || { renderState: {}, program: {} };

  const { vsCode, fsCode, ubo } = generateCocosPrograms(docIR, pass, options);
  const yaml = buildCceffectYaml(docIR, pass, ubo, options);

  return `${yaml}\n\n${vsCode}\n\n${fsCode}\n`;
}

/**
 * Emits Cocos Material (.mtl) scaffold matching the effect
 */
function emitCocosMaterial(docIR, effectRelativePath) {
  const mtl = {
    __type__: 'cc.Material',
    _name: docIR.shaderName.replace(/[\/\\]/g, '_'),
    _objFlags: 0,
    _native: '',
    _effectAsset: {
      __uuid__: effectRelativePath,
    },
    _techIdx: 0,
    _defines: [{}],
    _states: [{}],
    _props: [{}],
  };

  const propsObj = {};
  for (const prop of docIR.properties) {
    const pName = prop.cocosName || prop.name;
    if (prop.type === 'Color' || prop.type === 'Vector') {
      propsObj[pName] = {
        __type__: 'cc.Color',
        r: Math.round((prop.defaultValue[0] || 0) * 255),
        g: Math.round((prop.defaultValue[1] || 0) * 255),
        b: Math.round((prop.defaultValue[2] || 0) * 255),
        a: Math.round((prop.defaultValue[3] || 1) * 255),
      };
    } else if (prop.type === 'Float' || prop.type === 'Range' || prop.type === 'Int') {
      propsObj[pName] = prop.defaultValue;
    }
  }

  mtl._props = [propsObj];
  return JSON.stringify(mtl, null, 2);
}

module.exports = {
  buildCceffectYaml,
  generateCocosPrograms,
  emitCocosEffect,
  emitSurfaceShaderEffect,
  emitCocosMaterial,
  GLSL_SIMPLE_LIGHTING_SNIPPET,
  GLSL_NORMAL_UNPACK_SNIPPET,
};
