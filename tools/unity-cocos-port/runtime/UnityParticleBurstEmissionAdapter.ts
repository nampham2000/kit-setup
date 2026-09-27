import { _decorator, Component, ParticleSystem } from 'cc';
import { installUnityParticleBurstEmission } from './UnityParticleBurstEmission';

const { ccclass, property, executionOrder } = _decorator;

// Repeating bursts: Cocos 3.8.8 dispatches at most one repeat per frame, so a
// repeatInterval shorter than the frame (Hovl Magic circles: 3 x 400 every 0.01 s)
// falls behind and stops for good. Installs Unity's catch-up (and Burst Spread when
// the shape asks for it) on load, before the system can play.
@ccclass('UnityParticleBurstEmissionAdapter')
@executionOrder(-100)
export class UnityParticleBurstEmissionAdapter extends Component {
    @property(ParticleSystem) source: ParticleSystem | null = null;

    protected onLoad(): void {
        if (!this.source) throw new Error('Missing burst-emission particle system');
        installUnityParticleBurstEmission(this.source);
    }
}
