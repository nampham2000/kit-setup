import { _decorator, Component, CurveRange, Enum, Mat4, Node, ParticleSystem, Vec3 } from 'cc';
import { EDITOR_NOT_IN_PREVIEW } from 'cc/env';

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
    remainingLifetime?: number;
    randomSeed?: number;
};

type BurstLike = { time: number; repeatCount: number; repeatInterval: number; count: CurveRange };

// The sub system's own emission, taken over at runtime: every Unity sub-emitter
// event starts an instance that replays it from time 0.
type EmissionSchedule = { duration: number; loop: boolean; rate: CurveRange; bursts: BurstLike[] };

type EmissionInstance = {
    entry: UnityParticleSubEmitterEntry;
    schedule: EmissionSchedule;
    particle: ParticleLike | null;
    seed: number;
    position: Vec3;
    time: number;
    fresh: boolean;
    rateAccumulator: number;
    cycles: number[];
};

type TrackedParticle = { seed: number; position: Vec3; stamp: number };

// Keyed by target so birth and death entries sharing one sub system read its authored emission once.
const schedules = new WeakMap<ParticleSystem, EmissionSchedule>();

type ParticlePoolLike = {
    data: ParticleLike[];
    length: number;
};

const PARTICLE_SPACE_WORLD = 0;
const CURVE_MODE_CONSTANT = 0;

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

    @property({ visible: isBirthEntry, displayName: 'Emit Rate Per Particle', min: 0 })
    public emitRatePerParticle = 30;

    @property({ visible: isBirthEntry, displayName: 'Particles Per Sample', min: 1 })
    public particlesPerSample = 1;

    @property({ displayName: 'Max Source Particles', min: 0 })
    public maxSourceParticles = 32;

    @property({ visible: isDeathEntry, displayName: 'Death Burst Count', min: 1 })
    public deathBurstCount = 1;

    @property({ displayName: 'Play On Enable' })
    public playSubEmitterOnEnable = true;

    /** Unity semantics: each birth/death starts an instance that replays the sub system's bursts and rate over its duration. */
    @property({ displayName: 'Unity Instances' })
    public unityInstances = false;
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

    private readonly _birthAccumulators = new Map<UnityParticleSubEmitterEntry, number>();
    private readonly _lastParticleWorldPositions = new Map<ParticleLike, Vec3>();
    private readonly _currentParticles = new Set<ParticleLike>();
    private readonly _deathEmitterHoldTimes = new Map<UnityParticleSubEmitterEntry, number>();
    private readonly _legacyEntries: UnityParticleSubEmitterEntry[] = [];
    private readonly _worldPosition = new Vec3();
    private readonly _sourceWorldMatrix = new Mat4();
    private _sourceHadParticles = false;
    private readonly _instances: EmissionInstance[] = [];
    private readonly _freeInstances: EmissionInstance[] = [];
    private readonly _tracked = new Map<ParticleLike, TrackedParticle>();
    private readonly _freeTracks: TrackedParticle[] = [];
    private _stamp = 0;

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
        this._birthAccumulators.clear();
        this._lastParticleWorldPositions.clear();
        this._currentParticles.clear();
        this._deathEmitterHoldTimes.clear();
        this._sourceHadParticles = false;
        while (this._instances.length) this.releaseInstance(this._instances.length - 1);
        for (const track of this._tracked.values()) this._freeTracks.push(track);
        this._tracked.clear();
    }

    protected lateUpdate (dt: number): void {
        if (!this.source) return;

        const entries = this.getRuntimeEntries();
        if (!entries.length) return;

        const pool = this.getSourceParticlePool(this.source);
        if (!pool) return;

        if (!EDITOR_NOT_IN_PREVIEW && entries.some((entry) => entry.unityInstances && entry.subEmitter)) {
            this.updateInstances(pool, this.source, entries, dt);
        }

        const sourceHasParticles = this.poolHasActiveParticles(pool);
        if (sourceHasParticles && !this._sourceHadParticles) {
            this.resetDeathEmitters(entries);
            this._lastParticleWorldPositions.clear();
            this._currentParticles.clear();
        }

        this.prepareSubEmitters(entries, false);
        this.sampleActiveSourceParticles(pool, this.source, entries);
        this.emitBirthEntries(entries, dt);
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
            if (!entry.subEmitter || entry.unityInstances) continue;

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

    private emitBirthEntries (entries: UnityParticleSubEmitterEntry[], dt: number): void {
        if (this._currentParticles.size <= 0) return;

        for (const entry of entries) {
            if (entry.type !== UnityParticleSubEmitterType.Birth || !entry.subEmitter || entry.unityInstances) continue;

            const emitRate = Math.max(0, entry.emitRatePerParticle);
            const accumulated = (this._birthAccumulators.get(entry) || 0) + dt * emitRate;
            const samplesPerParticle = Math.floor(accumulated);
            this._birthAccumulators.set(entry, accumulated - samplesPerParticle);
            if (samplesPerParticle <= 0) continue;

            const emitCount = Math.max(1, Math.floor(entry.particlesPerSample)) * samplesPerParticle;
            for (const particle of this._currentParticles) {
                if (!this.shouldEmit(entry.emitProbability)) continue;
                const position = this._lastParticleWorldPositions.get(particle);
                if (position) this.emitAtWorldPosition(entry, position, emitCount);
            }
        }
    }

    private emitDeathEntries (entries: UnityParticleSubEmitterEntry[]): void {
        const hasDeathEntry = entries.some((entry) => entry.type === UnityParticleSubEmitterType.Death && entry.subEmitter && !entry.unityInstances);
        if (!hasDeathEntry) {
            for (const particle of [...this._lastParticleWorldPositions.keys()]) {
                if (!this._currentParticles.has(particle)) this._lastParticleWorldPositions.delete(particle);
            }
            return;
        }

        for (const [particle, position] of [...this._lastParticleWorldPositions.entries()]) {
            if (this._currentParticles.has(particle)) continue;

            for (const entry of entries) {
                if (entry.type !== UnityParticleSubEmitterType.Death || !entry.subEmitter || entry.unityInstances) continue;
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
            if (entry.type !== UnityParticleSubEmitterType.Death || entry.unityInstances) continue;
            this.stopDeathEmitter(entry);
        }
    }

    private cleanupIdleDeathEmitters (entries: UnityParticleSubEmitterEntry[], dt: number): void {
        for (const entry of entries) {
            if (entry.type !== UnityParticleSubEmitterType.Death || !entry.subEmitter || entry.unityInstances) continue;

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

    private updateInstances (pool: ParticlePoolLike, source: ParticleSystem, entries: UnityParticleSubEmitterEntry[], dt: number): void {
        const stamp = ++this._stamp;
        const count = Math.min(pool.length, this.maxTrackedSourceParticles(entries));
        for (let i = 0; i < count; i += 1) {
            const particle = pool.data[i];
            if (!particle || particle.remainingLifetime !== undefined && particle.remainingLifetime <= 0) continue;
            const seed = particle.randomSeed ?? 0;
            let track = this._tracked.get(particle);
            if (track && track.seed !== seed) {
                // The pool recycled this particle object: the old one died this frame.
                this.startInstances(entries, UnityParticleSubEmitterType.Death, null, track.position);
                track.stamp = 0;
            }
            this.getParticleWorldPosition(source, particle, this._worldPosition);
            if (!track || track.stamp === 0) {
                if (!track) {
                    track = this._freeTracks.pop() || { seed: 0, position: new Vec3(), stamp: 0 };
                    this._tracked.set(particle, track);
                }
                track.seed = seed;
                track.position.set(this._worldPosition);
                this.startInstances(entries, UnityParticleSubEmitterType.Birth, particle, this._worldPosition);
            }
            track.position.set(this._worldPosition);
            track.stamp = stamp;
        }
        this._sweepEntries = entries;
        this._tracked.forEach(this.sweepTrack);
        this._sweepEntries = null;

        for (let i = this._instances.length - 1; i >= 0; i -= 1) {
            if (!this.advanceInstance(this._instances[i], source, dt)) this.releaseInstance(i);
        }
    }

    private _sweepEntries: UnityParticleSubEmitterEntry[] | null = null;

    private readonly sweepTrack = (track: TrackedParticle, particle: ParticleLike): void => {
        if (track.stamp === this._stamp || !this._sweepEntries) return;
        this.startInstances(this._sweepEntries, UnityParticleSubEmitterType.Death, null, track.position);
        this._tracked.delete(particle);
        this._freeTracks.push(track);
    };

    private startInstances (entries: UnityParticleSubEmitterEntry[], type: UnityParticleSubEmitterType, particle: ParticleLike | null, position: Vec3): void {
        for (const entry of entries) {
            if (!entry.unityInstances || entry.type !== type || !entry.subEmitter) continue;
            if (!this.shouldEmit(entry.emitProbability)) continue;
            const schedule = this.captureSchedule(entry);
            const instance = this._freeInstances.pop() || {
                entry, schedule, particle: null, seed: 0, position: new Vec3(), time: 0, fresh: true, rateAccumulator: 0, cycles: [],
            };
            instance.entry = entry;
            instance.schedule = schedule;
            instance.particle = particle;
            instance.seed = particle?.randomSeed ?? 0;
            instance.position.set(position);
            instance.time = 0;
            instance.fresh = true;
            instance.rateAccumulator = 0;
            instance.cycles.length = schedule.bursts.length;
            instance.cycles.fill(0);
            this._instances.push(instance);
        }
    }

    /** Returns false once the instance can no longer emit. */
    private advanceInstance (instance: EmissionInstance, source: ParticleSystem, dt: number): boolean {
        const { schedule, particle } = instance;
        if (particle) {
            // Unity stops a birth sub-emitter when its parent particle dies.
            if ((particle.randomSeed ?? 0) !== instance.seed || particle.remainingLifetime !== undefined && particle.remainingLifetime <= 0) return false;
            this.getParticleWorldPosition(source, particle, instance.position);
        }
        if (instance.fresh) instance.fresh = false;
        else instance.time += dt;
        if (instance.time >= schedule.duration) {
            if (!schedule.loop) {
                this.emitDueBursts(instance, schedule.duration, dt);
                return false;
            }
            this.emitDueBursts(instance, schedule.duration, dt);
            instance.time -= schedule.duration;
            instance.cycles.fill(0);
        }
        this.emitDueBursts(instance, instance.time, dt);
        const rate = schedule.rate.evaluate(instance.time / schedule.duration, Math.random());
        if (rate > 0 && dt > 0) {
            instance.rateAccumulator += rate * dt;
            const emitCount = Math.floor(instance.rateAccumulator);
            instance.rateAccumulator -= emitCount;
            if (emitCount > 0) this.emitAtWorldPosition(instance.entry, instance.position, emitCount);
        }
        return true;
    }

    private emitDueBursts (instance: EmissionInstance, time: number, dt: number): void {
        const { bursts, duration } = instance.schedule;
        // Unity emits at most one cycle per 1/60 s of the step and drops the other due
        // cycles (fixtures/burst-cycles.json, same rule as UnityParticleBurstEmission).
        const cap = Math.max(1, Math.floor(dt * 60 + 1e-4));
        for (let b = 0; b < bursts.length; b += 1) {
            const burst = bursts[b];
            if (time < burst.time) continue;
            const interval = Math.max(1e-4, burst.repeatInterval);
            const due = Math.min(Math.max(1, burst.repeatCount), Math.floor((time - burst.time) / interval + 1e-6) + 1);
            const last = Math.min(due, instance.cycles[b] + cap);
            for (let cycle = instance.cycles[b]; cycle < last; cycle += 1) {
                const count = Math.round(burst.count.evaluate(Math.min(1, time / duration), Math.random()));
                if (count > 0) this.emitAtWorldPosition(instance.entry, instance.position, count);
            }
            instance.cycles[b] = Math.max(instance.cycles[b], due);
        }
    }

    private captureSchedule (entry: UnityParticleSubEmitterEntry): EmissionSchedule {
        const target = entry.subEmitter!;
        let schedule = schedules.get(target);
        if (schedule) return schedule;
        schedule = {
            duration: Math.max(1e-4, target.duration),
            loop: target.loop,
            rate: target.rateOverTime,
            bursts: target.bursts.slice(),
        };
        schedules.set(target, schedule);
        // The target keeps simulating what the instances emit but must not emit by itself.
        target.rateOverTime = new CurveRange();
        target.rateOverTime.constant = 0;
        this.setCurveConstant(target.rateOverDistance, 0);
        target.bursts.length = 0;
        target.loop = true;
        const emitterNode = entry.subEmitterNode || target.node;
        entry.subEmitterNode = emitterNode;
        if (!emitterNode.active) emitterNode.active = true;
        if (!(target as any)._isPlaying) target.play();
        return schedule;
    }

    private releaseInstance (index: number): void {
        const instance = this._instances[index];
        const last = this._instances.pop()!;
        if (index < this._instances.length) this._instances[index] = last;
        instance.particle = null;
        this._freeInstances.push(instance);
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
