'use strict';

/**
 * Unity HLSL/Cg -> GLSL 300 ES & Cocos Creator 3.8.8 Semantic Lowering Engine
 * Expanded Built-in Function Library v2
 */

const { lowerUrpFunctions } = require('./urp-shadergraph-rules.cjs');
const { lowerBuiltinConstants } = require('./sampler-state-manager.cjs');
const { replaceCall, replaceCallStatement, splitArgs } = require('./call-rewriter.cjs');

/**
 * Unity sampler name -> Cocos uniform name. Kept local rather than imported
 * from shaderlab-parser.cjs, which requires this module (circular).
 * Must stay in step with toCocosPropertyName there.
 */
function toCocosSamplerName(unityName) {
  let name = String(unityName || '').replace(/^_+/, '');
  if (!name) return 'mainTexture';
  name = name.charAt(0).toLowerCase() + name.slice(1);
  if (name === 'mainTex' || name === 'baseMap') return 'mainTexture';
  return name;
}

const DEFAULT_PRECISION_CONFIG = {
  fixed: 'mediump',
  half: 'mediump',
  float: 'highp',
  min16float: 'mediump',
};

/**
 * Toán tử `%` trên số thực.
 *
 * HLSL cho phép `a % b` với float và hiểu là fmod. GLSL thì `%` CHỈ dùng cho số
 * nguyên — để nguyên là lỗi biên dịch, không phải chỉ khác kết quả. Vì vậy phải
 * hạ xuống hmod().
 *
 * Chỉ nhận dạng vế trái là một nhóm ngoặc — `(...) % X` là hình dạng gần như duy
 * nhất trong shader Unity thật (`((_Time.y + seed) * speed) % 1`). Biến đếm vòng
 * lặp được viết `i % 2` chứ không ai viết `(i) % 2`, nên phép so khớp hẹp này
 * tránh đụng vào modulo nguyên hợp lệ.
 */
function lowerFloatModulo(code) {
    // Mỗi lượt thay ĐÚNG MỘT toán tử rồi quét lại từ đầu trên chuỗi mới.
    // `%` lồng nhau là chuyện thường trong shader Unity
    // (`((uv.y + ((t % 1) * speed)) % total)`), và nếu vừa quét vừa nối chuỗi thì
    // sau lần thay đầu tiên các chỉ số cũ trỏ vào văn bản đã đổi -- kết quả là
    // đoạn bị nhân đôi và mất ngoặc. Chậm hơn nhưng không có lớp trạng thái nào
    // để sai.
    const MAX_PASSES = 512;
    for (let pass = 0; pass < MAX_PASSES; pass++) {
        const replaced = replaceFirstFloatModulo(code);
        if (replaced === null) return code;
        code = replaced;
    }
    return code;
}

/** Thay toán tử `%` khớp đầu tiên bằng hmod(); trả null nếu không còn cái nào. */
function replaceFirstFloatModulo(code) {
    for (let pct = code.indexOf('%'); pct >= 0; pct = code.indexOf('%', pct + 1)) {
        // Vế trái phải kết thúc bằng ')' — tìm ngoặc mở tương ứng.
        let j = pct - 1;
        while (j >= 0 && /\s/.test(code[j])) j--;
        if (j < 0 || code[j] !== ')') continue;

        let depth = 0;
        let open = -1;
        for (let k = j; k >= 0; k--) {
            if (code[k] === ')') depth++;
            else if (code[k] === '(') { depth--; if (depth === 0) { open = k; break; } }
        }
        if (open < 0) continue;
        // `foo(...) % x` là lời gọi hàm, không phải nhóm ngoặc: vẫn là modulo float,
        // nhưng vế trái phải bao gồm cả tên hàm.
        let lhsStart = open;
        const nameMatch = /[A-Za-z_]\w*$/.exec(code.slice(0, open));
        if (nameMatch) lhsStart = open - nameMatch[0].length;

        // Vế phải: số, định danh (kèm swizzle), hoặc một nhóm ngoặc.
        let r = pct + 1;
        while (r < code.length && /\s/.test(code[r])) r++;
        let end = r;
        if (code[r] === '(') {
            let d = 0;
            for (; end < code.length; end++) {
                if (code[end] === '(') d++;
                else if (code[end] === ')') { d--; if (d === 0) { end++; break; } }
            }
        } else {
            const m = /^[A-Za-z_0-9.]+/.exec(code.slice(r));
            if (!m) continue;
            end = r + m[0].length;
        }

        const lhs = code.slice(lhsStart, j + 1);
        const rhs = code.slice(r, end);
        return code.slice(0, lhsStart) + `hmod(${lhs}, ${rhs})` + code.slice(end);
    }
    return null;
}

/**
 * Constructor ma trận: HLSL nhận theo HÀNG, GLSL nhận theo CỘT.
 *
 * `float2x2(c, -s, s, c)` và `mat2(c, -s, s, c)` là hai ma trận chuyển vị của
 * nhau, nên mọi mul() phía sau đều ra sai — mà vẫn compile sạch. Chuyển vị ngay
 * tại constructor thì `mul(M, v)` -> `M * v` và `mul(v, M)` -> `v * M` tự khắc đúng.
 */
function transposeMatrixConstructors(code) {
    for (const [type, n] of [['2x2', 2], ['3x3', 3], ['4x4', 4]]) {
        const re = new RegExp(`\\b(?:float|half|min16float)${type}\\s*\\(`, 'g');
        let m;
        while ((m = re.exec(code)) !== null) {
            const open = m.index + m[0].length - 1;
            let depth = 0;
            let close = -1;
            for (let k = open; k < code.length; k++) {
                if (code[k] === '(') depth++;
                else if (code[k] === ')') { depth--; if (depth === 0) { close = k; break; } }
            }
            if (close < 0) continue;
            const args = splitArgs(code.slice(open + 1, close));
            let replacement;
            if (args.length === n * n) {
                const t = [];
                for (let col = 0; col < n; col++) {
                    for (let row = 0; row < n; row++) t.push(args[row * n + col].trim());
                }
                replacement = `mat${n}(${t.join(', ')})`;
            } else if (args.length === n) {
                // Dạng dựng từ n vector = n HÀNG trong HLSL; không hoán vị được
                // bằng văn bản nên bọc transpose().
                replacement = `transpose(mat${n}(${args.map((a) => a.trim()).join(', ')}))`;
            } else {
                continue;   // mat(scalar) hoặc dạng lạ: để nguyên
            }
            code = code.slice(0, m.index) + replacement + code.slice(close + 1);
            re.lastIndex = m.index + replacement.length;
        }
    }
    return code;
}

/**
 * Cast kiểu C sang ma trận: `(mat3)expr` -> `mat3(expr)`.
 *
 * HLSL cho phép `(float3x3)m`; GLSL không có cast kiểu C, chỉ có constructor.
 * Nhánh xử lý cast trong mul() chỉ khớp `(float3x3)<định danh>`, nên khi toán hạng
 * là một lời gọi — `mul((half3x3)unity_CameraToWorld, v)` sau khi
 * `unity_CameraToWorld` đã hạ thành `inverse(cc_matView)` — cast bị giữ nguyên và
 * GLSL không parse được. Xử lý ở đây thì mọi vị trí cast đều đúng, không riêng mul().
 */
function lowerMatrixCasts(code) {
    const re = /\(\s*(mat[234])\s*\)\s*/g;
    let m;
    while ((m = re.exec(code)) !== null) {
        const type = m[1];
        let i = m.index + m[0].length;
        const start = i;
        // Toán hạng: định danh (có thể kèm lời gọi/chỉ số) hoặc một nhóm ngoặc.
        if (code[i] === '(') {
            let d = 0;
            for (; i < code.length; i++) {
                if (code[i] === '(') d++;
                else if (code[i] === ')') { d--; if (d === 0) { i++; break; } }
            }
        } else {
            const id = /^[A-Za-z_]\w*/.exec(code.slice(i));
            if (!id) continue;
            i += id[0].length;
            // Nuốt luôn phần gọi hàm hoặc chỉ số ngay sau tên.
            while (code[i] === '(' || code[i] === '[') {
                const openCh = code[i];
                const closeCh = openCh === '(' ? ')' : ']';
                let d = 0;
                for (; i < code.length; i++) {
                    if (code[i] === openCh) d++;
                    else if (code[i] === closeCh) { d--; if (d === 0) { i++; break; } }
                }
            }
        }
        const operand = code.slice(start, i);
        if (!operand) continue;
        const replacement = `${type}(${operand})`;
        code = code.slice(0, m.index) + replacement + code.slice(i);
        re.lastIndex = m.index + replacement.length;
    }
    return code;
}

function lowerHlslToGlsl(code, options = {}) {
  if (!code) return '';

  let out = code;
  const precisionConfig = { ...DEFAULT_PRECISION_CONFIG, ...(options.precision || {}) };

  // 1. Strip Unity Boilerplate / Stereo / Instancing / Loop Macros
  out = out.replace(/\bUNITY_SETUP_INSTANCE_ID\s*\([^)]*\);?/g, '');
  out = out.replace(/\bUNITY_TRANSFER_INSTANCE_ID\s*\([^)]*\);?/g, '');
  out = out.replace(/\bUNITY_INITIALIZE_OUTPUT\s*\([^)]*\);?/g, '');
  out = out.replace(/\bUNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX\s*\([^)]*\);?/g, '');
  out = out.replace(/\bUNITY_TRANSFER_FOG\s*\([^)]*\);?/g, '');
  out = out.replace(/\bUNITY_APPLY_FOG\s*\([^)]*\);?/g, '');
  out = out.replace(/\bUNITY_FOG_COORDS\s*\([^)]*\)/g, '');
  out = out.replace(/\bUNITY_CALC_FOG_FACTOR\s*\([^)]*\)/g, '1.0');
  out = out.replace(/\bUNITY_VERTEX_INPUT_INSTANCE_ID\b/g, '');
  out = out.replace(/\bUNITY_VERTEX_OUTPUT_STEREO\b/g, '');
  out = out.replace(/\bUNITY_DECLARE_DEPTH_TEXTURE\s*\([^)]*\);?/g, '');
  out = out.replace(/\bSAMPLER\s*\([^)]*\);?/g, '');
  // Stereo/XR and per-instance property access have no Cocos counterpart; left
  // in place they emit calls to undefined functions and the effect will not link.
  out = out.replace(/\bUNITY_INITIALIZE_VERTEX_OUTPUT_STEREO\s*\([^)]*\);?/g, '');
  out = out.replace(/\bUNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX\s*\([^)]*\);?/g, '');
  out = out.replace(/\bUNITY_TRANSFER_VERTEX_OUTPUT_STEREO\s*\([^)]*\);?/g, '');
  // UNITY_ACCESS_INSTANCED_PROP(buffer, prop) reads a per-instance value; a
  // playable draws one instance, so the plain material uniform is equivalent.
  out = replaceCall(out, 'UNITY_ACCESS_INSTANCED_PROP', (a) => (a.length === 2 ? a[1] : null));
  out = out.replace(/\bUNITY_INSTANCING_BUFFER_(?:START|END)\s*\([^)]*\)/g, '');
  // Fog: a playable renders without fog, so the colour passes through unchanged.
  out = replaceCall(out, ['UNITY_APPLY_FOG_COLOR', 'UNITY_APPLY_FOG'], (a) => (a.length >= 1 ? a[a.length >= 2 ? 1 : 0] : null));
  // UNITY_PROJ_COORD is a no-op on every platform Cocos targets.
  out = replaceCall(out, 'UNITY_PROJ_COORD', (a) => (a.length === 1 ? a[0] : null));
  // Eye-space depth of the current vertex; cc_matView row 2 gives the same value.
  out = replaceCallStatement(out, 'COMPUTE_EYEDEPTH', (a) => (a.length >= 1 ? `${a[0]} = -(cc_matView * cc_matWorld * vec4(a_position, 1.0)).z;` : null));
  out = replaceCall(out, ['LinearEyeDepth', 'LinearEyeDepthToOutsideDepth'], (a) => (a.length >= 1 ? `(1.0 / (cc_zBufferParams.z * (${a[0]}) + cc_zBufferParams.w))` : null));
  out = replaceCall(out, 'Linear01Depth', (a) => (a.length >= 1 ? `(1.0 / (cc_zBufferParams.x * (${a[0]}) + cc_zBufferParams.y))` : null));
  out = out.replace(/\bUNITY_DEFINE_INSTANCED_PROP\s*\(\s*[A-Za-z0-9_]+\s*,\s*([A-Za-z_]\w*)\s*\)\s*;?/g, '');
  // Texture object methods: tex.GetDimensions(w, h) -> textureSize(tex, 0)
  out = out.replace(/\b([A-Za-z_]\w*)\.GetDimensions\s*\(([^;]*)\)\s*;/g, (m, tex, args) => {
    const names = args.split(',').map(s => s.trim()).filter(Boolean);
    if (names.length < 2) return '';
    return `ivec2 __dim_${tex} = textureSize(${tex}, 0); ${names[0]} = float(__dim_${tex}.x); ${names[1]} = float(__dim_${tex}.y);`;
  });
  out = out.replace(/\bTEXTURE2D\s*\(\s*([A-Za-z_]\w*)\s*\);?/g, 'uniform sampler2D $1;');
  out = out.replace(/\bTEXTURECUBE\s*\(\s*([A-Za-z_]\w*)\s*\);?/g, 'uniform samplerCube $1;');
  out = out.replace(/\bTEXTURE3D\s*\(\s*([A-Za-z_]\w*)\s*\);?/g, 'uniform sampler3D $1;');
  out = out.replace(/\[\s*(?:unroll|loop|flatten|branch)\s*\]/gi, '');

  // 2. Extended Semantics Lowering
  out = out.replace(/\bSV_VertexID\b/g, 'gl_VertexID');
  out = out.replace(/\bSV_InstanceID\b/g, 'gl_InstanceID');

  // 3. Transform & Camera Helpers
  // All argument-rewriting rules use replaceCall (balanced parens); a flat
  // [^)]+ capture silently corrupts any nested call in the argument.
  out = replaceCall(out, 'TransformWorldToHClip', (a) => (a.length === 1 ? `(cc_matViewProj * vec4((${a[0]}).xyz, 1.0))` : null));

  out = replaceCall(out, ['UnityObjectToClipPos', 'TransformObjectToHClip'], (a) => {
    if (a.length !== 1) return null;
    const e = a[0].trim();
    if (e.endsWith('.xyz')) return `(cc_matViewProj * cc_matWorld * vec4(${e}, 1.0))`;
    return `(cc_matViewProj * cc_matWorld * vec4((${e}).xyz, 1.0))`;
  });

  out = replaceCall(out, ['UnityObjectToWorldPos', 'TransformObjectToWorld'], (a) => (a.length === 1 ? `((cc_matWorld * vec4((${a[0]}).xyz, 1.0)).xyz)` : null));
  out = replaceCall(out, ['UnityWorldToObjectPos', 'TransformWorldToObject'], (a) => (a.length === 1 ? `((cc_matWorldIT * vec4((${a[0]}).xyz, 1.0)).xyz)` : null));
  out = replaceCall(out, ['UnityObjectToWorldNormal', 'TransformObjectToWorldNormal'], (a) => (a.length >= 1 ? `normalize((cc_matWorldIT * vec4((${a[0]}).xyz, 0.0)).xyz)` : null));
  out = replaceCall(out, ['UnityObjectToWorldDir', 'TransformObjectToWorldDir'], (a) => (a.length >= 1 ? `normalize((cc_matWorld * vec4((${a[0]}).xyz, 0.0)).xyz)` : null));
  out = replaceCall(out, ['WorldSpaceViewDir', 'GetWorldSpaceViewDir', 'UnityWorldSpaceViewDir'], (a) => (a.length === 1 ? `(cc_cameraPos.xyz - (${a[0]}).xyz)` : null));
  out = replaceCall(out, 'ObjSpaceViewDir', (a) => (a.length === 1 ? `(((cc_matWorldIT * vec4(cc_cameraPos.xyz, 1.0)).xyz) - (${a[0]}).xyz)` : null));

  out = replaceCall(out, ['TRANSFORM_TEX', 'TRANSFORM_TEX_LOD'], (a) => (a.length === 2 ? `((${a[0]}).xy * ${a[1]}_ST.xy + ${a[1]}_ST.zw)` : null));

  out = replaceCall(out, ['ComputeScreenPos', 'UnityViewToScreenPos'], (a) => {
    if (a.length !== 1) return null;
    const e = a[0].trim();
    return `vec4(vec2((${e}).x, (${e}).y) * 0.5 + vec2((${e}).w * 0.5), (${e}).zw)`;
  });

  // Normal unpack helpers. These route through the UnpackNormalMap() helper the
  // effect generator emits: inlining would duplicate the argument (a texture
  // fetch) three times, turning one sample into three.
  out = replaceCall(out, 'UnpackNormalDXT5nm', (a) => (a.length >= 1 ? `UnpackNormalMap(${a[0]}, 1.0)` : null));
  out = replaceCall(out, ['UnpackScaleNormal', 'UnpackNormalScale'], (a) => (a.length === 2 ? `UnpackNormalMap(${a[0]}, ${a[1]})` : null));
  out = replaceCall(out, 'UnpackNormal', (a) => (a.length >= 1 ? `UnpackNormalMap(${a[0]}, 1.0)` : null));

  // Lighting helpers
  out = out.replace(/\bWorldSpaceLightDir\s*\(\s*([^)]*)\s*\)/g, 'normalize(-cc_mainLitDir.xyz)');
  out = out.replace(/\bObjSpaceLightDir\s*\(\s*([^)]*)\s*\)/g, 'normalize((cc_matWorldIT * vec4(-cc_mainLitDir.xyz, 0.0)).xyz)');
  // HLSL lets a scalar be swizzle-splatted -- `(3.0).xx`, `f.xxx` -- which GLSL
  // rejects outright. Amplify Shader Editor emits this constantly. Only literal
  // and parenthesised-expression forms are rewritten; `v.xx` on a vector is a
  // legal GLSL swizzle and must be left alone.
  out = out.replace(/\(\s*([-+]?(?:\d+\.?\d*|\.\d+))\s*\)\.(x{2,4})/g,
    (m, lit, sw) => `vec${sw.length}(${/\./.test(lit) ? lit : lit + '.0'})`);
  out = out.replace(/\b([-+]?(?:\d+\.\d*|\.\d+))\.(x{2,4})\b/g,
    (m, lit, sw) => `vec${sw.length}(${lit})`);

  // Unity injects `<Tex>_TexelSize` = (1/w, 1/h, w, h) for every sampler. Keep
  // that semantic as an explicit Cocos material uniform. `textureSize()` looks
  // equivalent on WebGL2, but Cocos also compiles a WebGL1/GLES100 variant where
  // it becomes unsupported `texture2DSize` and rejects the entire effect.
  // cocos-effect-generator synthesizes the matching authorable vec4 property;
  // runtime code binds it from the actual texture dimensions.
  out = out.replace(/\b_?([A-Za-z_]\w*?)_TexelSize\b/g, (m, tex) => {
    const name = toCocosSamplerName(tex);
    return `${name}TexelSize`;
  });
  // SpriteRenderer's per-instance tint. In Cocos the sprite's colour arrives as
  // the vertex colour varying.
  out = out.replace(/\b_RendererColor\b/g, 'v_color');

  // Platform constants. Cocos targets GL clip space (near = -1) and a
  // non-reversed depth buffer; these are compile-time values, not uniforms.
  out = out.replace(/\bUNITY_NEAR_CLIP_VALUE\b/g, '(-1.0)');
  out = out.replace(/\bUNITY_RAW_FAR_CLIP_VALUE\b/g, '(1.0)');
  out = out.replace(/\bUNITY_REVERSED_Z\b/g, '0');
  out = out.replace(/\bUNITY_COLORSPACE_GAMMA\b/g, '0');
  out = out.replace(/\bUNITY_PI\b/g, '3.14159265359');
  out = out.replace(/\bUNITY_TWO_PI\b/g, '6.28318530718');
  out = out.replace(/\bUNITY_HALF_PI\b/g, '1.57079632679');
  // Baked probe occlusion is not authored in a playable: fully unoccluded.
  out = out.replace(/\bunity_ProbesOcclusion\b/g, 'vec4(1.0)');
  out = out.replace(/\bUNITY_LIGHTMODEL_AMBIENT\b/g, 'cc_ambientSky.rgb');
  out = out.replace(/\bunity_LightColor\b/g, 'cc_mainLitColor');
  out = out.replace(/\bunity_LightPosition\b/g, 'vec4(-cc_mainLitDir.xyz, 0.0)');
  out = out.replace(/\bunity_4LightPos[XYZ]0\b/g, 'vec4(0.0)');
  out = out.replace(/\bunity_4LightAtten0\b/g, 'vec4(0.0)');

  // Shadows / Lightmaps
  out = out.replace(/\bSHADOW_COORDS\s*\([^)]*\)/g, '');
  out = out.replace(/\bTRANSFER_SHADOW\s*\([^)]*\);?/g, '');
  out = out.replace(/\bSHADOW_ATTENUATION\s*\([^)]*\)/g, '1.0');
  out = replaceCall(out, 'DecodeLightmap', (a) => (a.length >= 1 ? `(2.0 * (${a[0]}).rgb)` : null));
  out = out.replace(/\bunity_ShadowMask\b/g, 'vec4(1.0)');

  // 4. Matrix & Built-in Variables Mapping
  out = out.replace(/\b(?:UNITY_MATRIX_MVP|unity_MatrixMVP)\b/g, '(cc_matViewProj * cc_matWorld)');
  out = out.replace(/\b(?:UNITY_MATRIX_MV|unity_MatrixMV)\b/g, '(cc_matView * cc_matWorld)');
  out = out.replace(/\b(?:UNITY_MATRIX_M|unity_MatrixM|unity_ObjectToWorld|_UCST_MatWorld)\b/g, 'cc_matWorld');
  out = out.replace(/\b(?:unity_WorldToObject|unity_MatrixInvM|UNITY_MATRIX_I_M|_UCST_MatWorldIT)\b/g, 'cc_matWorldIT');
  out = out.replace(/\b(?:UNITY_MATRIX_V|unity_MatrixV|unity_WorldToCamera|_UCST_MatView|_UCST_MatWorldToCamera)\b/g, 'cc_matView');
  out = out.replace(/\b(?:unity_CameraToWorld)\b/g, 'inverse(cc_matView)');
  out = out.replace(/\b(?:UNITY_MATRIX_P|unity_MatrixP|_UCST_MatProj)\b/g, 'cc_matProj');
  out = out.replace(/\b(?:UNITY_MATRIX_VP|unity_MatrixVP|_UCST_MatViewProj)\b/g, 'cc_matViewProj');
  out = out.replace(/\bUNITY_MATRIX_T_MV\b/g, 'transpose(cc_matView * cc_matWorld)');
  out = out.replace(/\bUNITY_MATRIX_IT_MV\b/g, 'transpose(inverse(cc_matView * cc_matWorld))');

  out = out.replace(/\b_WorldSpaceCameraPos\b/g, 'cc_cameraPos.xyz');
  out = out.replace(/\b_ScreenParams\b/g, 'cc_screenSize');
  out = out.replace(/\b_MainLightPosition\b/g, '(-cc_mainLitDir)');
  out = out.replace(/\b_WorldSpaceLightPos0\b/g, 'vec4(-cc_mainLitDir.xyz, 0.0)');
  out = out.replace(/\b_MainLightColor\b/g, 'cc_mainLitColor');
  out = out.replace(/\b_LightColor0\b/g, 'cc_mainLitColor');

  // Time variables
  out = out.replace(/\b_Time\.y\b/g, 'cc_time.x');
  out = out.replace(/\b_Time\.x\b/g, '(cc_time.x * 0.05)');
  out = out.replace(/\b_Time\.z\b/g, '(cc_time.x * 2.0)');
  out = out.replace(/\b_Time\.w\b/g, '(cc_time.x * 3.0)');
  out = out.replace(/\b_Time\b/g, 'vec4(cc_time.x * 0.05, cc_time.x, cc_time.x * 2.0, cc_time.x * 3.0)');

  out = out.replace(/\b_SinTime\.w\b/g, 'sin(cc_time.x)');
  out = out.replace(/\b_CosTime\.w\b/g, 'cos(cc_time.x)');

  // 5. Texture Sampling Functions
  // Balanced-argument rewrites -- see call-rewriter.cjs. A flat [^)]+ capture
  // corrupts every nested call, so all arg-rewriting rules go through replaceCall.
  out = out.replace(/\b([A-Za-z_]\w*)\.SampleLevel\s*\(/g, '__SAMPLELEVEL__($1, ');
  out = replaceCall(out, '__SAMPLELEVEL__', (a) => (a.length >= 4 ? `textureLod(${a[0]}, ${a[2]}, ${a[3]})` : null));
  out = out.replace(/\b([A-Za-z_]\w*)\.Sample\s*\(/g, '__SAMPLE__($1, ');
  out = replaceCall(out, '__SAMPLE__', (a) => (a.length >= 3 ? `texture(${a[0]}, ${a[2]})` : null));

  out = replaceCall(out, 'SAMPLE_TEXTURE2D_LOD', (a) => (a.length >= 4 ? `textureLod(${a[0]}, ${a[2]}, ${a[3]})` : null));
  out = replaceCall(out, 'SAMPLE_TEXTURE2D', (a) => (a.length >= 3 ? `texture(${a[0]}, ${a[2]})` : null));
  out = replaceCall(out, 'SAMPLE_TEXTURECUBE_LOD', (a) => (a.length >= 4 ? `textureLod(${a[0]}, ${a[2]}, ${a[3]})` : null));
  out = replaceCall(out, 'SAMPLE_TEXTURECUBE', (a) => (a.length >= 3 ? `texture(${a[0]}, ${a[2]})` : null));
  out = replaceCall(out, 'SAMPLE_TEXTURE3D', (a) => (a.length >= 3 ? `texture(${a[0]}, ${a[2]})` : null));

  out = replaceCall(out, 'tex2Dlod', (a) => {
    if (a.length < 2) return null;
    // tex2Dlod(tex, float4(uv, 0, lod)) -> textureLod(tex, uv, lod)
    const ctor = /^(?:vec4|float4)\s*\(([\s\S]*)\)$/.exec(a[1]);
    if (ctor) {
      const parts = splitArgs(ctor[1]);
      if (parts.length === 4) return `textureLod(${a[0]}, vec2(${parts[0]}, ${parts[1]}), ${parts[3]})`;
      if (parts.length === 3) return `textureLod(${a[0]}, ${parts[0]}, ${parts[2]})`;
    }
    return `textureLod(${a[0]}, (${a[1]}).xy, (${a[1]}).w)`;
  });
  out = replaceCall(out, 'tex2Dproj', (a) => (a.length >= 2 ? `textureProj(${a[0]}, ${a[1]})` : null));
  /*
   * Gốc texture của Unity ở dưới-trái, của Cocos ở trên-trái.
   *
   * Mặc định TẮT: bật lên sẽ đổi hình của mọi effect đã sinh trước đây, và với
   * shader toàn màn hình / thuần thủ tục thì không có quy ước UV của mesh để mà
   * hiệu chỉnh. Bật bằng --unity-uv khi shader chạy trên hình học mang UV từ Unity.
   *
   * Vì sao không lật UV của mesh thay thế: cách đó làm ảnh hiện đúng nhưng LẶNG LẼ
   * đảo ngược mọi cách dùng uv.y mang tính thủ tục (gradient, gió cỏ, sọc hologram,
   * UV clipping). Lật ở chỗ lấy mẫu giữ nguyên toàn bộ shader trong không gian UV
   * của Unity.
   */
  const sampleFn = options.unityUv ? 'texU' : 'texture';
  out = replaceCall(out, 'tex2D', (a) => (a.length >= 2 ? `${sampleFn}(${a[0]}, ${a[1]})` : null));
  out = replaceCall(out, 'texCUBElod', (a) => (a.length >= 2 ? `textureLod(${a[0]}, (${a[1]}).xyz, (${a[1]}).w)` : null));
  out = replaceCall(out, 'texCUBE', (a) => (a.length >= 2 ? `texture(${a[0]}, ${a[1]})` : null));
  out = replaceCall(out, 'tex3Dlod', (a) => (a.length >= 2 ? `textureLod(${a[0]}, (${a[1]}).xyz, (${a[1]}).w)` : null));
  out = replaceCall(out, 'tex3D', (a) => (a.length >= 2 ? `texture(${a[0]}, ${a[1]})` : null));

  // 6. HLSL Math Intrinsics
  out = out.replace(/\blerp\s*\(/g, 'mix(');
  out = out.replace(/\bfrac\s*\(/g, 'fract(');
  out = replaceCall(out, 'saturate', (a) => (a.length === 1 ? `clamp(${a[0]}, 0.0, 1.0)` : null));
  out = out.replace(/\brsqrt\s*\(/g, 'inversesqrt(');
  out = out.replace(/\bddx\s*\(/g, 'dFdx(');
  out = out.replace(/\bddy\s*\(/g, 'dFdy(');
  out = replaceCall(out, 'atan2', (a) => (a.length === 2 ? `atan(${a[0]}, ${a[1]})` : null));

  // HLSL fmod() cắt về 0; GLSL mod() làm tròn xuống. Hai hàm chỉ trùng nhau khi
  // cả hai toán hạng dương — mà scroll speed và offset âm là chuyện thường. hmod()
  // trong compat/unity-compat.glsl giữ đúng ngữ nghĩa của HLSL.
  out = replaceCall(out, 'fmod', (a) => (a.length === 2 ? `hmod(${a[0]}, ${a[1]})` : null));
  out = lowerFloatModulo(out);

  // clip() intrinsic -- statement form; the expression may carry trailing arithmetic
  out = replaceCallStatement(out, 'clip', (a, expr) => `if ((${expr.trim()}) < 0.0) { discard; }`);

  out = transposeMatrixConstructors(out);

  // 7. mul() Overloads
  out = replaceCall(out, 'mul', (a) => {
    if (a.length !== 2) return null;
    const lhs = a[0].trim();
    const rhs = a[1].trim();
    // mul((float3x3)unity_ObjectToWorld, n) is Unity's object->world normal path.
    // Spec 4.1 mandates the inverse-transpose so non-uniform scale stays correct.
    const cast = /^\(\s*(?:float3x3|half3x3|mat3)\s*\)\s*([A-Za-z_]\w*)$/.exec(lhs);
    if (cast) {
      const m = cast[1];
      if (/^(?:unity_ObjectToWorld|cc_matWorld)$/.test(m)) {
        return `normalize((cc_matWorldIT * vec4((${rhs}).xyz, 0.0)).xyz)`;
      }
      return `(mat3(${m}) * (${rhs}))`;
    }
    return `(${lhs} * ${rhs})`;
  });

  // 8. Types
  out = out.replace(/\bfloat4x4\b/g, 'mat4');
  out = out.replace(/\bfloat3x3\b/g, 'mat3');
  out = out.replace(/\bfloat2x2\b/g, 'mat2');
  out = out.replace(/\bhalf4x4\b/g, 'mat4');
  out = out.replace(/\bhalf3x3\b/g, 'mat3');
  out = out.replace(/\bhalf2x2\b/g, 'mat2');

  out = out.replace(/\b(?:float4|half4|fixed4|min16float4)\b/g, 'vec4');
  out = out.replace(/\b(?:float3|half3|fixed3|min16float3)\b/g, 'vec3');
  out = out.replace(/\b(?:float2|half2|fixed2|min16float2)\b/g, 'vec2');
  out = out.replace(/\b(?:half|fixed|min16float)\b/g, 'float');
  out = out.replace(/\bint4\b/g, 'ivec4');
  out = out.replace(/\bint3\b/g, 'ivec3');
  out = out.replace(/\bint2\b/g, 'ivec2');
  out = out.replace(/\bbool4\b/g, 'bvec4');
  out = out.replace(/\bbool3\b/g, 'bvec3');
  out = out.replace(/\bbool2\b/g, 'bvec2');

  out = out.replace(/\binline\s+/g, '');

  // Sau khi tên kiểu đã đổi sang matN: chuyển cast kiểu C thành constructor.
  out = lowerMatrixCasts(out);

  // 9. URP & ShaderGraph Library Functions Lowering
  out = lowerUrpFunctions(out);

  // 10. Texture & Screen Built-in Constants Lowering
  out = lowerBuiltinConstants(out);

  return out;
}

module.exports = {
  lowerHlslToGlsl,
  DEFAULT_PRECISION_CONFIG,
};
