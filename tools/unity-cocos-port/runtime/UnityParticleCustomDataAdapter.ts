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
        const spec = JSON.parse(this.sourceContract || '{"curves":[]}') as UnityCustomDataSpec;
        this.stream = new UnityParticleCustomDataStream(this.source, spec);
    }

    protected onDestroy(): void {
        this.stream?.destroy();
        this.stream = null;
    }
}
