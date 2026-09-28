'use strict';
/**
 * Host for the Cocos Creator effect compiler ("shdc") that ships inside the installed editor.
 *
 * The editor's effect importer expands a .effect (YAML header, CCProgram blocks, engine #include chunks,
 * macro tagging, GLSL 300 -> GLSL 100 lowering) with shdc-lib.js and then compiles the WebGL1 output in a
 * WebGL context; a failure there is EFX2406. Re-implementing that expansion is how generators drift from
 * the importer, so this module loads the editor's own shdc-lib.js:
 *
 *   - effect-compiler/*.js and its node_modules (glsl-parser, glsl-tokenizer, js-yaml, ...) are extracted
 *     from <Creator>/resources/app.asar into a user-local cache keyed by the asar integrity hashes;
 *   - `cc/editor/offline-mappings` (gfx enums, Sampler.computeHash, murmurhash) is rebuilt from the
 *     engine's own transform-cache System.register modules with a minimal loader; the few rendering
 *     enums whose module drags in the pipeline are parsed from engine/cocos/rendering/define.ts;
 *   - engine chunks are registered from <engine>/editor/assets/chunks exactly like the editor does.
 *
 * Nothing is written to the Cocos project. Missing editor / cache failure throws (fail closed).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const vm = require('node:vm');
const { resolveCocosEngineRoot } = require('../cocos-engine-intrinsic-flags.cjs');

const DEFAULT_VERSION = '3.8.8';
const COMPILER_DIR = 'modules/engine-extensions/extensions/engine-extends/static/effect-compiler';
const NODE_PACKAGES = ['glsl-parser', 'glsl-tokenizer', 'js-yaml', 'argparse', 'sprintf-js', 'esprima', 'through'];

// ---------------------------------------------------------------------------------------------------------------
// Creator / engine resolution

function isEngineRoot(dir) {
  return !!dir && fs.existsSync(path.join(dir, 'editor', 'assets', 'chunks'));
}

/** Resolve {engineRoot, asarPath, version}. Order: explicit engineRoot, env, project creator.version, default 3.8.8. */
function resolveCreator(options = {}) {
  const env = options.env || process.env;
  let engineRoot = null;
  if (options.engineRoot) {
    if (!isEngineRoot(options.engineRoot)) throw new Error(`not a Cocos engine root (no editor/assets/chunks): ${options.engineRoot}`);
    engineRoot = path.resolve(options.engineRoot);
  }
  if (!engineRoot && options.projectRoot) engineRoot = resolveCocosEngineRoot(options.projectRoot, { env });
  if (!engineRoot && env.COCOS_ENGINE_ROOT && isEngineRoot(env.COCOS_ENGINE_ROOT)) engineRoot = path.resolve(env.COCOS_ENGINE_ROOT);
  if (!engineRoot) {
    const version = options.version || DEFAULT_VERSION;
    const candidates = [];
    if (env.COCOS_CREATOR_PATH) candidates.push(env.COCOS_CREATOR_PATH, path.join(env.COCOS_CREATOR_PATH, version));
    if (process.platform === 'win32') {
      candidates.push(`C:/ProgramData/cocos/editors/Creator/${version}`);
      if (env.LOCALAPPDATA) candidates.push(path.join(env.LOCALAPPDATA, 'CocosDashboard', 'resources', '.editors', 'Creator', version));
    } else if (process.platform === 'darwin') {
      candidates.push(`/Applications/Cocos/Creator/${version}/CocosCreator.app/Contents`, `/Applications/Cocos/Creator/${version}`);
    }
    for (const base of candidates) {
      for (const sub of [['resources', 'resources', '3d', 'engine'], ['Resources', 'resources', '3d', 'engine'], ['Contents', 'Resources', 'resources', '3d', 'engine']]) {
        const dir = path.join(base, ...sub);
        if (isEngineRoot(dir)) { engineRoot = path.resolve(dir); break; }
      }
      if (engineRoot) break;
    }
  }
  if (!engineRoot) {
    throw new Error('Cocos Creator engine not found: set COCOS_ENGINE_ROOT / COCOS_CREATOR_PATH or install Creator '
      + (options.version || DEFAULT_VERSION) + '. The effect compile gate fails closed without the editor compiler.');
  }
  const asarPath = path.resolve(engineRoot, '..', '..', '..', 'app.asar');
  if (!fs.existsSync(asarPath)) throw new Error(`Cocos Creator app.asar not found next to engine: ${asarPath}`);
  const versionMatch = /[\\/](\d+\.\d+\.\d+)[\\/]/.exec(engineRoot.replace(/\\/g, '/') + '/');
  return { engineRoot, asarPath, version: versionMatch ? versionMatch[1] : 'unknown' };
}

// ---------------------------------------------------------------------------------------------------------------
// asar extraction (format: pickle(uint32 size) + pickle(header json), file data after the header)

function readAsarHeader(asarPath) {
  const fd = fs.openSync(asarPath, 'r');
  try {
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    const headerPickleSize = head.readUInt32LE(4);
    const jsonSize = head.readUInt32LE(12);
    const json = Buffer.alloc(jsonSize);
    fs.readSync(fd, json, 0, jsonSize, 16);
    return { header: JSON.parse(json.toString('utf8')), dataOffset: 8 + headerPickleSize };
  } finally {
    fs.closeSync(fd);
  }
}

function asarEntries(header, prefix) {
  let node = header;
  for (const part of prefix.split('/').filter(Boolean)) {
    node = node && node.files && node.files[part];
    if (!node) return [];
  }
  const out = [];
  (function walk(n, rel) {
    if (!n.files) { out.push({ rel, entry: n }); return; }
    for (const [name, child] of Object.entries(n.files)) walk(child, rel ? `${rel}/${name}` : name);
  })(node, '');
  return out;
}

function cacheRoot(env = process.env) {
  if (env.CC_PLAYABLE_EFFECT_COMPILER_CACHE) return path.resolve(env.CC_PLAYABLE_EFFECT_COMPILER_CACHE);
  const base = env.LOCALAPPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Caches') : path.join(os.homedir(), '.cache'));
  return path.join(base, 'cc-playable', 'effect-compiler');
}

/** Extract the editor effect compiler + its npm deps once per Creator build; returns the cache directory. */
function ensureCompilerCache(creator, env = process.env) {
  const { header, dataOffset } = readAsarHeader(creator.asarPath);
  const groups = [{ prefix: COMPILER_DIR, dest: 'effect-compiler', filter: (rel) => !rel.startsWith('tests/') }];
  for (const pkg of NODE_PACKAGES) groups.push({ prefix: `node_modules/${pkg}`, dest: `node_modules/${pkg}`, filter: () => true });
  const files = [];
  const hash = crypto.createHash('sha256');
  for (const group of groups) {
    for (const { rel, entry } of asarEntries(header, group.prefix)) {
      if (!group.filter(rel) || entry.unpacked || entry.link) continue;
      files.push({ dest: `${group.dest}/${rel}`, entry });
      hash.update(`${group.dest}/${rel}:${entry.size}:${entry.integrity ? entry.integrity.hash : entry.offset}\n`);
    }
  }
  if (!files.some((f) => f.dest === 'effect-compiler/shdc-lib.js')) {
    throw new Error(`Cocos effect compiler (shdc-lib.js) not found in ${creator.asarPath}`);
  }
  const key = `${creator.version}-${hash.digest('hex').slice(0, 16)}`;
  const root = cacheRoot(env);
  const dir = path.join(root, key);
  if (fs.existsSync(path.join(dir, '.complete'))) return dir;
  fs.mkdirSync(root, { recursive: true });
  const staging = fs.mkdtempSync(path.join(root, `.staging-${key}-`));
  const fd = fs.openSync(creator.asarPath, 'r');
  try {
    for (const { dest, entry } of files) {
      const buf = Buffer.alloc(entry.size);
      if (entry.size) fs.readSync(fd, buf, 0, entry.size, dataOffset + Number(entry.offset));
      if (entry.integrity && entry.integrity.hash && entry.size) {
        const got = crypto.createHash('sha256').update(buf).digest('hex');
        if (got !== entry.integrity.hash) throw new Error(`asar integrity mismatch for ${dest}`);
      }
      const target = path.join(staging, dest);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, buf);
    }
    fs.writeFileSync(path.join(staging, '.complete'), JSON.stringify({ asar: creator.asarPath, version: creator.version, files: files.length }));
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(staging, dir);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    if (!fs.existsSync(path.join(dir, '.complete'))) throw error;
  }
  return dir;
}

// ---------------------------------------------------------------------------------------------------------------
// offline-mappings: minimal System.register loader over the engine transform cache

function transformCacheRoot(engineRoot) {
  for (const flavour of ['editor', 'preview']) {
    const dir = path.join(engineRoot, 'bin', '.cache', 'dev', flavour, 'transform-cache', 'fs');
    if (fs.existsSync(path.join(dir, 'cocos', 'gfx', 'base', 'define.js'))) return dir;
  }
  throw new Error(`engine transform cache not found under ${engineRoot}/bin/.cache/dev (open the editor once)`);
}

function loadSystemModules(root, entries) {
  const registry = new Map();
  const constantsProxy = new Proxy({}, { get: (_, key) => (key === '__esModule' ? true : false) });
  function load(file) {
    const key = path.resolve(file);
    if (registry.has(key)) return registry.get(key).exports;
    if (/virtual[\\/]/.test(key)) return constantsProxy;
    const record = { exports: {} };
    registry.set(key, record);
    const code = fs.readFileSync(key, 'utf8');
    let declaration = null;
    const System = { register: (_name, deps, factory) => { declaration = { deps, factory }; } };
    vm.runInNewContext(code, { System, Symbol, Object, Array, Math, Number, String, Error, TypeError, WeakMap, Map, Set, console, globalThis: {} }, { filename: key });
    if (!declaration) throw new Error(`not a System.register module: ${key}`);
    const exportFn = (name, value) => {
      if (typeof name === 'object') Object.assign(record.exports, name);
      else record.exports[name] = value;
      return value;
    };
    const mod = declaration.factory(exportFn, { meta: { url: key } });
    (declaration.deps || []).forEach((dep, i) => {
      const depExports = /virtual[\\/%]|^cc$|internal%/.test(dep) ? constantsProxy : load(path.resolve(path.dirname(key), dep));
      if (mod.setters && mod.setters[i]) mod.setters[i](depExports);
    });
    mod.execute();
    return record.exports;
  }
  return entries.map((entry) => load(path.join(root, entry)));
}

function parseTsEnum(source, name) {
  const m = new RegExp(`export\\s+enum\\s+${name}\\s*\\{([^}]*)\\}`).exec(source);
  if (!m) throw new Error(`enum ${name} not found`);
  const out = {};
  let next = 0;
  for (const raw of m[1].split(',')) {
    const item = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (!item) continue;
    const [k, v] = item.split('=').map((s) => s.trim());
    const value = v === undefined ? next : Number(v);
    if (!Number.isFinite(value)) throw new Error(`enum ${name}.${k} is not numeric`);
    out[k] = value;
    out[value] = k;
    next = value + 1;
  }
  return out;
}

function buildOfflineMappings(engineRoot) {
  const root = transformCacheRoot(engineRoot);
  const [gfx, samplerMod, murmur] = loadSystemModules(root, [
    'cocos/gfx/base/define.js', 'cocos/gfx/base/states/sampler.js', 'cocos/core/algorithm/murmurhash2_gc.js',
  ]);
  const renderingDefine = fs.readFileSync(path.join(engineRoot, 'cocos', 'rendering', 'define.ts'), 'utf8');
  const RenderPassStage = parseTsEnum(renderingDefine, 'RenderPassStage');
  const RenderPriority = parseTsEnum(renderingDefine, 'RenderPriority');
  const SetIndex = parseTsEnum(renderingDefine, 'SetIndex');
  const { Type, Format, FormatInfos, FormatType, ShaderStageFlagBit, DescriptorType, MemoryAccessBit, ColorMask, BlendOp,
    BlendFactor, StencilOp, ComparisonFunc, CullMode, ShadeModel, PolygonMode, PrimitiveMode, Filter, Address,
    DynamicStateFlagBit, GetTypeSize, SamplerInfo } = gfx;
  const Sampler = samplerMod.Sampler;
  if (!Type || !Format || !SamplerInfo || !Sampler || !GetTypeSize) throw new Error('engine gfx enums could not be loaded');
  const typeMap = {};
  const pairs = [['bool', 'BOOL'], ['bvec2', 'BOOL2'], ['bvec3', 'BOOL3'], ['bvec4', 'BOOL4'], ['int', 'INT'], ['ivec2', 'INT2'],
    ['ivec3', 'INT3'], ['ivec4', 'INT4'], ['uint', 'UINT'], ['uvec2', 'UINT2'], ['uvec3', 'UINT3'], ['uvec4', 'UINT4'],
    ['float', 'FLOAT'], ['vec2', 'FLOAT2'], ['vec3', 'FLOAT3'], ['vec4', 'FLOAT4'], ['mat2', 'MAT2'], ['mat3', 'MAT3'],
    ['mat4', 'MAT4'], ['mat2x3', 'MAT2X3'], ['mat2x4', 'MAT2X4'], ['mat3x2', 'MAT3X2'], ['mat3x4', 'MAT3X4'],
    ['mat4x2', 'MAT4X2'], ['mat4x3', 'MAT4X3'], ['sampler1D', 'SAMPLER1D'], ['sampler1DArray', 'SAMPLER1D_ARRAY'],
    ['sampler2D', 'SAMPLER2D'], ['sampler2DArray', 'SAMPLER2D_ARRAY'], ['sampler3D', 'SAMPLER3D'],
    ['samplerCube', 'SAMPLER_CUBE'], ['sampler', 'SAMPLER'], ['texture1D', 'TEXTURE1D'], ['texture1DArray', 'TEXTURE1D_ARRAY'],
    ['texture2D', 'TEXTURE2D'], ['texture2DArray', 'TEXTURE2D_ARRAY'], ['texture3D', 'TEXTURE3D'],
    ['textureCube', 'TEXTURE_CUBE'], ['image1D', 'IMAGE1D'], ['image1DArray', 'IMAGE1D_ARRAY'], ['image2D', 'IMAGE2D'],
    ['image2DArray', 'IMAGE2D_ARRAY'], ['image3D', 'IMAGE3D'], ['imageCube', 'IMAGE_CUBE'], ['subpassInput', 'SUBPASS_INPUT']];
  for (const [glsl, key] of pairs) { typeMap[glsl] = Type[key]; typeMap[Type[key]] = glsl; }
  Object.assign(typeMap, {
    int8_t: Type.INT, i8vec2: Type.INT2, i8vec3: Type.INT3, i8vec4: Type.INT4, uint8_t: Type.UINT, u8vec2: Type.UINT2,
    u8vec3: Type.UINT3, u8vec4: Type.UINT4, int16_t: Type.INT, i16vec2: Type.INT2, i16vec3: Type.INT3, i16vec4: Type.INT4,
    uint16_t: Type.INT, u16vec2: Type.UINT2, u16vec3: Type.UINT3, u16vec4: Type.UINT4, float16_t: Type.FLOAT,
    f16vec2: Type.FLOAT2, f16vec3: Type.FLOAT3, f16vec4: Type.FLOAT4, mat2x2: Type.MAT2, mat3x3: Type.MAT3, mat4x4: Type.MAT4,
    isampler1D: Type.SAMPLER1D, usampler1D: Type.SAMPLER1D, sampler1DShadow: Type.SAMPLER1D,
    isampler1DArray: Type.SAMPLER1D_ARRAY, usampler1DArray: Type.SAMPLER1D_ARRAY, sampler1DArrayShadow: Type.SAMPLER1D_ARRAY,
    isampler2D: Type.SAMPLER2D, usampler2D: Type.SAMPLER2D, sampler2DShadow: Type.SAMPLER2D,
    isampler2DArray: Type.SAMPLER2D_ARRAY, usampler2DArray: Type.SAMPLER2D_ARRAY, sampler2DArrayShadow: Type.SAMPLER2D_ARRAY,
    isampler3D: Type.SAMPLER3D, usampler3D: Type.SAMPLER3D, isamplerCube: Type.SAMPLER_CUBE, usamplerCube: Type.SAMPLER_CUBE,
    samplerCubeShadow: Type.SAMPLER_CUBE, iimage2D: Type.IMAGE2D, uimage2D: Type.IMAGE2D, usubpassInput: Type.SUBPASS_INPUT,
    isubpassInput: Type.SUBPASS_INPUT,
  });
  const formatMap = {};
  const formats = { bool: 'R8', bvec2: 'RG8', bvec3: 'RGB8', bvec4: 'RGBA8', int: 'R32I', ivec2: 'RG32I', ivec3: 'RGB32I',
    ivec4: 'RGBA32I', uint: 'R32UI', uvec2: 'RG32UI', uvec3: 'RGB32UI', uvec4: 'RGBA32UI', float: 'R32F', vec2: 'RG32F',
    vec3: 'RGB32F', vec4: 'RGBA32F', int8_t: 'R8I', i8vec2: 'RG8I', i8vec3: 'RGB8I', i8vec4: 'RGBA8I', uint8_t: 'R8UI',
    u8vec2: 'RG8UI', u8vec3: 'RGB8UI', u8vec4: 'RGBA8UI', int16_t: 'R16I', i16vec2: 'RG16I', i16vec3: 'RGB16I',
    i16vec4: 'RGBA16I', uint16_t: 'R16UI', u16vec2: 'RG16UI', u16vec3: 'RGB16UI', u16vec4: 'RGBA16UI', float16_t: 'R16F',
    f16vec2: 'RG16F', f16vec3: 'RGB16F', f16vec4: 'RGBA16F' };
  for (const [k, v] of Object.entries(formats)) formatMap[k] = Format[v];
  for (const k of ['mat2', 'mat3', 'mat4', 'mat2x2', 'mat3x3', 'mat4x4', 'mat2x3', 'mat2x4', 'mat3x2', 'mat3x4', 'mat4x2', 'mat4x3']) formatMap[k] = Format.RGBA32F;
  const passParams = {
    NONE: ColorMask.NONE, R: ColorMask.R, G: ColorMask.G, B: ColorMask.B, A: ColorMask.A,
    RG: ColorMask.R | ColorMask.G, RB: ColorMask.R | ColorMask.B, RA: ColorMask.R | ColorMask.A,
    GB: ColorMask.G | ColorMask.B, GA: ColorMask.G | ColorMask.A, BA: ColorMask.B | ColorMask.A,
    RGB: ColorMask.R | ColorMask.G | ColorMask.B, RGA: ColorMask.R | ColorMask.G | ColorMask.A,
    RBA: ColorMask.R | ColorMask.B | ColorMask.A, GBA: ColorMask.G | ColorMask.B | ColorMask.A, ALL: ColorMask.ALL,
    ADD: BlendOp.ADD, SUB: BlendOp.SUB, REV_SUB: BlendOp.REV_SUB, MIN: BlendOp.MIN, MAX: BlendOp.MAX,
    ZERO: BlendFactor.ZERO, ONE: BlendFactor.ONE, SRC_ALPHA: BlendFactor.SRC_ALPHA, DST_ALPHA: BlendFactor.DST_ALPHA,
    ONE_MINUS_SRC_ALPHA: BlendFactor.ONE_MINUS_SRC_ALPHA, ONE_MINUS_DST_ALPHA: BlendFactor.ONE_MINUS_DST_ALPHA,
    SRC_COLOR: BlendFactor.SRC_COLOR, DST_COLOR: BlendFactor.DST_COLOR, ONE_MINUS_SRC_COLOR: BlendFactor.ONE_MINUS_SRC_COLOR,
    ONE_MINUS_DST_COLOR: BlendFactor.ONE_MINUS_DST_COLOR, SRC_ALPHA_SATURATE: BlendFactor.SRC_ALPHA_SATURATE,
    CONSTANT_COLOR: BlendFactor.CONSTANT_COLOR, ONE_MINUS_CONSTANT_COLOR: BlendFactor.ONE_MINUS_CONSTANT_COLOR,
    CONSTANT_ALPHA: BlendFactor.CONSTANT_ALPHA, ONE_MINUS_CONSTANT_ALPHA: BlendFactor.ONE_MINUS_CONSTANT_ALPHA,
    KEEP: StencilOp.KEEP, REPLACE: StencilOp.REPLACE, INCR: StencilOp.INCR, DECR: StencilOp.DECR, INVERT: StencilOp.INVERT,
    INCR_WRAP: StencilOp.INCR_WRAP, DECR_WRAP: StencilOp.DECR_WRAP,
    NEVER: ComparisonFunc.NEVER, LESS: ComparisonFunc.LESS, EQUAL: ComparisonFunc.EQUAL, LESS_EQUAL: ComparisonFunc.LESS_EQUAL,
    GREATER: ComparisonFunc.GREATER, NOT_EQUAL: ComparisonFunc.NOT_EQUAL, GREATER_EQUAL: ComparisonFunc.GREATER_EQUAL,
    ALWAYS: ComparisonFunc.ALWAYS, FRONT: CullMode.FRONT, BACK: CullMode.BACK, GOURAND: ShadeModel.GOURAND,
    FLAT: ShadeModel.FLAT, FILL: PolygonMode.FILL, LINE: PolygonMode.LINE, POINT: PolygonMode.POINT,
    POINT_LIST: PrimitiveMode.POINT_LIST, LINE_LIST: PrimitiveMode.LINE_LIST, LINE_STRIP: PrimitiveMode.LINE_STRIP,
    LINE_LOOP: PrimitiveMode.LINE_LOOP, TRIANGLE_LIST: PrimitiveMode.TRIANGLE_LIST,
    TRIANGLE_STRIP: PrimitiveMode.TRIANGLE_STRIP, TRIANGLE_FAN: PrimitiveMode.TRIANGLE_FAN,
    LINE_LIST_ADJACENCY: PrimitiveMode.LINE_LIST_ADJACENCY, LINE_STRIP_ADJACENCY: PrimitiveMode.LINE_STRIP_ADJACENCY,
    TRIANGLE_LIST_ADJACENCY: PrimitiveMode.TRIANGLE_LIST_ADJACENCY, TRIANGLE_STRIP_ADJACENCY: PrimitiveMode.TRIANGLE_STRIP_ADJACENCY,
    TRIANGLE_PATCH_ADJACENCY: PrimitiveMode.TRIANGLE_PATCH_ADJACENCY, QUAD_PATCH_LIST: PrimitiveMode.QUAD_PATCH_LIST,
    ISO_LINE_LIST: PrimitiveMode.ISO_LINE_LIST, LINEAR: Filter.LINEAR, ANISOTROPIC: Filter.ANISOTROPIC,
    WRAP: Address.WRAP, MIRROR: Address.MIRROR, CLAMP: Address.CLAMP, BORDER: Address.BORDER,
    LINE_WIDTH: DynamicStateFlagBit.LINE_WIDTH, DEPTH_BIAS: DynamicStateFlagBit.DEPTH_BIAS,
    BLEND_CONSTANTS: DynamicStateFlagBit.BLEND_CONSTANTS, DEPTH_BOUNDS: DynamicStateFlagBit.DEPTH_BOUNDS,
    STENCIL_WRITE_MASK: DynamicStateFlagBit.STENCIL_WRITE_MASK, STENCIL_COMPARE_MASK: DynamicStateFlagBit.STENCIL_COMPARE_MASK,
    TRUE: true, FALSE: false,
  };
  for (const [k, v] of Object.entries(RenderPassStage)) if (typeof v === 'number') passParams[k] = v;
  return {
    murmurhash2_32_gc: murmur.murmurhash2_32_gc,
    murmurhash: murmur.murmurhash2_32_gc,
    Sampler, SamplerInfo,
    effectStructure: { $techniques: [{ $passes: [{ depthStencilState: {}, rasterizerState: {}, blendState: { targets: [{}] },
      properties: { any: { sampler: {}, editor: {} } }, migrations: { properties: { any: {} }, macros: { any: {} } }, embeddedMacros: {} }] }] },
    isSampler: (type) => type >= Type.SAMPLER1D,
    typeMap, formatMap,
    getFormat: (name) => Format[name.toUpperCase()],
    getShaderStage: (name) => ShaderStageFlagBit[name.toUpperCase()],
    getDescriptorType: (name) => DescriptorType[name.toUpperCase()],
    isNormalized: (format) => { const t = FormatInfos[format] && FormatInfos[format].type; return t === FormatType.UNORM || t === FormatType.SNORM; },
    isPaddedMatrix: (type) => type >= Type.MAT2 && type < Type.MAT4,
    getMemoryAccessFlag: (a) => (a === 'writeonly' ? MemoryAccessBit.WRITE_ONLY : a === 'readonly' ? MemoryAccessBit.READ_ONLY : MemoryAccessBit.READ_WRITE),
    passParams, SetIndex, RenderPriority, GetTypeSize,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// compiler instance

function listChunks(dir) {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.endsWith('.chunk')) out.push(full);
    }
  })(dir);
  return out;
}

let cachedHost = null;

/**
 * Load the editor effect compiler. Returns { creator, build(name, content, ctx) }.
 * build() returns { effect, errors[], warnings[] } and never throws on effect errors.
 */
function loadEffectCompiler(options = {}) {
  const creator = resolveCreator(options);
  if (cachedHost && cachedHost.creator.engineRoot === creator.engineRoot) return cachedHost;
  const cacheDir = ensureCompilerCache(creator, options.env);
  const compilerDir = path.join(cacheDir, 'effect-compiler');
  const mappingsPath = path.join(compilerDir, 'offline-mappings.js');
  const mappingsModule = new Module(mappingsPath, null);
  mappingsModule.filename = mappingsPath;
  mappingsModule.exports = buildOfflineMappings(creator.engineRoot);
  mappingsModule.loaded = true;
  const req = Module.createRequire(path.join(compilerDir, 'index.js'));
  const shdcPath = req.resolve('./shdc-lib.js');
  // shdc-lib keeps module-level state; give every host its own instance.
  delete require.cache[shdcPath];
  require.cache[req.resolve('./offline-mappings.js')] = mappingsModule;
  // shdc binds console.error/console.warn when it loads; route them through a switchable sink.
  const sink = { error: null, warn: null };
  const savedError = console.error;
  const savedWarn = console.warn;
  console.error = (...args) => (sink.error ? sink.error(...args) : savedError(...args));
  console.warn = (...args) => (sink.warn ? sink.warn(...args) : savedWarn(...args));
  let shdc;
  try {
    shdc = req('./shdc-lib.js');
  } finally {
    const errorForwarder = console.error;
    const warnForwarder = console.warn;
    console.error = savedError;
    console.warn = savedWarn;
    sink.errorForwarder = errorForwarder;
    sink.warnForwarder = warnForwarder;
  }
  const chunksDir = path.join(creator.engineRoot, 'editor', 'assets', 'chunks');
  const engineChunks = new Map();
  for (const file of listChunks(chunksDir)) {
    const key = path.relative(chunksDir, file).replace(/\\/g, '/').replace(/\.chunk$/, '');
    engineChunks.set(key, file);
  }
  // The editor registers the top-level chunks eagerly and resolves the rest through chunkSearchFn.
  for (const [key, file] of engineChunks) if (!key.includes('/')) shdc.addChunk(key, fs.readFileSync(file, 'utf8'));
  const byBasename = new Map();
  for (const key of engineChunks.keys()) {
    const base = key.split('/').pop();
    if (!byBasename.has(base)) byBasename.set(base, []);
    byBasename.get(base).push(key);
  }
  let context = { effectDir: null, assetsRoot: null, resolved: [] };
  const typeCheckSources = [];
  const recordingGl = {
    VERTEX_SHADER: 0x8b31, FRAGMENT_SHADER: 0x8b30, MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8b4c, COMPILE_STATUS: 0x8b81, LINK_STATUS: 0x8b82,
    getSupportedExtensions: () => [], getExtension: () => null,
    getParameter: (p) => (p === 0x8b4c ? 16 : 0),
    createShader: (type) => ({ type }),
    shaderSource: (shader, source) => { shader.source = source; typeCheckSources.push(shader); },
    compileShader: () => {}, getShaderParameter: () => true, getShaderInfoLog: () => '', deleteShader: () => {},
    createProgram: () => ({}), attachShader: () => {}, linkProgram: () => {}, getProgramParameter: () => true,
    getProgramInfoLog: () => '', deleteProgram: () => {},
  };
  const recordingDocument = { createElement: () => ({ getContext: () => recordingGl }) };
  shdc.options.throwOnError = false;
  shdc.options.throwOnWarning = false;
  shdc.options.noSource = false;
  // Built-in effects fail the tokenizer-based glsl1 parser test (EFX2404) yet import cleanly: the importer skips it.
  shdc.options.skipParserTest = true;
  shdc.options.chunkSearchFn = (names) => {
    for (const name of names) {
      const dirs = [context.effectDir, context.assetsRoot].filter(Boolean);
      for (const dir of dirs) {
        const file = path.resolve(dir, `${name}.chunk`);
        if (fs.existsSync(file)) { context.resolved.push(file); return { name, content: fs.readFileSync(file, 'utf8') }; }
      }
      if (engineChunks.has(name)) return { name, content: fs.readFileSync(engineChunks.get(name), 'utf8') };
      // engine sources include paths relative to the chunks folder (e.g. ../effects/advanced/common-functions)
      const engineRelative = path.resolve(chunksDir, `${name}.chunk`);
      if (engineRelative.startsWith(path.resolve(creator.engineRoot)) && fs.existsSync(engineRelative)) {
        return { name, content: fs.readFileSync(engineRelative, 'utf8') };
      }
    }
    return { name: undefined, content: undefined };
  };
  shdc.options.getAlternativeChunkPaths = (name) => (name.includes('/') ? [] : (byBasename.get(name) || []));

  function build(name, content, ctx = {}) {
    context = { effectDir: ctx.effectDir || null, assetsRoot: ctx.assetsRoot || null, resolved: [] };
    const errors = [];
    const warnings = [];
    sink.error = (...args) => errors.push(args.map(String).join(' '));
    sink.warn = (...args) => warnings.push(args.map(String).join(' '));
    let effect = null;
    const hadDocument = Object.prototype.hasOwnProperty.call(globalThis, 'document');
    const previousDocument = globalThis.document;
    typeCheckSources.length = 0;
    try {
      // shdc's finalTypeCheck compiles glsl1 in a WebGL context when `document` exists; the recording
      // context below captures exactly the sources (and macro values) the editor would compile.
      if (!hadDocument) globalThis.document = recordingDocument;
      effect = shdc.buildEffect(name, content);
    } catch (error) {
      errors.push(String(error && error.message ? error.message : error));
    } finally {
      sink.error = null;
      sink.warn = null;
      if (!hadDocument) delete globalThis.document;
      else globalThis.document = previousDocument;
    }
    const editorChecks = [];
    for (let i = 0; i + 1 < typeCheckSources.length; i += 2) {
      editorChecks.push({ vert: typeCheckSources[i].source, frag: typeCheckSources[i + 1].source });
    }
    if (effect) {
      // finalTypeCheck runs once per new graphics program, in effect.shaders order (before whitespace stripping).
      const graphics = effect.shaders.filter((shader) => shader.glsl1 && shader.glsl1.vert && shader.glsl1.frag);
      if (graphics.length === editorChecks.length) {
        graphics.forEach((shader, i) => Object.defineProperty(shader, 'editorTypeCheck', { value: editorChecks[i], enumerable: false }));
      }
    }
    if (!effect && !errors.length) errors.push(`${name}.effect: effect compiler produced no output`);
    return { effect, errors, warnings, resolvedChunks: context.resolved.slice(), editorChecks };
  }

  cachedHost = { creator, cacheDir, build };
  return cachedHost;
}

module.exports = {
  resolveCreator,
  ensureCompilerCache,
  buildOfflineMappings,
  loadEffectCompiler,
  cacheRoot,
};
