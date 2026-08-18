import { _decorator, Component, Node, Vec3, tween, input, Input, EventTouch, Camera, geometry, PhysicsSystem } from 'cc';
import { PlayableConfigManager } from '../config/index';
const { ccclass, property } = _decorator;

/**
 * Interactive 3D Hero object component.
 * Handles 3D idle floating/rotation animations via tween and touch interaction.
 * Animation timings and offsets are configured in `playable-config.json`.
 */
@ccclass('Interactive3DHero')
export class Interactive3DHero extends Component {
  @property({ type: Camera, tooltip: '3D Camera for raycasting (auto-finds main camera if null)' })
  public raycastCamera: Camera | null = null;

  // Runtime properties loaded from PlayableConfigManager
  public enableIdleAnimation: boolean = true;
  public floatHeight: number = 0.35;
  public floatDuration: number = 1.4;

  private _initialPos: Vec3 = new Vec3();
  private _initialScale: Vec3 = new Vec3();
  private _isBouncing: boolean = false;
  private _tapCount: number = 0;
  private _onTapCallback: ((count: number) => void) | null = null;

  onLoad(): void {
    this._initialPos = this.node.position.clone();
    this._initialScale = this.node.scale.clone();

    // Auto resolve camera if not assigned
    if (!this.raycastCamera) {
      this.raycastCamera = this.node.scene.getComponentInChildren(Camera);
    }

    this.applyConfig();

    PlayableConfigManager.instance.onConfigChanged(() => {
      this.applyConfig();
    });
  }

  private applyConfig(): void {
    const heroConfig = PlayableConfigManager.instance.hero;
    if (heroConfig) {
      this.floatHeight = heroConfig.floatHeight ?? 0.35;
      this.floatDuration = heroConfig.floatDuration ?? 1.4;
      this.enableIdleAnimation = heroConfig.enableIdleAnimation ?? true;
    }
  }

  start(): void {
    if (this.enableIdleAnimation) {
      this.startIdleAnimation();
    }

    // Register global input events for screen tapping and raycast
    input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
  }

  onDestroy(): void {
    input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
  }

  public setOnTapCallback(cb: (count: number) => void): void {
    this._onTapCallback = cb;
  }

  private startIdleAnimation(): void {
    const height = this.floatHeight > 0 ? this.floatHeight : 0.35;
    const duration = this.floatDuration > 0 ? this.floatDuration : 1.4;
    const heroConfig = PlayableConfigManager.instance.hero;
    const rotDuration = heroConfig.rotationDuration || 4.0;

    const topPos = new Vec3(this._initialPos.x, this._initialPos.y + height, this._initialPos.z);
    const botPos = new Vec3(this._initialPos.x, this._initialPos.y - 0.1, this._initialPos.z);

    // Floating up and down
    tween(this.node)
      .repeatForever(
        tween()
          .to(duration * 0.5, { position: topPos }, { easing: 'sineInOut' })
          .to(duration * 0.5, { position: botPos }, { easing: 'sineInOut' })
      )
      .start();

    // Subtle continuous rotation
    const rotObj = { angle: 0 };
    tween(rotObj)
      .repeatForever(
        tween()
          .to(rotDuration, { angle: 360 }, {
            onUpdate: () => {
              if (this.node && this.node.isValid) {
                this.node.setRotationFromEuler(15, rotObj.angle, 0);
              }
            }
          })
          .call(() => { rotObj.angle = 0; })
      )
      .start();
  }

  private onTouchStart(event: EventTouch): void {
    // If no direct node hit, check raycast from raycastCamera or general tap
    const touchLoc = event.getLocation();

    if (this.raycastCamera) {
      const ray = new geometry.Ray();
      this.raycastCamera.screenPointToRay(touchLoc.x, touchLoc.y, ray);

      if (PhysicsSystem.instance) {
        if (PhysicsSystem.instance.raycastClosest(ray)) {
          const hit = PhysicsSystem.instance.raycastClosestResult;
          if (hit.collider && (hit.collider.node === this.node || hit.collider.node.isChildOf(this.node))) {
            this.handleTap();
            return;
          }
        }
      }
    }

    // Default: Screen tap counts as game interaction
    this.handleTap();
  }

  public handleTap(): void {
    this._tapCount++;
    this.playBounceEffect();

    if (this._onTapCallback) {
      this._onTapCallback(this._tapCount);
    }
  }

  public playBounceEffect(): void {
    if (this._isBouncing) return;
    this._isBouncing = true;

    const punchFactor = PlayableConfigManager.instance.hero.punchScaleFactor || 1.3;

    const punchScale = new Vec3(this._initialScale.x * punchFactor, this._initialScale.y * (1 / punchFactor), this._initialScale.z * punchFactor);
    const reboundScale = new Vec3(this._initialScale.x * 0.85, this._initialScale.y * 1.2, this._initialScale.z * 0.85);

    tween(this.node)
      .to(0.08, { scale: punchScale }, { easing: 'quadOut' })
      .to(0.12, { scale: reboundScale }, { easing: 'sineOut' })
      .to(0.15, { scale: this._initialScale }, { easing: 'elasticOut' })
      .call(() => {
        this._isBouncing = false;
      })
      .start();
  }

  public playWinSpin(): void {
    tween(this.node)
      .to(0.6, { scale: new Vec3(this._initialScale.x * 1.4, this._initialScale.y * 1.4, this._initialScale.z * 1.4) }, { easing: 'backOut' })
      .start();
  }
}
