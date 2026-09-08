import { resources, JsonAsset } from 'cc';
import { IPlayableConfig, IPlayableCTAConfig, IPlayableAudioConfig, IPlayableGameplayConfig, IPlayableCameraConfig, IPlayableHeroConfig, IPlayableTrackingConfig, DEFAULT_PLAYABLE_CONFIG } from './PlayableConfig';

type ConfigChangeCallback = (config: IPlayableConfig) => void;
type ConfigFragmentMap = Record<string, string>;

interface ConfigFragmentEntry {
  targetParts: string[];
  resourcePath: string;
}

const CONFIG_FRAGMENTS_KEY = '$fragments';
const FORBIDDEN_CONFIG_PATH_PARTS = new Set(['__proto__', 'prototype', 'constructor']);

function cloneConfigValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isConfigRecord(value: any): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeFragmentResourcePath(value: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid config fragment resource path "${String(value)}"`);
  }
  const normalized = String(value || '').trim().replace(/\\/g, '/')
    .replace(/^resources\//, '')
    .replace(/\.json$/i, '');
  const parts = normalized.split('/');
  if (!normalized || normalized.startsWith('/')
    || parts.some(part => !part || part === '.' || part === '..' || part.indexOf(':') >= 0)) {
    throw new Error(`Invalid config fragment resource path "${value}"`);
  }
  return normalized;
}

function getConfigFragmentEntries(config: any): ConfigFragmentEntry[] {
  const fragmentMap = config?.[CONFIG_FRAGMENTS_KEY] as ConfigFragmentMap | undefined;
  if (fragmentMap === undefined) return [];
  if (!isConfigRecord(fragmentMap)) {
    throw new Error(`${CONFIG_FRAGMENTS_KEY} must map config paths to resource paths`);
  }

  const entries: ConfigFragmentEntry[] = [];
  for (const target of Object.keys(fragmentMap)) {
    const resourcePath = fragmentMap[target];
    const targetParts = target.split('.').map(part => part.trim());
    if (!targetParts.length || targetParts.some(part => !part || FORBIDDEN_CONFIG_PATH_PARTS.has(part) || part === CONFIG_FRAGMENTS_KEY)) {
      throw new Error(`Invalid config fragment target "${target}"`);
    }
    entries.push({
      targetParts,
      resourcePath: normalizeFragmentResourcePath(resourcePath),
    });
  }
  if (entries.length > 64) throw new Error(`${CONFIG_FRAGMENTS_KEY} supports at most 64 entries`);
  const resourcePaths = new Set<string>();
  for (const entry of entries) {
    if (resourcePaths.has(entry.resourcePath)) {
      throw new Error(`Config fragment resource path "${entry.resourcePath}" has more than one owner`);
    }
    resourcePaths.add(entry.resourcePath);
  }
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const left = entries[i].targetParts;
      const right = entries[j].targetParts;
      const sharedLength = Math.min(left.length, right.length);
      let samePrefix = true;
      for (let k = 0; k < sharedLength; k++) {
        if (left[k] !== right[k]) {
          samePrefix = false;
          break;
        }
      }
      if (samePrefix) {
        throw new Error('Config fragment target paths must not overlap');
      }
    }
  }
  return entries;
}

function mergeConfigRecord(target: Record<string, any>, source: Record<string, any>): void {
  for (const key of Object.keys(source)) {
    const sourceValue = source[key];
    if (isConfigRecord(sourceValue) && isConfigRecord(target[key])) {
      mergeConfigRecord(target[key], sourceValue);
    } else {
      target[key] = cloneConfigValue(sourceValue);
    }
  }
}

function mergeConfigAtPath(target: Record<string, any>, parts: string[], value: any): void {
  let current = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!isConfigRecord(current[part])) current[part] = {};
    current = current[part];
  }
  const leaf = parts[parts.length - 1];
  if (isConfigRecord(value) && isConfigRecord(current[leaf])) {
    mergeConfigRecord(current[leaf], value);
  } else {
    current[leaf] = cloneConfigValue(value);
  }
}

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
    if ((asset.json as any)[CONFIG_FRAGMENTS_KEY]) {
      console.warn('[PlayableConfigManager] Fragment manifests require loadFromResource() so referenced assets can be loaded.');
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

        const manifest = asset.json as Partial<IPlayableConfig>;
        let entries: ConfigFragmentEntry[] = [];
        try {
          entries = getConfigFragmentEntries(manifest);
        } catch (fragmentError) {
          console.error('[PlayableConfigManager] Invalid config fragment manifest.', fragmentError);
          this.init(manifest);
          resolve(this._config);
          return;
        }

        if (!entries.length) {
          console.log(`[PlayableConfigManager] Successfully loaded config from resources/${path}`);
          this.init(manifest);
          resolve(this._config);
          return;
        }

        const merged = cloneConfigValue(manifest) as Record<string, any>;
        Promise.all(entries.map(entry => this.loadFragment(entry.resourcePath))).then(fragmentValues => {
          for (let i = 0; i < entries.length; i++) {
            const fragmentValue = fragmentValues[i];
            if (fragmentValue !== null) {
              mergeConfigAtPath(merged, entries[i].targetParts, fragmentValue);
            }
          }
          console.log(`[PlayableConfigManager] Successfully loaded config from resources/${path} with ${entries.length} fragment(s)`);
          this.init(merged as Partial<IPlayableConfig>);
          resolve(this._config);
        });
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

  private loadFragment(path: string): Promise<any | null> {
    return new Promise(resolve => {
      resources.load(path, JsonAsset, (err, asset) => {
        if (err || !asset || asset.json === undefined || asset.json === null) {
          console.warn(`[PlayableConfigManager] Could not load config fragment "resources/${path}.json".`, err);
          resolve(null);
          return;
        }
        resolve(asset.json);
      });
    });
  }

  private mergeConfig(source: any): void {
    if (!isConfigRecord(source)) return;
    mergeConfigRecord(this._config as any, source);
  }
}
