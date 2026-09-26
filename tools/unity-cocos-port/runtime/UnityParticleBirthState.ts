import { Mat4, ParticleSystem } from 'cc';

/** Initialize render state even when a sub-emitter births after its update. */
export function installUnityParticleBirthState(system: ParticleSystem): void {
    const runtime = system as any;
    const processor = runtime.processor;
    if (!processor?.setNewParticle || runtime.unityParticleBirthState) return;
    runtime.unityParticleBirthState = true;
    const born = processor.setNewParticle;
    // Resolve lazy Cocos modules at installation, never during emission.
    const rotation = system.rotationOvertimeModule;
    const size = system.sizeOvertimeModule;
    const color = system.colorOverLifetimeModule;
    // Creator 3.8.8's CPU renderer leaves IParticleModule.update commented out.
    // Refresh the frame explicitly, including moving/rotating emitter parents.
    // Each call gets a fresh matrix: calculateTransform may invert it in place.
    const velocity = system.velocityOvertimeModule as any;
    const force = system.forceOvertimeModule as any;
    const limit = system.limitVelocityOvertimeModule as any;
    const frame = new Mat4(), update = processor.updateParticles;
    runtime.unityParticleModuleFrame = true;
    processor.updateParticles = function (dt: number): number {
        if (velocity?.enable && velocity.update) { system.node.getWorldMatrix(frame); velocity.update(system.simulationSpace, frame); }
        if (force?.enable && force.update) { system.node.getWorldMatrix(frame); force.update(system.simulationSpace, frame); }
        if (limit?.enable && limit.update) { system.node.getWorldMatrix(frame); limit.update(system.simulationSpace, frame); }
        return update.call(this, dt);
    };
    processor.setNewParticle = function (particle: any): void {
        born.call(this, particle);
        // No simulation step: preserve position, velocity, age and authored
        // Euler angles. Rotation.animate(0) converts Euler into the compressed
        // quaternion ABI required by the rotation-over-time vertex variant.
        if (rotation?.enable) rotation.animate(particle, 0);
        if (size?.enable) size.animate(particle, 0);
        if (color?.enable) color.animate(particle);
    };
}
