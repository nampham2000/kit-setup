import { _decorator, Component, ParticleSystem } from 'cc';
import { applyUnityParticleVelocityFrame, bindUnityParticleMeshBounds, UnityMeshFrameSpec } from './UnityParticleMeshFrame';

const { ccclass, property } = _decorator;

// Generated prefab binding for Unity Mesh particle pivots (mesh-bounds units) and
// Velocity alignment. The source contract comes from particle-renderer-contract.js.
@ccclass('UnityParticleMeshFrameAdapter')
export class UnityParticleMeshFrameAdapter extends Component {
    @property(ParticleSystem) source: ParticleSystem | null = null;
    @property sourceContract = '';
    private spec: UnityMeshFrameSpec | null = null;

    protected start(): void {
        if (!this.source || !this.sourceContract) throw new Error('Missing Unity mesh frame source contract');
        this.spec = JSON.parse(this.sourceContract) as UnityMeshFrameSpec;
        // The system's material instance exists once its own onLoad has run.
        if (this.spec.pivot && !bindUnityParticleMeshBounds(this.source)) throw new Error('Unity mesh pivot needs the renderer mesh bounds and a material instance');
    }

    // After ParticleSystem.update simulated the frame and before BEFORE_COMMIT fills vertices.
    protected lateUpdate(): void {
        if (this.spec?.velocity && this.source) applyUnityParticleVelocityFrame(this.source);
    }
}
