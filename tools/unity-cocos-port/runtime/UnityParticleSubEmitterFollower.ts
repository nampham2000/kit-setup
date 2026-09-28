import { _decorator, Component, CurveRange, Enum, Mat4, Node, ParticleSystem, Quat, Vec3 } from 'cc';
import { EDITOR_NOT_IN_PREVIEW } from 'cc/env';
import { UnityParticleDistanceSubEmitter } from './UnityParticleDistanceSubEmitter';

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
    velocity?: Vec3;
    ultimateVelocity?: Vec3;
    animatedVelocity?: Vec3;
    startLifetime?: number;
};

type AnimatedModuleLike = { animate(particle: ParticleLike, dt: number): void; };

type BurstLike = { time: number; repeatCount: number; repeatInterval: number; count: CurveRange };

// The sub system's own emission, taken over at runtime: every Unity sub-emitter
// event starts an instance that replays it from time 0.
// distanceRate: the sub system's Rate over Distance, which Unity measures per instance along the parent
// particle's path (Hovl Magic circle 1: SubGlow draws its dotted chains only this way).
type EmissionSchedule = { duration: number; loop: boolean; rate: CurveRange; bursts: BurstLike[]; distanceRate: number };

type EmissionInstance = {
    entry: UnityParticleSubEmitterEntry;
    schedule: EmissionSchedule;
    particle: ParticleLike | null;
    /** Birth instances: the parent's track; the instance ends once the sweep releases it. */
    track: TrackedParticle | null;
    seed: number;
    position: Vec3;
    /** Where the instance was at the start of the current step (birth: along the parent's path). */
    from: Vec3;
    time: number;
    fresh: boolean;
    rateAccumulator: number;
    distanceAccumulator: number;
    cycles: number[];
};

type TrackedParticle = { seed: number; position: Vec3; stamp: number };

// Hoisted so lateUpdate allocates no closure per frame (zero-GC).
const usesInstances = (entry: UnityParticleSubEmitterEntry): boolean => !!entry.unityInstances && !(entry.sourceDistanceRate > 0) && !!entry.subEmitter;

// Keyed by target so birth and death entries sharing one sub system read its authored emission once.
const schedules = new WeakMap<ParticleSystem, EmissionSchedule>();

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

// Where and how old the particles of one step are: an event at unwrapped instance time u sits at
// lerp(from, to, (u - start) / step) and has aged end - u by the end of the step.
type EmissionWindow = { from: Vec3; to: Vec3; start: number; step: number; end: number };

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

    @property({ visible: false }) public sourceDistanceRate = -1;
    @property({ visible: false }) public sourceSimulationSpace = 0;

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
    private readonly _velocity = new Vec3();
    private readonly _sample = new Vec3();
    private readonly _sourceForward = new Vec3();
    private readonly _alignment = new Quat();
    private readonly _emitterRotation = new Quat();
    private readonly _alignedRotation = new Quat();
    private readonly _window: EmissionWindow = { from: new Vec3(), to: new Vec3(), start: 0, step: 0, end: 0 };
    private _sourceHadParticles = false;
    private readonly _distanceBindings: UnityParticleDistanceSubEmitter[] = [];

    protected start(): void {
        if (!this.source) return;
        for (const entry of this.entries) if (entry.sourceDistanceRate > 0 && entry.subEmitter) {
            this._distanceBindings.push(new UnityParticleDistanceSubEmitter(this.source,entry.subEmitter,entry.sourceDistanceRate,entry.sourceSimulationSpace));
        }
    }

    protected onDestroy(): void {
        for (let i=this._distanceBindings.length-1;i>=0;i--) this._distanceBindings[i].destroy();
        this._distanceBindings.length=0;
    }
    private readonly _instances: EmissionInstance[] = [];
    private readonly _freeInstances: EmissionInstance[] = [];
    private readonly _tracked = new Map<ParticleLike, TrackedParticle>();
    private readonly _freeTracks: TrackedParticle[] = [];
    private _stamp = 0;

    protected onLoad (): void {
        this.prepareSubEmitters(this.getRuntimeEntries(), true);
        // Instance-mode targets keep their authored emission in the prefab (it is the
        // per-instance schedule); read and silence it now, so a helper that plays every child
        // ParticleSystem cannot make the target emit at its own node before the first event.
        if (!EDITOR_NOT_IN_PREVIEW) {
            for (const entry of this.entries) if (usesInstances(entry)) this.captureSchedule(entry);
        }
    }

    protected onEnable (): void {
        this.prepareSubEmitters(this.getRuntimeEntries(), true);
    }

    protected onValidate (): void {
        this.prepareSubEmitters(this.getRuntimeEntries(), true);
    }

    protected onDisable (): void {
        for (const binding of this._distanceBindings) binding.reset();
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
        let approximated=false;
        for (const entry of entries) if (!(entry.sourceDistanceRate > 0)) { approximated=true;break; }
        if (!approximated) return;

        const pool = this.getSourceParticlePool(this.source);
        if (!pool) return;

        if (!EDITOR_NOT_IN_PREVIEW && entries.some(usesInstances)) {
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
            if (!entry.subEmitter || entry.unityInstances || entry.sourceDistanceRate > 0) continue;

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
            if (entry.type !== UnityParticleSubEmitterType.Birth || !entry.subEmitter || entry.unityInstances || entry.sourceDistanceRate > 0) continue;

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
                this.startInstances(entries, UnityParticleSubEmitterType.Birth, particle, this._worldPosition, track);
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

    private startInstances (entries: UnityParticleSubEmitterEntry[], type: UnityParticleSubEmitterType, particle: ParticleLike | null, position: Vec3, track: TrackedParticle | null = null): void {
        for (const entry of entries) {
            if (!entry.unityInstances || entry.sourceDistanceRate > 0 || entry.type !== type || !entry.subEmitter) continue;
            if (!this.shouldEmit(entry.emitProbability)) continue;
            const schedule = this.captureSchedule(entry);
            this.ensureTargetRunning(entry);
            const instance = this._freeInstances.pop() || {
                entry, schedule, particle: null, track: null, seed: 0, position: new Vec3(), from: new Vec3(), time: 0, fresh: true, rateAccumulator: 0, distanceAccumulator: 0, cycles: [],
            };
            instance.entry = entry;
            instance.schedule = schedule;
            instance.particle = particle;
            instance.track = track;
            instance.seed = particle?.randomSeed ?? 0;
            instance.position.set(position);
            instance.from.set(position);
            instance.time = 0;
            instance.fresh = true;
            instance.rateAccumulator = 0;
            instance.distanceAccumulator = 0;
            instance.cycles.length = schedule.bursts.length;
            instance.cycles.fill(0);
            this._instances.push(instance);
        }
    }

    /**
     * Returns false once the instance can no longer emit.
     *
     * Unity runs each instance's emission inside the step: particles sit at their sub-frame point (a Birth
     * instance along its parent's path) and are aged by the rest of the step, so a moving parent leaves a
     * continuous trail instead of one clump per frame. A Birth instance that starts this step began at the
     * parent's birth point, parent-age seconds ago. Unity also turns a Birth instance by the parent's direction
     * of travel: FromTo(parent system forward, parent velocity incl. velocity over lifetime), measured on
     * sub-emitters aligned with their parent system (Tanks! shell sparks); the porter reports sub-emitters
     * rotated more than 20 deg from their parent, where this is unvalidated.
     */
    private advanceInstance (instance: EmissionInstance, source: ParticleSystem, dt: number): boolean {
        const { schedule, particle } = instance;
        let step = instance.fresh ? 0 : dt;
        instance.from.set(instance.position);
        const emitterNode = instance.entry.subEmitterNode || instance.entry.subEmitter!.node;
        let aligned = false;
        if (particle) {
            // Unity stops a birth sub-emitter when its parent particle dies. Particles removed
            // without a lifetime change (ParticleSystem.stop/clear resets the pool length,
            // collision kill uses removeAt) are caught by the sweep releasing their track.
            const track = instance.track;
            if (track && (track.stamp !== this._stamp || track.seed !== instance.seed)) return false;
            if ((particle.randomSeed ?? 0) !== instance.seed || particle.remainingLifetime !== undefined && particle.remainingLifetime <= 0) return false;
            this.getParticleWorldPosition(source, particle, instance.position);
            this.getParticleWorldVelocity(source, particle, this._velocity);
            if (instance.fresh) {
                const age = particle.startLifetime !== undefined && particle.remainingLifetime !== undefined
                    ? Math.max(0, particle.startLifetime - particle.remainingLifetime) : 0;
                step = age;
                Vec3.scaleAndAdd(instance.from, instance.position, this._velocity, -age);
            }
            if (Vec3.lengthSqr(this._velocity) > VELOCITY_EPSILON) {
                Vec3.transformQuat(this._sourceForward, EMITTER_FORWARD, source.node.worldRotation);
                Vec3.normalize(this._velocity, this._velocity);
                Quat.rotationTo(this._alignment, this._sourceForward, this._velocity);
                this._emitterRotation.set(emitterNode.worldRotation);
                Quat.multiply(this._alignedRotation, this._alignment, this._emitterRotation);
                emitterNode.setWorldRotation(this._alignedRotation);
                aligned = true;
            }
        }
        instance.fresh = false;
        const window = this._window;
        window.from.set(instance.from);
        window.to.set(instance.position);
        window.start = instance.time;
        window.step = step;
        window.end = instance.time + step;
        let alive = true;
        if (schedule.distanceRate > 0 && (schedule.loop || window.start < schedule.duration)) this.emitAlongPath(instance);
        if (window.end >= schedule.duration) {
            this.emitSpan(instance, instance.time, schedule.duration, 0, dt);
            if (!schedule.loop) {
                alive = false;
            } else {
                instance.time = window.end - schedule.duration;
                instance.cycles.fill(0);
                this.emitSpan(instance, 0, instance.time, schedule.duration, dt);
            }
        } else {
            this.emitSpan(instance, instance.time, window.end, 0, dt);
            instance.time = window.end;
        }
        if (aligned) emitterNode.setWorldRotation(this._emitterRotation);
        return alive;
    }

    /** Bursts due by `to` and rate emission over (from, to] of the instance clock; base unwraps a looped clock. */
    private emitSpan (instance: EmissionInstance, from: number, to: number, base: number, dt: number): void {
        this.emitDueBursts(instance, to, dt, base);
        const { schedule } = instance;
        const rate = schedule.rate.evaluate(Math.min(1, from / schedule.duration), Math.random());
        if (!(rate > 0) || !(to > from)) return;
        const owed = instance.rateAccumulator + rate * (to - from);
        const count = Math.floor(owed + EMISSION_EPSILON);
        for (let k = 1; k <= count; k += 1) {
            this.emitPlaced(instance.entry, from + (k - instance.rateAccumulator) / rate + base, 1);
        }
        instance.rateAccumulator = Math.max(0, owed - count);
    }

    /**
     * Rate over Distance of one instance: a particle each time the instance (its parent particle) has moved
     * 1/rate along this step's path, placed at that point and aged by the rest of the step.
     */
    private emitAlongPath (instance: EmissionInstance): void {
        const w = this._window;
        const rate = instance.schedule.distanceRate;
        const travelled = Vec3.distance(w.from, w.to) * rate;
        if (!(travelled > 0)) return;
        const owed = instance.distanceAccumulator + travelled;
        const count = Math.floor(owed + EMISSION_EPSILON);
        for (let k = 1; k <= count; k += 1) {
            const fraction = Math.min(1, (k - instance.distanceAccumulator) / travelled);
            this.emitPlaced(instance.entry, w.start + fraction * w.step, 1);
        }
        instance.distanceAccumulator = Math.max(0, owed - count);
    }

    private emitDueBursts (instance: EmissionInstance, time: number, dt: number, base: number): void {
        const { bursts, duration } = instance.schedule;
        // Unity emits at most one cycle per 1/60 s of the step and drops the other due
        // cycles (fixtures/burst-cycles.json, same rule as UnityParticleBurstEmission).
        const cap = Math.max(1, Math.floor(dt * 60 + 1e-4));
        for (let b = 0; b < bursts.length; b += 1) {
            const burst = bursts[b];
            if (time < burst.time) continue;
            const interval = Math.max(1e-4, burst.repeatInterval);
            // Only cycles strictly inside the duration belong to this loop (a cycle landing on
            // the duration is the next loop's t = 0), as in UnityParticleBurstEmission.
            if (burst.time >= duration) continue;
            const inside = Math.floor((duration - burst.time) / interval - 1e-6) + 1;
            const due = Math.min(Math.max(1, burst.repeatCount), inside, Math.floor((time - burst.time) / interval + 1e-6) + 1);
            const last = Math.min(due, instance.cycles[b] + cap);
            for (let cycle = instance.cycles[b]; cycle < last; cycle += 1) {
                const at = burst.time + cycle * interval;
                const count = Math.round(burst.count.evaluate(Math.min(1, at / duration), Math.random()));
                if (count > 0) this.emitPlaced(instance.entry, at + base, count);
            }
            instance.cycles[b] = Math.max(instance.cycles[b], due);
        }
    }

    /** Emits count particles for an event at unwrapped instance time u, placed and aged within the current step. */
    private emitPlaced (entry: UnityParticleSubEmitterEntry, u: number, count: number): void {
        const w = this._window;
        const fraction = w.step > 0 ? Math.min(1, Math.max(0, (u - w.start) / w.step)) : 1;
        Vec3.lerp(this._sample, w.from, w.to, fraction);
        const target = entry.subEmitter!;
        const pool = this.getSourceParticlePool(target);
        const before = pool ? pool.length : 0;
        this.emitAtWorldPosition(entry, this._sample, count);
        if (!pool) return;
        const age = Math.max(0, w.end - u);
        if (age > 0) for (let i = before; i < pool.length; i += 1) this.advanceNewParticle(target, pool.data[i], age);
    }

    // One CPU-renderer update step of age seconds for a particle born this step, in updateParticles' order
    // (the follower runs in lateUpdate, after the systems simulated the step).
    private advanceNewParticle (target: ParticleSystem, particle: ParticleLike, age: number): void {
        if (particle.remainingLifetime === undefined || particle.startLifetime === undefined || !particle.velocity || !particle.ultimateVelocity) return;
        particle.remainingLifetime -= age;
        if (particle.animatedVelocity) Vec3.set(particle.animatedVelocity, 0, 0, 0);
        const normalizedTime = 1 - particle.remainingLifetime / particle.startLifetime;
        const gravity = target.gravityModifier.evaluate(normalizedTime, 0) || 0;
        if (gravity !== 0 && target.simulationSpace === PARTICLE_SPACE_WORLD) particle.velocity.y -= gravity * GRAVITY * age;
        Vec3.copy(particle.ultimateVelocity, particle.velocity);
        const animated = (target.processor as any)?._runAnimateList as AnimatedModuleLike[] | undefined;
        if (animated) for (const module of animated) module.animate(particle, age);
        Vec3.scaleAndAdd(particle.position, particle.position, particle.ultimateVelocity, age);
    }

    private getParticleWorldVelocity (source: ParticleSystem, particle: ParticleLike, out: Vec3): Vec3 {
        const velocity = particle.ultimateVelocity || particle.velocity;
        if (!velocity) return out.set(0, 0, 0);
        out.set(velocity);
        if (source.simulationSpace !== PARTICLE_SPACE_WORLD) {
            source.node.getWorldMatrix(this._sourceWorldMatrix);
            Vec3.transformMat4Normal(out, out, this._sourceWorldMatrix);
        }
        return out;
    }

    private captureSchedule (entry: UnityParticleSubEmitterEntry): EmissionSchedule {
        const target = entry.subEmitter!;
        let schedule = schedules.get(target);
        if (schedule) return schedule;
        // UnityParticleRateOverDistanceEmitter owns the authored distance rate when the porter bound one; it
        // measures the sub system node, which instances do not move, so the instances take it over.
        const distanceEmitter = (target.node as any)?.getComponent?.('UnityParticleRateOverDistanceEmitter') as { rateOverDistance: number; enabled: boolean } | null;
        const distanceRate = distanceEmitter ? distanceEmitter.rateOverDistance : this.curveConstant(target.rateOverDistance);
        if (distanceEmitter) distanceEmitter.enabled = false;
        schedule = {
            duration: Math.max(1e-4, target.duration),
            loop: target.loop,
            rate: target.rateOverTime,
            bursts: target.bursts.slice(),
            distanceRate: distanceRate > 0 ? distanceRate : 0,
        };
        schedules.set(target, schedule);
        // The target keeps simulating what the instances emit but must not emit by itself.
        target.rateOverTime = new CurveRange();
        target.rateOverTime.constant = 0;
        this.setCurveConstant(target.rateOverDistance, 0);
        target.bursts.length = 0;
        target.loop = true;
        return schedule;
    }

    /** The silenced target simulates the particles instances emit: keep it active and playing. */
    private ensureTargetRunning (entry: UnityParticleSubEmitterEntry): void {
        const target = entry.subEmitter!;
        const emitterNode = entry.subEmitterNode || target.node;
        entry.subEmitterNode = emitterNode;
        if (!emitterNode.active) emitterNode.active = true;
        if (!(target as any)._isPlaying) target.play();
    }

    private releaseInstance (index: number): void {
        const instance = this._instances[index];
        const last = this._instances.pop()!;
        if (index < this._instances.length) this._instances[index] = last;
        instance.particle = null;
        instance.track = null;
        this._freeInstances.push(instance);
    }

    /** A constant curve's value (curve modes read their value at t = 0, like the porter's constant rates). */
    private curveConstant (curveRange: any): number {
        if (!curveRange) return 0;
        const value = curveRange.mode === CURVE_MODE_CONSTANT ? curveRange.constant * (curveRange.multiplier ?? 1) : curveRange.evaluate?.(0, 0.5);
        return Number.isFinite(value) ? value : 0;
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
