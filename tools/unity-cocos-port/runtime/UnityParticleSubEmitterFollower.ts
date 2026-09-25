import { _decorator, CCFloat, Component, Enum, Mat4, Node, ParticleSystem, Quat, Vec3 } from 'cc';

const { ccclass, executeInEditMode, executionOrder, playOnFocus, property } = _decorator;

export enum UnityParticleSubEmitterType {
    Birth = 0,
    Death = 2,
}
Enum(UnityParticleSubEmitterType);

export enum UnityParticleSubEmitterInherit {
    Nothing = 0,
}
Enum(UnityParticleSubEmitterInherit);

type ParticleLike = {
    position: Vec3;
    velocity: Vec3;
    ultimateVelocity: Vec3;
    animatedVelocity: Vec3;
    remainingLifetime: number;
    startLifetime: number;
    randomSeed: number;
};

type AnimatedModuleLike = { animate(particle: ParticleLike, dt: number): void; };

// One Unity Birth sub-emitter instance: it follows one parent particle and runs the sub-emitter's own emission
// timeline (instance time = parent age).
type BirthInstance = {
    seed: number;
    age: number;
    accumulator: number;
    emits: boolean;
    from: Vec3;
};

type ParticlePoolLike = {
    data: ParticleLike[];
    length: number;
};

const PARTICLE_SPACE_WORLD = 0;
const CURVE_MODE_CONSTANT = 0;
const EMISSION_EPSILON = 1e-6;
const GRAVITY = 9.8;
const VELOCITY_EPSILON = 1e-8;
// Cocos emitters face -Z (Unity +Z after the porter's Z mirror).
const EMITTER_FORWARD = new Vec3(0, 0, -1);

function isBirthEntry (this: UnityParticleSubEmitterEntry): boolean {
    return this.type === UnityParticleSubEmitterType.Birth;
}

function isDeathEntry (this: UnityParticleSubEmitterEntry): boolean {
    return this.type === UnityParticleSubEmitterType.Death;
}

@ccclass('UnityParticleSubEmitterEntry')
export class UnityParticleSubEmitterEntry {
    @property({ type: UnityParticleSubEmitterType })
    public type = UnityParticleSubEmitterType.Birth;

    @property({ type: ParticleSystem, displayName: 'Particle System' })
    public subEmitter: ParticleSystem | null = null;

    @property({ type: UnityParticleSubEmitterInherit })
    public inherit = UnityParticleSubEmitterInherit.Nothing;

    @property({ displayName: 'Emit Probability', min: 0, max: 1, slide: true })
    public emitProbability = 1;

    @property({ type: Node, displayName: 'Emitter Node' })
    public subEmitterNode: Node | null = null;

    // Unity sub-emitter Emission rate over time: particles per second emitted by each parent's instance.
    @property({ visible: isBirthEntry, displayName: 'Emit Rate Per Particle', min: 0 })
    public emitRatePerParticle = 30;

    // Unity sub-emitter main module Duration/Looping: a non-looping instance stops emitting after the duration.
    // 0 keeps the legacy behaviour (emit for the parent's whole life).
    @property({ visible: isBirthEntry, displayName: 'Emitter Duration', min: 0 })
    public emitterDuration = 0;

    @property({ visible: isBirthEntry, displayName: 'Emitter Looping' })
    public emitterLooping = true;

    // Unity sub-emitter bursts, in instance time.
    @property({ type: [CCFloat], visible: isBirthEntry, displayName: 'Burst Times' })
    public burstTimes: number[] = [];

    @property({ type: [CCFloat], visible: isBirthEntry, displayName: 'Burst Counts' })
    public burstCounts: number[] = [];

    @property({ visible: isBirthEntry, displayName: 'Particles Per Sample', min: 1 })
    public particlesPerSample = 1;

    @property({ displayName: 'Max Source Particles', min: 0 })
    public maxSourceParticles = 32;

    @property({ visible: isDeathEntry, displayName: 'Death Burst Count', min: 1 })
    public deathBurstCount = 1;

    @property({ displayName: 'Play On Enable' })
    public playSubEmitterOnEnable = true;
}

@ccclass('UnityParticleSubEmitterFollower')
@executeInEditMode
@playOnFocus
@executionOrder(200)
export class UnityParticleSubEmitterFollower extends Component {
    @property({ type: ParticleSystem })
    public source: ParticleSystem | null = null;

    @property({ type: [UnityParticleSubEmitterEntry], displayName: 'Sub Emitters' })
    public entries: UnityParticleSubEmitterEntry[] = [];

    @property({ type: ParticleSystem, visible: false })
    public subEmitter: ParticleSystem | null = null;

    @property({ type: Node, visible: false })
    public subEmitterNode: Node | null = null;

    @property({ visible: false })
    public emitRatePerParticle = 30;

    @property({ visible: false })
    public particlesPerSample = 1;

    @property({ visible: false })
    public maxSourceParticles = 32;

    @property({ visible: false })
    public playSubEmitterOnEnable = true;

    private readonly _birthInstances = new Map<UnityParticleSubEmitterEntry, Map<ParticleLike, BirthInstance>>();
    private readonly _lastParticleWorldPositions = new Map<ParticleLike, Vec3>();
    private readonly _currentParticles = new Set<ParticleLike>();
    private readonly _deathEmitterHoldTimes = new Map<UnityParticleSubEmitterEntry, number>();
    private readonly _legacyEntries: UnityParticleSubEmitterEntry[] = [];
    private readonly _worldPosition = new Vec3();
    private readonly _sourceWorldMatrix = new Mat4();
    private readonly _velocity = new Vec3();
    private readonly _sample = new Vec3();
    private readonly _sourceForward = new Vec3();
    private readonly _alignment = new Quat();
    private readonly _emitterRotation = new Quat();
    private readonly _alignedRotation = new Quat();
    private _sourceHadParticles = false;

    protected onLoad (): void {
        this.prepareSubEmitters(this.getRuntimeEntries(), true);
    }

    protected onEnable (): void {
        this.prepareSubEmitters(this.getRuntimeEntries(), true);
    }

    protected onValidate (): void {
        this.prepareSubEmitters(this.getRuntimeEntries(), true);
    }

    protected onDisable (): void {
        this._birthInstances.clear();
        this._lastParticleWorldPositions.clear();
        this._currentParticles.clear();
        this._deathEmitterHoldTimes.clear();
        this._sourceHadParticles = false;
    }

    protected lateUpdate (dt: number): void {
        if (!this.source) return;

        const entries = this.getRuntimeEntries();
        if (!entries.length) return;

        const pool = this.getSourceParticlePool(this.source);
        if (!pool) return;

        const sourceHasParticles = this.poolHasActiveParticles(pool);
        if (sourceHasParticles && !this._sourceHadParticles) {
            this.resetDeathEmitters(entries);
            this._lastParticleWorldPositions.clear();
            this._currentParticles.clear();
        }

        this.prepareSubEmitters(entries, false);
        this.sampleActiveSourceParticles(pool, this.source, entries);
        this.emitBirthEntries(this.source, entries);
        this.emitDeathEntries(entries);
        this.cleanupIdleDeathEmitters(entries, dt);
        this._sourceHadParticles = this._currentParticles.size > 0;
    }

    private getRuntimeEntries (): UnityParticleSubEmitterEntry[] {
        if (this.entries.length > 0) return this.entries;
        if (!this.subEmitter) return [];

        let entry = this._legacyEntries[0];
        if (!entry) {
            entry = new UnityParticleSubEmitterEntry();
            this._legacyEntries[0] = entry;
        }

        entry.type = UnityParticleSubEmitterType.Birth;
        entry.subEmitter = this.subEmitter;
        entry.subEmitterNode = this.subEmitterNode;
        entry.emitRatePerParticle = this.emitRatePerParticle;
        entry.particlesPerSample = this.particlesPerSample;
        entry.maxSourceParticles = this.maxSourceParticles;
        entry.playSubEmitterOnEnable = this.playSubEmitterOnEnable;
        return this._legacyEntries;
    }

    private prepareSubEmitters (entries: UnityParticleSubEmitterEntry[], resetDeathEmitters: boolean): void {
        for (const entry of entries) {
            if (!entry.subEmitter) continue;

            const emitterNode = entry.subEmitterNode || entry.subEmitter.node;
            entry.subEmitterNode = emitterNode;

            entry.subEmitter.simulationSpace = PARTICLE_SPACE_WORLD;
            this.setCurveConstant(entry.subEmitter.rateOverTime, 0);
            this.setCurveConstant(entry.subEmitter.rateOverDistance, 0);
            entry.subEmitter.playOnAwake = false;

            if (entry.type === UnityParticleSubEmitterType.Death) {
                if (resetDeathEmitters) {
                    this.stopDeathEmitter(entry);
                }
                continue;
            }

            if (!emitterNode.active) {
                emitterNode.active = true;
            }

            if (entry.playSubEmitterOnEnable && !(entry.subEmitter as any)._isPlaying) {
                entry.subEmitter.play();
            }
        }
    }

    private sampleActiveSourceParticles (pool: ParticlePoolLike, source: ParticleSystem, entries: UnityParticleSubEmitterEntry[]): void {
        this._currentParticles.clear();

        const sourceCount = Math.min(pool.length, this.maxTrackedSourceParticles(entries));
        for (let i = 0; i < sourceCount; i += 1) {
            const particle = pool.data[i];
            if (!particle || particle.remainingLifetime !== undefined && particle.remainingLifetime <= 0) continue;

            this._currentParticles.add(particle);
            this.getParticleWorldPosition(source, particle, this._worldPosition);

            const lastPosition = this._lastParticleWorldPositions.get(particle);
            if (lastPosition) {
                lastPosition.set(this._worldPosition);
            } else {
                this._lastParticleWorldPositions.set(particle, this._worldPosition.clone());
            }
        }
    }

    private maxTrackedSourceParticles (entries: UnityParticleSubEmitterEntry[]): number {
        let maxParticles = 0;
        for (const entry of entries) {
            maxParticles = Math.max(maxParticles, Math.floor(entry.maxSourceParticles));
        }
        return Math.max(0, maxParticles);
    }

    // Unity Birth sub-emitters: every parent particle owns an instance that emits along the parent's path during the
    // step, each particle aged by the part of the step since the parent passed its emission point. This runs after
    // the ParticleSystems updated (lateUpdate), so a new particle is advanced here by its sub-frame age, curves included.
    //
    // Unity also turns each instance by the parent's direction of travel: with the parent's velocity (incl. velocity
    // over lifetime) off its system's forward, the sub-emitter frame is rotated by FromTo(system forward, velocity)
    // (measured on sub-emitters aligned with their parent system, e.g. Tanks! shell sparks thrown outward and up).
    private emitBirthEntries (source: ParticleSystem, entries: UnityParticleSubEmitterEntry[]): void {
        Vec3.transformQuat(this._sourceForward, EMITTER_FORWARD, source.node.worldRotation);
        for (const entry of entries) {
            if (entry.type !== UnityParticleSubEmitterType.Birth || !entry.subEmitter) continue;
            let instances = this._birthInstances.get(entry);
            if (!instances) {
                instances = new Map();
                this._birthInstances.set(entry, instances);
            }
            const emitterNode = entry.subEmitterNode || entry.subEmitter.node;
            this._emitterRotation.set(emitterNode.worldRotation);
            for (const particle of this._currentParticles) {
                const age = particle.startLifetime - particle.remainingLifetime;
                this.getParticleWorldPosition(source, particle, this._worldPosition);
                let instance = instances.get(particle);
                if (!instance || instance.seed !== particle.randomSeed) {
                    // Born during this step: the instance starts at the parent's birth point, age seconds ago.
                    instance = { seed: particle.randomSeed, age: 0, accumulator: 0, emits: this.shouldEmit(entry.emitProbability), from: new Vec3() };
                    this.getParticleWorldVelocity(source, particle, this._velocity);
                    Vec3.scaleAndAdd(instance.from, this._worldPosition, this._velocity, -age);
                    instances.set(particle, instance);
                }
                if (instance.emits) {
                    this.getParticleWorldVelocity(source, particle, this._velocity);
                    if (Vec3.lengthSqr(this._velocity) > VELOCITY_EPSILON) {
                        Vec3.normalize(this._velocity, this._velocity);
                        Quat.rotationTo(this._alignment, this._sourceForward, this._velocity);
                    } else {
                        Quat.identity(this._alignment);
                    }
                    Quat.multiply(this._alignedRotation, this._alignment, this._emitterRotation);
                    emitterNode.setWorldRotation(this._alignedRotation);
                    this.emitInstanceStep(entry, instance, age, this._worldPosition);
                }
                instance.age = age;
                instance.from.set(this._worldPosition);
            }
            emitterNode.setWorldRotation(this._emitterRotation);
            for (const particle of [...instances.keys()]) {
                if (!this._currentParticles.has(particle)) instances.delete(particle);
            }
        }
    }

    private emitInstanceStep (entry: UnityParticleSubEmitterEntry, instance: BirthInstance, age: number, to: Vec3): void {
        const t0 = instance.age;
        const span = age - t0;
        if (span <= 0) return;
        const duration = entry.emitterDuration > 0 ? entry.emitterDuration : Infinity;
        const end = entry.emitterLooping ? age : Math.min(age, duration);
        const rate = Math.max(0, entry.emitRatePerParticle);
        if (rate > 0 && end > t0) {
            const owed = instance.accumulator + rate * (end - t0);
            const count = Math.floor(owed + EMISSION_EPSILON);
            for (let i = 1; i <= count; i++) {
                const time = t0 + (i - instance.accumulator) / rate;
                this.emitInstanceParticles(entry, instance.from, to, (time - t0) / span, age - time, 1);
            }
            instance.accumulator = Math.max(0, owed - count);
        }
        const bursts = Math.min(entry.burstTimes.length, entry.burstCounts.length);
        for (let i = 0; i < bursts; i++) {
            const time = entry.burstTimes[i];
            // A burst at time 0 fires on the instance's first step.
            if (!(time <= end && (time > t0 || (time === 0 && t0 === 0)))) continue;
            this.emitInstanceParticles(entry, instance.from, to, (time - t0) / span, age - time, Math.max(0, Math.round(entry.burstCounts[i])));
        }
    }

    private emitInstanceParticles (entry: UnityParticleSubEmitterEntry, from: Vec3, to: Vec3, fraction: number, age: number, count: number): void {
        const subEmitter = entry.subEmitter;
        if (!subEmitter || count <= 0) return;
        Vec3.lerp(this._sample, from, to, Math.min(1, Math.max(0, fraction)));
        const emitterNode = entry.subEmitterNode || subEmitter.node;
        if (!emitterNode.active) emitterNode.active = true;
        emitterNode.setWorldPosition(this._sample);
        if (!(subEmitter as any)._isPlaying) subEmitter.play();
        const pool = this.getSourceParticlePool(subEmitter);
        const before = pool ? pool.length : 0;
        // dt 0: Unity lifetimes are exact; Cocos' emit(n, dt) stretches them by one frame.
        (subEmitter as any).emit(count, 0);
        if (!pool) return;
        for (let i = before; i < pool.length; i++) this.advanceNewParticle(subEmitter, pool.data[i], Math.max(0, age));
    }

    // One CPU-renderer update step of age seconds for a particle born this step, in updateParticles' order.
    private advanceNewParticle (subEmitter: ParticleSystem, particle: ParticleLike, age: number): void {
        particle.remainingLifetime -= age;
        Vec3.set(particle.animatedVelocity, 0, 0, 0);
        const normalizedTime = 1 - particle.remainingLifetime / particle.startLifetime;
        const gravity = subEmitter.gravityModifier.evaluate(normalizedTime, 0) || 0;
        if (gravity !== 0 && subEmitter.simulationSpace === PARTICLE_SPACE_WORLD) particle.velocity.y -= gravity * GRAVITY * age;
        Vec3.copy(particle.ultimateVelocity, particle.velocity);
        const animated = (subEmitter.processor as any)?._runAnimateList as AnimatedModuleLike[] | undefined;
        if (animated) for (const module of animated) module.animate(particle, age);
        Vec3.scaleAndAdd(particle.position, particle.position, particle.ultimateVelocity, age);
    }

    private getParticleWorldVelocity (source: ParticleSystem, particle: ParticleLike, out: Vec3): Vec3 {
        out.set(particle.ultimateVelocity || particle.velocity);
        if (source.simulationSpace !== PARTICLE_SPACE_WORLD) {
            source.node.getWorldMatrix(this._sourceWorldMatrix);
            Vec3.transformMat4Normal(out, out, this._sourceWorldMatrix);
        }
        return out;
    }

    private emitDeathEntries (entries: UnityParticleSubEmitterEntry[]): void {
        const hasDeathEntry = entries.some((entry) => entry.type === UnityParticleSubEmitterType.Death && entry.subEmitter);
        if (!hasDeathEntry) {
            for (const particle of [...this._lastParticleWorldPositions.keys()]) {
                if (!this._currentParticles.has(particle)) this._lastParticleWorldPositions.delete(particle);
            }
            return;
        }

        for (const [particle, position] of [...this._lastParticleWorldPositions.entries()]) {
            if (this._currentParticles.has(particle)) continue;

            for (const entry of entries) {
                if (entry.type !== UnityParticleSubEmitterType.Death || !entry.subEmitter) continue;
                if (!this.shouldEmit(entry.emitProbability)) continue;
                this.emitAtWorldPosition(entry, position, Math.max(1, Math.floor(entry.deathBurstCount)));
            }
            this._lastParticleWorldPositions.delete(particle);
        }
    }

    private shouldEmit (probability: number): boolean {
        const clamped = Math.max(0, Math.min(1, Number.isFinite(probability) ? probability : 1));
        return clamped >= 1 || Math.random() <= clamped;
    }

    private getSourceParticlePool (source: ParticleSystem): ParticlePoolLike | null {
        const processor = source.processor as any;
        const pool = processor?._particles as ParticlePoolLike | undefined;
        if (!pool || !Array.isArray(pool.data) || typeof pool.length !== 'number') return null;
        return pool;
    }

    private getParticleWorldPosition (source: ParticleSystem, particle: ParticleLike, out: Vec3): Vec3 {
        out.set(particle.position);
        if (source.simulationSpace !== PARTICLE_SPACE_WORLD) {
            source.node.getWorldMatrix(this._sourceWorldMatrix);
            Vec3.transformMat4(out, out, this._sourceWorldMatrix);
        }
        return out;
    }

    private emitAtWorldPosition (entry: UnityParticleSubEmitterEntry, worldPosition: Vec3, count: number): void {
        if (!entry.subEmitter) return;

        const emitterNode = entry.subEmitterNode || entry.subEmitter.node;
        if (!emitterNode.active) {
            emitterNode.active = true;
        }
        emitterNode.setWorldPosition(worldPosition);
        if (!(entry.subEmitter as any)._isPlaying) {
            entry.subEmitter.play();
        }
        (entry.subEmitter as any).emit(count, 0);
        if (entry.type === UnityParticleSubEmitterType.Death) {
            this._deathEmitterHoldTimes.set(entry, 0.15);
        }
    }

    private resetDeathEmitters (entries: UnityParticleSubEmitterEntry[]): void {
        for (const entry of entries) {
            if (entry.type !== UnityParticleSubEmitterType.Death) continue;
            this.stopDeathEmitter(entry);
        }
    }

    private cleanupIdleDeathEmitters (entries: UnityParticleSubEmitterEntry[], dt: number): void {
        for (const entry of entries) {
            if (entry.type !== UnityParticleSubEmitterType.Death || !entry.subEmitter) continue;

            const holdTime = this._deathEmitterHoldTimes.get(entry) || 0;
            if (holdTime > 0) {
                this._deathEmitterHoldTimes.set(entry, Math.max(0, holdTime - dt));
                continue;
            }

            const emitterNode = entry.subEmitterNode || entry.subEmitter.node;
            if (!emitterNode.active) continue;

            const pool = this.getSourceParticlePool(entry.subEmitter);
            const hasActiveParticles = pool ? this.poolHasActiveParticles(pool) : false;
            const isPlaying = Boolean((entry.subEmitter as any)._isPlaying);
            if (!hasActiveParticles && !isPlaying) {
                this.stopDeathEmitter(entry);
            }
        }
    }

    private stopDeathEmitter (entry: UnityParticleSubEmitterEntry): void {
        if (!entry.subEmitter) return;

        const emitterNode = entry.subEmitterNode || entry.subEmitter.node;
        entry.subEmitterNode = emitterNode;
        (entry.subEmitter as any).stop?.();
        emitterNode.active = false;
        this._deathEmitterHoldTimes.delete(entry);
    }

    private setCurveConstant (curveRange: any, value: number): void {
        if (!curveRange) return;
        curveRange.mode = CURVE_MODE_CONSTANT;
        curveRange.multiplier = 1;
        curveRange.constant = value;
    }

    private poolHasActiveParticles (pool: ParticlePoolLike): boolean {
        const count = Math.max(0, pool.length);
        for (let i = 0; i < count; i += 1) {
            const particle = pool.data[i];
            if (particle && (particle.remainingLifetime === undefined || particle.remainingLifetime > 0)) {
                return true;
            }
        }
        return false;
    }
}
