import { AudioClip, AudioSource, Node } from 'cc';
import { ObjectPool, PoolHandle } from '../utils/pool/ObjectPool';
import { AudioVoiceBackend } from './AudioSystem';

/**
 * Web Audio nodes of a loaded clip: the decoded buffer and the browser context the Cocos web player already uses
 * (AudioClip._nativeAsset.player._player = pal/audio/web AudioPlayerWeb). No second context is created.
 */
interface WebClip { ctx: BaseAudioContext; buffer: AudioBuffer }
function webClipOf(clip: AudioClip): WebClip | null {
  const meta = (clip as unknown as { _nativeAsset?: { player?: { _player?: { _audioBuffer?: AudioBuffer; _gainNode?: GainNode } } } })._nativeAsset;
  const web = meta && meta.player && meta.player._player;
  const buffer = web && web._audioBuffer;
  const gain = web && web._gainNode;
  const ctx = gain && gain.context;
  if (!buffer || !ctx || typeof ctx.createBufferSource !== 'function' || typeof ctx.createGain !== 'function') return null;
  return { ctx, buffer };
}

/** One Web Audio voice: BufferSource (per start / resume) -> Gain -> StereoPanner -> destination. */
interface WebVoice {
  ctx: BaseAudioContext;
  gain: GainNode;
  panner: StereoPannerNode | null;
  src: AudioBufferSourceNode | null;
  buffer: AudioBuffer | null;
  loop: boolean;
  rate: number;
  /** buffer offset (s) at startedAt */
  offset: number;
  startedAt: number;
  paused: boolean;
  handle: number;
}

/**
 * One controlled voice per slot; BGM is owned separately by SoundManager.
 * Web Audio clips play through Web Audio nodes (playback rate = Unity pitch, StereoPanner = Unity 3D panning);
 * other clips (DOM audio, native) use the slot's Cocos AudioSource, which ignores rate / pan (supportsRatePan
 * reports whether the last started voice rendered them).
 */
export class CocosAudioBackend implements AudioVoiceBackend<AudioClip> {
  private readonly pool = new ObjectPool();
  private readonly bucket: PoolHandle<AudioSource>;
  private readonly sources: AudioSource[] = [];
  private readonly ended: Array<(() => void) | null> = [];
  private readonly web: Array<WebVoice | null> = [];
  private _ctx: BaseAudioContext | null = null;
  /** true once a voice played through Web Audio nodes (rate / pan rendered) */
  public supportsRatePan = false;

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
      this.web.push(null);
    }
  }

  private webVoice(slot: number, ctx: BaseAudioContext): WebVoice {
    let v = this.web[slot];
    if (v && v.ctx === ctx) return v;
    const gain = ctx.createGain();
    const panner = typeof (ctx as AudioContext).createStereoPanner === 'function' ? (ctx as AudioContext).createStereoPanner() : null;
    if (panner) { gain.connect(panner); panner.connect(ctx.destination); } else gain.connect(ctx.destination);
    v = { ctx, gain, panner, src: null, buffer: null, loop: false, rate: 1, offset: 0, startedAt: 0, paused: false, handle: 0 };
    this.web[slot] = v;
    return v;
  }

  private startNode(slot: number, v: WebVoice, offset: number): void {
    const src = v.ctx.createBufferSource();
    src.buffer = v.buffer;
    src.loop = v.loop;
    src.playbackRate.value = v.rate;
    src.connect(v.gain);
    const handle = v.handle;
    src.onended = () => {
      if (v.src !== src) return; // stopped / restarted
      v.src = null;
      if (v.paused || v.loop) return;
      v.handle = 0;
      this.onComplete(handle);
    };
    v.src = src;
    v.offset = offset;
    v.startedAt = v.ctx.currentTime;
    src.start(0, offset);
  }

  private stopNode(v: WebVoice): void {
    const src = v.src;
    v.src = null;
    if (src) { src.onended = null; try { src.stop(); } catch { /* not started */ } src.disconnect(); }
  }

  public start(slot: number, handle: number, clip: AudioClip, loop: boolean, volume: number, rate: number = 1, pan: number = 0): void {
    this.stop(slot);
    const wc = webClipOf(clip);
    if (wc) {
      this._ctx = wc.ctx;
      const v = this.webVoice(slot, wc.ctx);
      v.buffer = wc.buffer; v.loop = loop; v.rate = rate; v.paused = false; v.handle = handle;
      v.gain.gain.value = volume;
      if (v.panner) v.panner.pan.value = pan;
      this.supportsRatePan = !!v.panner;
      this.startNode(slot, v, 0);
      return;
    }
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
    const v = this.web[slot];
    if (v) { this.stopNode(v); v.handle = 0; v.paused = false; }
    const source = this.sources[slot];
    const ended = this.ended[slot];
    if (ended) source.node.off(AudioSource.EventType.ENDED, ended);
    this.ended[slot] = null;
    source.stop();
    source.clip = null;
  }
  public pause(slot: number): void {
    const v = this.web[slot];
    if (v && v.handle) {
      if (v.paused || !v.src || !v.buffer) return;
      const played = (v.ctx.currentTime - v.startedAt) * v.rate + v.offset;
      v.offset = v.loop ? played % v.buffer.duration : Math.min(played, v.buffer.duration);
      v.paused = true;
      this.stopNode(v);
      return;
    }
    this.sources[slot].pause();
  }
  public resume(slot: number): void {
    const v = this.web[slot];
    if (v && v.handle) {
      if (!v.paused) return;
      v.paused = false;
      this.startNode(slot, v, v.offset);
      return;
    }
    this.sources[slot].play();
  }
  public volume(slot: number, volume: number): void {
    const v = this.web[slot];
    if (v && v.handle) { v.gain.gain.value = volume; return; }
    this.sources[slot].volume = volume;
  }
  public pan(slot: number, pan: number): void {
    const v = this.web[slot];
    if (v && v.handle && v.panner) v.panner.pan.value = pan;
  }
  /** From the unlocking gesture: resume the shared context if the browser suspended it (no new context). */
  public unlock(): void {
    const ctx = this._ctx as AudioContext | null;
    if (ctx && ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume().catch(() => { /* retried by the next gesture */ });
  }
  /** Bind the shared context early (a preloaded clip) so unlock() can resume it before the first voice. */
  public adoptContext(clip: AudioClip): void {
    const wc = webClipOf(clip);
    if (wc) this._ctx = wc.ctx;
  }
  public destroy(): void {
    for (let i = 0; i < this.sources.length; i++) {
      this.stop(i);
      const v = this.web[i];
      if (v) { v.gain.disconnect(); if (v.panner) v.panner.disconnect(); }
      this.web[i] = null;
      this.bucket.put(this.sources[i]);
    }
    this.bucket.clear();
    this.sources.length = 0;
    this.ended.length = 0;
    this.web.length = 0;
  }
}
