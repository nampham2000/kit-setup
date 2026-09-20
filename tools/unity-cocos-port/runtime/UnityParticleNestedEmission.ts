import { ParticleSystem } from 'cc';

/** Keep Cocos' module-scoped emission transform out of nested birth callbacks. */
export function installUnityParticleNestedEmission(system: ParticleSystem): void {
    const runtime = system as any;
    const processor = runtime.processor;
    if (runtime.unityNestedEmission === processor.setNewParticle) return;
    const born = processor.setNewParticle;
    const engineEmit = (ParticleSystem.prototype as any).emit;
    processor.setNewParticle = function (particle: any): void {
        // Cocos 3.8.8 caches _world_mat/_world_rol once per emit(count).
        // setNewParticle can synchronously emit a child and overwrite both.
        // A zero-count engine call restores those caches without births or
        // random draws. Bypass instance wrappers so burst-spread counts and
        // within-frame lifetime delay stay owned by the outer emit call.
        try { born.call(this, particle); }
        finally { engineEmit.call(system, 0, 0); }
    };
    runtime.unityNestedEmission = processor.setNewParticle;
}
