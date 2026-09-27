import { ParticleSystem } from 'cc';

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
export function unityDampenKeep(dampen: number, dt: number): number {
    return Math.pow(Math.max(0, 1 - dampen), 30 * dt);
}

const source = { x: 0, y: 0, z: 0 };

export function installUnityParticleLimitVelocity(system: ParticleSystem): void {
    const module = system.limitVelocityOvertimeModule as any;
    if (!module || module.unityLimitVelocity) return;
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
        try { engineAnimate.call(this, particle, dt); } finally { this.dampen = dampen; }
        const keep = unityDampenKeep(dampen, dt);
        velocity.x += (source.x - velocity.x) * keep;
        velocity.y += (source.y - velocity.y) * keep;
        velocity.z += (source.z - velocity.z) * keep;
        const base = particle.velocity, animated = particle.animatedVelocity;
        base.x = velocity.x - animated.x;
        base.y = velocity.y - animated.y;
        base.z = velocity.z - animated.z;
    };
}
