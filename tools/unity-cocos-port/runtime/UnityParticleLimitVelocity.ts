import { ParticleSystem } from 'cc';
import { UnityNoiseCurve, sampleNoiseCurve } from './UnityNoiseKernel';

// Unity Limit Velocity over Lifetime, measured with ParticleSystem.Simulate
// (fixtures/limit-velocity-native.json): only the part of the speed above the
// limit decays, by (1 - dampen) per 1/30 s, so it is frame-rate independent:
//     speed' = limit + (speed - limit) * (1 - dampen)^(30 * dt)   (speed > limit)
// Separate axes apply the same rule per axis. Cocos 3.8.8 instead multiplies
// the whole speed by (1 - dampen) once per frame and clamps at the limit,
// which at 60 fps roughly halves the distance a damped burst travels.
//
// Composition (fixtures/velocity-limit-composition-native.json): the limit acts
// on the stored velocity plus the step's animated velocity (Velocity over
// Lifetime linear, orbital and radial, and Noise, all sampled at the
// start-of-step position). The limited total moves the particle, but Unity
// stores only velocity' = limited - animated, because animated velocity is
// recomputed every step. Cocos copies the limited total into Particle.velocity,
// which re-adds an orbit, radial pull or noise field on every following frame.
// Unity scales only the integrated displacement by the speed modifier, after
// the limit; the porter binds the limit only with a unit speed modifier.
//
// Drag (fixtures/limit-drag-native.json, 20 cases at 60/30 fps): after the
// dampened limit, the total speed decreases linearly by
//     coefficient * dt,  coefficient = drag(age at step start)
//                                    * (multiplyDragByParticleSize ? PI * (maxSize / 2)^2 : 1)
//                                    * (multiplyDragByParticleVelocity ? speed^2 : 1)
// clamped at zero, along the velocity direction; the stored velocity again drops
// the animated part. maxSize is the largest axis of the particle size at the start
// of the step (Size over Lifetime included). Cocos animates size before the limit,
// so the runtime keeps the previous step's size (start size on the first step).
export interface UnityLimitDragSpec {
    drag: UnityNoiseCurve;
    multiplyBySize: boolean;
    multiplyByVelocity: boolean;
}

export function unityDampenKeep(dampen: number, dt: number): number {
    return Math.pow(Math.max(0, 1 - dampen), 30 * dt);
}

/** Speed after one Unity drag step (native rule above). */
export function unityDragSpeed(speed: number, drag: number, maxSize: number, spec: UnityLimitDragSpec, dt: number): number {
    let coefficient = drag;
    if (spec.multiplyBySize) coefficient *= Math.PI * (maxSize * 0.5) * (maxSize * 0.5);
    if (spec.multiplyByVelocity) coefficient *= speed * speed;
    return Math.max(0, speed - coefficient * dt);
}

const source = { x: 0, y: 0, z: 0 };

export function installUnityParticleLimitVelocity(system: ParticleSystem, drag?: UnityLimitDragSpec | null): void {
    const module = system.limitVelocityOvertimeModule as any;
    if (!module) return;
    // Orbit/Noise may install first without the drag contract; the adapter adds it.
    if (drag) module.unityLimitDrag = drag;
    if (module.unityLimitVelocity) return;
    module.unityLimitVelocity = true;
    // Orbit and Noise runtimes check this before composing with the limit.
    module.unityAnimatedComposition = true;
    const engineAnimate = module.animate;
    module.animate = function (this: any, particle: any, dt: number): void {
        const velocity = particle.ultimateVelocity, dampen = this.dampen;
        source.x = velocity.x; source.y = velocity.y; source.z = velocity.z;
        // With dampen = 1 the engine returns the limit-projected velocity and
        // keeps its own limit curve, random channel, separate axes and space.
        this.dampen = 1;
        // Native evaluates limit curves at the beginning of the step. The CPU
        // processor has already decremented lifetime before invoking modules.
        // Restore it immediately so size/color and subsequent modules keep their age.
        const remaining = particle.remainingLifetime;
        particle.remainingLifetime = remaining + dt;
        try { engineAnimate.call(this, particle, dt); }
        finally { this.dampen = dampen; particle.remainingLifetime = remaining; }
        const keep = unityDampenKeep(dampen, dt);
        velocity.x += (source.x - velocity.x) * keep;
        velocity.y += (source.y - velocity.y) * keep;
        velocity.z += (source.z - velocity.z) * keep;
        const spec: UnityLimitDragSpec | undefined = this.unityLimitDrag;
        let stepSize = 0;
        if (spec) {
            const size = particle.size, start = particle.startSize;
            const first = remaining + dt >= particle.startLifetime - 1e-6 || particle.unityDragSize === undefined;
            stepSize = first && start ? Math.max(Math.abs(start.x), Math.abs(start.y), Math.abs(start.z)) : particle.unityDragSize;
            particle.unityDragSize = size ? Math.max(Math.abs(size.x), Math.abs(size.y), Math.abs(size.z)) : 0;
        }
        if (spec && dt > 0) {
            const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z);
            if (speed > 0) {
                const age = Math.max(0, Math.min(1, 1 - (remaining + dt) / particle.startLifetime));
                const random = ((Math.imul(particle.randomSeed | 0, 1664525) + 1013904223) >>> 0) / 4294967296;
                const scale = unityDragSpeed(speed, sampleNoiseCurve(spec.drag, age, random), stepSize, spec, dt) / speed;
                velocity.x *= scale; velocity.y *= scale; velocity.z *= scale;
            }
        }
        const base = particle.velocity, animated = particle.animatedVelocity;
        base.x = velocity.x - animated.x;
        base.y = velocity.y - animated.y;
        base.z = velocity.z - animated.z;
    };
}
