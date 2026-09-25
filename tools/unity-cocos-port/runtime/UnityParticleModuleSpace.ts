import { _decorator, Component, Mat4, ParticleSystem } from 'cc';

const { ccclass, executionOrder, property } = _decorator;
const SPACE_MODULES = ['velocityOvertimeModule', 'forceOvertimeModule', 'limitVelocityOvertimeModule'];
const _worldMatrix = new Mat4();

type SpaceModule = {
    enable: boolean;
    space: number;
    update(space: number, worldTransform: Mat4): void;
};

// Cocos 3.8.8's CPU particle renderer never calls the modules' update(space, worldTransform) (the call is commented
// out in updateParticles), so a Velocity/Force/Limit Velocity over Lifetime module whose space differs from the
// simulation space is applied without that rotation. Unity's default local-space velocity over lifetime then points
// along fixed world axes (Tanks! dust sank sideways instead of down). Refresh it with the emitter's current
// transform every frame, before the ParticleSystem (executionOrder 99) simulates, as Unity does.
@ccclass('UnityParticleModuleSpace')
@executionOrder(97)
export class UnityParticleModuleSpace extends Component {
    @property({ type: ParticleSystem })
    public particleSystem: ParticleSystem | null = null;

    protected update(): void {
        const particleSystem = this.particleSystem;
        if (!particleSystem || !particleSystem.isPlaying) return;
        const system = particleSystem as unknown as Record<string, SpaceModule | null>;
        for (const key of SPACE_MODULES) {
            const module = system[key];
            if (!module || !module.enable || module.space === particleSystem.simulationSpace) continue;
            // calculateTransform inverts the matrix in place for local-space systems.
            particleSystem.node.getWorldMatrix(_worldMatrix);
            module.update(particleSystem.simulationSpace, _worldMatrix);
        }
    }
}
