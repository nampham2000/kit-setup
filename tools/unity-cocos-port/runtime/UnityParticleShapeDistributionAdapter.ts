import { _decorator, Component, ParticleSystem } from 'cc';
import { installUnityShapeDistribution } from './UnityParticleShapeDistribution';

const { ccclass, property, executionOrder } = _decorator;

// Installs on load, before the system's onEnable can play or prewarm, so the first
// emission of a freshly instantiated effect already uses Unity's radius distribution.
@ccclass('UnityParticleShapeDistributionAdapter')
@executionOrder(-100)
export class UnityParticleShapeDistributionAdapter extends Component {
    @property(ParticleSystem) source: ParticleSystem | null = null;

    protected onLoad(): void {
        if (!this.source) throw new Error('Missing shape-distribution particle system');
        installUnityShapeDistribution(this.source);
    }
}
