import { _decorator, Component, ParticleSystem } from 'cc';
import { installUnityParticleEulerRotation } from './UnityParticleEulerRotation';

const { ccclass, property, executionOrder } = _decorator;

// Generated prefab binding for Mesh and Local-billboard rotation over lifetime.
// Installed in onLoad so prewarm and first births already use Unity's order.
@ccclass('UnityParticleEulerRotationAdapter')
@executionOrder(-100)
export class UnityParticleEulerRotationAdapter extends Component {
    @property(ParticleSystem) source: ParticleSystem | null = null;
    @property sourceContract = '';

    protected onLoad(): void {
        if (!this.source) throw new Error('Missing Unity Euler rotation particle system');
        if (!installUnityParticleEulerRotation(this.source)) throw new Error('Unity Euler rotation requires a rotation-over-lifetime module');
    }
}
