import { _decorator, Component, AudioClip, AudioSource, Node, director } from 'cc';
import { GameUtils } from './utils/GameUtils';
const { ccclass } = _decorator;

const DEFAULT_BGM_VOLUME = 0.8;
const DEFAULT_SFX_VOLUME = 1.0;

interface LoopingSfxPlayback {
  source: AudioSource;
  volume: number;
}

@ccclass('PlayableCoreSoundManager')
export class SoundManager extends Component {
  private _bgmVolume: number = DEFAULT_BGM_VOLUME;
  private _sfxVolume: number = DEFAULT_SFX_VOLUME;

  private static _instance: SoundManager | null = null;
  private _bgmAudioSource: AudioSource = null;
  private _sfxAudioSource: AudioSource = null;

  private _bgmMuted: boolean = false;
  private _sfxMuted: boolean = false;

  private _audioCache: Map<string, AudioClip> = new Map();
  private _audioLoading: Map<string, Promise<AudioClip>> = new Map();
  private _loopingSfx: Map<number, LoopingSfxPlayback | null> = new Map();
  private _nextLoopingSfxId: number = 1;

  public static get instance(): SoundManager | null {
    return this._instance;
  }

  onLoad() {
    if (SoundManager._instance) {
      this.node.destroy();
      return;
    }

    SoundManager._instance = this;
    const scene = director.getScene();
    if (scene) this.node.parent = scene;
    director.addPersistRootNode(this.node);

    if (!this._bgmAudioSource) {
      const bgmNode = new Node('BGM AudioSource');
      bgmNode.parent = this.node;
      this._bgmAudioSource = bgmNode.addComponent(AudioSource);
      this._bgmAudioSource.loop = true;
      this._bgmAudioSource.playOnAwake = false;
      this._bgmAudioSource.volume = this._bgmVolume;
    }

    if (!this._sfxAudioSource) {
      const sfxNode = new Node('SFX AudioSource');
      sfxNode.parent = this.node;
      this._sfxAudioSource = sfxNode.addComponent(AudioSource);
      this._sfxAudioSource.loop = false;
      this._sfxAudioSource.playOnAwake = false;
      this._sfxAudioSource.volume = this._sfxVolume;
    }
  }

  public preload(path: string): Promise<AudioClip> {
    if (!path) {
      return Promise.reject(new Error('[SoundManager] preload: empty path'));
    }

    const cached = this._audioCache.get(path);
    if (cached) return Promise.resolve(cached);

    const pending = this._audioLoading.get(path);
    if (pending) return pending;

    const promise = (async (): Promise<AudioClip> => {
      try {
        const clip = await GameUtils.loadAsset<AudioClip>(path);
        if (!clip) throw new Error(`[SoundManager] Failed to load audio: ${path}`);
        clip.addRef();
        this._audioCache.set(path, clip);
        return clip;
      } finally {
        this._audioLoading.delete(path);
      }
    })();

    this._audioLoading.set(path, promise);
    return promise;
  }

  public preloadList(paths: string[]): Promise<void> {
    if (!paths || paths.length === 0) return Promise.resolve();
    return Promise.all(paths.map((p) => this.preload(p))).then(() => undefined);
  }

  public playBGM(pathOrClip: string | AudioClip, loop: boolean = true): void {
    if (!pathOrClip || !this._bgmAudioSource) return;

    if (typeof pathOrClip === 'string') {
      this.preload(pathOrClip)
        .then((clip) => this.playBGM(clip, loop))
        .catch(() => undefined);
      return;
    }

    const clip = pathOrClip;
    if (this._bgmAudioSource.clip === clip && this._bgmAudioSource.playing) return;

    this._bgmAudioSource.stop();
    this._bgmAudioSource.clip = clip;
    this._bgmAudioSource.loop = loop;
    this._bgmAudioSource.volume = this._bgmMuted ? 0 : this._bgmVolume;
    this._bgmAudioSource.play();
  }

  public stopBGM(): void {
    if (this._bgmAudioSource) {
      this._bgmAudioSource.stop();
    }
  }

  public pauseBGM(): void {
    if (this._bgmAudioSource) {
      this._bgmAudioSource.pause();
    }
  }

  public resumeBGM(): void {
    if (this._bgmAudioSource) {
      this._bgmAudioSource.play();
    }
  }

  public isBGMPlaying(): boolean {
    return this._bgmAudioSource?.playing ?? false;
  }

  public playSFX(pathOrClip: string | AudioClip, volume: number = 1.0, loop: boolean = false): void {
    if (!pathOrClip || !this._sfxAudioSource || this._sfxMuted) return;

    if (typeof pathOrClip === 'string') {
      this.preload(pathOrClip)
        .then((clip) => this.playSFX(clip, volume, loop))
        .catch(() => undefined);
      return;
    }

    const clip = pathOrClip;
    if (loop) {
      if (this._sfxAudioSource.clip !== clip || !this._sfxAudioSource.playing || !this._sfxAudioSource.loop) {
        this._sfxAudioSource.stop();
        this._sfxAudioSource.clip = clip;
        this._sfxAudioSource.loop = true;
        this._sfxAudioSource.volume = this._sfxVolume * volume;
        this._sfxAudioSource.play();
      }
      return;
    }

    this._sfxAudioSource.playOneShot(clip, this._sfxVolume * volume);
  }

  /**
   * Starts an independently stoppable looping SFX channel.
   *
   * A dedicated AudioSource is required for each loop. Reusing the one-shot
   * source would make a second concurrent loop stop the first one, which is a
   * common mismatch when Unity gameplay stores and stops playback IDs per
   * object (for example, two tape rolls peeling at the same time).
   */
  public playLoopingSFX(pathOrClip: string | AudioClip, volume: number = 1.0): number {
    if (!pathOrClip) return 0;

    const id = this._nextLoopingSfxId++;
    this._loopingSfx.set(id, null);

    if (typeof pathOrClip === 'string') {
      this.preload(pathOrClip)
        .then((clip) => {
          if (!this._loopingSfx.has(id)) return;
          this.startLoopingSFX(id, clip, volume);
        })
        .catch(() => this._loopingSfx.delete(id));
      return id;
    }

    this.startLoopingSFX(id, pathOrClip, volume);
    return id;
  }

  public stopLoopingSFX(id: number): void {
    if (!id || !this._loopingSfx.has(id)) return;
    const playback = this._loopingSfx.get(id);
    this._loopingSfx.delete(id);
    if (!playback) return;
    playback.source.stop();
    playback.source.node.destroy();
  }

  public stopAllLoopingSFX(): void {
    for (const playback of this._loopingSfx.values()) {
      if (!playback) continue;
      playback.source.stop();
      playback.source.node.destroy();
    }
    this._loopingSfx.clear();
  }

  public getActiveLoopingSFXCount(): number {
    return this._loopingSfx.size;
  }

  private startLoopingSFX(id: number, clip: AudioClip, volume: number): void {
    if (!this._loopingSfx.has(id) || !this.node?.isValid) return;
    const node = new Node(`Looping SFX ${id}`);
    node.parent = this.node;
    const source = node.addComponent(AudioSource);
    const normalizedVolume = Math.max(0, volume);
    source.clip = clip;
    source.loop = true;
    source.playOnAwake = false;
    source.volume = this._sfxMuted ? 0 : this._sfxVolume * normalizedVolume;
    this._loopingSfx.set(id, { source, volume: normalizedVolume });
    source.play();
  }

  public release(path: string): void {
    const clip = this._audioCache.get(path);
    if (!clip) return;
    this._audioCache.delete(path);
    clip.decRef();
  }

  public releaseAll(): void {
    for (const clip of this._audioCache.values()) {
      clip.decRef();
    }
    this._audioCache.clear();
    this._audioLoading.clear();
  }

  public setBGMVolume(volume: number): void {
    this._bgmVolume = Math.max(0, Math.min(1, volume));
    if (this._bgmAudioSource && !this._bgmMuted) {
      this._bgmAudioSource.volume = this._bgmVolume;
    }
  }

  public setSFXVolume(volume: number): void {
    this._sfxVolume = Math.max(0, Math.min(1, volume));
    if (this._sfxAudioSource) {
      this._sfxAudioSource.volume = this._sfxVolume;
    }
    for (const playback of this._loopingSfx.values()) {
      if (playback) playback.source.volume = this._sfxMuted ? 0 : this._sfxVolume * playback.volume;
    }
  }

  public getBGMVolume(): number {
    return this._bgmVolume;
  }

  public getSFXVolume(): number {
    return this._sfxVolume;
  }

  public muteBGM(mute: boolean): void {
    this._bgmMuted = mute;
    if (this._bgmAudioSource) {
      this._bgmAudioSource.volume = mute ? 0 : this._bgmVolume;
    }
  }

  public muteSFX(mute: boolean): void {
    this._sfxMuted = mute;
    for (const playback of this._loopingSfx.values()) {
      if (playback) playback.source.volume = mute ? 0 : this._sfxVolume * playback.volume;
    }
  }

  public isBGMMuted(): boolean {
    return this._bgmMuted;
  }

  public isSFXMuted(): boolean {
    return this._sfxMuted;
  }

  onDestroy() {
    this.stopAllLoopingSFX();
    this.releaseAll();
    if (SoundManager._instance === this) {
      SoundManager._instance = null;
    }
  }
}
