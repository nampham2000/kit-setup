import { ParticleSystem } from 'cc';

/** Initialize render state even when a sub-emitter births after its update. */
export function installUnityParticleBirthState(system: ParticleSystem): void {
    const runtime = system as any;
    const processor = runtime.processor;
    if (!processor?.setNewParticle || runtime.unityParticleBirthState) return;
    runtime.unityParticleBirthState = true;
    const born = processor.setNewParticle;
    processor.setNewParticle = function (particle: any): void {
        born.call(this, particle);
        // No simulation step: preserve position, velocity, age and authored
        // Euler angles. Rotation.animate(0) converts Euler into the compressed
        // quaternion ABI required by the rotation-over-time vertex variant.
        const rotation = system.rotationOvertimeModule;
        if (rotation?.enable) rotation.animate(particle, 0);
        const size = system.sizeOvertimeModule;
        if (size?.enable) size.animate(particle, 0);
        const color = system.colorOverLifetimeModule;
        if (color?.enable) color.animate(particle);
    };
}
