import { _decorator, Component, ParticleSystem } from 'cc';
import { installUnityParticleNoise } from './UnityParticleNoise';
import { UnityNoiseSpec } from './UnityNoiseKernel';

const { ccclass, property, executionOrder } = _decorator;

// Generated prefab binding. The source contract is preserved verbatim; no
// project-specific controller or effect-name lookup is needed.
@ccclass('UnityParticleNoiseAdapter')
@executionOrder(-100)
export class UnityParticleNoiseAdapter extends Component {
    @property(ParticleSystem) source: ParticleSystem | null = null;
    @property sourceContract = '';

    protected start(): void {
        if (!this.source || !this.sourceContract) throw new Error('Missing Unity Noise source contract');
        const spec = JSON.parse(this.sourceContract) as UnityNoiseSpec;
        installUnityParticleNoise(this.source, spec);
    }
}
