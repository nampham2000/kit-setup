'use strict';

const fs = require('fs');
const path = require('path');
const { encodePng, decodePng, packPbrOrmTexture } = require('./unity-cocos-port/pbr-texture-packer');
const createColliderPorter = require('./unity-cocos-port/collider-porter');
const createLightPorter = require('./unity-cocos-port/light-porter');

console.log('\n======================================================');
console.log('🧪 MULTI-ROUND TESTING SUITE FOR PHASE 2');
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
// ROUND 1: PBR Texture Channel Packer
// -------------------------------------------------------------
console.log('📦 ROUND 1: Testing PBR Texture Channel Packer (PNG RGBA & ORM)...');

const tempDir = path.join(__dirname, '../../temp_test_phase2');
fs.mkdirSync(tempDir, { recursive: true });

const testMetallicPath = path.join(tempDir, 'test_metallic.png');
const testAoPath = path.join(tempDir, 'test_ao.png');
const testOrmOutPath = path.join(tempDir, 'test_packed_orm.png');

// 1. Create a 4x4 Metallic test texture: R = 200 (Metallic), G = 0, B = 0, A = 100 (Smoothness)
const metallicRgba = Buffer.alloc(4 * 4 * 4);
for (let i = 0; i < 16; i++) {
  metallicRgba[i * 4] = 200;     // Metallic
  metallicRgba[i * 4 + 1] = 0;
  metallicRgba[i * 4 + 2] = 0;
  metallicRgba[i * 4 + 3] = 100; // Smoothness (Gloss)
}
fs.writeFileSync(testMetallicPath, encodePng(4, 4, metallicRgba));

// 2. Create a 4x4 AO test texture: R = 180, G = 180 (Occlusion), B = 180, A = 255
const aoRgba = Buffer.alloc(4 * 4 * 4);
for (let i = 0; i < 16; i++) {
  aoRgba[i * 4] = 180;
  aoRgba[i * 4 + 1] = 180; // AO in G channel
  aoRgba[i * 4 + 2] = 180;
  aoRgba[i * 4 + 3] = 255;
}
fs.writeFileSync(testAoPath, encodePng(4, 4, aoRgba));

// 3. Pack into ORM
const ormResult = packPbrOrmTexture({
  metallicGlossPath: testMetallicPath,
  occlusionPath: testAoPath,
  outputPath: testOrmOutPath,
});

assert(ormResult.width === 4 && ormResult.height === 4, 'Output ORM dimensions match 4x4');
assert(fs.existsSync(testOrmOutPath), 'ORM PNG file written to disk');

// 4. Decode the output ORM and check channel mapping
const decodedOrm = decodePng(fs.readFileSync(testOrmOutPath));
const r = decodedOrm.data[0]; // AO
const g = decodedOrm.data[1]; // Roughness
const b = decodedOrm.data[2]; // Metallic
const a = decodedOrm.data[3]; // Alpha

assert(r === 180, `Red channel equals AO: expected 180, got ${r}`);
assert(g === 155, `Green channel equals Roughness (255 - 100 = 155): expected 155, got ${g}`);
assert(b === 200, `Blue channel equals Metallic: expected 200, got ${b}`);
assert(a === 255, `Alpha channel equals 255: got ${a}`);

// -------------------------------------------------------------
// ROUND 2: Rigidbody Constraints & CapsuleCollider
// -------------------------------------------------------------
console.log('\n📦 ROUND 2: Testing Rigidbody Constraints & CapsuleCollider...');

const mockBuilder = {
  objects: {},
  addedComponents: [],
  addRigidBody(nodeId, compId, config) {
    this.addedComponents.push({ type: 'cc.RigidBody', config });
  },
  addSphereCollider(nodeId, compId, config) {
    this.addedComponents.push({ type: 'cc.SphereCollider', config });
  },
  addCapsuleCollider(nodeId, compId, config) {
    this.addedComponents.push({ type: 'cc.CapsuleCollider', config });
  },
  addBoxCollider(nodeId, compId, config) {
    this.addedComponents.push({ type: 'cc.BoxCollider', config });
  },
  addDirectionalLight(nodeId, compId, doc) {
    this.addedComponents.push({ type: 'cc.DirectionalLight', doc });
  },
  addSphereLight(nodeId, compId, doc) {
    this.addedComponents.push({ type: 'cc.SphereLight', doc });
  },
  addSpotLight(nodeId, compId, doc) {
    this.addedComponents.push({ type: 'cc.SpotLight', doc });
  },
};

const colliderPorter = createColliderPorter({
  getField(doc, key, def) {
    return doc[key] !== undefined ? doc[key] : def;
  },
  unityRefGuid(ref) { return ref?.guid || ''; },
});

// Test Rigidbody with Constraints: FreezePosX (2) + FreezePosZ (8) + FreezeRotY (32) = 42
const mockRbDoc = {
  m_IsKinematic: 0,
  m_Mass: 2.5,
  m_Drag: 0.2,
  m_AngularDrag: 0.1,
  m_UseGravity: 1,
  m_Constraints: 42,
};
colliderPorter.emitRigidbody(1, 1, mockRbDoc, mockBuilder);

const emittedRb = mockBuilder.addedComponents.find(c => c.type === 'cc.RigidBody');
assert(emittedRb !== undefined, 'Rigidbody emitted');
assert(emittedRb.config.type === 1, 'Rigidbody is Dynamic (type 1)');
assert(emittedRb.config.mass === 2.5, 'Rigidbody mass is 2.5');
assert(emittedRb.config.linearFactor.x === 0 && emittedRb.config.linearFactor.y === 1 && emittedRb.config.linearFactor.z === 0,
  `LinearFactor accurately froze X & Z: (${emittedRb.config.linearFactor.x}, ${emittedRb.config.linearFactor.y}, ${emittedRb.config.linearFactor.z})`);
assert(emittedRb.config.angularFactor.x === 1 && emittedRb.config.angularFactor.y === 0 && emittedRb.config.angularFactor.z === 1,
  `AngularFactor accurately froze Y: (${emittedRb.config.angularFactor.x}, ${emittedRb.config.angularFactor.y}, ${emittedRb.config.angularFactor.z})`);

// Test CapsuleCollider (Unity height=3, radius=0.5 -> cylinderHeight = 3 - 2*0.5 = 2.0)
const mockCapsuleDoc = {
  m_Enabled: 1,
  m_IsTrigger: 1,
  m_Center: { x: 0, y: 1.5, z: 0 },
  m_Radius: 0.5,
  m_Height: 3.0,
  m_Direction: 1, // Y-axis
};
// Chữ ký thật: (nodeId, componentId, doc, gameObject, model, builder, reporter, options, unityDb)
// Test cũ truyền builder vào vị trí gameObject nên crash với
// "Cannot read properties of undefined (reading 'addCapsuleCollider')".
const capsuleGameObject = { name: 'CapsuleOwner' };
const capsuleModel = { file: 'mock/Capsule.prefab' };
const capsuleReporter = { high() {}, medium() {}, low() {}, add() {} };
colliderPorter.emitCapsuleCollider(
  1, 2, mockCapsuleDoc, capsuleGameObject, capsuleModel, mockBuilder, capsuleReporter, {}, null
);

const emittedCapsule = mockBuilder.addedComponents.find(c => c.type === 'cc.CapsuleCollider');
assert(emittedCapsule !== undefined, 'CapsuleCollider emitted');
assert(emittedCapsule.config.radius === 0.5, 'Capsule radius is 0.5');
assert(emittedCapsule.config.cylinderHeight === 2.0, `Capsule cylinderHeight is 2.0 (got ${emittedCapsule.config.cylinderHeight})`);
assert(emittedCapsule.config.direction === 1, 'Capsule direction is 1 (Y-axis)');
assert(emittedCapsule.config.isTrigger === true, 'Capsule isTrigger is true');

// -------------------------------------------------------------
// ROUND 3: Directional, Point (Sphere), and Spot Lights
// -------------------------------------------------------------
console.log('\n📦 ROUND 3: Testing Multi-Type Lighting Support...');

const lightPorter = createLightPorter({
  getField(doc, key, def) {
    return doc[key] !== undefined ? doc[key] : def;
  },
});

const mockReporter = { medium() {}, low() {}, high() {} };

// 1. Directional Light (type 1)
lightPorter.emitLight(1, 10, { m_Type: 1, m_Intensity: 2.0 }, mockBuilder, mockReporter);
const emittedDirLight = mockBuilder.addedComponents.find(c => c.type === 'cc.DirectionalLight');
assert(emittedDirLight !== undefined, 'DirectionalLight emitted for m_Type 1');

// 2. Point Light (type 2 -> SphereLight)
lightPorter.emitLight(1, 11, { m_Type: 2, m_Intensity: 1.5, m_Range: 15 }, mockBuilder, mockReporter);
const emittedSphereLight = mockBuilder.addedComponents.find(c => c.type === 'cc.SphereLight');
assert(emittedSphereLight !== undefined, 'SphereLight (Point Light) emitted for m_Type 2');

// 3. Spot Light (type 0 -> SpotLight)
lightPorter.emitLight(1, 12, { m_Type: 0, m_Intensity: 1.0, m_Range: 20, m_SpotAngle: 45 }, mockBuilder, mockReporter);
const emittedSpotLight = mockBuilder.addedComponents.find(c => c.type === 'cc.SpotLight');
assert(emittedSpotLight !== undefined, 'SpotLight emitted for m_Type 0');

// -------------------------------------------------------------
// ROUND 4: Camera Conversion (Ortho, FOV, ClearFlags, CullingMask)
// -------------------------------------------------------------
console.log('\n📦 ROUND 4: Testing Camera Conversion (Ortho, FOV, Visibility)...');

const {
  unityColorToCocos,
  unityLinearColorToCocos,
} = require('./unity-cocos-port/core-utils');

// Mock CocosPrefabBuilder addCamera
const cameraBuilder = {
  addComponent(nodeId, type, props) {
    return { type, props };
  }
};

function testAddCamera(doc) {
  const isOrthographic = Number(doc.m_Orthographic || 0) !== 0;
  const projection = isOrthographic ? 0 : 1;
  const fov = Number(doc.m_FieldOfView || 60);
  const orthoSize = Number(doc.m_OrthographicSize || 5);
  const orthoHeight = orthoSize * 2;
  const near = Number(doc.m_NearClipPlane || 0.3);
  const far = Number(doc.m_FarClipPlane || 1000);
  const unityClearFlags = Number(doc.m_ClearFlags || 1);
  let cocosClearFlags = 6;
  if (unityClearFlags === 1) cocosClearFlags = 7;
  else if (unityClearFlags === 3) cocosClearFlags = 2;
  else if (unityClearFlags === 4) cocosClearFlags = 0;
  const cullingMask = Number(doc.m_CullingMask?.m_Bits ?? 0xffffffff);

  return cameraBuilder.addComponent(1, 'cc.Camera', {
    _projection: projection,
    _fov: fov,
    _orthoHeight: orthoHeight,
    _near: near,
    _far: far,
    _clearFlags: cocosClearFlags,
    _visibility: cullingMask,
  });
}

// 1. Perspective Camera with Skybox (m_ClearFlags 1)
const persCam = testAddCamera({
  m_Orthographic: 0,
  m_FieldOfView: 45,
  m_ClearFlags: 1,
  m_CullingMask: { m_Bits: 0b1011 },
});
assert(persCam.props._projection === 1, 'Perspective projection is 1');
assert(persCam.props._fov === 45, 'FOV is 45');
assert(persCam.props._clearFlags === 7, 'Skybox clearFlags is 7');
assert(persCam.props._visibility === 11, 'Culling mask bitmask mapped to 11');

// 2. Orthographic Camera with size 7.5
const orthoCam = testAddCamera({
  m_Orthographic: 1,
  m_OrthographicSize: 7.5,
  m_ClearFlags: 2,
  m_CullingMask: { m_Bits: 0xffffffff },
});
assert(orthoCam.props._projection === 0, 'Orthographic projection is 0');
assert(orthoCam.props._orthoHeight === 15, 'OrthoHeight is 2 * 7.5 = 15.0');
assert(orthoCam.props._clearFlags === 6, 'Solid color clearFlags is 6');

// -------------------------------------------------------------
// ROUND 5: Color Space Conversion (Unity Linear <-> Cocos)
// -------------------------------------------------------------
console.log('\n📦 ROUND 5: Testing Color Space Conversion...');

const unityWhite = { r: 1.0, g: 1.0, b: 1.0, a: 1.0 };
const cocosWhite = unityColorToCocos(unityWhite);
assert(cocosWhite.r === 255 && cocosWhite.g === 255 && cocosWhite.b === 255 && cocosWhite.a === 255, 'White color maps to (255, 255, 255, 255)');

const unityHalfRed = { r: 0.5, g: 0.25, b: 0.0, a: 0.8 };
const cocosHalfRed = unityColorToCocos(unityHalfRed);
assert(cocosHalfRed.r === 128 && cocosHalfRed.g === 64 && cocosHalfRed.b === 0 && cocosHalfRed.a === 204, 'Partial color (0.5, 0.25, 0.0, 0.8) maps to (128, 64, 0, 204)');

const unityLinearHalf = { r: 0.5, g: 0.5, b: 0.5, a: 0.5019608 };
const cocosLinearHalf = unityLinearColorToCocos(unityLinearHalf);
assert(cocosLinearHalf.r === 188 && cocosLinearHalf.g === 188 && cocosLinearHalf.b === 188 && cocosLinearHalf.a === 128, 'Linear material color 0.5 is gamma-encoded to sRGB 188 before Cocos linearizes it');

// -------------------------------------------------------------
// ROUND 6: High Resolution PBR Texture Packing Benchmark
// -------------------------------------------------------------
console.log('\n📦 ROUND 6: Benchmark 256x256 PBR Texture Channel Packing...');

const largeMetallicPath = path.join(tempDir, 'large_metallic.png');
const largeAoPath = path.join(tempDir, 'large_ao.png');
const largeOrmOutPath = path.join(tempDir, 'large_packed_orm.png');

const largeMetallicBuf = Buffer.alloc(256 * 256 * 4, 128);
const largeAoBuf = Buffer.alloc(256 * 256 * 4, 200);
fs.writeFileSync(largeMetallicPath, encodePng(256, 256, largeMetallicBuf));
fs.writeFileSync(largeAoPath, encodePng(256, 256, largeAoBuf));

const packBenchStart = Date.now();
const largeOrm = packPbrOrmTexture({
  metallicGlossPath: largeMetallicPath,
  occlusionPath: largeAoPath,
  outputPath: largeOrmOutPath,
});
const packBenchTime = Date.now() - packBenchStart;

assert(largeOrm.width === 256 && largeOrm.height === 256, '256x256 ORM packed successfully');
assert(fs.existsSync(largeOrmOutPath), '256x256 ORM PNG file exists on disk');
console.log(`   ⚡ 256x256 PBR ORM Packed and Encoded in: ${packBenchTime}ms`);

// Clean up temp files
try {
  fs.rmSync(tempDir, { recursive: true, force: true });
} catch (e) {}

console.log('\n======================================================');
console.log(`📊 PHASE 2 TEST SUMMARY: ${passCount} PASSED, ${failCount} FAILED`);
console.log('======================================================\n');

if (failCount > 0) {
  process.exit(1);
}
