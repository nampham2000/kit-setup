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

const SAMPLER_TYPES = /\b(?:sampler2DArray|samplerCubeShadow|sampler2DShadow|samplerCube|sampler2D|sampler3D)\b/;

/**
 * Cocos rejects a texture() whose sampler argument is not a DECLARED sampler name,
 * before user macros are expanded:
 *
 *     Error EFX2300: sampler '_DistortTex' does not exist
 *
 * `#define _DistortTex DistortTex` looks like it should work -- it does for UBO
 * members, whose aliases the driver expands later -- but the effect importer
 * resolves sampler arguments itself and never sees the expansion. The failure is
 * silent from the CLI's point of view: the .effect is written, only the editor
 * refuses it, and `.meta` records `"imported": false`.
 *
 * Only the alias case is an error. An unknown name that is not #defined is more
 * likely a sampler from an #include we cannot see, so that is a warning.
 */
function checkSamplerNames(programs, errors, warnings) {
  for (const [name, body] of programs) {
    const declared = new Set();
    for (const d of body.matchAll(/\buniform\s+(?:lowp\s+|mediump\s+|highp\s+)?(?:sampler2DArray|samplerCubeShadow|sampler2DShadow|samplerCube|sampler2D|sampler3D)\s+([A-Za-z_]\w*)/g)) {
      declared.add(d[1]);
    }
    // Samplers passed into a helper are valid inside it: `vec4 Blur(vec2 uv, sampler2D source, ...)`.
    for (const fn of body.matchAll(/\([^()]*\)\s*\{/g)) {
      for (const param of fn[0].split(',')) {
        if (!SAMPLER_TYPES.test(param)) continue;
        const pm = /([A-Za-z_]\w*)\s*[),]?\s*$/.exec(param.replace(/\)\s*\{$/, ''));
        if (pm) declared.add(pm[1]);
      }
    }
    const defined = new Set(
      [...body.matchAll(/^\s*#\s*define\s+([A-Za-z_]\w*)/gm)].map(x => x[1])
    );

    const reported = new Set();
    for (const call of body.matchAll(/\b(?:texture|texture2D|textureLod|texture2DLod|textureGrad|texelFetch|textureSize)\s*\(\s*([A-Za-z_]\w*)/g)) {
      const arg = call[1];
      if (declared.has(arg) || reported.has(arg)) continue;
      reported.add(arg);
      if (defined.has(arg)) {
        errors.push(`[EFX2300_ALIASED_SAMPLER] ${name} -- texture() is called on '${arg}', which is a #define alias, not a declared sampler. Cocos resolves sampler names before macro expansion and will refuse to import the effect ("sampler '${arg}' does not exist"). Name the uniform '${arg}' or rewrite the call site.`);
      } else if (!/^cc_/.test(arg)) {
        warnings.push(`[SAMPLER_UNDECLARED] ${name} -- texture() is called on '${arg}', which this program does not declare. Fine if it comes from an #include; otherwise Cocos will refuse the effect.`);
      }
    }
  }
}

/**
 * Attribute và varying là `in` — CHỈ ĐỌC trong GLSL ES 3.0.
 *
 * Shader Unity sửa chúng tại chỗ suốt ngày (`v.vertex.xyz += ...`, `i.uv += ...`)
 * vì bên đó `v`/`i` là bản sao cục bộ của struct. Sau khi hạ mã một cách ngây thơ,
 * những lệnh đó thành `a_position += ...` / `v_uv += ...` và shader không compile.
 * Đo trên AllIn1SpriteShader: 1 lệnh ghi attribute + 18 lệnh ghi varying, không có
 * check nào bắt được — chỉ vỡ khi Cocos biên dịch variant lúc chạy.
 */
function checkReadOnlyInputs(programs, errors) {
  for (const [name, body] of programs) {
    const inputs = new Set();
    for (const d of body.matchAll(/^\s*in\s+(?:lowp\s+|mediump\s+|highp\s+|flat\s+)*[A-Za-z0-9_]+\s+([A-Za-z_]\w*)\s*;/gm)) {
      inputs.add(d[1]);
    }
    if (!inputs.size) continue;
    const reported = new Set();
    for (const v of inputs) {
      // Ghi = có `=` theo sau nhưng không phải so sánh (`==`, `<=`, `>=`, `!=`).
      const writeRe = new RegExp(`(?<![<>=!])\\b${v}(?:\\.[xyzwrgba]+)?\\s*(?:[-+*/]=|=(?!=))`);
      if (!writeRe.test(body) || reported.has(v)) continue;
      reported.add(v);
      errors.push(`[GLSL_WRITE_TO_INPUT] ${name} -- assigns to '${v}', which is declared \`in\` and therefore read-only. Copy it into a local first (\`vec2 ${v}_rw = ${v};\`) and write to that.`);
    }
  }
}

/**
 * `#define alpha pack0.x` cộng với `float alpha = ...;` ở đâu đó trong cùng program
 * sẽ nở thành `float pack0.x = ...;` — lỗi cú pháp.
 *
 * Đây là mặt trái của việc đóng gói scalar vào lát cắt vec4: property và biến cục bộ
 * dùng chung một token. Bộ sinh đổi tên biến cục bộ để tránh, nhưng effect viết tay
 * hoặc sửa tay thì không có ai canh.
 */
function checkDefineShadowing(programs, errors) {
  const DECL_TYPES = '(?:float|int|bool|vec[234]|ivec[234]|bvec[234]|mat[234])';
  for (const [name, body] of programs) {
    for (const d of body.matchAll(/^\s*#\s*define\s+([A-Za-z_]\w*)\s+\S/gm)) {
      const symbol = d[1];
      const declRe = new RegExp(`^\\s*${DECL_TYPES}\\s+${symbol}\\s*[=;]`, 'm');
      if (!declRe.test(body)) continue;
      errors.push(`[GLSL_DEFINE_SHADOWS_LOCAL] ${name} -- '${symbol}' is both #define'd and declared as a variable; the macro expands the declaration into invalid GLSL. Rename the local.`);
    }
  }
}

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

  // Every CCProgram block in the file, keyed by name. Programs may be called
  // anything -- `vs`, `unlit-vs`, `allin1-vs`, `standard-vs` -- so resolution has
  // to go through the technique instead of assuming the generator's defaults.
  const programs = new Map();
  for (const p of effectText.matchAll(/CCProgram\s+([A-Za-z0-9_\-]+)\s*%\{([\s\S]*?)\}%/g)) {
    programs.set(p[1], p[2]);
  }

  // 1. Check CCEffect block
  const cceffectMatch = /CCEffect\s*%\{([\s\S]*?)\}%/.exec(effectText);
  const stageRefs = { vert: [], frag: [] };
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

    // `vert: <program>[:<entry>]`. The entry is optional: surface-shader effects
    // (--mode surface-pbr) omit it because main() comes from the included
    // shading-entry chunk rather than a hand-written vert()/frag().
    for (const m of yaml.matchAll(/\b(vert|frag):\s*([A-Za-z0-9_\-]+)(?::([A-Za-z0-9_]+))?/g)) {
      stageRefs[m[1]].push({ program: m[2], entry: m[3] || null });
    }
    if (!stageRefs.vert.length) errors.push('No pass declares a vertex program (vert: <program>:<entry>)');
    if (!stageRefs.frag.length) errors.push('No pass declares a fragment program (frag: <program>:<entry>)');
  }

  // 2. Every referenced program must exist and expose the entry it names.
  const seenStage = new Set();
  for (const stage of ['vert', 'frag']) {
    for (const ref of stageRefs[stage]) {
      const key = `${stage}:${ref.program}:${ref.entry}`;
      if (seenStage.has(key)) continue;          // techniques share programs by design
      seenStage.add(key);
      const body = programs.get(ref.program);
      if (body === undefined) {
        errors.push(`Pass references ${stage}: ${ref.program} but there is no CCProgram ${ref.program} %{ ... }% block.`);
        continue;
      }
      if (ref.entry) {
        const entryRe = new RegExp(`vec4\\s+${ref.entry}\\s*\\(`);
        if (!entryRe.test(body)) {
          errors.push(`CCProgram ${ref.program} must contain vec4 ${ref.entry}() -- the pass declares ${stage}: ${ref.program}:${ref.entry}.`);
        }
      }
    }
  }

  // Bodies used by the varying cross-check below.
  const vsBody = stageRefs.vert.length ? programs.get(stageRefs.vert[0].program) : undefined;
  const fsBody = stageRefs.frag.length ? programs.get(stageRefs.frag[0].program) : undefined;
  const vsMatch = vsBody === undefined ? null : [null, vsBody];
  const fsMatch = fsBody === undefined ? null : [null, fsBody];

  // Surface effects carry an extra contract: the surface hooks plus the
  // shading-entry includes that supply main() and lighting.
  if (isSurfaceEffect) {
    const surfaceFs = programs.get('surface-fragment');
    if (surfaceFs === undefined) {
      errors.push('Missing CCProgram surface-fragment %{ ... }% block');
    } else if (!/CC_SURFACES_FRAGMENT_MODIFY_/.test(surfaceFs)) {
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
  }

  // 2b. Sampler names cannot be reached through a #define.
  checkSamplerNames(programs, errors, warnings);

  // 2c. `in` variables are read-only.
  checkReadOnlyInputs(programs, errors);

  // 2d. A #define must not shadow a declared variable name.
  checkDefineShadowing(programs, errors);

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

  // 4. Check for residual unlowered Unity syntax in active code.
  // A symbol the effect itself #defines is NOT residual -- it is a deliberate
  // compatibility shim (`#define _Time vec4(cc_time.x*0.05, ...)`,
  // `#define half4 vec4`). Flagging those turns a correct port into a wall of
  // warnings, so each check names the symbol it depends on and is skipped when
  // that symbol is defined in this file.
  const definedSymbols = new Set(
    [...effectText.matchAll(/^\s*#\s*define\s+([A-Za-z_]\w*)/gm)].map(x => x[1])
  );

  const residualCheck = [
    { symbol: 'UnityObjectToClipPos', pattern: /\bUnityObjectToClipPos\b/, msg: 'Residual UnityObjectToClipPos found in GLSL' },
    { symbol: 'TRANSFORM_TEX', pattern: /\bTRANSFORM_TEX\b/, msg: 'Residual TRANSFORM_TEX macro found in GLSL' },
    { symbol: 'SAMPLE_TEXTURE2D', pattern: /\bSAMPLE_TEXTURE2D\b/, msg: 'Residual SAMPLE_TEXTURE2D macro found in GLSL' },
    { symbol: '_Time', pattern: /\b_Time\.y\b/, msg: 'Residual _Time.y variable found in GLSL' },
    { symbol: 'unity_ObjectToWorld', pattern: /\bunity_ObjectToWorld\b/, msg: 'Residual unity_ObjectToWorld found in GLSL' },
    { symbol: 'UNITY_MATRIX_MVP', pattern: /\bUNITY_MATRIX_MVP\b/, msg: 'Residual UNITY_MATRIX_MVP found in GLSL' },
    { symbol: 'fixed4', pattern: /\bfixed4\b/, msg: 'Residual fixed4 type found in GLSL' },
    { symbol: 'half4', pattern: /\bhalf4\b/, msg: 'Residual half4 type found in GLSL' },
  ];

  for (const check of residualCheck) {
    if (definedSymbols.has(check.symbol)) continue;
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
