import { _decorator, Component, ParticleSystem } from 'cc';
import { EDITOR_NOT_IN_PREVIEW } from 'cc/env';
import { UnityParticleAlignToDirection } from './UnityParticleAlignToDirection';

const { ccclass, property } = _decorator;

/** Generated binding for Unity ShapeModule.alignToDirection (particle-align-to-direction-binding.js). */
@ccclass('UnityParticleAlignToDirectionAdapter')
export class UnityParticleAlignToDirectionAdapter extends Component {
    @property(ParticleSystem) source: ParticleSystem | null = null;
    /** JSON {eulerSigns:[x,y,z]} from the renderer contract. */
    @property sourceContract = '';
    private align: UnityParticleAlignToDirection | null = null;

    protected onLoad(): void {
        if (EDITOR_NOT_IN_PREVIEW || !this.source) return;
        const contract = JSON.parse(this.sourceContract || '{}') as { eulerSigns?: number[] };
        this.align = new UnityParticleAlignToDirection(this.source, contract.eulerSigns || [-1, -1, 1]);
    }

    protected onDestroy(): void {
        this.align?.destroy();
        this.align = null;
    }
}
