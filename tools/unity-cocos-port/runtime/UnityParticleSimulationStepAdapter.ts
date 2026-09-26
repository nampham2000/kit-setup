import { _decorator, Component, ParticleSystem } from 'cc';
import { installUnityParticleSimulationStep } from './UnityParticleSimulationStep';
const { ccclass, property, executionOrder } = _decorator;
@ccclass('UnityParticleSimulationStepAdapter')
@executionOrder(-110)
export class UnityParticleSimulationStepAdapter extends Component {
    @property(ParticleSystem) source: ParticleSystem | null = null;
    @property maximumDeltaTime = 0;
    protected onLoad(): void {
        if (!this.source) throw new Error('Missing simulation-step particle system');
        installUnityParticleSimulationStep(this.source, this.maximumDeltaTime);
    }
}
