import { _decorator, Component, ParticleSystem } from 'cc';
import { UnityCollisionSpec, UnityParticleCollision } from './UnityParticleCollision';

const { ccclass, property } = _decorator;

interface SubEmitterContract { probability: number; inheritColor: boolean; countMin: number; countMax: number; }

/**
 * Node event carrying Unity OnParticleCollision data: (intersection: Vec3, normal: Vec3)
 * in world space, once per collision. Emitted on the particle system's node only when
 * the source Collision module sends collision messages. The vectors are reused.
 */
export const UNITY_PARTICLE_COLLISION_EVENT = 'unity-particle-collision';

// Generated prefab binding for a Unity World-type Collision module and its Collision
// sub-emitters (particle-collision-binding.js). `targets[i]` pairs with
// sourceContract.subEmitters[i].
@ccclass('UnityParticleCollisionAdapter')
export class UnityParticleCollisionAdapter extends Component {
    @property(ParticleSystem) source: ParticleSystem | null = null;
    @property([ParticleSystem]) targets: ParticleSystem[] = [];
    @property sourceContract = '';
    private collision: UnityParticleCollision | null = null;

    get collisions(): number { return this.collision?.collisions ?? 0; }

    protected start(): void {
        if (!this.source || !this.sourceContract) throw new Error('Missing Unity collision source contract');
        const contract = JSON.parse(this.sourceContract) as UnityCollisionSpec & { subEmitters: SubEmitterContract[]; messages?: boolean };
        const subEmitters = contract.subEmitters.map((entry, index) => ({ ...entry, target: this.targets[index] }))
            .filter(entry => !!entry.target);
        this.collision = new UnityParticleCollision(this.source, contract, subEmitters);
        if (contract.messages) {
            this.collision.onCollision = (intersection, normal) => this.node.emit(UNITY_PARTICLE_COLLISION_EVENT, intersection, normal);
        }
    }

    protected onDestroy(): void {
        this.collision?.destroy();
        this.collision = null;
    }
}
