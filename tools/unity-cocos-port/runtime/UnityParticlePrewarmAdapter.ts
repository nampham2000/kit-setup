import { _decorator, Component, ParticleSystem } from 'cc';
import { installUnityParticlePrewarm } from './UnityParticlePrewarm';

const { ccclass, property, executionOrder } = _decorator;

// Installs on load, before the system's onEnable plays and prewarms, so a
// freshly instantiated or re-activated effect starts in Unity's steady state.
@ccclass('UnityParticlePrewarmAdapter')
@executionOrder(-100)
export class UnityParticlePrewarmAdapter extends Component {
    @property(ParticleSystem) source: ParticleSystem | null = null;

    protected onLoad(): void {
        if (!this.source) throw new Error('Missing prewarm particle system');
        installUnityParticlePrewarm(this.source);
    }
}
