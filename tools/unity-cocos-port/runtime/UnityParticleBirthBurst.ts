import { Mat4, ParticleSystem, Vec3 } from 'cc';
import { UnityParticleSubEmitterFollower } from './UnityParticleSubEmitterFollower';
import { installUnityParticleNestedEmission } from './UnityParticleNestedEmission';

export class UnityParticleBirthBurst {
    private readonly position = new Vec3();
    private readonly offset = new Vec3();
    private readonly inverse = new Mat4();
    private readonly sourceProcessor: any;
    private readonly targetProcessor: any;
    private readonly sourceBefore: (particle: any) => void;
    private readonly targetBefore: (particle: any) => void;
    private emitting = false;
    private readonly pending: { particle: any; seed: number }[];
    private pendingCount = 0;
    private readonly updateBefore: (dt: number) => number;
    public births = 0;

    constructor(private readonly source: ParticleSystem, private readonly target: ParticleSystem, private readonly count: number,
        private readonly automaticBirth = true, private readonly delay = 0, private readonly minCount = count) {
        this.pending = delay > 0 ? Array.from({ length: source.capacity }, () => ({ particle: null, seed: 0 })) : [];
        for (const helper of source.node.getComponents(UnityParticleSubEmitterFollower)) {
            helper.entries = helper.entries.filter(entry => entry.subEmitter !== target);
            if (helper.entries.length === 0) helper.enabled = false;
        }
        target.stop();
        target.bursts.length = 0;
        target.rateOverTime.mode = 0; target.rateOverTime.constant = 0;
        target.rateOverDistance.mode = 0; target.rateOverDistance.constant = 0;
        target.play();
        this.sourceProcessor = source.processor; this.targetProcessor = target.processor;
        this.sourceBefore = this.sourceProcessor.setNewParticle;
        this.updateBefore = this.sourceProcessor.updateParticles;
        this.targetBefore = this.targetProcessor.setNewParticle;
        if (automaticBirth) this.sourceProcessor.setNewParticle = this.sourceBirth;
        if (automaticBirth && delay === 0) installUnityParticleNestedEmission(source);
        if (delay > 0) this.sourceProcessor.updateParticles = this.advance;
        this.targetProcessor.setNewParticle = this.targetBirth;
    }

    private readonly sourceBirth = (particle: any): void => {
        this.sourceBefore.call(this.sourceProcessor, particle);
        if (this.delay > 0) {
            if (this.pendingCount === this.pending.length) throw new Error('Scheduled birth exceeded source capacity');
            const track = this.pending[this.pendingCount++];
            track.particle = particle; track.seed = particle.randomSeed;
            return;
        }
        this.triggerParticle(particle);
    };

    private readonly advance = (dt: number): number => {
        const result = this.updateBefore.call(this.sourceProcessor, dt);
        for (let i = this.pendingCount - 1; i >= 0; i--) {
            const track = this.pending[i], particle = track.particle;
            const valid = particle.randomSeed === track.seed && particle.remainingLifetime > 0;
            const ready = particle.startLifetime - particle.remainingLifetime > this.delay;
            if (valid && !ready) continue;
            if (valid) this.triggerParticle(particle);
            this.pendingCount--;
            this.pending[i] = this.pending[this.pendingCount];
            this.pending[this.pendingCount] = track;
            track.particle = null;
        }
        return result;
    };

    triggerParticle(particle: any): void {
        this.position.set(particle.position);
        if (this.source.simulationSpace !== 0) Vec3.transformMat4(this.position, this.position, this.source.node.worldMatrix);
        Vec3.subtract(this.offset, this.position, this.target.node.worldPosition);
        if (this.target.simulationSpace !== 0) {
            Mat4.invert(this.inverse, this.target.node.worldMatrix);
            Vec3.transformMat4Normal(this.offset, this.offset, this.inverse);
        }
        this.emitting = true;
        // Unity birth count uses uniform integers including both ends.
        const count = this.minCount === this.count ? this.count : this.minCount + Math.floor((this.count - this.minCount + 1) * Math.random());
        try { (this.target as any).emit(count, 0); }
        finally { this.emitting = false; }
        this.births += count;
    }

    private readonly targetBirth = (particle: any): void => {
        if (this.emitting) Vec3.add(particle.position, particle.position, this.offset);
        this.targetBefore.call(this.targetProcessor, particle);
    };

    destroy(): void {
        if (this.automaticBirth) this.sourceProcessor.setNewParticle = this.sourceBefore;
        if (this.delay > 0) this.sourceProcessor.updateParticles = this.updateBefore;
        this.targetProcessor.setNewParticle = this.targetBefore;
    }
}
