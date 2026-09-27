import { _decorator, Component, ParticleSystem } from 'cc';
import { installUnityParticleBurstSpread } from './UnityParticleBurstEmission';

const { ccclass, property, executionOrder } = _decorator;

// Installs on load, before the system's onEnable can play or prewarm, so the
// first burst of a freshly instantiated effect is already spread.
@ccclass('UnityParticleBurstSpreadAdapter')
@executionOrder(-100)
export class UnityParticleBurstSpreadAdapter extends Component {
    @property(ParticleSystem) source: ParticleSystem | null = null;

    protected onLoad(): void {
        if (!this.source) throw new Error('Missing burst-spread particle system');
        installUnityParticleBurstSpread(this.source);
    }
}
