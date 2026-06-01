import { _decorator, Component, director, error, EventTarget, Node, warn } from 'cc';
import { SoundManager } from './SoundManager.ts';
import { GameTrackingService } from 'playable-sdk/analytics/GameTrackingService';
import { GameUtils } from './utils/GameUtils.ts';

const { ccclass, property } = _decorator;

/**
 * Super-light gameplay lifecycle state machine.
 * Designed for Playable Ads: clear gates for init/load/play/pause/end/unload.
 */
export enum GameState {
  Idle = 0,
  Booting,
  Ready,      // boot done (settings/resources ok), level may not be loaded
  Loading,    // loading gameplay/level content
  Loaded,     // level content ready, but not yet accepting interaction
  Playing,    // user can interact
  Paused,
  Win,
  Lose,
  Unloading,
  Failed,
}

/** Hooks let each playable project inject its own game-specific logic without forking the framework. */
export type GameHooks = {
  /** Called during init() after preloadResources(). Use for settings, analytics init, etc. */
  boot?: () => void | Promise<void>;
  /** Called when loadLevel() runs. Instantiate gameplay root, load JSON, etc. */
  load?: (levelId?: string) => void | Promise<void>;
  /** Called when unloadLevel() runs. Destroy gameplay root, clear pools, etc. */
  unload?: (levelId?: string) => void | Promise<void>;
  /** Called right before entering Playing. */
  start?: () => void | Promise<void>;
  /** Called when pausing. */
  pause?: (reason?: string) => void;
  /** Called when resuming. */
  resume?: () => void;
  /** Called when ending (win/lose). */
  end?: (win: boolean, reason?: string) => void;
};

@ccclass('PlayableCoreGameManager')
export class GameManager extends Component {
  private static _instance: GameManager | null = null;

  private static readonly PRELOAD_SFX = ['sound/jump_sfx', 'sound/fall_sfx', 'sound/order_complete_sfx'];

  @property public autoInitOnLoad = true;
  /** If true: after loadLevel() completes, automatically call startGame(). */
  @property public autoStartOnReady = true;

  @property public playBgmOnStart = true;
  @property public bgmPath = 'sound/bg_music';

  private _state: GameState = GameState.Idle;
  private _initPromise: Promise<void> | null = null;
  private _loadPromise: Promise<void> | null = null;
  private _unloadPromise: Promise<void> | null = null;

  private _bootCompleted = false;
  private _levelLoaded = false;
  private _currentLevelId: string | null = null;

  private _interactionEnabled = false;
  private _trackingStep = 0;
  private _trackingScore = 0;

  private _hooks: GameHooks = {};

  /** Internal lightweight event hub. */
  private _events = new EventTarget();

  /** Framework events you can subscribe to (string-based for portability). */
  public static readonly EVT_STATE_CHANGED = 'gm.state_changed';
  public static readonly EVT_READY = 'gm.ready';
  public static readonly EVT_LEVEL_LOADED = 'gm.level_loaded';
  public static readonly EVT_PLAYING = 'gm.playing';
  public static readonly EVT_GAME_OVER = 'gm.game_over';

  public static get instance(): GameManager | null {
    return this._instance;
  }

  public static getOrCreate(): GameManager {
    if (this._instance && this._instance.node?.isValid) {
      return this._instance;
    }

    const scene = director.getScene();
    const node = new Node('GameManager');
    if (scene) node.parent = scene;
    const manager = node.addComponent(GameManager);
    this._instance = manager;
    return manager;
  }

  public get state(): GameState { return this._state; }
  public get currentLevelId(): string | null { return this._currentLevelId; }
  public get isBootCompleted(): boolean { return this._bootCompleted; }
  public get isLevelLoaded(): boolean { return this._levelLoaded; }

  onLoad(): void {
    if (GameManager._instance && GameManager._instance !== this) {
      this.node.destroy();
      return;
    }

    GameManager._instance = this;
    const scene = director.getScene();
    if (scene) this.node.parent = scene;
    director.addPersistRootNode(this.node);

    // Default: block interaction until state enters Playing.
    this.setInteractionEnabled(false);

    if (this.autoInitOnLoad) {
      this.init().catch(() => undefined);
    }
  }

  onDestroy(): void {
    if (GameManager._instance === this) {
      GameTrackingService.stopSession();
      GameManager._instance = null;
    }
  }

  /** Provide/override hooks per playable project (call once during bootstrap). */
  public setHooks(hooks: Partial<GameHooks>): void {
    this._hooks = { ...this._hooks, ...hooks };
  }

  /** Subscribe to internal framework events (state changes, ready, loaded, game over...). */
  public on(eventName: string, cb: (...args: any[]) => void, target?: any): void {
    this._events.on(eventName, cb, target);
  }
  public off(eventName: string, cb?: (...args: any[]) => void, target?: any): void {
    this._events.off(eventName, cb, target);
  }

  /** Bootstraps settings + resources. Safe to call multiple times. */
  public init(): Promise<void> {
    if (this._state === GameState.Ready || this._bootCompleted) return Promise.resolve();
    if (this._initPromise) return this._initPromise;

    this.transit(GameState.Booting);
    this.stopGameInteraction();
    this._trackingStep = 0;
    this._trackingScore = 0;

    const customBundles = GameUtils.listCustomBundles();
    GameTrackingService.init([...customBundles, 'resources']);

    this._initPromise = (async () => {
      try {
        if (this._hooks.boot) await this._hooks.boot();

        const sound = this.ensureSoundManager();
        await sound.preloadList(GameManager.PRELOAD_SFX).catch(() => undefined);

        this._bootCompleted = true;
        this.transit(GameState.Ready);
        this._events.emit(GameManager.EVT_READY);
      } catch (e) {
        this.transit(GameState.Failed);
        error('[GameManager] init failed', e);
        throw e;
      } finally {
        this._initPromise = null;
      }
    })();

    return this._initPromise;
  }

  /** Load gameplay/level content and enter Loaded (still non-interactive). */
  public loadLevel(levelId: string = 'default'): Promise<void> {
    if (this._loadPromise) return this._loadPromise;

    this._loadPromise = (async () => {
      await this.init();
      if (!this.canLoadLevel()) return;

      // If something is already loaded, unload first.
      if (this._levelLoaded) {
        await this.unloadLevel();
      }

      this._currentLevelId = levelId;
      this.transit(GameState.Loading);
      this.stopGameInteraction();

      try {
        if (this._hooks.load) await this._hooks.load(levelId);
        this._levelLoaded = true;
        this.transit(GameState.Loaded);
        this._events.emit(GameManager.EVT_LEVEL_LOADED, { levelId });

        if (this.autoStartOnReady) {
          await this.startGame();
        }
      } catch (e) {
        this.transit(GameState.Failed);
        error('[GameManager] loadLevel failed', e);
        throw e;
      } finally {
        this._loadPromise = null;
      }
    })();

    return this._loadPromise;
  }

  /** Unload gameplay content; returns to Ready (boot stays). */
  public unloadLevel(): Promise<void> {
    if (this._unloadPromise) return this._unloadPromise;

    this._unloadPromise = (async () => {
      if (!this._levelLoaded) return;
      if (!this.canUnloadLevel()) return;

      const levelId = this._currentLevelId ?? 'default';
      this.transit(GameState.Unloading);
      this.stopGameInteraction();

      try {
        if (this._hooks.unload) await this._hooks.unload(levelId);
      } catch (e) {
        // Unload failures should not brick the next playable run; log and continue.
        warn('[GameManager] unloadLevel error (ignored)', e);
      } finally {
        this._levelLoaded = false;
        this._currentLevelId = null;
        this.transit(GameState.Ready);
        this._unloadPromise = null;
      }
    })();

    return this._unloadPromise;
  }

  /** Start accepting user input (enters Playing) if all gates are satisfied. */
  public async startGame(): Promise<void> {
    await this.init();
    if (!this._levelLoaded) {
      warn('[GameManager] startGame() called but no level is loaded. Call loadLevel() first.');
      return;
    }
    if (!this.canEnterPlaying()) return;

    // Optional BGM
    if (this.playBgmOnStart && this.bgmPath) {
      const sound = this.ensureSoundManager();
      sound.preload(this.bgmPath)
        .then(() => sound.playBGM(this.bgmPath, true))
        .catch(() => undefined);
    }

    if (this._hooks.start) await this._hooks.start();

    this.transit(GameState.Playing);
    this.setInteractionEnabled(true);
    this._events.emit(GameManager.EVT_PLAYING, { levelId: this._currentLevelId });
  }

  /** Pause gameplay. Keeps level loaded. */
  public pause(reason?: string): void {
    if (this._state !== GameState.Playing) return;
    this.transit(GameState.Paused);
    this.stopGameInteraction();
    try { this._hooks.pause?.(reason); } catch (_) {}
  }

  /** Resume from pause. */
  public resume(): void {
    if (this._state !== GameState.Paused) return;
    this.transit(GameState.Playing);
    this.setInteractionEnabled(true);
    try { this._hooks.resume?.(); } catch (_) {}
  }

  /** End the game (Win/Lose). Still keeps level loaded, so you can show end UI. */
  public endGame(win: boolean, reason?: string): void {
    if (this._state !== GameState.Playing && this._state !== GameState.Paused) return;
    this.transit(win ? GameState.Win : GameState.Lose);
    this.stopGameInteraction();
    const resultParams = { reason: reason || (win ? 'win' : 'lose'), score: this._trackingScore };
    if (win) GameTrackingService.logGameWin(resultParams);
    else GameTrackingService.logGameLose(resultParams);
    try { this._hooks.end?.(win, reason); } catch (_) {}
    this._events.emit(GameManager.EVT_GAME_OVER, { win, reason, levelId: this._currentLevelId });
  }

  public setTrackingScore(score: number): void {
    this._trackingScore = Math.max(this._trackingScore, score | 0);
  }

  public trackGameplayInteraction(name: string, params: Record<string, any> = {}): void {
    this._trackingStep++;
    if (typeof params.score === 'number') this.setTrackingScore(params.score);
    GameTrackingService.logInteraction({ step: this._trackingStep, name, ...params });
  }

  /** Call when you want to block user input (loading/transition). */
  public stopGameInteraction(): void {
    this.setInteractionEnabled(false);
  }

  /** True only when state is Playing AND user interaction is enabled. */
  public canInteract(): boolean {
    return this._state === GameState.Playing && this._interactionEnabled;
  }

  /** Gate used by UI/input systems. Prefer canInteract() when possible. */
  public setInteractionEnabled(enabled: boolean): void {
    this._interactionEnabled = !!enabled;
  }

  /** Basic gate: can we safely create gameplay objects now? */
  public canCreateGameplayObjects(): boolean {
    return this._bootCompleted && this._levelLoaded && (this._state === GameState.Loaded || this._state === GameState.Playing || this._state === GameState.Paused);
  }

  /** Basic gate: can we start loading a level now? */
  public canLoadLevel(): boolean {
    return this._bootCompleted && (this._state === GameState.Ready || this._state === GameState.Win || this._state === GameState.Lose);
  }

  /** Basic gate: can we unload the current level now? */
  public canUnloadLevel(): boolean {
    return this._levelLoaded && (this._state === GameState.Loaded || this._state === GameState.Playing || this._state === GameState.Paused || this._state === GameState.Win || this._state === GameState.Lose);
  }

  /** Basic gate: can we enter Playing now? */
  public canEnterPlaying(): boolean {
    return this._bootCompleted && this._levelLoaded && (this._state === GameState.Loaded || this._state === GameState.Paused);
  }

  /** Convenience: logs a warning if you call gameplay code too early. */
  public requireGameplayReady(context: string = 'unknown'): boolean {
    const ok = this.canCreateGameplayObjects();
    if (!ok) {
      warn(`[GameManager] Gameplay not ready (${context}). state=${GameState[this._state]} boot=${this._bootCompleted} levelLoaded=${this._levelLoaded}`);
    }
    return ok;
  }

  /** Convenience: logs a warning if input is used while not interactable. */
  public requireInteractable(context: string = 'unknown'): boolean {
    const ok = this.canInteract();
    if (!ok) {
      warn(`[GameManager] Interaction blocked (${context}). state=${GameState[this._state]} interactionEnabled=${this._interactionEnabled}`);
    }
    return ok;
  }

  private transit(next: GameState): void {
    if (this._state === next) return;

    const from = this._state;
    const ok = this.isTransitionAllowed(from, next);
    if (!ok) {
      warn(`[GameManager] state transition blocked: ${GameState[from]} -> ${GameState[next]}`);
      return;
    }

    this._state = next;
    this._events.emit(GameManager.EVT_STATE_CHANGED, { from, to: next });
  }

  private isTransitionAllowed(from: GameState, to: GameState): boolean {
    switch (from) {
      case GameState.Idle: return to === GameState.Booting || to === GameState.Failed;
      case GameState.Booting: return to === GameState.Ready || to === GameState.Failed;
      case GameState.Ready: return to === GameState.Loading || to === GameState.Failed;
      case GameState.Loading: return to === GameState.Loaded || to === GameState.Failed;
      case GameState.Loaded: return to === GameState.Playing || to === GameState.Unloading || to === GameState.Failed;
      case GameState.Playing: return to === GameState.Paused || to === GameState.Win || to === GameState.Lose || to === GameState.Unloading || to === GameState.Failed;
      case GameState.Paused: return to === GameState.Playing || to === GameState.Win || to === GameState.Lose || to === GameState.Unloading || to === GameState.Failed;
      case GameState.Win:
      case GameState.Lose: return to === GameState.Unloading || to === GameState.Loading || to === GameState.Ready || to === GameState.Failed;
      case GameState.Unloading: return to === GameState.Ready || to === GameState.Failed;
      case GameState.Failed: return to === GameState.Booting || to === GameState.Ready;
      default: return true;
    }
  }

  private ensureSoundManager(): SoundManager {
    if (SoundManager.instance && SoundManager.instance.node && SoundManager.instance.node.isValid) {
      return SoundManager.instance;
    }

    // Create one if not present.
    const scene = director.getScene();
    const node = new Node('SoundManager');
    if (scene) node.parent = scene;
    const sm = node.addComponent(SoundManager);
    director.addPersistRootNode(node);
    return sm;
  }

}
