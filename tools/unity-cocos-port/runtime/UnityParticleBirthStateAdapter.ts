import { _decorator, Component, ParticleSystem } from 'cc';
import { installUnityParticleBirthState } from './UnityParticleBirthState';

const { ccclass, property, executionOrder } = _decorator;

@ccclass('UnityParticleBirthStateAdapter')
@executionOrder(-100)
export class UnityParticleBirthStateAdapter extends Component {
    @property(ParticleSystem) source: ParticleSystem | null = null;
    @property nativeScalingMode = -1;

    protected start(): void {
        if (!this.source) throw new Error('Missing birth-state particle system');
        installUnityParticleBirthState(this.source, this.nativeScalingMode);
    }
}
