import { _decorator, Component, AudioClip, Node, input, Input, game, Game } from 'cc';
import { SoundManager } from '../SoundManager';
import { PlayableConfigManager } from '../config/PlayableConfigManager';
import { DEFAULT_PLAYABLE_CONFIG } from '../config/PlayableConfig';
import { AudioSystemConfig } from '../audio/AudioSystem';
import { superHtmlPlayable } from '../../sdk/platform/SuperHtmlPlayable';

const { ccclass } = _decorator;

/**
 * Browser user-activation events that may unlock audio. Cocos UI nodes consume touches before the global
 * input dispatcher, so a first gesture on an on-screen control (virtual stick, fire button) never reached the
 * input TOUCH_START/MOUSE_DOWN listeners, and keyboard-only players never touch at all.
 */
const DOM_GESTURE_EVENTS = ['pointerdown', 'touchstart', 'mousedown', 'keydown'];

/** Scene-facing facade. All playback is owned by the persistent SoundManager. */
@ccclass('PlayableAudioController')
export class PlayableAudioController extends Component {
  private static _instance: PlayableAudioController | null = null;
  public bgmClip: AudioClip | null = null;
  public clickSfx: AudioClip | null = null;
  public successSfx: AudioClip | null = null;
  public winSfx: AudioClip | null = null;
  public autoPlayBgm = false;
  public bgmVolume = 0;
  public sfxVolume = 0;
  private _manager: SoundManager | null = null;
  private _isMuted = false;
  private _hasUnlockedAudio = false;
  private _hidden = false;
  private _resumeBgm = false;
  private _bgmStopped = false;
  private _generation = 0;
  private _unsubscribe: (() => void) | null = null;
  private _onMuteChangedCallbacks: Array<(isMuted: boolean) => void> = [];
  public ready: Promise<void> = Promise.resolve();
  private readonly _domUnlock = (): void => this.unlockAudio();
  private _domTarget: EventTarget | null = null;

  public static get instance(): PlayableAudioController | null { return this._instance; }
  public get isMuted(): boolean { return this._isMuted; }

  public onLoad(): void {
    if (PlayableAudioController._instance && PlayableAudioController._instance !== this) {
      this.node.destroy();
      return;
    }
    PlayableAudioController._instance = this;
    this._manager = SoundManager.instance;
    if (!this._manager) {
      const root = new Node('Shared Audio System');
      root.parent = this.node.scene;
      this._manager = root.addComponent(SoundManager);
    }
    this._isMuted = !superHtmlPlayable.is_audio();
    input.on(Input.EventType.TOUCH_START, this.unlockAudio, this);
    input.on(Input.EventType.MOUSE_DOWN, this.unlockAudio, this);
    const domTarget = (globalThis as { window?: EventTarget }).window;
    if (domTarget && typeof domTarget.addEventListener === 'function') {
      for (const type of DOM_GESTURE_EVENTS) domTarget.addEventListener(type, this._domUnlock, { capture: true, passive: true });
      this._domTarget = domTarget;
    }
    game.on(Game.EVENT_HIDE, this.onHide, this);
    game.on(Game.EVENT_SHOW, this.onShow, this);
    this.ready = PlayableConfigManager.instance.ensureLoaded('playable-config').then(() => {
      if (PlayableAudioController._instance !== this) return;
      this._unsubscribe = PlayableConfigManager.instance.onConfigChanged(() => {
        this.ready = this.applyConfig();
        this.ready.catch(error => console.error('[AudioSystem] Configuration/preload failed', error));
      });
      return this.applyConfig();
    });
    this.ready.catch(error => console.error('[AudioSystem] Configuration/preload failed', error));
  }

  private async applyConfig(): Promise<void> {
    const generation = ++this._generation;
    const cfg = PlayableConfigManager.instance.audio;
    const manager = this._manager!;
    this.autoPlayBgm = cfg.autoPlayBgm;
    this.bgmVolume = cfg.bgmVolume;
    this.sfxVolume = cfg.sfxVolume;
    manager.stopBGM();
    this.bgmClip = null;
    manager.setBGMVolume(this.bgmVolume);
    manager.setSFXVolume(this.sfxVolume);
    manager.muteBGM(this._isMuted);
    manager.muteSFX(this._isMuted);
    // Legacy path fields feed explicit template intents, without a second player.
    const system = JSON.parse(JSON.stringify(cfg.system ?? DEFAULT_PLAYABLE_CONFIG.audio.system)) as AudioSystemConfig;
    if (system.sounds['ui-click'] && !system.sounds['ui-click'].path) system.sounds['ui-click'].path = cfg.clickSoundPath;
    if (system.sounds.success && !system.sounds.success.path) system.sounds.success.path = cfg.successSoundPath;
    if (system.sounds.win && !system.sounds.win.path) system.sounds.win.path = cfg.winSoundPath;
    const sfxReady = manager.configureAudio(system);
    manager.audio?.setSuspended(this._hidden);
    if (this._hasUnlockedAudio) manager.audio?.unlockFromGesture();
    const bgmReady = cfg.bgmSoundPath ? manager.preload(cfg.bgmSoundPath) : Promise.resolve(null);
    const [, bgm] = await Promise.all([sfxReady, bgmReady]);
    if (generation !== this._generation) return;
    this.bgmClip = bgm;
    this.clickSfx = manager.getCachedAudio(system.sounds['ui-click']?.path ?? '');
    this.successSfx = manager.getCachedAudio(system.sounds.success?.path ?? '');
    this.winSfx = manager.getCachedAudio(system.sounds.win?.path ?? '');
    // If the first gesture happened during loading, next gesture retries BGM.
    // Do not manufacture an AudioContext or emit silent sounds to unlock it.
  }

  /** Must be called from a real gesture; engine/browser owns the audio context. */
  public unlockAudio(): void {
    this._hasUnlockedAudio = true;
    this._manager?.audio?.unlockFromGesture();
    if (this.autoPlayBgm && !this._bgmStopped) this.playBgm();
  }
  public playBgm(clip?: AudioClip): void {
    if (!this._hasUnlockedAudio || this._isMuted || this._hidden) return;
    const target = clip ?? this.bgmClip;
    if (!target) return;
    this._bgmStopped = false;
    this._manager?.playBGM(target);
  }
  public stopBgm(): void {
    this._bgmStopped = true;
    this._resumeBgm = false;
    this._manager?.stopBGM();
  }
  public playClickSfx(): void { this._manager?.playSound('ui-click'); }
  public playSuccessSfx(): void { this._manager?.playSound('success'); }
  public playWinSfx(): void { this._manager?.playSound('win'); }
  /** Known template clip compatibility. New ports call SoundManager.playSound(id). */
  public playSfx(clip: AudioClip | null): void {
    if (!clip) return;
    if (clip === this.clickSfx) this.playClickSfx();
    else if (clip === this.successSfx) this.playSuccessSfx();
    else if (clip === this.winSfx) this.playWinSfx();
    else if (this._hasUnlockedAudio && !this._isMuted && !this._hidden) this._manager?.playSFX(clip);
  }
  public toggleMute(): boolean { this.setMute(!this._isMuted); return this._isMuted; }
  public setMute(muted: boolean): void {
    this._isMuted = muted;
    this._manager?.muteBGM(muted);
    this._manager?.muteSFX(muted);
    if (!muted && this.autoPlayBgm && !this._bgmStopped) this.playBgm();
    for (const cb of this._onMuteChangedCallbacks) cb(muted);
  }
  public addMuteListener(cb: (isMuted: boolean) => void): void { this._onMuteChangedCallbacks.push(cb); }
  public removeMuteListener(cb: (isMuted: boolean) => void): void {
    const index = this._onMuteChangedCallbacks.indexOf(cb);
    if (index >= 0) this._onMuteChangedCallbacks.splice(index, 1);
  }
  private onHide(): void {
    this._hidden = true;
    this._resumeBgm = this._manager?.isBGMPlaying() ?? false;
    this._manager?.pauseBGM();
    this._manager?.audio?.setSuspended(true);
  }
  private onShow(): void {
    this._hidden = false;
    this._manager?.audio?.setSuspended(false);
    if (this._resumeBgm && !this._isMuted) this._manager?.resumeBGM();
    this._resumeBgm = false;
  }
  public onDestroy(): void {
    this._generation++;
    this._unsubscribe?.();
    input.off(Input.EventType.TOUCH_START, this.unlockAudio, this);
    input.off(Input.EventType.MOUSE_DOWN, this.unlockAudio, this);
    for (const type of DOM_GESTURE_EVENTS) this._domTarget?.removeEventListener(type, this._domUnlock, { capture: true });
    this._domTarget = null;
    game.off(Game.EVENT_HIDE, this.onHide, this);
    game.off(Game.EVENT_SHOW, this.onShow, this);
    if (PlayableAudioController._instance !== this) return;
    this._manager?.audio?.stopAll();
    this._manager?.stopBGM();
    this._onMuteChangedCallbacks.length = 0;
    PlayableAudioController._instance = null;
  }
}
