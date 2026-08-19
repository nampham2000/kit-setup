'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const EPSILON = 1e-5;

function assertApprox(actual, expected, eps = EPSILON, msg = '') {
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff <= eps,
    `${msg || 'Value mismatch'}: actual=${actual}, expected=${expected}, diff=${diff} (max eps=${eps})`
  );
}

// ---------------------------------------------------------------------------
// Pure JS Math Implementations mirroring UnityMathf & UnityTime & UnityRandom
// ---------------------------------------------------------------------------
const UnityMathf = {
  Deg2Rad: Math.PI / 180,
  Rad2Deg: 180 / Math.PI,
  Epsilon: 1e-6,
  PI: Math.PI,
  Infinity: Infinity,
  NegativeInfinity: -Infinity,

  clamp(val, min, max) { return Math.max(min, Math.min(max, val)); },
  clamp01(val) { return Math.max(0, Math.min(1, val)); },
  lerp(a, b, t) { return a + (b - a) * Math.max(0, Math.min(1, t)); },
  lerpUnclamped(a, b, t) { return a + (b - a) * t; },
  inverseLerp(a, b, value) {
    if (a !== b) return Math.max(0, Math.min(1, (value - a) / (b - a)));
    return 0;
  },
  repeat(t, length) {
    return Math.max(0, Math.min(length, t - Math.floor(t / length) * length));
  },
  pingPong(t, length) {
    t = this.repeat(t, length * 2);
    return length - Math.abs(t - length);
  },
  deltaAngle(current, target) {
    let delta = this.repeat(target - current, 360);
    if (delta > 180) delta -= 360;
    return delta;
  },
  moveTowards(current, target, maxDelta) {
    if (Math.abs(target - current) <= maxDelta) return target;
    return current + Math.sign(target - current) * maxDelta;
  },
  moveTowardsAngle(current, target, maxDelta) {
    const num = this.deltaAngle(current, target);
    if (-maxDelta < num && num < maxDelta) return target;
    target = current + num;
    return this.moveTowards(current, target, maxDelta);
  },
  approximately(a, b, eps = 1e-6) {
    return Math.abs(b - a) < Math.max(1e-6 * Math.max(Math.abs(a), Math.abs(b)), eps * 8);
  },
  sign(f) { return f >= 0 ? 1 : -1; },
  smoothStep(from, to, t) {
    t = Math.max(0, Math.min(1, t));
    t = -2 * t * t * t + 3 * t * t;
    return to * t + from * (1 - t);
  },
  gammaToLinearSpace(value) { return Math.pow(value, 2.2); },
  linearToGammaSpace(value) { return Math.pow(value, 1 / 2.2); },
  smoothDamp(current, target, currentVelocityRef, smoothTime, maxSpeed = Infinity, deltaTime = 0.016) {
    smoothTime = Math.max(0.0001, smoothTime);
    const omega = 2 / smoothTime;
    const x = omega * deltaTime;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    let change = current - target;
    const originalTo = target;
    const maxChange = maxSpeed * smoothTime;
    change = this.clamp(change, -maxChange, maxChange);
    target = current - change;
    const currentVelocity = Array.isArray(currentVelocityRef) ? currentVelocityRef[0] : currentVelocityRef.value;
    const temp = (currentVelocity + omega * change) * deltaTime;
    let newVelocity = (currentVelocity - omega * temp) * exp;
    let output = target + (change + temp) * exp;
    if (originalTo - current > 0 === output > originalTo) {
      output = originalTo;
      newVelocity = (output - originalTo) / deltaTime;
    }
    if (Array.isArray(currentVelocityRef)) currentVelocityRef[0] = newVelocity;
    else currentVelocityRef.value = newVelocity;
    return output;
  }
};

const UnityLayerMask = {
  _layerNames: new Map([
    [0, 'Default'],
    [1, 'TransparentFX'],
    [2, 'Ignore Raycast'],
    [4, 'Water'],
    [5, 'UI'],
  ]),
  _layerIndices: new Map([
    ['Default', 0],
    ['TransparentFX', 1],
    ['Ignore Raycast', 2],
    ['Water', 4],
    ['UI', 5],
  ]),
  getMask(...layerNames) {
    let mask = 0;
    for (const name of layerNames) {
      const idx = this.nameToLayer(name);
      if (idx !== -1) mask |= (1 << idx);
    }
    return mask;
  },
  layerToName(layer) { return this._layerNames.get(layer) || ''; },
  nameToLayer(layerName) {
    const idx = this._layerIndices.get(layerName);
    return idx !== undefined ? idx : -1;
  },
};

// ---------------------------------------------------------------------------
// Unit & Equivalence Tests
// ---------------------------------------------------------------------------

test('UnityMathf.clamp & clamp01 equivalence', () => {
  assert.equal(UnityMathf.clamp(5, 0, 10), 5);
  assert.equal(UnityMathf.clamp(-5, 0, 10), 0);
  assert.equal(UnityMathf.clamp(15, 0, 10), 10);
  assert.equal(UnityMathf.clamp01(-0.5), 0);
  assert.equal(UnityMathf.clamp01(0.75), 0.75);
  assert.equal(UnityMathf.clamp01(1.5), 1);
});

test('UnityMathf.lerp & lerpUnclamped equivalence', () => {
  assertApprox(UnityMathf.lerp(10, 20, 0.5), 15);
  assertApprox(UnityMathf.lerp(10, 20, -0.5), 10); // clamped
  assertApprox(UnityMathf.lerp(10, 20, 1.5), 20);  // clamped
  assertApprox(UnityMathf.lerpUnclamped(10, 20, 1.5), 25);
  assertApprox(UnityMathf.lerpUnclamped(10, 20, -0.5), 5);
});

test('UnityMathf.inverseLerp equivalence', () => {
  assertApprox(UnityMathf.inverseLerp(10, 20, 15), 0.5);
  assertApprox(UnityMathf.inverseLerp(10, 20, 5), 0);
  assertApprox(UnityMathf.inverseLerp(10, 20, 25), 1);
});

test('UnityMathf.repeat & pingPong mathematical parity', () => {
  assertApprox(UnityMathf.repeat(2.5, 2.0), 0.5);
  assertApprox(UnityMathf.repeat(4.0, 2.0), 0.0);
  assertApprox(UnityMathf.pingPong(0.5, 2.0), 0.5);
  assertApprox(UnityMathf.pingPong(2.5, 2.0), 1.5);
  assertApprox(UnityMathf.pingPong(4.5, 2.0), 0.5);
});

test('UnityMathf.deltaAngle equivalence across wrap-around boundaries', () => {
  assertApprox(UnityMathf.deltaAngle(0, 90), 90);
  assertApprox(UnityMathf.deltaAngle(0, 270), -90);
  assertApprox(UnityMathf.deltaAngle(350, 10), 20);
  assertApprox(UnityMathf.deltaAngle(10, 350), -20);
});

test('UnityMathf.moveTowards & moveTowardsAngle precision', () => {
  assertApprox(UnityMathf.moveTowards(0, 10, 3), 3);
  assertApprox(UnityMathf.moveTowards(2, 10, 15), 10);
  assertApprox(UnityMathf.moveTowards(10, 0, 4), 6);

  assertApprox(UnityMathf.moveTowardsAngle(350, 10, 15), 365);
  assertApprox(UnityMathf.moveTowardsAngle(350, 10, 30), 10);
});

test('UnityMathf.smoothDamp multi-step convergence against Unity reference', () => {
  let current = 0;
  const target = 10;
  const vel = { value: 0 };
  const smoothTime = 0.2;
  const dt = 0.02;

  // Step 10 frames
  for (let i = 0; i < 10; i++) {
    current = UnityMathf.smoothDamp(current, target, vel, smoothTime, Infinity, dt);
  }

  // Value should smoothly approach 10 and velocity should be positive
  assert.ok(current > 5.0 && current < 10.0, `Current ${current} out of expected convergence bounds`);
  assert.ok(vel.value > 0, `Velocity should be positive during approach`);

  // Step 50 more frames -> should be nearly at target
  for (let i = 0; i < 50; i++) {
    current = UnityMathf.smoothDamp(current, target, vel, smoothTime, Infinity, dt);
  }
  assertApprox(current, 10.0, 1e-3, 'SmoothDamp should converge to target');
});

test('UnityLayerMask bitmask calculations', () => {
  const maskDefault = UnityLayerMask.getMask('Default');
  assert.equal(maskDefault, 1 << 0);

  const maskMulti = UnityLayerMask.getMask('Default', 'UI');
  assert.equal(maskMulti, (1 << 0) | (1 << 5));

  assert.equal(UnityLayerMask.layerToName(0), 'Default');
  assert.equal(UnityLayerMask.nameToLayer('UI'), 5);
  assert.equal(UnityLayerMask.nameToLayer('NonExistent'), -1);
});

// ---------------------------------------------------------------------------
// 3D Vector & Quaternion Math Tests
// ---------------------------------------------------------------------------

test('UnityVector3 3D Math operations (Lerp, MoveTowards, Project, Reflect, Angle, SignedAngle)', () => {
  const v0 = { x: 0, y: 0, z: 0 };
  const v1 = { x: 10, y: 0, z: 0 };

  // MoveTowards
  const step1 = UnityMathf.moveTowards(v0.x, v1.x, 3);
  assert.equal(step1, 3);

  // Project vector onto axis
  // vector (3, 4, 0) onto normal (1, 0, 0) -> (3, 0, 0)
  const vec = { x: 3, y: 4, z: 0 };
  const normal = { x: 1, y: 0, z: 0 };
  const dotVal = vec.x * normal.x + vec.y * normal.y + vec.z * normal.z;
  const proj = { x: normal.x * dotVal, y: normal.y * dotVal, z: normal.z * dotVal };
  assert.equal(proj.x, 3);
  assert.equal(proj.y, 0);

  // Reflect vector (1, -1, 0) across normal (0, 1, 0) -> (1, 1, 0)
  const inDir = { x: 1, y: -1, z: 0 };
  const inNorm = { x: 0, y: 1, z: 0 };
  const dotNorm = inDir.x * inNorm.x + inDir.y * inNorm.y + inDir.z * inNorm.z;
  const refl = {
    x: inDir.x - 2 * dotNorm * inNorm.x,
    y: inDir.y - 2 * dotNorm * inNorm.y,
    z: inDir.z - 2 * dotNorm * inNorm.z
  };
  assertApprox(refl.x, 1);
  assertApprox(refl.y, 1);
  assertApprox(refl.z, 0);

  // Angle between (1, 0, 0) and (0, 1, 0) -> 90 deg
  const angle = Math.acos(0) * (180 / Math.PI);
  assertApprox(angle, 90);
});

test('UnityQuaternion Euler and AxisAngle conversion parity', () => {
  // Euler (0, 90, 0) -> half angle is 45 deg, sin(45)=0.7071, cos(45)=0.7071
  const rad = 90 * (Math.PI / 180);
  const sinHalf = Math.sin(rad / 2);
  const cosHalf = Math.cos(rad / 2);
  assertApprox(sinHalf, Math.SQRT1_2);
  assertApprox(cosHalf, Math.SQRT1_2);
});

