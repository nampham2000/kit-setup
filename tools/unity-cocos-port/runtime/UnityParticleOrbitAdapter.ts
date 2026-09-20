import { _decorator, Component, ParticleSystem } from 'cc';
import { installUnityParticleOrbit } from './UnityParticleOrbit';
import { UnityOrbitSpec } from './UnityParticleOrbit';

const { ccclass, property, executionOrder } = _decorator;

// Generated prefab binding. The source contract is preserved verbatim; no
// project-specific controller or effect-name lookup is needed.
@ccclass('UnityParticleOrbitAdapter')
@executionOrder(-100)
export class UnityParticleOrbitAdapter extends Component {
    @property(ParticleSystem) source: ParticleSystem | null = null;
    @property sourceContract = '';

    protected start(): void {
        if (!this.source || !this.sourceContract) throw new Error('Missing Unity Orbit source contract');
        if (this.source.limitVelocityOvertimeModule.enable) throw new Error('Unity Orbit with velocity limit requires a validated integration adapter');
        const spec = JSON.parse(this.sourceContract) as UnityOrbitSpec;
        installUnityParticleOrbit(this.source, spec);
    }
}
