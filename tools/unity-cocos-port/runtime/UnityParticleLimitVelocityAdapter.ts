import { _decorator, Component, ParticleSystem } from 'cc';
import { installUnityParticleLimitVelocity } from './UnityParticleLimitVelocity';

const { ccclass, property, executionOrder } = _decorator;

// Installs on load, before the system's onEnable can play or prewarm.
@ccclass('UnityParticleLimitVelocityAdapter')
@executionOrder(-100)
export class UnityParticleLimitVelocityAdapter extends Component {
    @property(ParticleSystem) source: ParticleSystem | null = null;

    protected onLoad(): void {
        if (!this.source) throw new Error('Missing limit-velocity particle system');
        installUnityParticleLimitVelocity(this.source);
    }
}
