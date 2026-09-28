import { _decorator, Component, Mat4, ParticleSystem, Vec3 } from 'cc';

const { ccclass, executionOrder, property } = _decorator;
const PARTICLE_SPACE_WORLD = 0;
const CURVE_MODE_CONSTANT = 0;
const DISTANCE_EPSILON = 1e-6;
// Emissions are owed in particles, not metres: a step that ends exactly on a 1/rate boundary emits that particle
// once. A distance remainder (0.2 % 0.1 === 0.0999...) emitted it again at the start of the next step.
const EMISSION_EPSILON = 1e-6;

type ParticleLike = {
    position: Vec3;
    velocity: Vec3;
    remainingLifetime: number;
};

type ParticlePoolLike = {
    data: ParticleLike[];
    length: number;
};

// Unity emission over distance: one particle each time the emitter has travelled 1/rate, placed at that point of
// the step's path and aged by the part of the step since it passed there. Must run before the ParticleSystem
// (executionOrder 99), which ages and moves every particle by the whole step right after this update.
@ccclass('UnityParticleRateOverDistanceEmitter')
@executionOrder(98)
export class UnityParticleRateOverDistanceEmitter extends Component {
    @property({ type: ParticleSystem })
    public particleSystem: ParticleSystem | null = null;

    @property({ min: 0, displayName: 'Rate Over Distance' })
    public rateOverDistance = 0;

    /**
     * Unity "Random Between Two Constants" upper bound (rateOverDistance is then the lower one); 0 = Constant.
     * The rate is drawn uniformly per update, which keeps Unity's mean density; whether Unity draws once per
     * frame or once per emitter is not measured.
     */
    @property({ min: 0, displayName: 'Rate Over Distance Max' })
    public rateOverDistanceMax = 0;

    private readonly _lastWorldPosition = new Vec3();
    private readonly _currentWorldPosition = new Vec3();
    private readonly _sampleWorldPosition = new Vec3();
    private readonly _positionOffset = new Vec3();
    private readonly _inverseWorldMatrix = new Mat4();
    private _pendingEmission = 0;

    protected onLoad(): void {
        this.disableNativeRateOverDistance();
        this.resetTracking();
    }

    protected onEnable(): void {
        this.disableNativeRateOverDistance();
        this.resetTracking();
    }

    /**
     * Unity measures the first move from where Instantiate(prefab, pos, rot) placed the
     * emitter. The Cocos spawn pattern (instantiate, addChild -> onEnable, then set the world
     * pose) only reaches that pose after onEnable, so the start position is taken again here,
     * before the first update: same-frame spawner positioning is absorbed, while a move made
     * by an owner's first update (Hovl_Laser parking its HitEffect at the raycast hit) still
     * emits rate * distance particles along the jump.
     */
    protected start(): void {
        this.resetTracking();
    }

    protected onDisable(): void {
        this._pendingEmission = 0;
    }

    protected update(dt: number): void {
        const particleSystem = this.particleSystem;
        if (!particleSystem) return;
        this.disableNativeRateOverDistance();
        this.node.getWorldPosition(this._currentWorldPosition);

        if (!particleSystem.isPlaying) {
            this._lastWorldPosition.set(this._currentWorldPosition);
            this._pendingEmission = 0;
            return;
        }

        const min = Math.max(0, this.rateOverDistance);
        const rate = this.rateOverDistanceMax > min ? min + Math.random() * (this.rateOverDistanceMax - min) : min;
        const distance = Vec3.distance(this._lastWorldPosition, this._currentWorldPosition);
        if (rate <= 0 || distance <= DISTANCE_EPSILON) {
            this._lastWorldPosition.set(this._currentWorldPosition);
            return;
        }

        const travelled = distance * rate;
        const owed = this._pendingEmission + travelled;
        const count = Math.floor(owed + EMISSION_EPSILON);
        const step = dt * particleSystem.simulationSpeed;
        for (let i = 1; i <= count; i++) {
            const fraction = Math.min(1, Math.max(0, (i - this._pendingEmission) / travelled));
            Vec3.lerp(this._sampleWorldPosition, this._lastWorldPosition, this._currentWorldPosition, fraction);
            this.emitAtWorldPosition(particleSystem, this._sampleWorldPosition, fraction * step);
        }

        this._pendingEmission = Math.max(0, owed - count);
        this._lastWorldPosition.set(this._currentWorldPosition);
    }

    private emitAtWorldPosition(
        particleSystem: ParticleSystem,
        worldPosition: Readonly<Vec3>,
        lead: number,
    ): void {
        const pool = (particleSystem.processor as any)?._particles as ParticlePoolLike | undefined;
        const previousLength = pool?.length || 0;
        // dt 0: Unity lifetimes are exact; Cocos' emit(n, dt) stretches them by one frame.
        (particleSystem as any).emit(1, 0);
        if (!pool || pool.length <= previousLength) return;

        const particle = pool.data[pool.length - 1];
        if (particleSystem.simulationSpace === PARTICLE_SPACE_WORLD) {
            Vec3.subtract(this._positionOffset, worldPosition, this._currentWorldPosition);
        } else {
            this.node.getWorldMatrix(this._inverseWorldMatrix);
            Mat4.invert(this._inverseWorldMatrix, this._inverseWorldMatrix);
            Vec3.transformMat4(this._positionOffset, worldPosition, this._inverseWorldMatrix);
        }
        particle.position.add(this._positionOffset);
        // Start `lead` seconds ahead of the coming full-step update, so the particle ends this step at its
        // sub-frame age (step - lead) and position, as Unity's emission leaves it.
        particle.remainingLifetime += lead;
        Vec3.scaleAndAdd(particle.position, particle.position, particle.velocity, -lead);
    }

    private disableNativeRateOverDistance(): void {
        const curve = this.particleSystem?.rateOverDistance;
        if (!curve) return;
        curve.mode = CURVE_MODE_CONSTANT;
        curve.multiplier = 1;
        curve.constant = 0;
    }

    private resetTracking(): void {
        this.node.getWorldPosition(this._lastWorldPosition);
        this._pendingEmission = 0;
    }
}
