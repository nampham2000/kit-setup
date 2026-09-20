import { Mat4, ParticleSystem, Vec3 } from 'cc';
import { UnityParticleSubEmitterFollower } from './UnityParticleSubEmitterFollower';

type Listener = (particle: any) => void;
interface DeathState {
    listeners: Listener[]; dying: any[]; lifetimes: number[];
    before: (dt: number) => number; step: (dt: number) => number;
}

// Unity integrates the terminal simulation
// step before firing Death; Cocos removes the particle before that integration.
// One owner hook is shared by every Death link on the same source system.
export class UnityParticleDeathBurst {
    private readonly position = new Vec3();
    private readonly offset = new Vec3();
    private readonly inverse = new Mat4();
    private readonly processor: any;
    private readonly targetProcessor: any;
    private readonly targetBefore: (particle: any) => void;
    private readonly state: DeathState;
    private emitting = false;
    public emitted = 0;

    constructor(private readonly source: ParticleSystem, private readonly target: ParticleSystem, private readonly count: number) {
        for (const helper of source.node.getComponents(UnityParticleSubEmitterFollower)) {
            helper.entries = helper.entries.filter(entry => entry.subEmitter !== target);
            if (helper.entries.length === 0) helper.enabled = false;
        }
        target.stop(); target.bursts.length = 0;
        target.rateOverTime.mode = 0; target.rateOverTime.constant = 0;
        target.rateOverDistance.mode = 0; target.rateOverDistance.constant = 0;
        target.play();
        this.processor = source.processor;
        this.targetProcessor = target.processor;
        this.targetBefore = this.targetProcessor.setNewParticle;
        this.targetProcessor.setNewParticle = this.targetBirth;
        if (!this.processor.unityParticleDeathState) {
            const processor = this.processor;
            const state: DeathState = {
                listeners: [], dying: new Array(source.capacity), lifetimes: new Array(source.capacity),
                before: processor.updateParticles, step: null as any,
            };
            state.step = (dt: number): number => {
                const pool = processor._particles;
                let dyingCount = 0;
                for (let i = 0; i < pool.length; i++) {
                    const p = pool.data[i];
                    if (p.remainingLifetime - dt < 0) {
                        state.dying[dyingCount] = p;
                        state.lifetimes[dyingCount++] = p.remainingLifetime - dt;
                        // Let the normal engine module stack integrate at age=1.
                        p.remainingLifetime = dt;
                    }
                }
                state.before.call(processor, dt);
                for (let i = 0; i < dyingCount; i++) {
                    const p = state.dying[i];
                    p.remainingLifetime = state.lifetimes[i];
                    for (let j = 0; j < state.listeners.length; j++) state.listeners[j](p);
                    if (source.trailModule.enable) source.trailModule.removeParticle(p);
                    for (let j = pool.length - 1; j >= 0; j--) {
                        if (pool.data[j] === p) { pool.removeAt(j); break; }
                    }
                    state.dying[i] = null;
                }
                return pool.length;
            };
            processor.unityParticleDeathState = state;
            processor.updateParticles = state.step;
        }
        this.state = this.processor.unityParticleDeathState;
        this.state.listeners.push(this.onDeath);
    }

    private readonly onDeath = (particle: any): void => {
        this.position.set(particle.position);
        if (this.source.simulationSpace !== 0) Vec3.transformMat4(this.position, this.position, this.source.node.worldMatrix);
        Vec3.subtract(this.offset, this.position, this.target.node.worldPosition);
        if (this.target.simulationSpace !== 0) {
            Mat4.invert(this.inverse, this.target.node.worldMatrix);
            Vec3.transformMat4Normal(this.offset, this.offset, this.inverse);
        }
        this.emitting = true;
        try { (this.target as any).emit(this.count, 0); }
        finally { this.emitting = false; }
        this.emitted += this.count;
    };

    private readonly targetBirth = (particle: any): void => {
        if (this.emitting) Vec3.add(particle.position, particle.position, this.offset);
        this.targetBefore.call(this.targetProcessor, particle);
    };

    destroy(): void {
        this.targetProcessor.setNewParticle = this.targetBefore;
        const index = this.state.listeners.indexOf(this.onDeath);
        if (index >= 0) this.state.listeners.splice(index, 1);
        if (this.state.listeners.length === 0) {
            this.processor.updateParticles = this.state.before;
            delete this.processor.unityParticleDeathState;
        }
    }
}
