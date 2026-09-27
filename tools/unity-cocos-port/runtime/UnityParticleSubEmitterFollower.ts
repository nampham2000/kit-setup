import { _decorator, Component, Enum, Mat4, Node, ParticleSystem, Vec3 } from 'cc';
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
};

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
        for (const binding of this._distanceBindings) binding.reset();
        this._birthAccumulators.clear();
        this._lastParticleWorldPositions.clear();
        this._currentParticles.clear();
        this._deathEmitterHoldTimes.clear();
        this._sourceHadParticles = false;
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
            if (!entry.subEmitter || entry.sourceDistanceRate > 0) continue;

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
            if (entry.type !== UnityParticleSubEmitterType.Birth || !entry.subEmitter || entry.sourceDistanceRate > 0) continue;

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
