import { _decorator, Component, ParticleSystem } from 'cc';
import { installUnityParticleExternalForces } from './UnityParticleExternalForces';

const { ccclass, property, executionOrder } = _decorator;

// Installs in start: cc.ParticleSystem (executionOrder 99) creates its processor after
// this component's onLoad. Unity influence filters other than "all layers" are refused by the porter.
@ccclass('UnityParticleExternalForcesAdapter')
@executionOrder(-100)
export class UnityParticleExternalForcesAdapter extends Component {
    @property(ParticleSystem) source: ParticleSystem | null = null;
    @property multiplier = 1;

    protected start(): void {
        if (!this.source) throw new Error('Missing external-forces particle system');
        installUnityParticleExternalForces(this.source, { multiplier: this.multiplier });
    }
}
