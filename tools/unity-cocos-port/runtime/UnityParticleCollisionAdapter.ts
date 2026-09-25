import { _decorator, Component, ParticleSystem } from 'cc';
import { UnityCollisionSpec, UnityParticleCollision } from './UnityParticleCollision';

const { ccclass, property } = _decorator;

interface SubEmitterContract { probability: number; inheritColor: boolean; countMin: number; countMax: number; }

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
        const contract = JSON.parse(this.sourceContract) as UnityCollisionSpec & { subEmitters: SubEmitterContract[] };
        const subEmitters = contract.subEmitters.map((entry, index) => ({ ...entry, target: this.targets[index] }))
            .filter(entry => !!entry.target);
        this.collision = new UnityParticleCollision(this.source, contract, subEmitters);
    }

    protected onDestroy(): void {
        this.collision?.destroy();
        this.collision = null;
    }
}
