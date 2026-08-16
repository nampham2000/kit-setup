import { _decorator, Component, Node, Label, Button, Vec3, tween, UIOpacity } from 'cc';

const { ccclass, property } = _decorator;

/**
 * Controller managing 2D Canvas UI elements (HUD, Counter, Tutorial, Buttons, Result Screen).
 */
@ccclass('PlayableUIHUD')
export class PlayableUIHUD extends Component {
  private static _instance: PlayableUIHUD | null = null;

  @property({ type: Label, tooltip: 'Main Header Title Label' })
  public titleLabel: Label | null = null;

  @property({ type: Label, tooltip: 'Instruction / Subtitle Label' })
  public subtitleLabel: Label | null = null;

  @property({ type: Label, tooltip: 'Tap / Score Counter Label' })
  public tapCounterLabel: Label | null = null;

  @property({ type: Node, tooltip: 'Button node to switch camera view' })
  public cameraSwitchBtn: Node | null = null;

  @property({ type: Label, tooltip: 'Label on camera switch button' })
  public cameraSwitchLabel: Label | null = null;

  @property({ type: Node, tooltip: 'Button node to toggle audio mute' })
  public audioToggleBtn: Node | null = null;

  @property({ type: Label, tooltip: 'Label on audio toggle button' })
  public audioToggleLabel: Label | null = null;

  @property({ type: Node, tooltip: 'Tutorial hand pointer node' })
  public tutorialHandNode: Node | null = null;

  @property({ type: Node, tooltip: 'Result / End Card Popup Screen' })
  public resultScreenNode: Node | null = null;

  @property({ type: Label, tooltip: 'Result Screen Title Label' })
  public resultTitleLabel: Label | null = null;

  @property({ type: Node, tooltip: 'Result Screen Install / CTA Button' })
  public resultInstallBtn: Node | null = null;

  @property({ type: Node, tooltip: 'Result Screen Replay Button' })
  public resultReplayBtn: Node | null = null;

  private _isTutorialActive: boolean = true;

  public static get instance(): PlayableUIHUD | null {
    return this._instance;
  }

  onLoad(): void {
    if (PlayableUIHUD._instance && PlayableUIHUD._instance !== this) {
      this.node.destroy();
      return;
    }
    PlayableUIHUD._instance = this;
  }

  start(): void {
    if (this.tutorialHandNode) {
      this.startTutorialHandAnimation();
    }

    if (this.resultScreenNode) {
      this.resultScreenNode.active = false;
    }
  }

  public updateTapCount(current: number, target: number): void {
    if (this.tapCounterLabel) {
      this.tapCounterLabel.string = `Taps: ${current} / ${target}`;

      // Punch animation on counter update
      const baseScale = new Vec3(1, 1, 1);
      const punchScale = new Vec3(1.25, 1.25, 1.25);
      tween(this.tapCounterLabel.node)
        .to(0.08, { scale: punchScale }, { easing: 'quadOut' })
        .to(0.12, { scale: baseScale }, { easing: 'quadIn' })
        .start();
    }
  }

  public updateCameraLabel(name: string): void {
    if (this.cameraSwitchLabel) {
      this.cameraSwitchLabel.string = `Cam: ${name}`;
    }
  }

  public updateAudioLabel(isMuted: boolean): void {
    if (this.audioToggleLabel) {
      this.audioToggleLabel.string = isMuted ? 'Sound: OFF 🔇' : 'Sound: ON 🔊';
    }
  }

  public hideTutorialHand(): void {
    if (!this._isTutorialActive || !this.tutorialHandNode) return;
    this._isTutorialActive = false;

    let uiOp = this.tutorialHandNode.getComponent(UIOpacity);
    if (!uiOp) {
      uiOp = this.tutorialHandNode.addComponent(UIOpacity);
    }

    tween(uiOp)
      .to(0.3, { opacity: 0 }, { easing: 'fade' })
      .call(() => {
        if (this.tutorialHandNode) {
          this.tutorialHandNode.active = false;
        }
      })
      .start();
  }

  public showResultScreen(win: boolean = true): void {
    if (!this.resultScreenNode) return;

    this.resultScreenNode.active = true;
    this.resultScreenNode.setScale(new Vec3(0.5, 0.5, 0.5));

    let uiOp = this.resultScreenNode.getComponent(UIOpacity);
    if (!uiOp) {
      uiOp = this.resultScreenNode.addComponent(UIOpacity);
    }
    uiOp.opacity = 0;

    if (this.resultTitleLabel) {
      this.resultTitleLabel.string = win ? '🎉 VICTORY! 🎉' : 'TRY AGAIN!';
    }

    // Fade and scale pop-in animation
    tween(uiOp)
      .to(0.35, { opacity: 255 }, { easing: 'quadOut' })
      .start();

    tween(this.resultScreenNode)
      .to(0.4, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start();
  }

  public hideResultScreen(): void {
    if (!this.resultScreenNode) return;
    this.resultScreenNode.active = false;
  }

  private startTutorialHandAnimation(): void {
    if (!this.tutorialHandNode) return;

    const startPos = this.tutorialHandNode.position.clone();
    const targetPos = new Vec3(startPos.x + 30, startPos.y - 30, startPos.z);

    tween(this.tutorialHandNode)
      .repeatForever(
        tween()
          .to(0.55, { position: targetPos }, { easing: 'quadOut' })
          .to(0.45, { position: startPos }, { easing: 'quadIn' })
      )
      .start();
  }
}
