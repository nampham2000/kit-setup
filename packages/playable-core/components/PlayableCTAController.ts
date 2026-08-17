import { _decorator, Component, Node, Button, tween, Vec3, sys } from 'cc';
import { PlayableConfigManager } from '../config/index.ts';
import { superHtmlPlayable } from 'playable-sdk/platform/SuperHtmlPlayable';

const { ccclass, property } = _decorator;

/**
 * Controller managing Call-To-Action (CTA) flow and app store redirections.
 * All primitive properties (URLs, pulse, delays) are automatically loaded from `playable-config.json`.
 */
@ccclass('PlayableCTAController')
export class PlayableCTAController extends Component {
  private static _instance: PlayableCTAController | null = null;

  @property({ type: Node, tooltip: 'Primary CTA Button Node (optional, auto-finds if null)' })
  public ctaButtonNode: Node | null = null;

  // Runtime properties loaded from PlayableConfigManager
  public googlePlayUrl: string = '';
  public appStoreUrl: string = '';
  public enableButtonPulse: boolean = true;
  public autoRedirectDelay: number = 0;

  private _hasRedirected: boolean = false;
  private _onCtaCallback: (() => void) | null = null;

  public static get instance(): PlayableCTAController | null {
    return this._instance;
  }

  onLoad(): void {
    if (PlayableCTAController._instance && PlayableCTAController._instance !== this) {
      this.node.destroy();
      return;
    }
    PlayableCTAController._instance = this;

    this.applyConfig();

    PlayableConfigManager.instance.onConfigChanged(() => {
      this.applyConfig();
    });
  }

  private applyConfig(): void {
    const ctaConfig = PlayableConfigManager.instance.cta;
    this.googlePlayUrl = ctaConfig.googlePlayUrl || 'https://play.google.com/store/apps/details?id=com.playable.ad';
    this.appStoreUrl = ctaConfig.appStoreUrl || 'https://apps.apple.com/app/id123456789';
    this.enableButtonPulse = ctaConfig.enableButtonPulse ?? true;
    this.autoRedirectDelay = ctaConfig.autoRedirectDelay ?? 0;

    // Apply store URLs to super_html adapter
    if (this.googlePlayUrl) {
      superHtmlPlayable.set_google_play_url(this.googlePlayUrl);
    }
    if (this.appStoreUrl) {
      superHtmlPlayable.set_app_store_url(this.appStoreUrl);
    }
  }

  start(): void {
    // Auto resolve CTA Button node if not wired in scene inspector
    if (!this.ctaButtonNode) {
      this.ctaButtonNode = this.node.getChildByName('CTAButton')
        || this.node.scene.getChildByPath('Canvas/HUD/CTAButton')
        || this.node.scene.getChildByPath('Canvas/CTAButton');
    }

    if (this.ctaButtonNode) {
      const btn = this.ctaButtonNode.getComponent(Button);
      if (btn) {
        this.ctaButtonNode.on(Button.EventType.CLICK, this.onCtaClicked, this);
      } else {
        this.ctaButtonNode.on(Node.EventType.TOUCH_END, this.onCtaClicked, this);
      }

      if (this.enableButtonPulse) {
        this.startPulseAnimation(this.ctaButtonNode);
      }

      // Check if ad network requires hiding custom download button (e.g. Google channel)
      if (superHtmlPlayable.is_hide_download()) {
        this.ctaButtonNode.active = false;
      }
    }

    if (this.autoRedirectDelay > 0) {
      this.scheduleOnce(() => {
        if (!this._hasRedirected) {
          this.triggerDownload('auto_timeout');
        }
      }, this.autoRedirectDelay);
    }
  }

  public setCtaCallback(cb: () => void): void {
    this._onCtaCallback = cb;
  }

  public onCtaClicked(): void {
    this.triggerDownload('button_click');
  }

  /**
   * Main download / CTA redirection logic.
   * Dispatches to SuperHtmlPlayable, MRAID, or fallback URL open.
   */
  public triggerDownload(source: string = 'direct'): void {
    console.log(`[PlayableCTAController] Triggering store download (source: ${source})`);
    this._hasRedirected = true;

    if (this._onCtaCallback) {
      try {
        this._onCtaCallback();
      } catch (e) {
        console.error('[PlayableCTAController] Error in CTA callback:', e);
      }
    }

    // 1. SuperHtml standard playable hook
    try {
      superHtmlPlayable.download();
    } catch (e) {
      console.warn('[PlayableCTAController] SuperHtml download error:', e);
    }

    // 2. MRAID standard (AppLovin, IronSource, etc.)
    const win = globalThis as any;
    if (typeof win.mraid !== 'undefined' && win.mraid && typeof win.mraid.open === 'function') {
      try {
        const targetUrl = this.getTargetStoreUrl();
        win.mraid.open(targetUrl);
        return;
      } catch (e) {
        console.warn('[PlayableCTAController] MRAID open failed:', e);
      }
    }

    // 3. Fallback direct open for testing in browser
    if (sys.isBrowser) {
      const url = this.getTargetStoreUrl();
      if (url && !url.includes('com.playable.ad')) {
        try {
          window.open(url, '_blank');
        } catch (e) {
          console.warn('[PlayableCTAController] Window open fallback failed:', e);
        }
      }
    }
  }

  public getTargetStoreUrl(): string {
    const isIOS = sys.os === sys.OS.IOS || (typeof navigator !== 'undefined' && /iPad|iPhone|iPod/i.test(navigator.userAgent));
    return isIOS ? (this.appStoreUrl || this.googlePlayUrl) : (this.googlePlayUrl || this.appStoreUrl);
  }

  public startPulseAnimation(targetNode: Node): void {
    if (!targetNode || !targetNode.isValid) return;
    const ctaConfig = PlayableConfigManager.instance.cta;
    const multiplier = ctaConfig.pulseScaleMultiplier || 1.08;
    const duration = ctaConfig.pulseDuration || 0.6;

    const baseScale = targetNode.scale.clone();
    const pulseScale = new Vec3(baseScale.x * multiplier, baseScale.y * multiplier, baseScale.z * multiplier);

    tween(targetNode)
      .repeatForever(
        tween()
          .to(duration, { scale: pulseScale }, { easing: 'sineInOut' })
          .to(duration, { scale: baseScale }, { easing: 'sineInOut' })
          .delay(0.1)
      )
      .start();
  }
}
