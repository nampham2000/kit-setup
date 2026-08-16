import { _decorator, Component, AudioClip, AudioSource, Node, resources } from 'cc';
import { SoundManager } from '../SoundManager';
import { PlayableConfigManager } from '../config';
import { superHtmlPlayable } from 'playable-sdk/platform/SuperHtmlPlayable';

const { ccclass, property } = _decorator;

/**
 * Controller for managing Playable audio lifecycle, SFX, BGM, and mute states.
 * All audio paths, autoplay states, and volume levels are loaded dynamically from `playable-config.json`.
 */
@ccclass('PlayableAudioController')
export class PlayableAudioController extends Component {
  private static _instance: PlayableAudioController | null = null;

  // Runtime audio clip assets and volumes loaded from config
  public bgmClip: AudioClip | null = null;
  public clickSfx: AudioClip | null = null;
  public successSfx: AudioClip | null = null;
  public winSfx: AudioClip | null = null;

  public autoPlayBgm: boolean = true;
  public bgmVolume: number = 0.6;
  public sfxVolume: number = 1.0;

  private _isMuted: boolean = false;
  private _bgmSource: AudioSource | null = null;
  private _sfxSource: AudioSource | null = null;
  private _hasUnlockedAudio: boolean = false;
  private _onMuteChangedCallbacks: Array<(isMuted: boolean) => void> = [];

  public static get instance(): PlayableAudioController | null {
    return this._instance;
  }

  public get isMuted(): boolean {
    return this._isMuted;
  }

  onLoad(): void {
    if (PlayableAudioController._instance && PlayableAudioController._instance !== this) {
      this.node.destroy();
      return;
    }
    PlayableAudioController._instance = this;

    this.applyConfig();

    // Create internal AudioSources if not present
    this._bgmSource = this.getComponent(AudioSource) || this.addComponent(AudioSource);
    this._bgmSource.loop = true;
    this._bgmSource.volume = this.bgmVolume;
    this._bgmSource.playOnAwake = false;

    const sfxNode = new Node('SFX_AudioSource');
    sfxNode.parent = this.node;
    this._sfxSource = sfxNode.addComponent(AudioSource);
    this._sfxSource.loop = false;
    this._sfxSource.volume = this.sfxVolume;
    this._sfxSource.playOnAwake = false;

    // Check platform audio policy (e.g. IronSource muted flag)
    if (!superHtmlPlayable.is_audio()) {
      this.setMute(true);
    }

    // Auto load audio clips from resources/sound configured in JSON
    this.autoLoadAudioClips();

    PlayableConfigManager.instance.onConfigChanged(() => {
      this.applyConfig();
    });
  }

  private applyConfig(): void {
    const audioConfig = PlayableConfigManager.instance.audio;
    if (audioConfig) {
      this.autoPlayBgm = audioConfig.autoPlayBgm ?? this.autoPlayBgm;
      this.bgmVolume = audioConfig.bgmVolume ?? this.bgmVolume;
      this.sfxVolume = audioConfig.sfxVolume ?? this.sfxVolume;

      if (this._bgmSource) {
        this._bgmSource.volume = this._isMuted ? 0 : this.bgmVolume;
      }
      if (this._sfxSource) {
        this._sfxSource.volume = this._isMuted ? 0 : this.sfxVolume;
      }
    }
  }

  private autoLoadAudioClips(): void {
    const cfg = PlayableConfigManager.instance.audio;
    if (!cfg) return;

    if (!this.bgmClip && cfg.bgmSoundPath) {
      resources.load(cfg.bgmSoundPath, AudioClip, (err, clip) => {
        if (!err && clip) {
          this.bgmClip = clip;
          if (this.autoPlayBgm && !this._isMuted && (!this._bgmSource || !this._bgmSource.playing)) {
            this.playBgm();
          }
        }
      });
    }

    if (!this.clickSfx && cfg.clickSoundPath) {
      resources.load(cfg.clickSoundPath, AudioClip, (err, clip) => {
        if (!err && clip) this.clickSfx = clip;
      });
    }

    if (!this.successSfx && cfg.successSoundPath) {
      resources.load(cfg.successSoundPath, AudioClip, (err, clip) => {
        if (!err && clip) this.successSfx = clip;
      });
    }

    if (!this.winSfx && cfg.winSoundPath) {
      resources.load(cfg.winSoundPath, AudioClip, (err, clip) => {
        if (!err && clip) this.winSfx = clip;
      });
    }
  }

  start(): void {
    if (this.autoPlayBgm && this.bgmClip && !this._isMuted) {
      this.playBgm();
    }
  }

  /**
   * Resumes Web Audio Context on first touch event to comply with mobile browser autoplay policies.
   */
  public unlockAudio(): void {
    if (this._hasUnlockedAudio) return;
    this._hasUnlockedAudio = true;

    try {
      const win = globalThis as any;
      const audioCtx = win.AudioContext || win.webkitAudioContext;
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
    } catch (e) {
      // Ignore if not supported
    }

    if (this.autoPlayBgm && this.bgmClip && !this._isMuted && (!this._bgmSource || !this._bgmSource.playing)) {
      this.playBgm();
    }
  }

  public playBgm(clip?: AudioClip): void {
    const targetClip = clip || this.bgmClip;
    if (!targetClip || !this._bgmSource) return;

    this._bgmSource.clip = targetClip;
    this._bgmSource.volume = this._isMuted ? 0 : this.bgmVolume;
    this._bgmSource.play();
  }

  public stopBgm(): void {
    if (this._bgmSource) {
      this._bgmSource.stop();
    }
  }

  public playClickSfx(): void {
    this.playSfx(this.clickSfx);
  }

  public playSuccessSfx(): void {
    this.playSfx(this.successSfx);
  }

  public playWinSfx(): void {
    this.playSfx(this.winSfx);
  }

  public playSfx(clip: AudioClip | null): void {
    if (this._isMuted || !clip || !this._sfxSource) return;
    this._sfxSource.playOneShot(clip, this.sfxVolume);
  }

  public toggleMute(): boolean {
    this.setMute(!this._isMuted);
    return this._isMuted;
  }

  public setMute(muted: boolean): void {
    this._isMuted = muted;

    if (this._bgmSource) {
      this._bgmSource.volume = muted ? 0 : this.bgmVolume;
    }
    if (this._sfxSource) {
      this._sfxSource.volume = muted ? 0 : this.sfxVolume;
    }

    // Also notify core SoundManager if active
    if (SoundManager.instance) {
      SoundManager.instance.muteBGM(muted);
      SoundManager.instance.muteSFX(muted);
    }

    // Notify listeners (such as UI Audio Button)
    for (const cb of this._onMuteChangedCallbacks) {
      cb(this._isMuted);
    }
  }

  public addMuteListener(cb: (isMuted: boolean) => void): void {
    this._onMuteChangedCallbacks.push(cb);
  }

  public removeMuteListener(cb: (isMuted: boolean) => void): void {
    this._onMuteChangedCallbacks = this._onMuteChangedCallbacks.filter(c => c !== cb);
  }
}
