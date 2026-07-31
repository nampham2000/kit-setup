import { _decorator, Component, Mat4, ParticleSystem, Vec3 } from 'cc';

const { ccclass, executionOrder, property } = _decorator;
const PARTICLE_SPACE_WORLD = 0;
const CURVE_MODE_CONSTANT = 0;
const DISTANCE_EPSILON = 1e-6;

type ParticleLike = {
    position: Vec3;
};

type ParticlePoolLike = {
    data: ParticleLike[];
    length: number;
};

@ccclass('UnityParticleRateOverDistanceEmitter')
@executionOrder(98)
export class UnityParticleRateOverDistanceEmitter extends Component {
    @property({ type: ParticleSystem })
    public particleSystem: ParticleSystem | null = null;

    @property({ min: 0, displayName: 'Rate Over Distance' })
    public rateOverDistance = 0;

    private readonly _lastWorldPosition = new Vec3();
    private readonly _currentWorldPosition = new Vec3();
    private readonly _sampleWorldPosition = new Vec3();
    private readonly _positionOffset = new Vec3();
    private readonly _inverseWorldMatrix = new Mat4();
    private _distanceRemainder = 0;
    private _wasPlaying = false;

    protected onLoad(): void {
        this.disableNativeRateOverDistance();
        this.resetTracking();
    }

    protected onEnable(): void {
        this.disableNativeRateOverDistance();
        this.resetTracking();
    }

    protected onDisable(): void {
        this._distanceRemainder = 0;
        this._wasPlaying = false;
    }

    protected update(dt: number): void {
        const particleSystem = this.particleSystem;
        if (!particleSystem) return;
        this.disableNativeRateOverDistance();
        this.node.getWorldPosition(this._currentWorldPosition);

        if (!particleSystem.isPlaying) {
            this._lastWorldPosition.set(this._currentWorldPosition);
            this._distanceRemainder = 0;
            this._wasPlaying = false;
            return;
        }

        if (!this._wasPlaying) {
            this._lastWorldPosition.set(this._currentWorldPosition);
            this._wasPlaying = true;
            return;
        }

        const rate = Math.max(0, this.rateOverDistance);
        const distance = Vec3.distance(this._lastWorldPosition, this._currentWorldPosition);
        if (rate <= 0 || distance <= DISTANCE_EPSILON) {
            this._lastWorldPosition.set(this._currentWorldPosition);
            return;
        }

        const spacing = 1 / rate;
        const firstDistance = spacing - this._distanceRemainder;
        for (let traveled = firstDistance; traveled <= distance + DISTANCE_EPSILON; traveled += spacing) {
            Vec3.lerp(
                this._sampleWorldPosition,
                this._lastWorldPosition,
                this._currentWorldPosition,
                Math.min(1, traveled / distance),
            );
            this.emitAtWorldPosition(particleSystem, this._sampleWorldPosition, dt);
        }

        this._distanceRemainder = (this._distanceRemainder + distance) % spacing;
        this._lastWorldPosition.set(this._currentWorldPosition);
    }

    private emitAtWorldPosition(
        particleSystem: ParticleSystem,
        worldPosition: Readonly<Vec3>,
        dt: number,
    ): void {
        const pool = (particleSystem.processor as any)?._particles as ParticlePoolLike | undefined;
        const previousLength = pool?.length || 0;
        (particleSystem as any).emit(1, dt);
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
        this._distanceRemainder = 0;
        this._wasPlaying = false;
    }
}
