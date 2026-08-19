'use strict';

/**
 * Unity ShaderGraph (.shadergraph) Parser & Transpiler for Cocos Creator 3.8.8
 * 
 * Supports both modern Unity ShaderGraph (Context/Block format) and classic ShaderGraph (MasterNode format).
 * Translates ShaderGraph nodes, inputs, math, noise, procedural, artistic, and UV operations
 * into robust Cocos GLSL 300 ES shader code with std140 UBO layout support.
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// Built-in GLSL Procedural & Math Helper Functions for ShaderGraph Runtime
// ============================================================================

const GLSL_SHADERGRAPH_PRELUDE = `
// --- Unity ShaderGraph GLSL Standard Library ---

float unity_mod(float x, float y) {
  return x - y * floor(x / y);
}

vec2 unity_mod(vec2 x, vec2 y) {
  return x - y * floor(x / y);
}

vec3 unity_mod(vec3 x, vec3 y) {
  return x - y * floor(x / y);
}

vec4 unity_mod(vec4 x, vec4 y) {
  return x - y * floor(x / y);
}

// Simple / Value Noise
float unity_noise_randomValue(vec2 uv) {
  return fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
}

float unity_noise_interpolate(float a, float b, float t) {
  return (1.0 - cos(t * 3.14159265)) * 0.5 * (b - a) + a;
}

float unity_simple_noise(vec2 uv, float scale) {
  float s = max(scale, 0.0001);
  vec2 p = uv * s;
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float c0 = unity_noise_randomValue(i + vec2(0.0, 0.0));
  float c1 = unity_noise_randomValue(i + vec2(1.0, 0.0));
  float c2 = unity_noise_randomValue(i + vec2(0.0, 1.0));
  float c3 = unity_noise_randomValue(i + vec2(1.0, 1.0));
  float bottom = mix(c0, c1, f.x);
  float top = mix(c2, c3, f.x);
  return mix(bottom, top, f.y);
}

// Gradient Noise (Perlin)
vec2 unity_gradient_noise_dir(vec2 p) {
  p = unity_mod(p, vec2(289.0));
  float x = unity_mod((34.0 * p.x + 1.0) * p.x, 289.0) + p.y;
  x = unity_mod((34.0 * x + 1.0) * x, 289.0);
  x = fract(x / 41.0) * 2.0 - 1.0;
  return normalize(vec2(x - floor(x + 0.5), abs(x) - 0.5));
}

float unity_gradient_noise(vec2 uv, float scale) {
  float s = max(scale, 0.0001);
  vec2 p = uv * s;
  vec2 ip = floor(p);
  vec2 fp = fract(p);
  float d00 = dot(unity_gradient_noise_dir(ip), fp);
  float d01 = dot(unity_gradient_noise_dir(ip + vec2(0.0, 1.0)), fp - vec2(0.0, 1.0));
  float d10 = dot(unity_gradient_noise_dir(ip + vec2(1.0, 0.0)), fp - vec2(1.0, 0.0));
  float d11 = dot(unity_gradient_noise_dir(ip + vec2(1.0, 1.0)), fp - vec2(1.0, 1.0));
  fp = fp * fp * fp * (fp * (fp * 6.0 - 15.0) + 10.0);
  return mix(mix(d00, d10, fp.x), mix(d01, d11, fp.x), fp.y) + 0.5;
}

// Voronoi (Worley) Noise
vec2 unity_voronoi_randomVector(vec2 uv, vec2 offset) {
  mat2 m = mat2(15.27, 47.63, 99.41, 89.98);
  vec2 p = fract(sin(m * uv) * 46839.32);
  return vec2(sin(p.y * offset.x) * 0.5 + 0.5, cos(p.x * offset.y) * 0.5 + 0.5);
}

void unity_voronoi(vec2 uv, float angleOffset, float cellDensity, out float outVal, out float cells) {
  vec2 g = floor(uv * cellDensity);
  vec2 f = fract(uv * cellDensity);
  float res = 8.0;
  float cellId = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 lattice = vec2(float(x), float(y));
      vec2 offset = unity_voronoi_randomVector(lattice + g, vec2(angleOffset, angleOffset));
      vec2 v = lattice + offset - f;
      float d = dot(v, v);
      if (d < res) {
        res = d;
        cellId = offset.x;
      }
    }
  }
  outVal = sqrt(res);
  cells = cellId;
}

// UV Transformations
vec2 unity_tiling_offset(vec2 uv, vec2 tiling, vec2 offset) {
  return uv * tiling + offset;
}

vec2 unity_rotate_uv(vec2 uv, vec2 center, float rotation) {
  float r = rotation * (3.14159265 / 180.0);
  vec2 p = uv - center;
  float s = sin(r);
  float c = cos(r);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y) + center;
}

vec2 unity_polar_coordinates(vec2 uv, vec2 center, float radialScale, float lengthScale) {
  vec2 delta = uv - center;
  float radius = length(delta) * 2.0 * radialScale;
  float angle = atan(delta.x, delta.y) * 0.159154943 * lengthScale + 0.5;
  return vec2(radius, angle);
}

vec2 unity_twirl(vec2 uv, vec2 center, float strength, vec2 offset) {
  vec2 delta = uv - center;
  float angle = strength * length(delta);
  float s = sin(angle);
  float c = cos(angle);
  return vec2(c * delta.x - s * delta.y, s * delta.x + c * delta.y) + center + offset;
}

vec2 unity_spherize(vec2 uv, vec2 center, float strength, vec2 offset) {
  vec2 delta = uv - center;
  float d = dot(delta, delta);
  float d1 = sqrt(d);
  float d2 = pow(d1, strength);
  return delta * (d2 / max(d1, 0.0001)) + center + offset;
}

vec2 unity_flipbook(vec2 uv, float width, float height, float tile, vec2 invert) {
  float tileCount = max(width * height, 1.0);
  float currentTile = floor(mod(tile, tileCount));
  vec2 tileSize = vec2(1.0 / max(width, 1.0), 1.0 / max(height, 1.0));
  float row = floor(currentTile / max(width, 1.0));
  float col = floor(mod(currentTile, max(width, 1.0)));
  if (invert.y > 0.5) row = height - 1.0 - row;
  if (invert.x > 0.5) col = width - 1.0 - col;
  return (uv + vec2(col, row)) * tileSize;
}

// Color & Artistic Helpers
vec3 unity_fresnel(vec3 normal, vec3 viewDir, float power) {
  float f = 1.0 - max(0.0, dot(normalize(normal), normalize(viewDir)));
  return vec3(pow(f, max(power, 0.0001)));
}

vec3 unity_blend_burn(vec3 base, vec3 blend, float opacity) {
  vec3 res = 1.0 - (1.0 - base) / max(blend, vec3(0.0001));
  return mix(base, clamp(res, 0.0, 1.0), opacity);
}

vec3 unity_blend_dodge(vec3 base, vec3 blend, float opacity) {
  vec3 res = base / max(1.0 - blend, vec3(0.0001));
  return mix(base, clamp(res, 0.0, 1.0), opacity);
}

vec3 unity_blend_overlay(vec3 base, vec3 blend, float opacity) {
  vec3 res = mix(2.0 * base * blend, 1.0 - 2.0 * (1.0 - base) * (1.0 - blend), step(vec3(0.5), base));
  return mix(base, res, opacity);
}

vec3 unity_blend_hard_light(vec3 base, vec3 blend, float opacity) {
  vec3 res = mix(2.0 * base * blend, 1.0 - 2.0 * (1.0 - base) * (1.0 - blend), step(vec3(0.5), blend));
  return mix(base, res, opacity);
}

vec3 unity_blend_soft_light(vec3 base, vec3 blend, float opacity) {
  vec3 res = mix(
    2.0 * base * blend + base * base * (1.0 - 2.0 * blend),
    sqrt(max(base, vec3(0.0))) * (2.0 * blend - 1.0) + 2.0 * base * (1.0 - blend),
    step(vec3(0.5), blend)
  );
  return mix(base, res, opacity);
}

vec3 unity_blend_linear_light(vec3 base, vec3 blend, float opacity) {
  vec3 res = clamp(base + 2.0 * blend - 1.0, 0.0, 1.0);
  return mix(base, res, opacity);
}

vec3 unity_blend_vivid_light(vec3 base, vec3 blend, float opacity) {
  vec3 burn = 1.0 - (1.0 - base) / max(2.0 * blend, vec3(0.0001));
  vec3 dodge = base / max(1.0 - 2.0 * (blend - 0.5), vec3(0.0001));
  vec3 res = mix(burn, dodge, step(vec3(0.5), blend));
  return mix(base, clamp(res, 0.0, 1.0), opacity);
}

vec3 unity_blend_pin_light(vec3 base, vec3 blend, float opacity) {
  vec3 res = mix(min(base, 2.0 * blend), max(base, 2.0 * (blend - 0.5)), step(vec3(0.5), blend));
  return mix(base, res, opacity);
}

vec3 unity_blend_screen(vec3 base, vec3 blend, float opacity) {
  vec3 res = 1.0 - (1.0 - base) * (1.0 - blend);
  return mix(base, res, opacity);
}

vec3 unity_contrast(vec3 In, float Contrast) {
  return max(vec3(0.0), (In - 0.5) * Contrast + 0.5);
}

vec3 unity_hue_saturation(vec3 In, float Hue, float Saturation) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(In.bg, K.wz), vec4(In.gb, K.xy), step(In.b, In.g));
  vec4 q = mix(vec4(p.xyw, In.r), vec4(In.r, p.yzx), step(p.x, In.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  vec3 hsv = vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  hsv.x = fract(hsv.x + Hue);
  hsv.y = clamp(hsv.y * Saturation, 0.0, 1.0);
  vec4 K2 = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p2 = abs(fract(hsv.xxx + K2.xyz) * 6.0 - K2.www);
  return hsv.z * mix(K2.xxx, clamp(p2 - K2.xxx, 0.0, 1.0), hsv.y);
}

vec3 unity_normal_strength(vec3 In, float Strength) {
  return vec3(In.xy * Strength, mix(1.0, In.z, clamp(Strength, 0.0, 1.0)));
}

vec3 unity_normal_blend(vec3 A, vec3 B) {
  return normalize(vec3(A.xy + B.xy, A.z * B.z));
}

float unity_remap(float In, vec2 InMinMax, vec2 OutMinMax) {
  return OutMinMax.x + (In - InMinMax.x) * (OutMinMax.y - OutMinMax.x) / max(InMinMax.y - InMinMax.x, 0.00001);
}

vec2 unity_remap(vec2 In, vec2 InMinMax, vec2 OutMinMax) {
  return OutMinMax.x + (In - InMinMax.x) * (OutMinMax.y - OutMinMax.x) / max(InMinMax.y - InMinMax.x, 0.00001);
}

vec3 unity_remap(vec3 In, vec2 InMinMax, vec2 OutMinMax) {
  return OutMinMax.x + (In - InMinMax.x) * (OutMinMax.y - OutMinMax.x) / max(InMinMax.y - InMinMax.x, 0.00001);
}

vec4 unity_remap(vec4 In, vec2 InMinMax, vec2 OutMinMax) {
  return OutMinMax.x + (In - InMinMax.x) * (OutMinMax.y - OutMinMax.x) / max(InMinMax.y - InMinMax.x, 0.00001);
}

float unity_inverse_lerp(float A, float B, float T) {
  return (T - A) / max(B - A, 0.00001);
}
`;

// ============================================================================
// ShaderGraph JSON Parser & Node Transpiler
// ============================================================================

class ShaderGraphParser {
  constructor(jsonContent, options = {}) {
    this.raw = typeof jsonContent === 'string' ? JSON.parse(jsonContent) : jsonContent;
    this.options = options;
    this.properties = [];
    this.nodes = new Map();
    this.edges = [];
    this.targetShadingModel = 'unlit'; // 'unlit' | 'lit' | 'custom'
    this.hasAlphaClip = false;
    this.isTransparent = false;
    this.cullMode = 'back';
    this.errors = [];
    this.warnings = [];

    /**
     * Khác với đường ShaderLab/HLSL (chỉ sinh template), parser này dịch THẬT
     * đồ thị node sang GLSL: mỗi node được emit thành biểu thức `_sg_*` và
     * các hàm chuẩn (unity_simple_noise, unity_voronoi, ...) được nhúng kèm.
     * Vì vậy thân shader là kết quả dịch, không phải template.
     */
    this.bodyTranspiled = true;

    this._parse();
  }

  _parse() {
    this._parseProperties();
    this._parseNodes();
    this._parseEdges();
    this._detectShadingModelAndStates();
  }

  _parseProperties() {
    const rawProps = this.raw.m_Properties || [];
    for (const prop of rawProps) {
      const typeStr = prop.m_Type || prop.__type || '';
      const name = prop.m_Name || prop.m_ReferenceName || `prop_${this.properties.length}`;
      const refName = prop.m_OverrideReferenceName || prop.m_ReferenceName || name;
      const displayName = prop.m_DisplayName || prop.m_Name || refName;
      const id = prop.m_ObjectId || prop.m_Guid || prop.m_Id || refName;

      let kind = 'float';
      let defaultValue = 0;

      if (typeStr.includes('Color')) {
        kind = 'color';
        const val = prop.m_Value || prop.m_DefaultValue || { r: 1, g: 1, b: 1, a: 1 };
        defaultValue = [val.r ?? 1, val.g ?? 1, val.b ?? 1, val.a ?? 1];
      } else if (typeStr.includes('Vector4')) {
        kind = 'vector';
        const val = prop.m_Value || prop.m_DefaultValue || { x: 0, y: 0, z: 0, w: 0 };
        defaultValue = [val.x ?? 0, val.y ?? 0, val.z ?? 0, val.w ?? 0];
      } else if (typeStr.includes('Vector3')) {
        kind = 'vec3';
        const val = prop.m_Value || prop.m_DefaultValue || { x: 0, y: 0, z: 0 };
        defaultValue = [val.x ?? 0, val.y ?? 0, val.z ?? 0];
      } else if (typeStr.includes('Vector2')) {
        kind = 'vec2';
        const val = prop.m_Value || prop.m_DefaultValue || { x: 0, y: 0 };
        defaultValue = [val.x ?? 0, val.y ?? 0];
      } else if (typeStr.includes('Texture2D')) {
        kind = 'texture';
        defaultValue = 'white';
      } else if (typeStr.includes('Cubemap') || typeStr.includes('TextureCube')) {
        kind = 'cubemap';
        defaultValue = 'default-cube-texture';
      } else if (typeStr.includes('Boolean')) {
        kind = 'float';
        defaultValue = (prop.m_Value || prop.m_DefaultValue) ? 1.0 : 0.0;
      } else {
        kind = 'float';
        defaultValue = Number(prop.m_Value ?? prop.m_DefaultValue ?? 0);
      }

      this.properties.push({
        id,
        name: refName.replace(/^_+/, ''),
        rawName: refName,
        displayName,
        kind,
        defaultValue,
        propertyObj: prop,
      });
    }
  }

  _parseNodes() {
    const rawNodes = this.raw.m_Nodes || [];
    for (const node of rawNodes) {
      const id = node.m_ObjectId || node.m_Guid || node.m_Id;
      if (!id) continue;
      this.nodes.set(id, node);
    }
  }

  _parseEdges() {
    const rawEdges = this.raw.m_Edges || [];
    for (const edge of rawEdges) {
      const fromNodeId = edge.m_OutputSlot?.m_Node?.m_Id || edge.m_OutputSlot?.node?.m_Id || edge.fromNode;
      const fromSlotId = edge.m_OutputSlot?.m_SlotId ?? edge.fromSlot ?? 0;
      const toNodeId = edge.m_InputSlot?.m_Node?.m_Id || edge.m_InputSlot?.node?.m_Id || edge.toNode;
      const toSlotId = edge.m_InputSlot?.m_SlotId ?? edge.toSlot ?? 0;

      if (fromNodeId && toNodeId) {
        this.edges.push({
          fromNodeId,
          fromSlotId,
          toNodeId,
          toSlotId,
        });
      }
    }
  }

  _detectShadingModelAndStates() {
    for (const [id, node] of this.nodes) {
      const typeStr = String(node.m_Type || node.__type || '');
      const name = String(node.m_Name || '');

      if (typeStr.includes('PBRMasterNode') || typeStr.includes('Lit') || name.includes('Lit Master') || name.includes('SurfaceDescription.BaseColor')) {
        this.targetShadingModel = 'lit';
      }
      if (typeStr.includes('UnlitMasterNode') || name.includes('Unlit Master')) {
        this.targetShadingModel = 'unlit';
      }
      if (name.includes('AlphaClip') || name.includes('Alpha Clip') || typeStr.includes('AlphaClip')) {
        this.hasAlphaClip = true;
      }
      if (node.m_SurfaceType === 1 || node.m_SurfaceType === 'Transparent' || node.m_BlendMode !== 0) {
        this.isTransparent = true;
      }
    }
  }

  /**
   * Generates Cocos Creator 3.8.8 CCEffect shader code from the parsed ShaderGraph.
   */
  generateCocosEffect(effectName = 'CustomShaderGraph') {
    const props = this._formatUniformProperties();
    const { packStd140Uniforms } = require('./ubo-alignment-formatter');
    const packedUbo = packStd140Uniforms(props, `${effectName}Params`);

    const fragmentCode = this._transpileGraphToGLSL();

    const isLit = this.targetShadingModel === 'lit';
    const isTransparent = this.isTransparent;

    const techniquesYaml = this._generateTechniquesYaml(effectName, packedUbo.propertyYaml, isLit, isTransparent);
    const vertexShaderCode = this._generateVertexShader(effectName, isLit);
    const fragmentShaderCode = this._generateFragmentShader(effectName, packedUbo, fragmentCode, isLit);

    return `// Auto-generated by Unity ShaderGraph to Cocos Creator Transpiler
// Target: Cocos Creator 3.8.8+ (GLSL 300 ES, std140 UBO layout compliant)

${techniquesYaml}

${vertexShaderCode}

${fragmentShaderCode}
`;
  }

  _formatUniformProperties() {
    const list = [];
    for (const prop of this.properties) {
      if (prop.kind === 'texture' || prop.kind === 'cubemap') {
        list.push({
          name: prop.name,
          type: prop.kind === 'cubemap' ? 'samplerCube' : 'sampler2D',
          defaultValue: prop.defaultValue,
          displayName: prop.displayName,
        });
      } else if (prop.kind === 'color') {
        list.push({
          name: prop.name,
          type: 'vec4',
          defaultValue: prop.defaultValue,
          displayName: prop.displayName,
        });
      } else if (prop.kind === 'vector') {
        list.push({
          name: prop.name,
          type: 'vec4',
          defaultValue: prop.defaultValue,
          displayName: prop.displayName,
        });
      } else if (prop.kind === 'vec3') {
        list.push({
          name: prop.name,
          type: 'vec3',
          defaultValue: prop.defaultValue,
          displayName: prop.displayName,
        });
      } else if (prop.kind === 'vec2') {
        list.push({
          name: prop.name,
          type: 'vec2',
          defaultValue: prop.defaultValue,
          displayName: prop.displayName,
        });
      } else {
        list.push({
          name: prop.name,
          type: 'float',
          defaultValue: prop.defaultValue,
          displayName: prop.displayName,
        });
      }
    }

    if (!list.some((p) => p.name === 'mainColor' || p.name === 'baseColor')) {
      list.push({ name: 'baseColor', type: 'vec4', defaultValue: [1, 1, 1, 1], displayName: 'Base Color' });
    }
    return list;
  }

  _generateTechniquesYaml(effectName, propertyYaml, isLit, isTransparent) {
    return `CCEffect %{
  techniques:
  - name: ${isTransparent ? 'transparent' : 'opaque'}
    passes:
    - vert: ${effectName}-vs:vert
      frag: ${effectName}-fs:frag
      rasterizerState:
        cullMode: ${this.cullMode}
      depthStencilState:
        depthTest: true
        depthWrite: ${isTransparent ? 'false' : 'true'}
${isTransparent ? `      blendState:
        targets:
        - blend: true
          blendSrc: src_alpha
          blendDst: one_minus_src_alpha
          blendSrcAlpha: one
          blendDstAlpha: one_minus_src_alpha` : ''}
      properties: &props
${propertyYaml}
}%`;
  }

  _generateVertexShader(effectName, isLit) {
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

  _generateFragmentShader(effectName, packedUbo, fragmentCode, isLit) {
    const samplers = this.properties
      .filter((p) => p.kind === 'texture' || p.kind === 'cubemap')
      .map((p) => `  uniform ${p.kind === 'cubemap' ? 'samplerCube' : 'sampler2D'} ${p.name};`)
      .join('\n');

    return `CCProgram ${effectName}-fs %{
  precision highp float;
  #include <builtin/uniforms/cc-global>
  #include <legacy/output-standard>
  #include <common/color/gamma>
  #if CC_RECEIVE_SHADOW
    #include <legacy/shadow-map-fs>
  #endif

${GLSL_SHADERGRAPH_PRELUDE}

${samplers}

${packedUbo.uboGlsl}

  in highp vec3 v_worldPosition;
  in mediump vec3 v_worldNormal;
  in vec2 v_uv;
  in vec4 v_color;
  #if CC_RECEIVE_SHADOW
    in mediump vec2 v_shadowBias;
  #endif

${isLit ? `  float shadowFactor (vec3 normal) {
    float shadow = 1.0;
    #if CC_RECEIVE_SHADOW && CC_SHADOW_TYPE == CC_SHADOW_MAP
      if (cc_mainLitDir.w > 0.0) {
        #if CC_DIR_LIGHT_SHADOW_TYPE == CC_DIR_LIGHT_SHADOW_CASCADED
          shadow = CCCSMFactorBase(v_worldPosition, normal, v_shadowBias);
        #endif
        #if CC_DIR_LIGHT_SHADOW_TYPE == CC_DIR_LIGHT_SHADOW_UNIFORM
          shadow = CCShadowFactorBase(CC_SHADOW_POSITION, normal, v_shadowBias);
        #endif
      }
    #endif
    return shadow;
  }

  float distributionGGX (float noH, float roughness) {
    float a = max(roughness * roughness, 0.002);
    float a2 = a * a;
    float d = noH * noH * (a2 - 1.0) + 1.0;
    return a2 / max(3.14159265 * d * d, 0.0001);
  }

  float geometrySmith (float noL, float noV, float roughness) {
    float k = roughness + 1.0;
    k = k * k * 0.125;
    return noL / mix(noL, 1.0, k) * noV / mix(noV, 1.0, k);
  }` : ''}

  vec4 frag () {
${packedUbo.aliasesGlsl}
    vec2 uv = v_uv;
    vec3 worldNormal = normalize(v_worldNormal);
    vec3 worldPosition = v_worldPosition;
    vec3 viewDir = normalize(cc_cameraPos.xyz - worldPosition);
    vec4 vertexColor = v_color;

${fragmentCode}
  }
}%`;
  }

  /**
   * Topologically traverses node connections and produces evaluated GLSL statements.
   */
  _transpileGraphToGLSL() {
    const codeLines = [];
    const evaluatedNodes = new Map();
    let varCounter = 0;

    const getVarName = (prefix = 'node') => `_sg_${prefix}_${varCounter++}`;

    const getInputExpr = (toNodeId, toSlotId, defaultVal = '0.0') => {
      const edge = this.edges.find((e) => e.toNodeId === toNodeId && e.toSlotId === toSlotId);
      if (!edge) return defaultVal;
      const key = `${edge.fromNodeId}_${edge.fromSlotId}`;
      if (evaluatedNodes.has(key)) {
        return evaluatedNodes.get(key);
      }
      return defaultVal;
    };

    const visited = new Set();
    const orderedNodeIds = [];

    const visit = (nodeId) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      const incomingEdges = this.edges.filter((e) => e.toNodeId === nodeId);
      for (const edge of incomingEdges) {
        visit(edge.fromNodeId);
      }
      orderedNodeIds.push(nodeId);
    };

    for (const [nodeId] of this.nodes) {
      visit(nodeId);
    }

    for (const nodeId of orderedNodeIds) {
      const node = this.nodes.get(nodeId);
      if (!node) continue;
      const typeStr = String(node.m_Type || node.__type || '');
      const name = String(node.m_Name || '');

      // 1. Property Node
      if (typeStr.includes('PropertyNode')) {
        const propId = node.m_Property?.m_Id || node.m_PropertyGuid || node.m_Id;
        const matchedProp = this.properties.find((p) => p.id === propId || p.rawName === propId);
        const outSlotId = node.m_Slots?.[0]?.m_Id ?? 0;
        const propVar = matchedProp ? matchedProp.name : 'vec4(1.0)';
        evaluatedNodes.set(`${nodeId}_${outSlotId}`, propVar);
        continue;
      }

      // 2. UV Node
      if (typeStr.includes('UVNode') || name === 'UV') {
        const outVar = getVarName('uv');
        codeLines.push(`    vec2 ${outVar} = uv;`);
        evaluatedNodes.set(`${nodeId}_0`, outVar);
        continue;
      }

      // 3. Time Node
      if (typeStr.includes('TimeNode') || name === 'Time') {
        const outVar = getVarName('time');
        codeLines.push(`    float ${outVar}_t = cc_time.x;`);
        codeLines.push(`    float ${outVar}_sin = sin(cc_time.x);`);
        codeLines.push(`    float ${outVar}_cos = cos(cc_time.x);`);
        evaluatedNodes.set(`${nodeId}_0`, `${outVar}_t`);
        evaluatedNodes.set(`${nodeId}_1`, `${outVar}_sin`);
        evaluatedNodes.set(`${nodeId}_2`, `${outVar}_cos`);
        evaluatedNodes.set(`${nodeId}_3`, `(cc_time.x * 2.0)`);
        continue;
      }

      // 4. SampleTexture2DNode
      if (typeStr.includes('SampleTexture2DNode') || name === 'Sample Texture 2D') {
        const texExpr = getInputExpr(nodeId, 0, 'mainTexture');
        const uvExpr = getInputExpr(nodeId, 1, 'uv');
        const outVar = getVarName('texColor');
        codeLines.push(`    vec4 ${outVar} = texture(${texExpr}, ${uvExpr});`);
        evaluatedNodes.set(`${nodeId}_4`, `${outVar}.rgba`);
        evaluatedNodes.set(`${nodeId}_5`, `${outVar}.r`);
        evaluatedNodes.set(`${nodeId}_6`, `${outVar}.g`);
        evaluatedNodes.set(`${nodeId}_7`, `${outVar}.b`);
        evaluatedNodes.set(`${nodeId}_8`, `${outVar}.a`);
        continue;
      }

      // 5. TilingAndOffsetNode
      if (typeStr.includes('TilingAndOffsetNode') || name === 'Tiling And Offset') {
        const inUv = getInputExpr(nodeId, 0, 'uv');
        const tiling = getInputExpr(nodeId, 1, 'vec2(1.0, 1.0)');
        const offset = getInputExpr(nodeId, 2, 'vec2(0.0, 0.0)');
        const outVar = getVarName('tilingOffset');
        codeLines.push(`    vec2 ${outVar} = unity_tiling_offset(${inUv}, ${tiling}, ${offset});`);
        evaluatedNodes.set(`${nodeId}_3`, outVar);
        continue;
      }

      // 6. SimpleNoiseNode
      if (typeStr.includes('SimpleNoiseNode') || name === 'Simple Noise') {
        const inUv = getInputExpr(nodeId, 0, 'uv');
        const scale = getInputExpr(nodeId, 1, '10.0');
        const outVar = getVarName('noise');
        codeLines.push(`    float ${outVar} = unity_simple_noise(${inUv}, ${scale});`);
        evaluatedNodes.set(`${nodeId}_2`, outVar);
        continue;
      }

      // 7. VoronoiNode
      if (typeStr.includes('VoronoiNode') || name === 'Voronoi') {
        const inUv = getInputExpr(nodeId, 0, 'uv');
        const angle = getInputExpr(nodeId, 1, '2.0');
        const density = getInputExpr(nodeId, 2, '5.0');
        const outVar = getVarName('voronoi');
        codeLines.push(`    float ${outVar};`);
        codeLines.push(`    float ${outVar}_cells;`);
        codeLines.push(`    unity_voronoi(${inUv}, ${angle}, ${density}, ${outVar}, ${outVar}_cells);`);
        evaluatedNodes.set(`${nodeId}_3`, outVar);
        evaluatedNodes.set(`${nodeId}_4`, `${outVar}_cells`);
        continue;
      }

      // 8. FresnelNode
      if (typeStr.includes('FresnelNode') || name === 'Fresnel Effect') {
        const inNormal = getInputExpr(nodeId, 0, 'worldNormal');
        const inViewDir = getInputExpr(nodeId, 1, 'viewDir');
        const inPower = getInputExpr(nodeId, 2, '5.0');
        const outVar = getVarName('fresnel');
        codeLines.push(`    vec3 ${outVar} = unity_fresnel(${inNormal}, ${inViewDir}, ${inPower});`);
        evaluatedNodes.set(`${nodeId}_3`, `${outVar}.x`);
        continue;
      }

      // 9. Standard Math Binary Nodes
      if (typeStr.includes('MultiplyNode') || name === 'Multiply') {
        const a = getInputExpr(nodeId, 0, '1.0');
        const b = getInputExpr(nodeId, 1, '1.0');
        const outVar = getVarName('mul');
        codeLines.push(`    vec4 ${outVar} = vec4(${a}) * vec4(${b});`);
        evaluatedNodes.set(`${nodeId}_2`, outVar);
        continue;
      }
      if (typeStr.includes('AddNode') || name === 'Add') {
        const a = getInputExpr(nodeId, 0, '0.0');
        const b = getInputExpr(nodeId, 1, '0.0');
        const outVar = getVarName('add');
        codeLines.push(`    vec4 ${outVar} = vec4(${a}) + vec4(${b});`);
        evaluatedNodes.set(`${nodeId}_2`, outVar);
        continue;
      }
      if (typeStr.includes('SubtractNode') || name === 'Subtract') {
        const a = getInputExpr(nodeId, 0, '0.0');
        const b = getInputExpr(nodeId, 1, '0.0');
        const outVar = getVarName('sub');
        codeLines.push(`    vec4 ${outVar} = vec4(${a}) - vec4(${b});`);
        evaluatedNodes.set(`${nodeId}_2`, outVar);
        continue;
      }
      if (typeStr.includes('LerpNode') || name === 'Lerp') {
        const a = getInputExpr(nodeId, 0, '0.0');
        const b = getInputExpr(nodeId, 1, '1.0');
        const t = getInputExpr(nodeId, 2, '0.5');
        const outVar = getVarName('lerp');
        codeLines.push(`    vec4 ${outVar} = mix(vec4(${a}), vec4(${b}), float(${t}));`);
        evaluatedNodes.set(`${nodeId}_3`, outVar);
        continue;
      }
      if (typeStr.includes('OneMinusNode') || name === 'One Minus') {
        const a = getInputExpr(nodeId, 0, '0.0');
        const outVar = getVarName('oneMinus');
        codeLines.push(`    vec4 ${outVar} = 1.0 - vec4(${a});`);
        evaluatedNodes.set(`${nodeId}_1`, outVar);
        continue;
      }
      if (typeStr.includes('RemapNode') || name === 'Remap') {
        const inVal = getInputExpr(nodeId, 0, '0.0');
        const inMinMax = getInputExpr(nodeId, 1, 'vec2(-1.0, 1.0)');
        const outMinMax = getInputExpr(nodeId, 2, 'vec2(0.0, 1.0)');
        const outVar = getVarName('remap');
        codeLines.push(`    float ${outVar} = unity_remap(float(${inVal}), ${inMinMax}, ${outMinMax});`);
        evaluatedNodes.set(`${nodeId}_3`, outVar);
        continue;
      }
      if (typeStr.includes('StepNode') || name === 'Step') {
        const edge = getInputExpr(nodeId, 0, '0.5');
        const inVal = getInputExpr(nodeId, 1, '0.0');
        const outVar = getVarName('step');
        codeLines.push(`    float ${outVar} = step(float(${edge}), float(${inVal}));`);
        evaluatedNodes.set(`${nodeId}_2`, outVar);
        continue;
      }
      if (typeStr.includes('SmoothstepNode') || name === 'Smoothstep') {
        const edge1 = getInputExpr(nodeId, 0, '0.0');
        const edge2 = getInputExpr(nodeId, 1, '1.0');
        const inVal = getInputExpr(nodeId, 2, '0.5');
        const outVar = getVarName('smoothstep');
        codeLines.push(`    float ${outVar} = smoothstep(float(${edge1}), float(${edge2}), float(${inVal}));`);
        evaluatedNodes.set(`${nodeId}_3`, outVar);
        continue;
      }
      if (typeStr.includes('SaturateNode') || name === 'Saturate') {
        const inVal = getInputExpr(nodeId, 0, '0.0');
        const outVar = getVarName('sat');
        codeLines.push(`    vec4 ${outVar} = clamp(vec4(${inVal}), 0.0, 1.0);`);
        evaluatedNodes.set(`${nodeId}_1`, outVar);
        continue;
      }
      if (typeStr.includes('ClampNode') || name === 'Clamp') {
        const inVal = getInputExpr(nodeId, 0, '0.0');
        const minVal = getInputExpr(nodeId, 1, '0.0');
        const maxVal = getInputExpr(nodeId, 2, '1.0');
        const outVar = getVarName('clamp');
        codeLines.push(`    vec4 ${outVar} = clamp(vec4(${inVal}), vec4(${minVal}), vec4(${maxVal}));`);
        evaluatedNodes.set(`${nodeId}_3`, outVar);
        continue;
      }

      // 10. Blend Node
      if (typeStr.includes('BlendNode') || name === 'Blend') {
        const base = getInputExpr(nodeId, 0, 'vec3(0.0)');
        const blend = getInputExpr(nodeId, 1, 'vec3(1.0)');
        const opacity = getInputExpr(nodeId, 2, '1.0');
        const blendMode = node.m_BlendMode || 'Multiply';
        const outVar = getVarName('blend');
        if (blendMode === 'Burn' || blendMode === 0) {
          codeLines.push(`    vec3 ${outVar} = unity_blend_burn(vec3(${base}), vec3(${blend}), float(${opacity}));`);
        } else if (blendMode === 'Dodge' || blendMode === 3) {
          codeLines.push(`    vec3 ${outVar} = unity_blend_dodge(vec3(${base}), vec3(${blend}), float(${opacity}));`);
        } else if (blendMode === 'Overlay' || blendMode === 5) {
          codeLines.push(`    vec3 ${outVar} = unity_blend_overlay(vec3(${base}), vec3(${blend}), float(${opacity}));`);
        } else if (blendMode === 'Screen' || blendMode === 7) {
          codeLines.push(`    vec3 ${outVar} = unity_blend_screen(vec3(${base}), vec3(${blend}), float(${opacity}));`);
        } else {
          codeLines.push(`    vec3 ${outVar} = mix(vec3(${base}), (vec3(${base}) * vec3(${blend})), float(${opacity}));`);
        }
        evaluatedNodes.set(`${nodeId}_3`, outVar);
        continue;
      }

      // 11. Combine / Split Nodes
      if (typeStr.includes('CombineNode') || name === 'Combine') {
        const r = getInputExpr(nodeId, 0, '0.0');
        const g = getInputExpr(nodeId, 1, '0.0');
        const b = getInputExpr(nodeId, 2, '0.0');
        const a = getInputExpr(nodeId, 3, '1.0');
        const outVar = getVarName('combine');
        codeLines.push(`    vec4 ${outVar} = vec4(float(${r}), float(${g}), float(${b}), float(${a}));`);
        evaluatedNodes.set(`${nodeId}_4`, `${outVar}.rgba`);
        evaluatedNodes.set(`${nodeId}_5`, `${outVar}.rgb`);
        evaluatedNodes.set(`${nodeId}_6`, `${outVar}.rg`);
        continue;
      }
      if (typeStr.includes('SplitNode') || name === 'Split') {
        const inVal = getInputExpr(nodeId, 0, 'vec4(1.0)');
        const outVar = getVarName('split');
        codeLines.push(`    vec4 ${outVar} = vec4(${inVal});`);
        evaluatedNodes.set(`${nodeId}_1`, `${outVar}.r`);
        evaluatedNodes.set(`${nodeId}_2`, `${outVar}.g`);
        evaluatedNodes.set(`${nodeId}_3`, `${outVar}.b`);
        evaluatedNodes.set(`${nodeId}_4`, `${outVar}.a`);
        continue;
      }

      // 12. Normal Nodes
      if (typeStr.includes('NormalStrengthNode') || name === 'Normal Strength') {
        const inNorm = getInputExpr(nodeId, 0, 'worldNormal');
        const strength = getInputExpr(nodeId, 1, '1.0');
        const outVar = getVarName('normStr');
        codeLines.push(`    vec3 ${outVar} = unity_normal_strength(vec3(${inNorm}), float(${strength}));`);
        evaluatedNodes.set(`${nodeId}_2`, outVar);
        continue;
      }
      if (typeStr.includes('NormalBlendNode') || name === 'Normal Blend') {
        const normA = getInputExpr(nodeId, 0, 'worldNormal');
        const normB = getInputExpr(nodeId, 1, 'vec3(0.0, 0.0, 1.0)');
        const outVar = getVarName('normBlend');
        codeLines.push(`    vec3 ${outVar} = unity_normal_blend(vec3(${normA}), vec3(${normB}));`);
        evaluatedNodes.set(`${nodeId}_2`, outVar);
        continue;
      }
    }

    // Connect Fragment Master / Output Slots
    let baseColorExpr = 'baseColor';
    let alphaExpr = '1.0';
    let emissionExpr = 'vec3(0.0)';
    let metallicExpr = '0.0';
    let roughnessExpr = '0.5';
    let alphaClipThresholdExpr = '0.5';

    for (const [nodeId, node] of this.nodes) {
      const typeStr = String(node.m_Type || node.__type || '');
      const name = String(node.m_Name || '');

      if (typeStr.includes('PBRMasterNode') || name.includes('Lit Master')) {
        baseColorExpr = getInputExpr(nodeId, 0, baseColorExpr);
        alphaExpr = getInputExpr(nodeId, 7, alphaExpr);
        emissionExpr = getInputExpr(nodeId, 4, emissionExpr);
        metallicExpr = getInputExpr(nodeId, 2, metallicExpr);
        roughnessExpr = `(1.0 - (${getInputExpr(nodeId, 3, '0.5')}))`;
        alphaClipThresholdExpr = getInputExpr(nodeId, 8, alphaClipThresholdExpr);
      } else if (typeStr.includes('UnlitMasterNode') || name.includes('Unlit Master')) {
        baseColorExpr = getInputExpr(nodeId, 0, baseColorExpr);
        alphaExpr = getInputExpr(nodeId, 1, alphaExpr);
        alphaClipThresholdExpr = getInputExpr(nodeId, 2, alphaClipThresholdExpr);
      } else if (name === 'SurfaceDescription.BaseColor' || name === 'Base Color') {
        baseColorExpr = getInputExpr(nodeId, 0, baseColorExpr);
      } else if (name === 'SurfaceDescription.Alpha' || name === 'Alpha') {
        alphaExpr = getInputExpr(nodeId, 0, alphaExpr);
      } else if (name === 'SurfaceDescription.Emission' || name === 'Emission') {
        emissionExpr = getInputExpr(nodeId, 0, emissionExpr);
      } else if (name === 'SurfaceDescription.Metallic' || name === 'Metallic') {
        metallicExpr = getInputExpr(nodeId, 0, metallicExpr);
      } else if (name === 'SurfaceDescription.Smoothness' || name === 'Smoothness') {
        roughnessExpr = `(1.0 - (${getInputExpr(nodeId, 0, '0.5')}))`;
      } else if (name === 'SurfaceDescription.AlphaClipThreshold' || name === 'Alpha Clip Threshold') {
        alphaClipThresholdExpr = getInputExpr(nodeId, 0, alphaClipThresholdExpr);
        this.hasAlphaClip = true;
      }
    }

    if (this.targetShadingModel === 'lit') {
      codeLines.push(`
    vec4 finalBaseColor = vec4(${baseColorExpr});
    finalBaseColor.rgb = SRGBToLinear(finalBaseColor.rgb);
    float finalAlpha = float(${alphaExpr});
    finalBaseColor.a *= finalAlpha;

    #if USE_ALPHA_TEST
      if (finalBaseColor.a < ${alphaClipThresholdExpr}) discard;
    #endif

    vec3 normal = worldNormal;
    vec3 lightDir = normalize(-cc_mainLitDir.xyz);
    vec3 halfDir = normalize(lightDir + viewDir);

    float noL = max(dot(normal, lightDir), 0.0);
    float noV = max(dot(normal, viewDir), 0.0001);
    float noH = max(dot(normal, halfDir), 0.0);
    float voH = max(dot(viewDir, halfDir), 0.0);
    float shadow = shadowFactor(normal);
    vec3 lightColor = cc_mainLitColor.rgb * cc_mainLitColor.w;

    float rough = clamp(float(${roughnessExpr}), 0.04, 1.0);
    float metal = clamp(float(${metallicExpr}), 0.0, 1.0);

    vec3 f0 = mix(vec3(0.04), finalBaseColor.rgb, metal);
    vec3 fresnel = f0 + (vec3(1.0) - f0) * pow(1.0 - voH, 5.0);
    vec3 specular = distributionGGX(noH, rough) * geometrySmith(noL, noV, rough) * fresnel;
    vec3 diffuse = finalBaseColor.rgb * (1.0 - metal) / 3.14159265;
    vec3 direct = (diffuse + specular) * lightColor * noL * shadow;

    float hemisphere = normal.y * 0.5 + 0.5;
    vec3 ambient = mix(cc_ambientGround.rgb, cc_ambientSky.rgb, hemisphere) * cc_ambientSky.w * finalBaseColor.rgb;
    vec3 emissiveVal = vec3(${emissionExpr});

    return CCFragOutput(vec4(direct + ambient + emissiveVal, finalBaseColor.a));
`);
    } else {
      codeLines.push(`
    vec4 finalColor = vec4(${baseColorExpr});
    finalColor.rgb = SRGBToLinear(finalColor.rgb);
    float finalAlpha = float(${alphaExpr});
    finalColor.a *= finalAlpha;

    #if USE_ALPHA_TEST
      if (finalColor.a < ${alphaClipThresholdExpr}) discard;
    #endif

    return CCFragOutput(finalColor);
`);
    }

    return codeLines.join('\n');
  }
}

module.exports = {
  ShaderGraphParser,
  GLSL_SHADERGRAPH_PRELUDE,
};
