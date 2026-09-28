import { ParticleSystem, Vec3 } from 'cc';

/**
 * Unity InheritVelocityModule, Initial mode with a constant multiplier, World simulation
 * (fixtures/inherit-velocity-native.json). Cocos 3.8.8 has no such module. Unity adds
 * multiplier * emitter velocity to the particle's base velocity once at birth; the emitter
 * velocity is the transform displacement over the frame. Local simulation is unaffected
 * in Unity and never gets this runtime.
 */
export class UnityParticleInheritVelocity {
    private readonly processor: any;
    private readonly birthBefore: (particle: any) => void;
    private readonly previous = new Vec3();
    private readonly current = new Vec3();
    private readonly inherited = new Vec3();
    private tracked = false;

    constructor(private readonly system: ParticleSystem, private readonly multiplier: number) {
        this.processor = (system as any).processor;
        this.birthBefore = this.processor.setNewParticle;
        this.processor.setNewParticle = this.birth;
    }

    /** Called once per frame after all movement (lateUpdate): the next frame's displacement origin. */
    track(): void {
        this.system.node.getWorldPosition(this.previous);
        this.tracked = true;
    }

    /** Emitter velocity for a frame of length dt; zero before the first tracked frame. */
    emitterVelocity(out: Vec3, dt: number): Vec3 {
        if (!this.tracked || !(dt > 0)) return Vec3.set(out, 0, 0, 0);
        this.system.node.getWorldPosition(this.current);
        Vec3.subtract(out, this.current, this.previous);
        return Vec3.multiplyScalar(out, out, 1 / dt);
    }

    frameDelta = 0;

    private readonly birth = (particle: any): void => {
        this.emitterVelocity(this.inherited, this.frameDelta);
        Vec3.scaleAndAdd(particle.velocity, particle.velocity, this.inherited, this.multiplier);
        Vec3.scaleAndAdd(particle.ultimateVelocity, particle.ultimateVelocity, this.inherited, this.multiplier);
        this.birthBefore.call(this.processor, particle);
    };

    destroy(): void {
        this.processor.setNewParticle = this.birthBefore;
    }
}
