import { _decorator, Component, Camera, Vec3, Quat, tween, view, screen } from 'cc';
import { PlayableConfigManager } from '../config';

const { ccclass, property } = _decorator;

export enum CameraAngleMode {
  Perspective3D = 0,
  TopDown3D = 1,
  CloseUp3D = 2,
}

/**
 * Controller managing multiple scene cameras (Main 3D, Top-Down/Action 3D, and UI 2D Camera).
 * Provides smooth transitions, camera angle switching, and screen resize adaptations.
 * Presets, transition durations, and FOV thresholds are dynamically loaded from `playable-config.json`.
 */
@ccclass('CameraController')
export class CameraController extends Component {
  private static _instance: CameraController | null = null;

  @property({ type: Camera, tooltip: 'Primary 3D Perspective Camera (auto-finds if null)' })
  public mainCamera: Camera | null = null;

  @property({ type: Camera, tooltip: 'Secondary 3D / Top-Down Camera (optional)' })
  public subCamera: Camera | null = null;

  @property({ type: Camera, tooltip: '2D UI Canvas Camera (optional)' })
  public uiCamera: Camera | null = null;

  // Runtime properties loaded from PlayableConfigManager
  public transitionDuration: number = 0.5;

  private _currentMode: CameraAngleMode = CameraAngleMode.Perspective3D;

  // Default camera presets
  private _presetPositions: Vec3[] = [
    new Vec3(0, 5.5, 7.5),   // Mode 0: Perspective 3D
    new Vec3(0, 9.5, 1.2),   // Mode 1: Top-Down 3D
    new Vec3(0, 3.2, 4.2),   // Mode 2: Close-Up 3D
  ];

  private _presetEulerRotations: Vec3[] = [
    new Vec3(-32, 0, 0),    // Mode 0
    new Vec3(-80, 0, 0),    // Mode 1
    new Vec3(-18, 0, 0),    // Mode 2
  ];

  public static get instance(): CameraController | null {
    return this._instance;
  }

  public get currentMode(): CameraAngleMode {
    return this._currentMode;
  }

  onLoad(): void {
    if (CameraController._instance && CameraController._instance !== this) {
      this.node.destroy();
      return;
    }
    CameraController._instance = this;

    // Auto-resolve main camera if not wired
    if (!this.mainCamera) {
      this.mainCamera = this.getComponent(Camera) || this.node.scene.getComponentInChildren(Camera);
    }

    this.applyConfig();

    PlayableConfigManager.instance.onConfigChanged(() => {
      this.applyConfig();
      this.applyCurrentModeImmediate();
      this.onScreenResize();
    });

    // Listen to screen resize for responsive FOV adjustment
    view.on('canvas-resize', this.onScreenResize, this);
  }

  private applyConfig(): void {
    const camConfig = PlayableConfigManager.instance.camera;
    if (camConfig) {
      this.transitionDuration = camConfig.transitionDuration ?? 0.5;
      if (camConfig.presets && camConfig.presets.length >= 3) {
        for (let i = 0; i < 3; i++) {
          const p = camConfig.presets[i];
          if (p && p.position) {
            this._presetPositions[i] = new Vec3(p.position.x, p.position.y, p.position.z);
          }
          if (p && p.eulerRotation) {
            this._presetEulerRotations[i] = new Vec3(p.eulerRotation.x, p.eulerRotation.y, p.eulerRotation.z);
          }
        }
      }
      if (camConfig.defaultMode !== undefined) {
        this._currentMode = camConfig.defaultMode as CameraAngleMode;
      }
    }
  }

  start(): void {
    this.applyCurrentModeImmediate();
    this.onScreenResize();
  }

  onDestroy(): void {
    view.off('canvas-resize', this.onScreenResize, this);
  }

  /**
   * Cycle to the next camera mode (Perspective -> Top-Down -> Close-Up -> Perspective).
   */
  public nextCameraMode(): string {
    const next = (this._currentMode + 1) % 3;
    this.setCameraMode(next);
    return this.getCameraModeName(next);
  }

  public getCameraModeName(mode: CameraAngleMode): string {
    switch (mode) {
      case CameraAngleMode.Perspective3D: return 'Perspective 3D';
      case CameraAngleMode.TopDown3D: return 'Top-Down 3D';
      case CameraAngleMode.CloseUp3D: return 'Close-Up 3D';
      default: return 'Camera';
    }
  }

  public setCameraMode(mode: CameraAngleMode, animate: boolean = true): void {
    this._currentMode = mode;
    console.log(`[CameraController] Switching camera mode to: ${this.getCameraModeName(mode)}`);

    if (!this.mainCamera) return;

    const targetPos = this._presetPositions[mode] || this._presetPositions[0];
    const targetEuler = this._presetEulerRotations[mode] || this._presetEulerRotations[0];

    const duration = this.transitionDuration > 0 ? this.transitionDuration : 0.5;

    if (!animate || duration <= 0) {
      this.mainCamera.node.setPosition(targetPos);
      this.mainCamera.node.setRotationFromEuler(targetEuler.x, targetEuler.y, targetEuler.z);
      return;
    }

    // Smooth tween transition
    const node = this.mainCamera.node;
    tween(node)
      .to(duration, {
        position: targetPos,
      }, { easing: 'cubicOut' })
      .start();

    // Smooth rotation interpolation
    const startRot = node.rotation.clone();
    const endRot = new Quat();
    Quat.fromEuler(endRot, targetEuler.x, targetEuler.y, targetEuler.z);

    let progress = { t: 0 };
    const tempQuat = new Quat();
    tween(progress)
      .to(duration, { t: 1 }, {
        easing: 'cubicOut',
        onUpdate: () => {
          Quat.slerp(tempQuat, startRot, endRot, progress.t);
          node.setRotation(tempQuat);
        }
      })
      .start();
  }

  private applyCurrentModeImmediate(): void {
    if (!this.mainCamera) return;
    const targetPos = this._presetPositions[this._currentMode] || this._presetPositions[0];
    const targetEuler = this._presetEulerRotations[this._currentMode] || this._presetEulerRotations[0];
    this.mainCamera.node.setPosition(targetPos);
    this.mainCamera.node.setRotationFromEuler(targetEuler.x, targetEuler.y, targetEuler.z);
  }

  public onScreenResize(): void {
    const size = screen.windowSize;
    const isPortrait = size.height > size.width;

    if (this.mainCamera) {
      const camConfig = PlayableConfigManager.instance.camera;
      const fovPort = camConfig.fovPortrait || 55;
      const fovLand = camConfig.fovLandscape || 45;
      this.mainCamera.fov = isPortrait ? fovPort : fovLand;
    }
  }
}
