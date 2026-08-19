'use strict';

/**
 * Shader Intermediate Representation (IR) Data Structures
 * for Unity HLSL/ShaderLab -> Cocos Creator 3.8.8 Transpiler (UCShaderTranspiler)
 */

/**
 * @typedef {'float'|'int'|'bool'|'vec2'|'vec3'|'vec4'|'mat2'|'mat3'|'mat4'|'sampler2D'|'samplerCube'|'sampler3D'} ShaderDataType
 */

/**
 * Creates a ShaderDocumentIR
 */
function createShaderDocumentIR(options = {}) {
  return {
    sourceFile: options.sourceFile || '',
    shaderName: options.shaderName || '',
    family: options.family || 'CustomVertexFragment', // 'CustomVertexFragment' | 'Unlit' | 'Toon' | 'MatCap' | 'PBR' | 'Surface' | 'Sprite' | 'Particle' | 'Unknown'
    properties: options.properties || [],
    subShaders: options.subShaders || [],
    fallBack: options.fallBack || 'Off',
    dependencies: options.dependencies || [],
    diagnostics: options.diagnostics || [],
    customEditor: options.customEditor || '',
  };
}

/**
 * Creates a ShaderPropertyIR
 */
function createShaderPropertyIR(options = {}) {
  return {
    name: options.name || '',
    displayName: options.displayName || options.name || '',
    type: options.type || 'Float', // 'Float' | 'Range' | 'Color' | 'Vector' | '2D' | 'Cube' | '3D' | 'Int'
    range: options.range || null, // [min, max]
    defaultValue: options.defaultValue !== undefined ? options.defaultValue : null,
    attributes: options.attributes || [], // e.g. ['Header', 'Toggle', 'HDR', 'MainTexture', 'MainColor']
    cocosName: options.cocosName || '',
    cocosType: options.cocosType || '',
    editor: options.editor || {},
    textureDefault: options.textureDefault || 'white', // 'white' | 'black' | 'gray' | 'bump'
  };
}

/**
 * Creates a SubShaderIR
 */
function createSubShaderIR(options = {}) {
  return {
    index: options.index || 0,
    tags: options.tags || {},
    lod: options.lod || 100,
    renderState: options.renderState || createRenderStateIR(),
    passes: options.passes || [],
  };
}

/**
 * Creates a ShaderPassIR
 */
function createShaderPassIR(options = {}) {
  return {
    id: options.id || '',
    name: options.name || '',
    lightMode: options.lightMode || '',
    tags: options.tags || {},
    renderState: options.renderState || createRenderStateIR(),
    program: options.program || createShaderProgramIR(),
    isGrabPass: options.isGrabPass || false,
    grabTextureName: options.grabTextureName || '',
    usePass: options.usePass || '',
  };
}

/**
 * Creates a RenderStateIR
 */
function createRenderStateIR(options = {}) {
  return {
    cull: options.cull || 'back', // 'back' | 'front' | 'none' | 'off'
    zWrite: options.zWrite !== undefined ? options.zWrite : true,
    zTest: options.zTest || 'LEqual', // 'Less' | 'LEqual' | 'Equal' | 'GEqual' | 'Greater' | 'NotEqual' | 'Always' | 'Off'
    blend: options.blend || null, // { enabled: boolean, srcRGB: string, dstRGB: string, srcAlpha: string, dstAlpha: string, opRGB: string, opAlpha: string }
    colorMask: options.colorMask || 'RGBA',
    stencil: options.stencil || null, // { ref, comp, pass, fail, zFail, readMask, writeMask }
    queue: options.queue || 'Geometry', // 'Background' | 'Geometry' | 'AlphaTest' | 'Transparent' | 'Overlay'
    renderType: options.renderType || 'Opaque',
  };
}

/**
 * Creates a ShaderProgramIR
 */
function createShaderProgramIR(options = {}) {
  return {
    language: options.language || 'hlsl', // 'hlsl' | 'cg'
    vertexEntry: options.vertexEntry || 'vert',
    fragmentEntry: options.fragmentEntry || 'frag',
    target: options.target || '3.0',
    defines: options.defines || [],
    includes: options.includes || [],
    keywords: options.keywords || [],
    pragmas: options.pragmas || [],
    rawHlsl: options.rawHlsl || '',
    structs: options.structs || [],
    functions: options.functions || [],
    uniforms: options.uniforms || [],
    samplers: options.samplers || [],
    stageInputs: options.stageInputs || [],
    stageOutputs: options.stageOutputs || [],
    features: options.features || {},
  };
}

/**
 * Creates a DiagnosticIR
 */
function createDiagnosticIR(options = {}) {
  return {
    code: options.code || 'UCST-INFO',
    severity: options.severity || 'info', // 'info' | 'warning' | 'error' | 'high' | 'medium' | 'low'
    category: options.category || 'general', // 'parse' | 'semantic' | 'render-state' | 'resource' | 'unsupported' | 'validation'
    message: options.message || '',
    sourceFile: options.sourceFile || '',
    line: options.line || 0,
    column: options.column || 0,
    suggestion: options.suggestion || '',
    confidenceImpact: options.confidenceImpact || 0,
  };
}

module.exports = {
  createShaderDocumentIR,
  createShaderPropertyIR,
  createSubShaderIR,
  createShaderPassIR,
  createRenderStateIR,
  createShaderProgramIR,
  createDiagnosticIR,
};
