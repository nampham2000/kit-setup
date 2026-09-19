/** Engine-independent, bounded voice scheduler. Larger priority wins. */
export interface AudioSoundPolicy {
  path: string;
  cooldownMs: number;
  maxConcurrent: number;
  priority: number;
  volume: number;
  loop: boolean;
  stealable: boolean;
}

export interface AudioSystemConfig {
  maxSfxVoices: number;
  sounds: Record<string, AudioSoundPolicy>;
}

export type AudioDecision = 'played' | 'locked' | 'muted' | 'suspended' | 'unknown'
  | 'not-ready' | 'cooldown' | 'concurrency' | 'budget' | 'backend-error';

export interface AudioVoiceBackend<T> {
  start(slot: number, handle: number, clip: T, loop: boolean, volume: number): void;
  stop(slot: number): void;
  pause(slot: number): void;
  resume(slot: number): void;
  volume(slot: number, volume: number): void;
}

interface SoundState<T> {
  policy: AudioSoundPolicy;
  clip: T | null;
  lastPlayMs: number;
  active: number;
}

interface Voice<T> {
  handle: number;
  paused: boolean;
  sound: SoundState<T> | null;
  gain: number;
  playbackGain: number;
  fadeRemaining: number;
  fadeDuration: number;
}

export function validateAudioSystemConfig(config: AudioSystemConfig): void {
  if (!Number.isInteger(config.maxSfxVoices) || config.maxSfxVoices < 1 || config.maxSfxVoices > 64) {
    throw new Error('audio.system.maxSfxVoices must be an integer in [1, 64]');
  }
  if (!config.sounds || typeof config.sounds !== 'object' || Array.isArray(config.sounds)) {
    throw new Error('audio.system.sounds must be a record');
  }
  for (const id of Object.keys(config.sounds)) {
    const p = config.sounds[id];
    if (!id || !p || typeof p.path !== 'string' || !Number.isFinite(p.cooldownMs) || p.cooldownMs < 0
      || !Number.isInteger(p.maxConcurrent) || p.maxConcurrent < 1 || p.maxConcurrent > config.maxSfxVoices
      || !Number.isFinite(p.priority) || !Number.isFinite(p.volume) || p.volume < 0 || p.volume > 1
      || typeof p.loop !== 'boolean' || typeof p.stealable !== 'boolean') {
      throw new Error(`Invalid audio policy: ${id}`);
    }
  }
}

/** No timers, promises, object creation or logging in play/update. Preload before input. */
export class AudioSystem<T> {
  private readonly sounds = new Map<string, SoundState<T>>();
  private readonly voices: Voice<T>[] = [];
  private static nextHandle = 1;
  private unlocked = false;
  private muted = false;
  private suspended = false;
  private masterVolume = 1;
  public lastDecision: AudioDecision = 'locked';
  public readonly counters = { requested: 0, played: 0, rejected: 0, stolen: 0, completed: 0, backendErrors: 0 };

  constructor(config: AudioSystemConfig, private readonly backend: AudioVoiceBackend<T>,
    private readonly now: () => number = () => performance.now()) {
    validateAudioSystemConfig(config);
    for (const id of Object.keys(config.sounds)) {
      this.sounds.set(id, { policy: { ...config.sounds[id] }, clip: null, lastPlayMs: -Infinity, active: 0 });
    }
    for (let i = 0; i < config.maxSfxVoices; i++) {
      this.voices.push({ handle: 0, paused: false, sound: null, gain: 1, playbackGain: 1, fadeRemaining: 0, fadeDuration: 0 });
    }
  }

  public bind(id: string, clip: T): void {
    const state = this.sounds.get(id);
    if (!state) throw new Error(`Unknown audio intent: ${id}`);
    state.clip = clip;
  }

  public has(id: string): boolean { return this.sounds.has(id); }
  public unlockFromGesture(): void { this.unlocked = true; }
  public get isUnlocked(): boolean { return this.unlocked; }
  public get activeVoices(): number {
    let count = 0;
    for (let i = 0; i < this.voices.length; i++) if (this.voices[i].handle) count++;
    return count;
  }

  /** Positive handle means backend start was requested, not proof of audible output. */
  public play(id: string, playbackGain: number = 1): number {
    this.counters.requested++;
    if (!this.unlocked) return this.reject('locked');
    if (this.muted) return this.reject('muted');
    if (this.suspended) return this.reject('suspended');
    const sound = this.sounds.get(id);
    if (!sound) return this.reject('unknown');
    if (!sound.clip) return this.reject('not-ready');
    const now = this.now();
    if (now - sound.lastPlayMs < sound.policy.cooldownMs) return this.reject('cooldown');
    if (sound.active >= sound.policy.maxConcurrent) return this.reject('concurrency');
    let slot = -1;
    let victim = -1;
    for (let i = 0; i < this.voices.length; i++) {
      const voice = this.voices[i];
      if (!voice.handle) { slot = i; break; }
      const oldPolicy = voice.sound!.policy;
      if (oldPolicy.stealable && oldPolicy.priority < sound.policy.priority
        && (victim < 0 || oldPolicy.priority < this.voices[victim].sound!.policy.priority
          || (oldPolicy.priority === this.voices[victim].sound!.policy.priority
            && voice.handle < this.voices[victim].handle))) victim = i;
    }
    if (slot < 0) {
      if (victim < 0) return this.reject('budget');
      slot = victim;
      this.stop(this.voices[slot].handle);
      this.counters.stolen++;
    }
    const voice = this.voices[slot];
    const handle = AudioSystem.nextHandle++;
    voice.handle = handle;
    voice.paused = false;
    voice.sound = sound;
    voice.gain = 1;
    voice.playbackGain = Number.isFinite(playbackGain) ? Math.max(0, Math.min(1, playbackGain)) : 1;
    voice.fadeRemaining = 0;
    sound.active++;
    try {
      this.backend.start(slot, handle, sound.clip, sound.policy.loop, sound.policy.volume * this.masterVolume * voice.playbackGain);
    } catch {
      this.backend.stop(slot);
      this.clear(slot);
      this.counters.backendErrors++;
      return this.reject('backend-error');
    }
    sound.lastPlayMs = now;
    this.lastDecision = 'played';
    this.counters.played++;
    return handle;
  }

  private reject(reason: AudioDecision): number {
    this.lastDecision = reason;
    this.counters.rejected++;
    return 0;
  }

  public isActive(handle: number): boolean { return this.find(handle) >= 0; }
  public setPlaybackGain(handle: number, gain: number): boolean {
    const slot = this.find(handle);
    if (slot < 0 || !Number.isFinite(gain)) return false;
    this.voices[slot].playbackGain = Math.max(0, Math.min(1, gain));
    this.applyVolume(slot);
    return true;
  }
  private find(handle: number): number {
    if (!handle) return -1;
    for (let i = 0; i < this.voices.length; i++) if (this.voices[i].handle === handle) return i;
    return -1;
  }

  public stop(handle: number): boolean {
    const slot = this.find(handle);
    if (slot < 0) return false;
    // Invalidate before stop, since some backends emit an event synchronously.
    this.clear(slot);
    this.backend.stop(slot);
    return true;
  }

  public pause(handle: number): boolean {
    const slot = this.find(handle);
    if (slot < 0) return false;
    const voice = this.voices[slot];
    if (!voice.paused && !this.suspended) this.backend.pause(slot);
    voice.paused = true;
    return true;
  }

  public resume(handle: number): boolean {
    const slot = this.find(handle);
    if (slot < 0) return false;
    const voice = this.voices[slot];
    if (voice.paused && !this.suspended) this.backend.resume(slot);
    voice.paused = false;
    return true;
  }

  /** Backend passes the original handle; stale completion cannot release a reused voice. */
  public complete(handle: number): void {
    const slot = this.find(handle);
    if (slot < 0) return;
    this.clear(slot);
    this.counters.completed++;
  }

  private clear(slot: number): void {
    const voice = this.voices[slot];
    if (voice.sound) voice.sound.active--;
    voice.handle = 0;
    voice.sound = null;
    voice.fadeRemaining = 0;
  }

  public fadeOut(handle: number, seconds: number): boolean {
    const slot = this.find(handle);
    if (slot < 0 || !Number.isFinite(seconds) || seconds < 0) return false;
    if (seconds === 0) return this.stop(handle);
    const voice = this.voices[slot];
    voice.fadeDuration = seconds / voice.gain;
    voice.fadeRemaining = seconds;
    return true;
  }

  public update(dt: number): void {
    if (this.suspended || dt <= 0 || !Number.isFinite(dt)) return;
    for (let i = 0; i < this.voices.length; i++) {
      const voice = this.voices[i];
      if (!voice.handle || voice.paused || voice.fadeRemaining <= 0) continue;
      voice.fadeRemaining = Math.max(0, voice.fadeRemaining - dt);
      if (voice.fadeRemaining === 0) this.stop(voice.handle);
      else {
        voice.gain = voice.fadeRemaining / voice.fadeDuration;
        this.applyVolume(i);
      }
    }
  }

  private applyVolume(slot: number): void {
    const voice = this.voices[slot];
    if (voice.sound) this.backend.volume(slot, this.muted ? 0 : voice.sound.policy.volume * this.masterVolume * voice.gain * voice.playbackGain);
  }
  public setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    this.masterVolume = Math.max(0, Math.min(1, volume));
    for (let i = 0; i < this.voices.length; i++) this.applyVolume(i);
  }
  public setMuted(muted: boolean): void {
    this.muted = muted;
    for (let i = 0; i < this.voices.length; i++) this.applyVolume(i);
  }
  public setSuspended(suspended: boolean): void {
    if (this.suspended === suspended) return;
    this.suspended = suspended;
    for (let i = 0; i < this.voices.length; i++) {
      if (!this.voices[i].handle || this.voices[i].paused) continue;
      if (suspended) this.backend.pause(i);
      else this.backend.resume(i);
    }
  }
  public stopAll(): void {
    for (let i = 0; i < this.voices.length; i++) if (this.voices[i].handle) this.stop(this.voices[i].handle);
    for (const sound of this.sounds.values()) sound.lastPlayMs = -Infinity;
  }
}
