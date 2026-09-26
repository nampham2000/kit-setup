import { _decorator, Component, ParticleSystem } from 'cc';
import { installUnityParticleSimulationStep } from './UnityParticleSimulationStep';
import { installUnityParticleRandomForce } from './UnityParticleRandomForce';
const { ccclass, property, executionOrder } = _decorator;
@ccclass('UnityParticleSimulationStepAdapter')
@executionOrder(-110)
export class UnityParticleSimulationStepAdapter extends Component {
    @property(ParticleSystem) source: ParticleSystem | null = null;
    @property maximumDeltaTime = 0;
    @property gravityY = -9.81;
    @property sourceForceContract = '';
    protected onLoad(): void {
        if (!this.source) throw new Error('Missing simulation-step particle system');
        installUnityParticleSimulationStep(this.source, this.maximumDeltaTime, this.gravityY);
    }
    protected start(): void {
        if(this.source&&this.sourceForceContract)installUnityParticleRandomForce(this.source,JSON.parse(this.sourceForceContract));
    }
}
