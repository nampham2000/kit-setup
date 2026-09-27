import { _decorator, Component, ParticleSystem } from 'cc';
import { installUnityParticleSimulationStep } from './UnityParticleSimulationStep';
import { installUnityParticleCapacityRetirement } from './UnityParticleBirthTiming';
import { installUnityParticleRandomForce } from './UnityParticleRandomForce';
const { executeInEditMode, playOnFocus,  ccclass, property, executionOrder } = _decorator;
@ccclass('UnityParticleSimulationStepAdapter')
@executeInEditMode
@playOnFocus
@executionOrder(-110)
export class UnityParticleSimulationStepAdapter extends Component {
    @property(ParticleSystem) source: ParticleSystem | null = null;
    @property maximumDeltaTime = 0;
    @property gravityY = -9.81;
    @property sourceForceContract = '';
    @property sourceCapacityRetirement = false;
    protected onLoad(): void {
        if (!this.source) throw new Error('Missing simulation-step particle system');
        installUnityParticleSimulationStep(this.source, this.maximumDeltaTime, this.gravityY);
        if(this.sourceCapacityRetirement)installUnityParticleCapacityRetirement(this.source);
    }
    protected start(): void {
        // ParticleSystem.onLoad may create its processor after this early adapter.
        if(this.source&&this.sourceCapacityRetirement)installUnityParticleCapacityRetirement(this.source);
        if(this.source&&this.sourceForceContract)installUnityParticleRandomForce(this.source,JSON.parse(this.sourceForceContract));
    }
}
