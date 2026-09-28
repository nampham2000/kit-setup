// URP / ShaderGraph library shims for Cocos effects generated from Unity ShaderGraph code.
// Single source of truth for tools/shader-compiler/shadergraph (functions are pruned per stage: only what a stage
// reaches is emitted). GLSL ES 1.00 compatible: no arrays constructors, no methods, no uint in ES 1.00 branches.
// Matrix convention: a GLSL matrix value holds the transpose of the HLSL matrix (see sg-glsl-types.cjs).

float sgSaturate (float x) { return clamp(x, 0.0, 1.0); }
vec2 sgSaturate (vec2 x) { return clamp(x, 0.0, 1.0); }
vec3 sgSaturate (vec3 x) { return clamp(x, 0.0, 1.0); }
vec4 sgSaturate (vec4 x) { return clamp(x, 0.0, 1.0); }

float sgRound (float x) { return floor(x + 0.5); }
vec2 sgRound (vec2 x) { return floor(x + 0.5); }
vec3 sgRound (vec3 x) { return floor(x + 0.5); }
vec4 sgRound (vec4 x) { return floor(x + 0.5); }

float sgTrunc (float x) { return sign(x) * floor(abs(x)); }
vec2 sgTrunc (vec2 x) { return sign(x) * floor(abs(x)); }
vec3 sgTrunc (vec3 x) { return sign(x) * floor(abs(x)); }
vec4 sgTrunc (vec4 x) { return sign(x) * floor(abs(x)); }

// HLSL fmod truncates toward zero (GLSL mod floors)
float sgFmod (float a, float b) { return a - b * sgTrunc(a / b); }
vec2 sgFmod (vec2 a, vec2 b) { return a - b * sgTrunc(a / b); }
vec3 sgFmod (vec3 a, vec3 b) { return a - b * sgTrunc(a / b); }
vec4 sgFmod (vec4 a, vec4 b) { return a - b * sgTrunc(a / b); }
vec2 sgFmod (vec2 a, float b) { return a - b * sgTrunc(a / b); }
vec3 sgFmod (vec3 a, float b) { return a - b * sgTrunc(a / b); }
vec4 sgFmod (vec4 a, float b) { return a - b * sgTrunc(a / b); }

float sgLog10 (float x) { return log(x) * 0.4342944819; }
vec2 sgLog10 (vec2 x) { return log(x) * 0.4342944819; }
vec3 sgLog10 (vec3 x) { return log(x) * 0.4342944819; }
vec4 sgLog10 (vec4 x) { return log(x) * 0.4342944819; }
float sgExp10 (float x) { return exp(x * 2.302585093); }
vec2 sgExp10 (vec2 x) { return exp(x * 2.302585093); }
vec3 sgExp10 (vec3 x) { return exp(x * 2.302585093); }
vec4 sgExp10 (vec4 x) { return exp(x * 2.302585093); }
float sgRcp (float x) { return 1.0 / x; }
vec2 sgRcp (vec2 x) { return 1.0 / x; }
vec3 sgRcp (vec3 x) { return 1.0 / x; }
vec4 sgRcp (vec4 x) { return 1.0 / x; }
bool sgIsNan (float x) { return !(x < 0.0 || x > 0.0 || x == 0.0); }
bool sgIsInf (float x) { return x != 0.0 && x * 2.0 == x; }

mat2 sgTranspose (mat2 m) { return mat2(m[0][0], m[1][0], m[0][1], m[1][1]); }
mat3 sgTranspose (mat3 m) { return mat3(m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]); }
mat4 sgTranspose (mat4 m) {
  return mat4(m[0][0], m[1][0], m[2][0], m[3][0], m[0][1], m[1][1], m[2][1], m[3][1],
              m[0][2], m[1][2], m[2][2], m[3][2], m[0][3], m[1][3], m[2][3], m[3][3]);
}
float sgDeterminant (mat2 m) { return m[0][0] * m[1][1] - m[1][0] * m[0][1]; }
float sgDeterminant (mat3 m) { return dot(m[0], cross(m[1], m[2])); }
float sgDeterminant (mat4 m) {
  float b00 = m[0][0] * m[1][1] - m[0][1] * m[1][0];
  float b01 = m[0][0] * m[1][2] - m[0][2] * m[1][0];
  float b02 = m[0][0] * m[1][3] - m[0][3] * m[1][0];
  float b03 = m[0][1] * m[1][2] - m[0][2] * m[1][1];
  float b04 = m[0][1] * m[1][3] - m[0][3] * m[1][1];
  float b05 = m[0][2] * m[1][3] - m[0][3] * m[1][2];
  float b06 = m[2][0] * m[3][1] - m[2][1] * m[3][0];
  float b07 = m[2][0] * m[3][2] - m[2][2] * m[3][0];
  float b08 = m[2][0] * m[3][3] - m[2][3] * m[3][0];
  float b09 = m[2][1] * m[3][2] - m[2][2] * m[3][1];
  float b10 = m[2][1] * m[3][3] - m[2][3] * m[3][1];
  float b11 = m[2][2] * m[3][3] - m[2][3] * m[3][2];
  return b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
}

// Exact sRGB transfer (Unity Color.cs / ColorSpaceConversion.hlsl)
float sgSRGBToLinear (float c) { return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4); }
vec3 sgSRGBToLinear (vec3 c) { return vec3(sgSRGBToLinear(c.r), sgSRGBToLinear(c.g), sgSRGBToLinear(c.b)); }
vec4 sgSRGBToLinear (vec4 c) { return vec4(sgSRGBToLinear(c.rgb), c.a); }
float sgLinearToSRGB (float c) { return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(max(c, 0.0), 1.0 / 2.4) - 0.055; }
vec3 sgLinearToSRGB (vec3 c) { return vec3(sgLinearToSRGB(c.r), sgLinearToSRGB(c.g), sgLinearToSRGB(c.b)); }
vec4 sgLinearToSRGB (vec4 c) { return vec4(sgLinearToSRGB(c.rgb), c.a); }
vec4 sgDecodeSRGB (vec4 c) { return vec4(sgSRGBToLinear(c.rgb), c.a); }

// OkLab (Color.hlsl) for perceptual gradients
vec3 sgLinearToOklab (vec3 c) {
  float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  l = sign(l) * pow(abs(l), 1.0 / 3.0); m = sign(m) * pow(abs(m), 1.0 / 3.0); s = sign(s) * pow(abs(s), 1.0 / 3.0);
  return vec3(0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
              1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
              0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s);
}
vec3 sgOklabToLinear (vec3 c) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  return vec3(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
              -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
              -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}

// Normal maps: Cocos imports normal maps as plain RGB (tangent xyz * 0.5 + 0.5)
vec3 sgUnpackNormal (vec4 c) { return c.rgb * 2.0 - 1.0; }
vec3 sgUnpackNormalScale (vec4 c, float s) { vec3 n = c.rgb * 2.0 - 1.0; n.xy *= s; return n; }
vec3 sgUnpackNormalRGB (vec4 c, float s) { vec3 n = c.rgb * 2.0 - 1.0; n.xy *= s; return n; }
vec3 sgUnpackNormalRGB (vec4 c) { return c.rgb * 2.0 - 1.0; }
vec3 sgUnpackNormal (vec4 c, float s) { vec3 n = c.rgb * 2.0 - 1.0; n.xy *= s; return n; }
vec3 sgUnpackNormalRGBNoScale (vec4 c) { return c.rgb * 2.0 - 1.0; }

vec2 sgTransformUV (vec4 st, vec2 uv) { return uv * st.xy + st.zw; }

void sgClip (float x) { if (x < 0.0) discard; }
void sgClip (vec2 x) { if (any(lessThan(x, vec2(0.0)))) discard; }
void sgClip (vec3 x) { if (any(lessThan(x, vec3(0.0)))) discard; }
void sgClip (vec4 x) { if (any(lessThan(x, vec4(0.0)))) discard; }

// URP Core ShaderLibrary/Hashes.hlsl
#if __VERSION__ >= 300
uint sgTchou21u (uvec2 v) { v.y ^= 1103515245u; v.x += v.y; v.x *= v.y; v.x ^= v.x >> 5u; v.x *= 0x27d4eb2du; return v.x; }
uvec2 sgTchou22u (uvec2 v) { v.y ^= 1103515245u; v.x += v.y; v.x *= v.y; v.x ^= v.x >> 5u; v.x *= 0x27d4eb2du; v.y ^= (v.x << 3u); return v; }
uvec3 sgTchou23u (uvec2 q) { uvec3 v; v.xy = q; v.y ^= 1103515245u; v.x += v.y; v.x *= v.y; v.x ^= v.x >> 5u; v.x *= 0x27d4eb2du; v.y ^= (v.x << 3u); v.z = v.x ^ (v.y << 5u); return v; }
void Hash_Tchou_2_1_float (vec2 i, out float o) { uint r = sgTchou21u(uvec2(ivec2(sgRound(i)))); o = float(r >> 8u) * (1.0 / 16777215.0); }
void Hash_Tchou_2_2_float (vec2 i, out vec2 o) { uvec2 r = sgTchou22u(uvec2(ivec2(sgRound(i)))); o = vec2(r >> 8u) * (1.0 / 16777215.0); }
void Hash_Tchou_2_3_float (vec2 i, out vec3 o) { uvec3 r = sgTchou23u(uvec2(ivec2(sgRound(i)))); o = vec3(r >> 8u) * (1.0 / 16777215.0); }
#else
// GLSL ES 1.00 has no 32-bit integer ops: sine hashes stand in for the Tchou hashes (reported SG_ES1_HASH)
void Hash_Tchou_2_1_float (vec2 i, out float o) { o = fract(sin(dot(sgRound(i), vec2(12.9898, 78.233))) * 43758.5453); }
void Hash_Tchou_2_2_float (vec2 i, out vec2 o) { vec2 r = sgRound(i); o = fract(sin(vec2(dot(r, vec2(127.1, 311.7)), dot(r, vec2(269.5, 183.3)))) * 43758.5453); }
void Hash_Tchou_2_3_float (vec2 i, out vec3 o) { vec2 r = sgRound(i); o = fract(sin(vec3(dot(r, vec2(127.1, 311.7)), dot(r, vec2(269.5, 183.3)), dot(r, vec2(419.2, 371.9)))) * 43758.5453); }
#endif
void Hash_LegacySine_2_1_float (vec2 i, out float o) { float angle = dot(i, vec2(12.9898, 78.233)); o = fract(sin(angle) * 43758.5453); }
void Hash_BetterSine_2_1_float (vec2 i, out float o) { float angle = dot(i, vec2(12.9898, 78.233) / 1000.0); o = fract(sin(angle) * 43758.5453); }
// HLSL float2x2(15.27, 47.63, 99.41, 89.98) is row-major; mul(i, m) = row vector * matrix
void Hash_LegacySine_2_2_float (vec2 i, out vec2 o) { vec2 angles = vec2(i.x * 15.27 + i.y * 99.41, i.x * 47.63 + i.y * 89.98); o = fract(sin(angles)); }
void Hash_LegacyMod_2_1_float (vec2 i, out float o) {
  i = sgFmod(i, vec2(289.0));
  float x = sgFmod((34.0 * i.x + 1.0) * i.x, 289.0) + i.y;
  x = sgFmod((34.0 * x + 1.0) * x, 289.0);
  o = fract(x / 41.0) * 2.0 - 1.0;
}
void Hash_LegacyMod_2_2_float (vec2 i, out vec2 o) {
  float a; float b;
  Hash_LegacyMod_2_1_float(i, a);
  Hash_LegacyMod_2_1_float(i + vec2(17.0, 31.0), b);
  o = vec2(a, b) * 0.5 + 0.5;
}

// URP SpaceTransforms.hlsl (object = node transform; sgMatWorld is identity for batched sprites, see sg-common)
vec3 TransformObjectToWorld (vec3 p) { return (sgMatWorld * vec4(p, 1.0)).xyz; }
vec3 TransformWorldToObject (vec3 p) { vec4 v = vec4(p, 1.0); return vec3(dot(sgMatWorldIT[0], v), dot(sgMatWorldIT[1], v), dot(sgMatWorldIT[2], v)); }
vec3 TransformObjectToWorldDir (vec3 d) { return normalize((sgMatWorld * vec4(d, 0.0)).xyz); }
vec3 TransformObjectToWorldDir (vec3 d, bool n) { vec3 r = (sgMatWorld * vec4(d, 0.0)).xyz; return n ? normalize(r) : r; }
vec3 TransformWorldToObjectDir (vec3 d) { vec4 v = vec4(d, 0.0); return normalize(vec3(dot(sgMatWorldIT[0], v), dot(sgMatWorldIT[1], v), dot(sgMatWorldIT[2], v))); }
vec3 TransformWorldToObjectDir (vec3 d, bool n) { vec4 v = vec4(d, 0.0); vec3 r = vec3(dot(sgMatWorldIT[0], v), dot(sgMatWorldIT[1], v), dot(sgMatWorldIT[2], v)); return n ? normalize(r) : r; }
vec3 TransformObjectToWorldNormal (vec3 n) { return normalize((sgMatWorldIT * vec4(n, 0.0)).xyz); }
vec3 TransformObjectToWorldNormal (vec3 n, bool doNormalize) { vec3 r = (sgMatWorldIT * vec4(n, 0.0)).xyz; return doNormalize ? normalize(r) : r; }
vec3 TransformWorldToObjectNormal (vec3 n) { return normalize(vec3(dot(sgMatWorld[0].xyz, n), dot(sgMatWorld[1].xyz, n), dot(sgMatWorld[2].xyz, n))); }
vec3 TransformWorldToObjectNormal (vec3 n, bool doNormalize) { vec3 r = vec3(dot(sgMatWorld[0].xyz, n), dot(sgMatWorld[1].xyz, n), dot(sgMatWorld[2].xyz, n)); return doNormalize ? normalize(r) : r; }
vec3 TransformWorldToView (vec3 p) { return (cc_matView * vec4(p, 1.0)).xyz; }
vec3 TransformWorldToViewDir (vec3 d) { return (cc_matView * vec4(d, 0.0)).xyz; }
vec3 TransformWorldToViewDir (vec3 d, bool n) { vec3 r = (cc_matView * vec4(d, 0.0)).xyz; return n ? normalize(r) : r; }
vec3 TransformViewToWorld (vec3 p) { return (cc_matViewInv * vec4(p, 1.0)).xyz; }
vec3 TransformViewToWorldDir (vec3 d) { return (cc_matViewInv * vec4(d, 0.0)).xyz; }
vec3 TransformViewToWorldDir (vec3 d, bool n) { vec3 r = (cc_matViewInv * vec4(d, 0.0)).xyz; return n ? normalize(r) : r; }
vec3 TransformObjectToView (vec3 p) { return (cc_matView * (sgMatWorld * vec4(p, 1.0))).xyz; }
vec4 TransformObjectToHClip (vec3 p) { return cc_matViewProj * (sgMatWorld * vec4(p, 1.0)); }
vec4 TransformWorldToHClip (vec3 p) { return cc_matViewProj * vec4(p, 1.0); }
vec4 TransformWViewToHClip (vec3 p) { return cc_matProj * vec4(p, 1.0); }
vec3 TransformTangentToWorldDir (vec3 v, mat3 m, bool n) { vec3 r = m * v; return n ? normalize(r) : r; }
vec3 TransformTangentToWorld (vec3 v, mat3 m) { return m * v; }
vec3 TransformTangentToWorld (vec3 v, mat3 m, bool n) { vec3 r = m * v; return n ? normalize(r) : r; }
vec3 TransformWorldToTangent (vec3 v, mat3 m) { return vec3(dot(m[0], v), dot(m[1], v), dot(m[2], v)); }
vec3 TransformWorldToTangent (vec3 v, mat3 m, bool n) { vec3 r = vec3(dot(m[0], v), dot(m[1], v), dot(m[2], v)); return n ? normalize(r) : r; }
vec3 TransformWorldToTangentDir (vec3 v, mat3 m, bool n) { vec3 r = vec3(dot(m[0], v), dot(m[1], v), dot(m[2], v)); return n ? normalize(r) : r; }
vec3 GetObjectToWorldMatrixScale () { return vec3(length(sgMatWorld[0].xyz), length(sgMatWorld[1].xyz), length(sgMatWorld[2].xyz)); }
mat4 GetObjectToWorldMatrix () { return sgTranspose(sgMatWorld); }
mat4 GetWorldToObjectMatrix () { return sgMatWorldIT; }
mat4 GetWorldToViewMatrix () { return sgTranspose(cc_matView); }
mat4 GetViewToWorldMatrix () { return sgTranspose(cc_matViewInv); }
mat4 GetWorldToHClipMatrix () { return sgTranspose(cc_matViewProj); }
mat4 GetViewToHClipMatrix () { return sgTranspose(cc_matProj); }
vec3 GetCameraPositionWS () { return cc_cameraPos.xyz; }
vec3 GetWorldSpaceViewDir (vec3 p) { return cc_cameraPos.xyz - p; }
vec3 GetWorldSpaceNormalizeViewDir (vec3 p) { return normalize(cc_cameraPos.xyz - p); }
vec3 SafeNormalize (vec3 v) { return v * inversesqrt(max(dot(v, v), 1.175494351e-38)); }
vec2 SafeNormalize (vec2 v) { return v * inversesqrt(max(dot(v, v), 1.175494351e-38)); }
float SafePositivePow_float (float b, float e) { return pow(max(abs(b), 1.192092896e-07), e); }
vec3 SafePositivePow_float (vec3 b, vec3 e) { return pow(max(abs(b), vec3(1.192092896e-07)), e); }
float Linear01Depth (float d, vec4 z) { return 1.0 / (z.x * d + z.y); }
float LinearEyeDepth (float d, vec4 z) { return 1.0 / (z.z * d + z.w); }
