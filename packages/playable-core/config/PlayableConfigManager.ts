import { resources, JsonAsset } from 'cc';
import { IPlayableConfig, IPlayableCTAConfig, IPlayableAudioConfig, IPlayableGameplayConfig, IPlayableCameraConfig, IPlayableHeroConfig, IPlayableTrackingConfig, DEFAULT_PLAYABLE_CONFIG } from './PlayableConfig';

type ConfigChangeCallback = (config: IPlayableConfig) => void;

/**
 * Centralized Scriptable Configuration Manager for Playable Ads.
 * Loads and coordinates all parameters (CTA, Audio, Gameplay, Camera, Hero, Tracking)
 * dynamically from `resources/playable-config.json` before gameplay begins.
 */
export class PlayableConfigManager {
  private static _instance: PlayableConfigManager | null = null;
  private _config: IPlayableConfig = JSON.parse(JSON.stringify(DEFAULT_PLAYABLE_CONFIG));
  private _isLoaded: boolean = false;
  private _loadPromise: Promise<IPlayableConfig> | null = null;
  private _listeners: ConfigChangeCallback[] = [];

  public static get instance(): PlayableConfigManager {
    if (!this._instance) {
      this._instance = new PlayableConfigManager();
    }
    return this._instance;
  }

  public get isLoaded(): boolean {
    return this._isLoaded;
  }

  public get config(): IPlayableConfig {
    return this._config;
  }

  public get cta(): IPlayableCTAConfig {
    return this._config.cta;
  }

  public get audio(): IPlayableAudioConfig {
    return this._config.audio;
  }

  public get gameplay(): IPlayableGameplayConfig {
    return this._config.gameplay;
  }

  public get camera(): IPlayableCameraConfig {
    return this._config.camera;
  }

  public get hero(): IPlayableHeroConfig {
    return this._config.hero;
  }

  public get tracking(): IPlayableTrackingConfig {
    return this._config.tracking;
  }

  public get custom(): Record<string, any> {
    return this._config.custom || {};
  }

  /**
   * Ensures configuration is loaded asynchronously before proceeding.
   * Caches in-flight promise to prevent redundant asset queries.
   */
  public ensureLoaded(path: string = 'playable-config'): Promise<IPlayableConfig> {
    if (this._isLoaded) {
      return Promise.resolve(this._config);
    }
    if (this._loadPromise) {
      return this._loadPromise;
    }

    this._loadPromise = this.loadFromResource(path);
    return this._loadPromise;
  }

  /**
   * Initialize or overwrite configuration directly from an object.
   */
  public init(customConfig?: Partial<IPlayableConfig>): IPlayableConfig {
    if (customConfig) {
      this.mergeConfig(customConfig);
    }
    this._isLoaded = true;
    this.notifyListeners();
    return this._config;
  }

  /**
   * Load and apply configuration from a Cocos Creator JsonAsset.
   */
  public loadFromJsonAsset(asset: JsonAsset | null): IPlayableConfig {
    if (!asset || !asset.json) {
      console.warn('[PlayableConfigManager] Invalid JsonAsset provided, keeping default config.');
      this._isLoaded = true;
      return this._config;
    }
    return this.init(asset.json as Partial<IPlayableConfig>);
  }

  /**
   * Asynchronously load configuration from `resources/` (e.g. `resources/playable-config.json`).
   */
  public loadFromResource(path: string = 'playable-config'): Promise<IPlayableConfig> {
    return new Promise((resolve) => {
      resources.load(path, JsonAsset, (err, asset) => {
        if (err || !asset || !asset.json) {
          console.warn(`[PlayableConfigManager] Could not load "${path}" from resources. Using default config.`, err);
          this._isLoaded = true;
          resolve(this._config);
          return;
        }

        console.log(`[PlayableConfigManager] Successfully loaded config from resources/${path}`);
        this.loadFromJsonAsset(asset);
        resolve(this._config);
      });
    });
  }

  /**
   * Get a deeply nested property value by dot-notated key path.
   * Example: get('cta.googlePlayUrl', 'https://...')
   */
  public get<T = any>(keyPath: string, defaultValue?: T): T {
    if (!keyPath) return defaultValue as T;
    const parts = keyPath.split('.');
    let curr: any = this._config;

    for (const part of parts) {
      if (curr === null || curr === undefined || typeof curr !== 'object') {
        return defaultValue as T;
      }
      curr = curr[part];
    }

    return (curr !== undefined ? curr : defaultValue) as T;
  }

  /**
   * Set a deeply nested property value at runtime.
   */
  public set(keyPath: string, value: any): void {
    if (!keyPath) return;
    const parts = keyPath.split('.');
    let curr: any = this._config;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in curr) || typeof curr[part] !== 'object' || curr[part] === null) {
        curr[part] = {};
      }
      curr = curr[part];
    }

    curr[parts[parts.length - 1]] = value;
    this.notifyListeners();
  }

  /**
   * Subscribe to config updates.
   */
  public onConfigChanged(callback: ConfigChangeCallback): () => void {
    this._listeners.push(callback);
    return () => {
      this._listeners = this._listeners.filter(cb => cb !== callback);
    };
  }

  private notifyListeners(): void {
    for (const cb of this._listeners) {
      try {
        cb(this._config);
      } catch (e) {
        console.error('[PlayableConfigManager] Listener callback error:', e);
      }
    }
  }

  private mergeConfig(source: any): void {
    if (!source || typeof source !== 'object') return;

    for (const key of Object.keys(source)) {
      if (key in this._config && typeof (this._config as any)[key] === 'object' && !Array.isArray((this._config as any)[key]) && source[key] !== null) {
        Object.assign((this._config as any)[key], source[key]);
      } else {
        (this._config as any)[key] = source[key];
      }
    }
  }
}
