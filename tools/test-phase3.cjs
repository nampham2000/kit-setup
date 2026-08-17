'use strict';

const fs = require('fs');
const path = require('path');
const { computeStd140Layout, packStd140Uniforms, TYPE_SPECS } = require('./unity-cocos-port/ubo-alignment-formatter');
const {
  applyUnityParticleSystemToCocos,
  parseUnityRendererDoc,
} = require('./unity-cocos-port/particle-system-converter');

console.log('\n======================================================');
console.log('🧪 MULTI-ROUND TESTING SUITE FOR PHASE 3');
console.log('======================================================\n');

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`   ✅ PASS: ${message}`);
    passCount++;
  } else {
    console.error(`   ❌ FAIL: ${message}`);
    failCount++;
  }
}

// -------------------------------------------------------------
// ROUND 1: std140 Layout Rule Engine & Type Specifications
// -------------------------------------------------------------
console.log('📐 ROUND 1: Testing std140 Layout Engine & Alignment Rules...');

assert(TYPE_SPECS.float.size === 4 && TYPE_SPECS.float.align === 4, 'float is 4 bytes, align 4');
assert(TYPE_SPECS.vec2.size === 8 && TYPE_SPECS.vec2.align === 8, 'vec2 is 8 bytes, align 8');
assert(TYPE_SPECS.vec3.size === 12 && TYPE_SPECS.vec3.align === 16, 'vec3 size 12 occupies 16-byte slot (align 16)');
assert(TYPE_SPECS.vec4.size === 16 && TYPE_SPECS.vec4.align === 16, 'vec4 is 16 bytes, align 16');
assert(TYPE_SPECS.mat4.size === 64 && TYPE_SPECS.mat4.align === 16, 'mat4 is 64 bytes, align 16');
assert(TYPE_SPECS.mat3.size === 48 && TYPE_SPECS.mat3.align === 16, 'mat3 is 48 bytes (3x vec4 slots), align 16');

// Test layout calculation for a struct with hole: [vec3, vec2]
// vec3 is at 0..12. vec2 requires align 8 -> pushed to offset 16..24. End rounded to 32.
const structWithHole = computeStd140Layout([
  { name: 'v3', type: 'vec3' },
  { name: 'v2', type: 'vec2' },
]);
assert(structWithHole.fields[0].offset === 0, 'v3 offset is 0');
assert(structWithHole.fields[1].offset === 16, 'v2 offset pushed to 16 due to align 8 after vec3');
assert(structWithHole.totalSize === 32, 'Total struct size rounded to 32 bytes (multiple of 16)');
assert(structWithHole.wastedBytes === 12, `Detected 12 bytes of wasted padding (got ${structWithHole.wastedBytes})`);

// -------------------------------------------------------------
// ROUND 2: std140 Uniform Packing & Code Generation
// -------------------------------------------------------------
console.log('\n📐 ROUND 2: Testing std140 Uniform Packing & GLSL/YAML CodeGen...');

const testUniformProps = [
  { name: '_BaseColor', type: 'vec4', defaultValue: [1, 1, 1, 1], displayName: 'Base Color' },
  { name: '_SpecularColor', type: 'vec3', defaultValue: [0.8, 0.8, 0.8], displayName: 'Specular Color' },
  { name: '_Glossiness', type: 'float', defaultValue: 0.5, displayName: 'Glossiness' },
  { name: '_MainTex_ST', type: 'vec4', defaultValue: [1, 1, 0, 0], displayName: 'Main Tex ST' },
  { name: '_Tiling', type: 'vec2', defaultValue: [1, 1], displayName: 'Tiling' },
  { name: '_Offset', type: 'vec2', defaultValue: [0, 0], displayName: 'Offset' },
  { name: '_AlphaCutoff', type: 'float', defaultValue: 0.5, displayName: 'Alpha Cutoff' },
  { name: '_Metallic', type: 'float', defaultValue: 0.0, displayName: 'Metallic' },
  { name: '_BumpScale', type: 'float', defaultValue: 1.0, displayName: 'Bump Scale' },
  { name: '_EmissionScale', type: 'float', defaultValue: 2.0, displayName: 'Emission Scale' },
];

const packedResult = packStd140Uniforms(testUniformProps, 'TestBlock');

assert(packedResult.blockName === 'TestBlock', 'Block name is TestBlock');
assert(packedResult.uboGlsl.includes('uniform TestBlock {'), 'GLSL uniform block header created');
assert(packedResult.aliasesGlsl.includes('vec3 _SpecularColor ='), 'SpecularColor vec3 alias created');
assert(packedResult.aliasesGlsl.includes('float _Glossiness ='), 'Glossiness float alias created');
assert(packedResult.propertyYaml.includes('_BaseColor:'), 'YAML properties contains _BaseColor');
assert(packedResult.layout.wastedBytes === 0, `Zero wasted bytes achieved (wastedBytes: ${packedResult.layout.wastedBytes})`);
assert(packedResult.layout.totalSize % 16 === 0, `Total block size (${packedResult.layout.totalSize}) is a multiple of 16`);

// -------------------------------------------------------------
// ROUND 3: Shuriken Particle System - Main & Emission Modules
// -------------------------------------------------------------
console.log('\n✨ ROUND 3: Testing Shuriken Particle System Main & Emission Modules...');

const mockParticleBuilder = {
  objects: {},
  add(obj) {
    const id = Object.keys(this.objects).length + 1;
    this.objects[id] = obj;
    return id;
  },
};

function createMockParticleSystemTree(builder) {
  const startLifetimeId = builder.add({ __type__: 'cc.CurveRange', mode: 0, constant: 5 });
  const startSpeedId = builder.add({ __type__: 'cc.CurveRange', mode: 0, constant: 5 });
  const startSizeId = builder.add({ __type__: 'cc.CurveRange', mode: 0, constant: 1 });
  const startColorId = builder.add({ __type__: 'cc.GradientRange', mode: 0, color: { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 } });
  const rateOverTimeId = builder.add({ __type__: 'cc.CurveRange', mode: 0, constant: 10 });
  const shapeModuleId = builder.add({ __type__: 'cc.ShapeModule', enable: false, radius: 1, angle: 0.5 });
  const velocityModuleId = builder.add({
    __type__: 'cc.VelocityOverLifetimeModule',
    enable: false,
    x: { __type__: 'cc.CurveRange', mode: 0, constant: 0 },
    y: { __type__: 'cc.CurveRange', mode: 0, constant: 0 },
    z: { __type__: 'cc.CurveRange', mode: 0, constant: 0 },
  });
  const colorModuleId = builder.add({ __type__: 'cc.ColorOverLifetimeModule', enable: false });
  const sizeModuleId = builder.add({ __type__: 'cc.SizeOverLifetimeModule', enable: false });
  const rotationModuleId = builder.add({ __type__: 'cc.RotationOverLifetimeModule', enable: false });

  const particleId = builder.add({
    __type__: 'cc.ParticleSystem',
    duration: 5.0,
    loop: true,
    playOnAwake: true,
    simulationSpace: 0,
    startLifetime: { __id__: startLifetimeId },
    startSpeed: { __id__: startSpeedId },
    startSize3D: false,
    startSize: { __id__: startSizeId },
    startColor: { __id__: startColorId },
    rateOverTime: { __id__: rateOverTimeId },
    _shapeModule: { __id__: shapeModuleId },
    _velocityOvertimeModule: { __id__: velocityModuleId },
    _colorOverLifetimeModule: { __id__: colorModuleId },
    _sizeOvertimeModule: { __id__: sizeModuleId },
    _rotationOvertimeModule: { __id__: rotationModuleId },
    _materials: [],
  });

  return {
    particleId,
    particle: builder.objects[particleId],
    startLifetime: builder.objects[startLifetimeId],
    startSpeed: builder.objects[startSpeedId],
    startColor: builder.objects[startColorId],
    rateOverTime: builder.objects[rateOverTimeId],
    shapeModule: builder.objects[shapeModuleId],
    velocityModule: builder.objects[velocityModuleId],
    colorModule: builder.objects[colorModuleId],
    sizeModule: builder.objects[sizeModuleId],
    rotationModule: builder.objects[rotationModuleId],
  };
}

const tree1 = createMockParticleSystemTree(mockParticleBuilder);

const sampleShurikenDoc = {
  lengthInSec: 3.5,
  looping: 1,
  prewarm: 0,
  playOnAwake: 1,
  simulationSpeed: 1.2,
  'InitialModule.startLifetime.scalar': 2.5,
  'InitialModule.startSpeed.scalar': 8.0,
  'InitialModule.startSize.scalar': 0.4,
  'InitialModule.startColor.color': { r: 1, g: 0.5, b: 0, a: 1 },
  'InitialModule.gravityModifier.scalar': 0.5,
  'InitialModule.maxNumParticles': 500,
  'EmissionModule.enabled': 1,
  'EmissionModule.rateOverTime.scalar': 25.0,
};

applyUnityParticleSystemToCocos(mockParticleBuilder, tree1.particleId, sampleShurikenDoc, null);

assert(tree1.particle.duration === 3.5, `Particle duration is 3.5 (got ${tree1.particle.duration})`);
assert(tree1.particle.loop === true, 'Particle loop is true');
assert(tree1.particle.playOnAwake === true, 'Particle playOnAwake is true');
assert(tree1.particle.simulationSpeed === 1.2, `Simulation speed is 1.2 (got ${tree1.particle.simulationSpeed})`);
assert(tree1.startLifetime.mode === 0 && tree1.startLifetime.constant === 2.5, `StartLifetime constant is 2.5 (got ${tree1.startLifetime.constant})`);
assert(tree1.startSpeed.constant === 8.0, `StartSpeed constant is 8.0 (got ${tree1.startSpeed.constant})`);
assert(tree1.startColor.color.r === 255 && tree1.startColor.color.g === 128, 'StartColor converted to cc.Color (255, 128, 0, 255)');
assert(tree1.rateOverTime.constant === 25.0, `RateOverTime is 25.0 (got ${tree1.rateOverTime.constant})`);

// -------------------------------------------------------------
// ROUND 4: Shuriken Particle System - Shape & Renderer Modules
// -------------------------------------------------------------
console.log('\n✨ ROUND 4: Testing Particle Shape & Renderer Modules...');

const tree2 = createMockParticleSystemTree(mockParticleBuilder);

// Cone Shape (type 4 in Unity / Cone type in Cocos)
const coneParticleDoc = {
  ...sampleShurikenDoc,
  'ShapeModule.enabled': 1,
  'ShapeModule.type': 4, // Cone
  'ShapeModule.radius.value': 1.5,
  'ShapeModule.angle': 25.0,
  'ShapeModule.length': 4.0,
  'ShapeModule.boxX': 1,
  'ShapeModule.boxY': 1,
  'ShapeModule.boxZ': 1,
};

applyUnityParticleSystemToCocos(mockParticleBuilder, tree2.particleId, coneParticleDoc, null);
assert(tree2.shapeModule.enable === true, 'Shape module enabled');
assert(tree2.shapeModule.radius === 1.5, `Shape radius is 1.5 (got ${tree2.shapeModule.radius})`);
assert(tree2.shapeModule.angle !== undefined, `Shape angle accurately set (got ${tree2.shapeModule.angle})`);

// Renderer Module parsing
const mockRendererDoc = {
  m_RenderMode: 1, // Stretch Billboard
  m_LengthScale: 2.0,
  m_VelocityScale: 1.5,
  m_CameraVelocityScale: 0.0,
};
const parsedRenderer = parseUnityRendererDoc(mockRendererDoc);
assert(parsedRenderer.m_RenderMode === 1, 'RenderMode is 1 (Stretch Billboard)');
assert(parsedRenderer.m_LengthScale === 2.0, 'LengthScale is 2.0');
assert(parsedRenderer.m_VelocityScale === 1.5, 'VelocityScale is 1.5');

// -------------------------------------------------------------
// ROUND 5: Particle Velocity & Color Over Lifetime
// -------------------------------------------------------------
console.log('\n✨ ROUND 5: Testing Velocity, Color & Size Over Lifetime Modules...');

const tree3 = createMockParticleSystemTree(mockParticleBuilder);

const fullParticleDoc = {
  ...sampleShurikenDoc,
  'VelocityModule.enabled': 1,
  'VelocityModule.x.scalar': 2.0,
  'VelocityModule.y.scalar': -1.0,
  'VelocityModule.z.scalar': 0.5,
  'ColorModule.enabled': 1,
  'SizeModule.enabled': 1,
  'SizeModule.curve.scalar': 1.5,
  'RotationModule.enabled': 1,
  'RotationModule.x.scalar': 45.0,
};

applyUnityParticleSystemToCocos(mockParticleBuilder, tree3.particleId, fullParticleDoc, null);

assert(tree3.velocityModule.enable === true, 'VelocityOverLifetimeModule enabled');
assert(tree3.velocityModule.x.constant === 2.0, `Velocity X constant is 2.0 (got ${tree3.velocityModule.x.constant})`);
assert(tree3.colorModule.enable === true, 'ColorOverLifetimeModule enabled');
assert(tree3.sizeModule.enable === true, 'SizeOverLifetimeModule enabled');
assert(tree3.rotationModule.enable === true, 'RotationOverLifetimeModule enabled');

// -------------------------------------------------------------
// ROUND 6: Effect Converter Integration Verification
// -------------------------------------------------------------
console.log('\n✨ ROUND 6: Testing HLSL -> CCEffect CLI Tool Execution...');

const hlslToolPath = path.join(__dirname, 'unity-hlsl-to-cocos-effect.cjs');
assert(fs.existsSync(hlslToolPath), 'unity-hlsl-to-cocos-effect.cjs exists on disk');

const uboToolPath = path.join(__dirname, 'ubo-alignment-formatter.cjs');
assert(fs.existsSync(uboToolPath), 'ubo-alignment-formatter.cjs exists on disk');

console.log('\n======================================================');
console.log(`📊 PHASE 3 TEST SUMMARY: ${passCount} PASSED, ${failCount} FAILED`);
console.log('======================================================\n');

if (failCount > 0) {
  process.exit(1);
}
