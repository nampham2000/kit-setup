import { _decorator, Component, Button } from 'cc';
import { PlayableCTAController } from './PlayableCTAController.ts';
import { PlayableAudioController } from './PlayableAudioController.ts';
import { PlayableTrackingController } from './PlayableTrackingController.ts';
import { CameraController } from './CameraController.ts';
import { PlayableUIHUD } from './PlayableUIHUD.ts';
import { Interactive3DHero } from './Interactive3DHero.ts';
import { PlayableConfigManager } from '../config/index.ts';
import { superHtmlPlayable } from 'playable-sdk/platform/SuperHtmlPlayable';

const { ccclass } = _decorator;

/**
 * Master Game Entry & Lifecycle Controller for Playable Ad.
 * Coordinates CTA, Audio, Tracking, Multi-Camera, and UI HUD systems.
 * Dynamically loads `resources/playable-config.json` before initializing gameplay.
 * Zero Inspector wiring required.
 */
@ccclass('PlayableEntry')
export class PlayableEntry extends Component {
  private static _instance: PlayableEntry | null = null;

  // Runtime controllers (auto-resolved from node or scene)
  public ctaController: PlayableCTAController | null = null;
  public audioController: PlayableAudioController | null = null;
  public trackingController: PlayableTrackingController | null = null;
  public cameraController: CameraController | null = null;
  public hud: PlayableUIHUD | null = null;
  public hero: Interactive3DHero | null = null;

  public targetTaps: number = 3;

  private _currentTaps: number = 0;
  private _isGameFinished: boolean = false;
  private _isFirstTapDone: boolean = false;
  private _isGameInitialized: boolean = false;

  public static get instance(): PlayableEntry | null {
    return this._instance;
  }

  onLoad(): void {
    if (PlayableEntry._instance && PlayableEntry._instance !== this) {
      this.node.destroy();
      return;
    }
    PlayableEntry._instance = this;

    // 1. Auto-resolve controllers on this node or scene
    this.resolveControllers();

    // 2. Start preloading configuration dynamically from resources/playable-config.json
    PlayableConfigManager.instance.ensureLoaded('playable-config').then(() => {
      this.applyConfig();
      if (this.hud) {
        this.hud.updateTapCount(this._currentTaps, this.targetTaps);
      }
    });

    PlayableConfigManager.instance.onConfigChanged(() => {
      this.applyConfig();
      if (this.hud) {
        this.hud.updateTapCount(this._currentTaps, this.targetTaps);
      }
    });
  }

  private resolveControllers(): void {
    if (!this.ctaController) this.ctaController = this.getComponent(PlayableCTAController) || this.node.scene.getComponentInChildren(PlayableCTAController);
    if (!this.audioController) this.audioController = this.getComponent(PlayableAudioController) || this.node.scene.getComponentInChildren(PlayableAudioController);
    if (!this.trackingController) this.trackingController = this.getComponent(PlayableTrackingController) || this.node.scene.getComponentInChildren(PlayableTrackingController);
    if (!this.cameraController) this.cameraController = this.getComponent(CameraController) || this.node.scene.getComponentInChildren(CameraController);
    if (!this.hud) this.hud = this.getComponent(PlayableUIHUD) || this.node.scene.getComponentInChildren(PlayableUIHUD);
    if (!this.hero) this.hero = this.getComponent(Interactive3DHero) || this.node.scene.getComponentInChildren(Interactive3DHero);
  }

  private applyConfig(): void {
    const gameplayConfig = PlayableConfigManager.instance.gameplay;
    if (gameplayConfig) {
      this.targetTaps = gameplayConfig.targetTaps || 3;
    }
  }

  async start(): Promise<void> {
    // Ensure config is fully loaded before launching gameplay
    await PlayableConfigManager.instance.ensureLoaded('playable-config');
    this.applyConfig();

    if (this._isGameInitialized) return;
    this._isGameInitialized = true;

    console.log('[PlayableEntry] Config preloaded. Initializing game flow...');

    // 1. Setup Tracking
    if (this.trackingController) {
      this.trackingController.trackGameStart();
    }

    // 2. Setup CTA callback
    if (this.ctaController) {
      this.ctaController.setCtaCallback(() => {
        if (this.trackingController) {
          this.trackingController.trackCtaClicked();
        }
      });
    }

    // 3. Setup 3D Hero interaction callback
    if (this.hero) {
      this.hero.setOnTapCallback(this.onHeroTapped.bind(this));
    }

    // 4. Setup HUD UI buttons
    this.setupUIBindings();

    // 5. Initial HUD updates
    if (this.hud) {
      this.hud.updateTapCount(0, this.targetTaps);
      if (this.cameraController) {
        this.hud.updateCameraLabel(this.cameraController.getCameraModeName(this.cameraController.currentMode));
      }
      if (this.audioController) {
        this.hud.updateAudioLabel(this.audioController.isMuted);
      }
    }

    // 6. Check optional auto-win timer from config
    const autoWin = PlayableConfigManager.instance.gameplay.autoWinTimer;
    if (autoWin && autoWin > 0) {
      this.scheduleOnce(() => {
        if (!this._isGameFinished) {
          this.triggerWin();
        }
      }, autoWin);
    }
  }

  private setupUIBindings(): void {
    if (!this.hud) return;

    // Camera Switch Button
    if (this.hud.cameraSwitchBtn) {
      const btn = this.hud.cameraSwitchBtn.getComponent(Button);
      const handler = () => {
        if (this.cameraController) {
          const modeName = this.cameraController.nextCameraMode();
          if (this.hud) this.hud.updateCameraLabel(modeName);
        }
        if (this.audioController) this.audioController.playClickSfx();
      };
      if (btn) {
        this.hud.cameraSwitchBtn.on(Button.EventType.CLICK, handler, this);
      } else {
        this.hud.cameraSwitchBtn.on(Button.EventType.CLICK, handler, this);
      }
    }

    // Audio Toggle Button
    if (this.hud.audioToggleBtn) {
      const handler = () => {
        if (this.audioController) {
          const isMuted = this.audioController.toggleMute();
          if (this.hud) this.hud.updateAudioLabel(isMuted);
        }
      };
      this.hud.audioToggleBtn.on(Button.EventType.CLICK, handler, this);
    }

    // Result Replay Button
    if (this.hud.resultReplayBtn) {
      this.hud.resultReplayBtn.on(Button.EventType.CLICK, this.restartGame, this);
    }

    // Result Install Button
    if (this.hud.resultInstallBtn) {
      this.hud.resultInstallBtn.on(Button.EventType.CLICK, () => {
        if (this.ctaController) {
          this.ctaController.triggerDownload('result_screen_install');
        }
      }, this);
    }
  }

  public onHeroTapped(totalTaps: number): void {
    if (this._isGameFinished) return;

    // First interaction trigger
    if (!this._isFirstTapDone) {
      this._isFirstTapDone = true;
      if (this.audioController) this.audioController.unlockAudio();
      if (this.trackingController) this.trackingController.trackFirstInteraction();
      if (this.hud) this.hud.hideTutorialHand();
    }

    this._currentTaps++;

    if (this.audioController) {
      this.audioController.playClickSfx();
    }

    if (this.hud) {
      this.hud.updateTapCount(this._currentTaps, this.targetTaps);
    }

    // Check Win Condition
    if (this._currentTaps >= this.targetTaps) {
      this.triggerWin();
    }
  }

  private triggerWin(): void {
    this._isGameFinished = true;
    console.log('[PlayableEntry] Game Won! All targets reached.');

    if (this.trackingController) {
      this.trackingController.trackStageComplete(1);
      this.trackingController.trackGameWin();
    }

    try {
      superHtmlPlayable.game_end();
    } catch (e) {
      // Ignore
    }

    if (this.audioController) {
      this.audioController.playSuccessSfx();
      this.scheduleOnce(() => {
        if (this.audioController) this.audioController.playWinSfx();
      }, 0.3);
    }

    if (this.hero) {
      this.hero.playWinSpin();
    }

    // Show End Card / Result Screen after brief delay
    this.scheduleOnce(() => {
      if (this.hud) {
        this.hud.showResultScreen(true);
      }
    }, 0.6);
  }

  public restartGame(): void {
    console.log('[PlayableEntry] Restarting game session.');
    this._isGameFinished = false;
    this._currentTaps = 0;

    if (this.hud) {
      this.hud.hideResultScreen();
      this.hud.updateTapCount(0, this.targetTaps);
    }

    if (this.hero) {
      this.hero.handleTap();
    }

    if (this.audioController) {
      this.audioController.playClickSfx();
    }

    if (this.trackingController) {
      this.trackingController.trackGameStart();
    }
  }
}
