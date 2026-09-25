import { _decorator, Component, Director, director, ParticleSystem, Vec3 } from 'cc';
const { ccclass } = _decorator;

interface ParticleLike { position: Vec3; size: Vec3; }
interface ProcessorLike { _particles?: { length: number; data: ParticleLike[]; } | null; getModel?: () => { priority: number; } | null; }
interface CameraLike { enabled?: boolean; visibility: number; position: Vec3; forward: Vec3; projectionType?: number; }

const WORLD_SPACE = 0;
const ORTHO = 0;
const _center = new Vec3();
const _min = new Vec3();
const _max = new Vec3();
const _offset = new Vec3();

// Unity draws transparent renderers back to front by the sorting distance of each renderer's bounds centre
// (view-space depth for orthographic cameras, distance for perspective ones); a ParticleSystemRenderer's bounds
// enclose its live particles. Cocos sorts its transparent queue by Model.priority, then pass hash, then depth, so
// the systems of an effect draw in material-hash order (Tanks! shell explosion: the premultiplied flash covered the
// smoke Unity draws over it). Before every draw this helper sets each particle model's priority to the negative
// sorting distance of its particle bounds centre, so all particle systems carrying it sort back to front like Unity.
@ccclass('UnityParticleDepthSort')
export class UnityParticleDepthSort extends Component {
    private _systems: ParticleSystem[] = [];

    onEnable(): void {
        this._systems = this.getComponentsInChildren(ParticleSystem);
        director.on(Director.EVENT_BEFORE_DRAW, this.sortNow, this);
    }

    onDisable(): void {
        director.off(Director.EVENT_BEFORE_DRAW, this.sortNow, this);
    }

    public sortNow(): void {
        const camera = this._camera();
        if (!camera) return;
        for (const system of this._systems) {
            const model = (system as unknown as { processor?: ProcessorLike; }).processor?.getModel?.();
            if (!model) continue;
            this._boundsCenter(system, _center);
            Vec3.subtract(_offset, _center, camera.position);
            const distance = camera.projectionType === ORTHO ? Vec3.dot(_offset, camera.forward) : _offset.length();
            model.priority = -distance;
        }
    }

    private _camera(): CameraLike | null {
        const cameras = (this.node.scene?.renderScene?.cameras ?? []) as unknown as CameraLike[];
        for (const camera of cameras) {
            if (camera.enabled !== false && (camera.visibility & this.node.layer) !== 0) return camera;
        }
        return null;
    }

    private _boundsCenter(system: ParticleSystem, out: Vec3): void {
        const particles = (system as unknown as { processor?: ProcessorLike; }).processor?._particles;
        if (!particles || particles.length === 0) {
            system.node.getWorldPosition(out);
            return;
        }
        _min.set(Infinity, Infinity, Infinity);
        _max.set(-Infinity, -Infinity, -Infinity);
        for (let i = 0; i < particles.length; i++) {
            const particle = particles.data[i];
            const half = Math.max(particle.size.x, particle.size.y) * 0.5;
            const p = particle.position;
            _min.set(Math.min(_min.x, p.x - half), Math.min(_min.y, p.y - half), Math.min(_min.z, p.z - half));
            _max.set(Math.max(_max.x, p.x + half), Math.max(_max.y, p.y + half), Math.max(_max.z, p.z + half));
        }
        Vec3.add(out, _min, _max);
        Vec3.multiplyScalar(out, out, 0.5);
        if (system.simulationSpace !== WORLD_SPACE) Vec3.transformMat4(out, out, system.node.worldMatrix);
    }
}
