import { _decorator, Component, ParticleSystem } from 'cc';
const { ccclass, property, executionOrder } = _decorator;

// Unity separates ParticleSystem simulation from ParticleSystemRenderer.enabled.
@ccclass('UnityParticleRendererVisibility')
@executionOrder(1000)
export class UnityParticleRendererVisibility extends Component {
    @property(ParticleSystem) public source: ParticleSystem | null = null;
    @property public rendererVisible = false;
    @property public trailsVisible = false;

    lateUpdate(): void {
        if (!this.source) return;
        const processor = this.source.processor as any;
        if (!this.rendererVisible) {
            if (processor?.model) processor.model.enabled = false;
            else if (processor?._model) processor._model.enabled = false;
        }
        const trail = this.source.trailModule.getModel();
        if (trail && !this.trailsVisible) trail.enabled = false;
    }
}
