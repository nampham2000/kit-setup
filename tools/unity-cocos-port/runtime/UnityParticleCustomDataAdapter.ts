import { _decorator, Component, ParticleSystem } from 'cc';
import { EDITOR_NOT_IN_PREVIEW } from 'cc/env';
import { UnityCustomDataSpec, UnityParticleCustomDataStream } from './UnityParticleCustomData';

const { ccclass, property } = _decorator;

/** Binds Unity CustomDataModule Custom1 curves (sourceContract JSON) to the particle material. */
@ccclass('UnityParticleCustomDataAdapter')
export class UnityParticleCustomDataAdapter extends Component {
    @property({ type: ParticleSystem })
    public source: ParticleSystem | null = null;

    @property
    public sourceContract = '';

    private stream: UnityParticleCustomDataStream | null = null;

    // start: materials bound by scene runtimes in onLoad must exist before the define is added.
    protected start(): void {
        if (EDITOR_NOT_IN_PREVIEW || !this.source || this.stream) return;
        // Only materials whose effect declares the Custom1 texture take the feed: others would
        // log unknown-property warnings and get an instanced material for nothing.
        const material = this.source.getSharedMaterial(0);
        const declares = !!material?.effectAsset?.techniques.some((t) => t.passes.some((p) => !!p.properties && 'customDataTexture' in p.properties));
        if (!declares) return;
        const spec = JSON.parse(this.sourceContract || '{"curves":[]}') as UnityCustomDataSpec;
        this.stream = new UnityParticleCustomDataStream(this.source, spec);
    }

    protected onDestroy(): void {
        this.stream?.destroy();
        this.stream = null;
    }
}
