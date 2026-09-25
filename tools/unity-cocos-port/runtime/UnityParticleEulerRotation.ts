import { ParticleSystem } from 'cc';

// Native oracle: fixtures/particle-rotation-over-lifetime-native.json (Unity
// 6000.3 BakeMesh). Rotation over lifetime adds the angular velocity, sampled at
// the normalized age the step starts from, to each Euler component of
// Particle.rotation3D. Mesh and Local-billboard particles then render
// Quaternion.Euler: Z first, then X, then Y. X/Y/Z share one random draw.
// Cocos 3.8.8 RotationOvertimeModule instead right-multiplies per-frame
// Quat.fromEuler (Y-Z-X) deltas onto a Y-Z-X start rotation, so a spin about
// the emitter axis becomes a tumble about the particle axis.
// The converter has already applied the renderer's Z-reflection signs to the
// start rotation and module curves, so integration runs in Cocos axes.

const ROTATION_SEED = 125292; // cc ParticleModuleRandSeed.ROTATION

interface Settable { set(x: number, y: number, z: number): unknown; }

function pseudoRandom(seed: number): number {
    return ((seed * 9301 + 49297) % 233280) / 233280;
}

/** Packs Unity Z-X-Y Euler radians into the Cocos rotation-over-time vertex ABI. */
export function packUnityEulerRotation(out: Settable, ex: number, ey: number, ez: number): void {
    const sx = Math.sin(ex * 0.5), cx = Math.cos(ex * 0.5);
    const sy = Math.sin(ey * 0.5), cy = Math.cos(ey * 0.5);
    const sz = Math.sin(ez * 0.5), cz = Math.cos(ez * 0.5);
    // q and -q are one rotation; the vertex shader rebuilds w as +sqrt(1 - |xyz|^2).
    const sign = cx * cy * cz + sx * sy * sz < 0 ? -1 : 1;
    out.set(sign * (sx * cy * cz + cx * sy * sz),
        sign * (cx * sy * cz - sx * cy * sz),
        sign * (cx * cy * sz - sx * sy * cz));
}

export function installUnityParticleEulerRotation(system: ParticleSystem): boolean {
    const runtime = system as any;
    if (runtime.unityEulerRotation) return true;
    const rotation = system.rotationOvertimeModule as any;
    if (!rotation) return false;
    runtime.unityEulerRotation = true;
    rotation.animate = function (this: any, p: any, dt: number): void {
        const life = p.startLifetime > 0 ? p.startLifetime : 1;
        // Cocos subtracts dt before its modules run.
        const age = Math.min(1, Math.max(0, 1 - (p.remainingLifetime + dt) / life));
        const random = pseudoRandom(p.randomSeed + ROTATION_SEED);
        // ParticleSystem.emit resets startEuler for every birth; here it carries rotation3D.
        const e = p.startEuler;
        if (this.separateAxes) {
            e.x += (this.x.evaluate(age, random) || 0) * dt;
            e.y += (this.y.evaluate(age, random) || 0) * dt;
        }
        e.z += (this.z.evaluate(age, random) || 0) * dt;
        packUnityEulerRotation(p.rotation, e.x, e.y, e.z);
    };
    return true;
}
