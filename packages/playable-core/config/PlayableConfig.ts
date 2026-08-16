/**
 * Playable Configuration interfaces and default presets.
 * Acts like a Unity ScriptableObject data asset for Cocos Creator 3.8.
 */

export interface IPlayableCTAConfig {
  googlePlayUrl: string;
  appStoreUrl: string;
  enableButtonPulse: boolean;
  autoRedirectDelay: number;
  pulseScaleMultiplier: number;
  pulseDuration: number;
}

export interface IPlayableAudioConfig {
  autoPlayBgm: boolean;
  bgmVolume: number;
  sfxVolume: number;
  bgmSoundPath: string;
  clickSoundPath: string;
  successSoundPath: string;
  winSoundPath: string;
}

export interface IPlayableGameplayConfig {
  targetTaps: number;
  autoWinTimer: number;
  difficulty: 'easy' | 'normal' | 'hard' | string;
  [key: string]: any;
}

export interface IPlayableCameraPreset {
  position: { x: number; y: number; z: number };
  eulerRotation: { x: number; y: number; z: number };
}

export interface IPlayableCameraConfig {
  defaultMode: number;
  transitionDuration: number;
  fovPortrait: number;
  fovLandscape: number;
  presets?: IPlayableCameraPreset[];
}

export interface IPlayableHeroConfig {
  enableIdleAnimation: boolean;
  floatHeight: number;
  floatDuration: number;
  rotationDuration: number;
  punchScaleFactor: number;
}

export interface IPlayableTrackingConfig {
  enableHeartbeat: boolean;
  heartbeatInterval: number;
  gameId?: string;
}

export interface IPlayableConfig {
  $schema?: string;
  title?: string;
  version?: string;
  cta: IPlayableCTAConfig;
  audio: IPlayableAudioConfig;
  gameplay: IPlayableGameplayConfig;
  camera: IPlayableCameraConfig;
  hero: IPlayableHeroConfig;
  tracking: IPlayableTrackingConfig;
  custom: Record<string, any>;
}

export const DEFAULT_PLAYABLE_CONFIG: IPlayableConfig = {
  $schema: 'playable-config-v1',
  title: 'Playable Ad Config',
  version: '1.0.0',
  cta: {
    googlePlayUrl: 'https://play.google.com/store/apps/details?id=com.playable.ad',
    appStoreUrl: 'https://apps.apple.com/app/id123456789',
    enableButtonPulse: true,
    autoRedirectDelay: 0,
    pulseScaleMultiplier: 1.08,
    pulseDuration: 0.6,
  },
  audio: {
    autoPlayBgm: true,
    bgmVolume: 0.6,
    sfxVolume: 1.0,
    bgmSoundPath: 'sound/bgm_main',
    clickSoundPath: 'sound/sfx_click',
    successSoundPath: 'sound/sfx_success',
    winSoundPath: 'sound/sfx_win',
  },
  gameplay: {
    targetTaps: 3,
    autoWinTimer: 0,
    difficulty: 'normal',
  },
  camera: {
    defaultMode: 0,
    transitionDuration: 0.5,
    fovPortrait: 55,
    fovLandscape: 45,
    presets: [
      { position: { x: 0, y: 5.5, z: 7.5 }, eulerRotation: { x: -32, y: 0, z: 0 } },
      { position: { x: 0, y: 9.5, z: 1.2 }, eulerRotation: { x: -80, y: 0, z: 0 } },
      { position: { x: 0, y: 3.2, z: 4.2 }, eulerRotation: { x: -18, y: 0, z: 0 } },
    ],
  },
  hero: {
    enableIdleAnimation: true,
    floatHeight: 0.35,
    floatDuration: 1.4,
    rotationDuration: 4.0,
    punchScaleFactor: 1.3,
  },
  tracking: {
    enableHeartbeat: true,
    heartbeatInterval: 5,
    gameId: 'cc_playable_game',
  },
  custom: {},
};
