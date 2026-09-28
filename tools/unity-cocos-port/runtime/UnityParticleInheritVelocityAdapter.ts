import { _decorator, Component, ParticleSystem } from 'cc';
import { EDITOR_NOT_IN_PREVIEW } from 'cc/env';
import { UnityParticleInheritVelocity } from './UnityParticleInheritVelocity';

const { ccclass, property } = _decorator;

/** Generated binding for Unity InheritVelocityModule (particle-inherit-velocity-binding.js). */
@ccclass('UnityParticleInheritVelocityAdapter')
export class UnityParticleInheritVelocityAdapter extends Component {
    @property(ParticleSystem) source: ParticleSystem | null = null;
    /** Unity InheritVelocityModule constant multiplier (Initial mode). */
    @property multiplier = 0;
    private runtime: UnityParticleInheritVelocity | null = null;

    // cc.ParticleSystem (executionOrder 99) creates its processor in its own onLoad.
    protected onLoad(): void { this.install(); }
    protected start(): void { this.install(); }

    private install(): void {
        if (this.runtime || EDITOR_NOT_IN_PREVIEW || !this.source || !(this.source as any).processor) return;
        this.runtime = new UnityParticleInheritVelocity(this.source, this.multiplier);
    }

    // Default execution order runs before cc.ParticleSystem.update (99), which emits.
    protected update(dt: number): void {
        if (this.runtime) this.runtime.frameDelta = dt;
    }

    protected lateUpdate(): void {
        this.runtime?.track();
    }

    protected onDestroy(): void {
        this.runtime?.destroy();
        this.runtime = null;
    }
}
