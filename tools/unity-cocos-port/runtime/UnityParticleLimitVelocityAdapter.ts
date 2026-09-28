import { _decorator, Component, ParticleSystem } from 'cc';
import { installUnityParticleLimitVelocity, UnityLimitDragSpec } from './UnityParticleLimitVelocity';

const { ccclass, property, executionOrder } = _decorator;

// Installs on load, before the system's onEnable can play or prewarm.
// sourceContract (optional) carries the Unity drag contract:
// {"drag":{minMaxState,scalar,...},"multiplyBySize":bool,"multiplyByVelocity":bool}.
@ccclass('UnityParticleLimitVelocityAdapter')
@executionOrder(-100)
export class UnityParticleLimitVelocityAdapter extends Component {
    @property(ParticleSystem) source: ParticleSystem | null = null;
    @property sourceContract = '';

    protected onLoad(): void {
        if (!this.source) throw new Error('Missing limit-velocity particle system');
        const drag = this.sourceContract ? JSON.parse(this.sourceContract) as UnityLimitDragSpec : null;
        installUnityParticleLimitVelocity(this.source, drag);
    }
}
