import { ParticleSystem } from 'cc';

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
