import { AudioClip, AudioSource, Node } from 'cc';
import { ObjectPool, PoolHandle } from '../utils/pool/ObjectPool';
import { AudioVoiceBackend } from './AudioSystem';

/** One controlled AudioSource per slot; BGM is owned separately by SoundManager. */
export class CocosAudioBackend implements AudioVoiceBackend<AudioClip> {
  private readonly pool = new ObjectPool();
  private readonly bucket: PoolHandle<AudioSource>;
  private readonly sources: AudioSource[] = [];
  private readonly ended: Array<(() => void) | null> = [];

  constructor(root: Node, count: number, private readonly onComplete: (handle: number) => void) {
    this.bucket = this.pool.register<AudioSource>('audio-voices', {
      max: count,
      create: () => {
        const node = new Node('Managed SFX Voice');
        node.parent = root;
        const source = node.addComponent(AudioSource);
        source.playOnAwake = false;
        return source;
      },
      destroy: source => source.node.destroy(),
    });
    // Reserve once during initialization. No node/component churn in gameplay.
    for (let i = 0; i < count; i++) {
      this.sources.push(this.bucket.get());
      this.ended.push(null);
    }
  }

  public start(slot: number, handle: number, clip: AudioClip, loop: boolean, volume: number): void {
    this.stop(slot);
    const source = this.sources[slot];
    source.clip = clip;
    source.loop = loop;
    source.volume = volume;
    const ended = () => {
      if (this.ended[slot] !== ended) return;
      this.ended[slot] = null;
      source.clip = null;
      this.onComplete(handle);
    };
    this.ended[slot] = ended;
    source.node.once(AudioSource.EventType.ENDED, ended);
    source.play();
  }
  public stop(slot: number): void {
    const source = this.sources[slot];
    const ended = this.ended[slot];
    if (ended) source.node.off(AudioSource.EventType.ENDED, ended);
    this.ended[slot] = null;
    source.stop();
    source.clip = null;
  }
  public pause(slot: number): void { this.sources[slot].pause(); }
  public resume(slot: number): void { this.sources[slot].play(); }
  public volume(slot: number, volume: number): void { this.sources[slot].volume = volume; }
  public destroy(): void {
    for (let i = 0; i < this.sources.length; i++) {
      this.stop(i);
      this.bucket.put(this.sources[i]);
    }
    this.bucket.clear();
    this.sources.length = 0;
    this.ended.length = 0;
  }
}
