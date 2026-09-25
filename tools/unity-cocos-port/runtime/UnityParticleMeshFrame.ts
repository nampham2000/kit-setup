import { ParticleSystem, Vec4 } from 'cc';

// Native BakeMesh (fixtures/particle-pivot-alignment-native.json and -extra-native.json):
// - A Mesh particle pivot is measured in mesh-bounds units: every vertex is
//   v + pivot * boundsSize before size and rotation (Unity negates the Z term; the
//   Z-reflected Cocos mesh does not). The vertex program multiplies
//   sourceRendererPivot.xyz by sourceRendererMesh.xyz, which this runtime binds.
// - Velocity alignment renders LookRotation(total world velocity, world up) followed by
//   rotation3D. A zero velocity keeps rotation3D; a velocity parallel to up turns +Z
//   onto it about X. The rotation is world space, so the vertex program skips the
//   emitter rotation (sourceRendererPivot.w == 3).

export interface UnityMeshFrameSpec { pivot: boolean; velocity: boolean; }
export interface UnityQuat { x: number; y: number; z: number; w: number; }
interface Settable { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown; }

/** Unity LookRotation(velocity, Vector3.up) for a Cocos-space velocity, returned in Cocos axes. */
export function unityVelocityFrame(out: UnityQuat, vx: number, vy: number, vz: number): void {
    const length = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (!(length > 1e-12)) { out.x = 0; out.y = 0; out.z = 0; out.w = 1; return; }
    // Unity forward: the port reflects Z.
    const zx = vx / length, zy = vy / length, zz = -vz / length;
    let xx = zz, xz = -zx; // up x forward with up = (0, 1, 0)
    const side = Math.sqrt(xx * xx + xz * xz);
    let qx: number, qy: number, qz: number, qw: number;
    if (side < 1e-6) {
        qx = zy > 0 ? -Math.SQRT1_2 : Math.SQRT1_2; qy = 0; qz = 0; qw = Math.SQRT1_2;
    } else {
        xx /= side; xz /= side;
        const yx = zy * xz, yy = zz * xx - zx * xz, yz = -zy * xx;
        // Columns (x, y, z): m00=xx m10=0 m20=xz, m01=yx m11=yy m21=yz, m02=zx m12=zy m22=zz.
        const trace = xx + yy + zz;
        if (trace > 0) {
            const s = Math.sqrt(trace + 1) * 2;
            qw = s / 4; qx = (yz - zy) / s; qy = (zx - xz) / s; qz = -yx / s;
        } else if (xx > yy && xx > zz) {
            const s = Math.sqrt(1 + xx - yy - zz) * 2;
            qw = (yz - zy) / s; qx = s / 4; qy = yx / s; qz = (zx + xz) / s;
        } else if (yy > zz) {
            const s = Math.sqrt(1 + yy - xx - zz) * 2;
            qw = (zx - xz) / s; qx = yx / s; qy = s / 4; qz = (zy + yz) / s;
        } else {
            const s = Math.sqrt(1 + zz - xx - yy) * 2;
            qw = -yx / s; qx = (zx + xz) / s; qy = (zy + yz) / s; qz = s / 4;
        }
    }
    // Reflection through Z keeps the z rotation component and negates x and y.
    out.x = -qx; out.y = -qy; out.z = qz; out.w = qw;
}

/** Unity Z-X-Y Euler composition (radians, Cocos-signed axes), as in sourceEuler(). */
export function unityEulerQuaternion(out: UnityQuat, ex: number, ey: number, ez: number): void {
    const sx = Math.sin(ex * 0.5), cx = Math.cos(ex * 0.5);
    const sy = Math.sin(ey * 0.5), cy = Math.cos(ey * 0.5);
    const sz = Math.sin(ez * 0.5), cz = Math.cos(ez * 0.5);
    out.x = sx * cy * cz + cx * sy * sz;
    out.y = cx * sy * cz - sx * cy * sz;
    out.z = cx * cy * sz - sx * sy * cz;
    out.w = cx * cy * cz + sx * sy * sz;
}

/** Inverse of unityEulerQuaternion for the Euler vertex ABI (rotation over lifetime off). */
export function unityEulerFromQuaternion(out: Settable, q: UnityQuat): void {
    const { x, y, z, w } = q;
    const sx = Math.max(-1, Math.min(1, -2 * (y * z - w * x)));
    if (Math.abs(sx) < 0.9999999) {
        out.set(Math.asin(sx), Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y)), Math.atan2(2 * (x * y + w * z), 1 - 2 * (x * x + z * z)));
    } else {
        out.set(Math.asin(sx), Math.atan2(-2 * (x * z - w * y), 1 - 2 * (y * y + z * z)), 0);
    }
}

function multiply(out: UnityQuat, a: UnityQuat, b: UnityQuat): void {
    const ax = a.x, ay = a.y, az = a.z, aw = a.w, bx = b.x, by = b.y, bz = b.z, bw = b.w;
    out.x = ax * bw + aw * bx + ay * bz - az * by;
    out.y = ay * bw + aw * by + az * bx - ax * bz;
    out.z = az * bw + aw * bz + ax * by - ay * bx;
    out.w = aw * bw - ax * bx - ay * by - az * bz;
}

const look: UnityQuat = { x: 0, y: 0, z: 0, w: 1 }, euler: UnityQuat = { x: 0, y: 0, z: 0, w: 1 }, frame: UnityQuat = { x: 0, y: 0, z: 0, w: 1 };
const bounds = new Vec4();

/** Binds the Cocos mesh bounds size used by the source vertex program for the Unity pivot. */
export function bindUnityParticleMeshBounds(system: ParticleSystem): boolean {
    const mesh = system.renderer.mesh, material = system.getMaterialInstance(0);
    const min = mesh?.struct.minPosition, max = mesh?.struct.maxPosition;
    if (!material || !min || !max) return false;
    bounds.set(max.x - min.x, max.y - min.y, max.z - min.z, 1);
    material.setProperty('sourceRendererMesh', bounds);
    return true;
}

/** Writes Unity Velocity-aligned mesh rotations after the frame's simulation. */
export function applyUnityParticleVelocityFrame(system: ParticleSystem): void {
    const pool = (system as any).processor?._particles;
    if (!pool) return;
    // The quaternion vertex ABI is compiled while rotation over lifetime is enabled
    // (the Euler adapter then keeps rotation3D in startEuler); otherwise Euler radians.
    const quaternionAbi = !!system.rotationOvertimeModule?.enable;
    const local = system.simulationSpace === 1; // cc ParticleSpace.Local
    const q = system.node.worldRotation;
    for (let i = 0; i < pool.length; i++) {
        const p = pool.data[i], v = p.ultimateVelocity;
        let vx = v.x, vy = v.y, vz = v.z;
        if (local) {
            // Rotate the local-space velocity into world space.
            const tx = 2 * (q.y * vz - q.z * vy), ty = 2 * (q.z * vx - q.x * vz), tz = 2 * (q.x * vy - q.y * vx);
            vx += q.w * tx + q.y * tz - q.z * ty; vy += q.w * ty + q.z * tx - q.x * tz; vz += q.w * tz + q.x * ty - q.y * tx;
        }
        unityVelocityFrame(look, vx, vy, vz);
        const e = p.startEuler;
        unityEulerQuaternion(euler, e.x, e.y, e.z);
        multiply(frame, look, euler);
        if (quaternionAbi) {
            // q and -q are one rotation; the vertex program rebuilds w as +sqrt(1 - |xyz|^2).
            const sign = frame.w < 0 ? -1 : 1;
            p.rotation.set(sign * frame.x, sign * frame.y, sign * frame.z);
        } else {
            unityEulerFromQuaternion(p.rotation, frame);
        }
    }
}
