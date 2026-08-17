import { _decorator, Component, AudioClip, AudioSource, Node, director } from 'cc';
import { GameUtils } from './utils/GameUtils.ts';
const { ccclass } = _decorator;

const DEFAULT_BGM_VOLUME = 0.8;
const DEFAULT_SFX_VOLUME = 1.0;

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
  }

  public isBGMMuted(): boolean {
    return this._bgmMuted;
  }

  public isSFXMuted(): boolean {
    return this._sfxMuted;
  }

  onDestroy() {
    this.releaseAll();
    if (SoundManager._instance === this) {
      SoundManager._instance = null;
    }
  }
}
