import { _decorator, Component, Label } from 'cc';
import { PlayableConfigManager } from '../config';
import { GameTrackingService } from 'playable-sdk/analytics/GameTrackingService';

const { ccclass, property } = _decorator;

export type PlayableEventType =
  | 'DISPLAYED'
  | 'FIRST_INTERACTION'
  | 'GAME_START'
  | 'STAGE_1_START'
  | 'STAGE_1_COMPLETE'
  | 'GAME_WIN'
  | 'GAME_LOSE'
  | 'CTA_CLICKED'
  | 'HEARTBEAT';

/**
 * Controller for tracking Playable ad milestones and user analytics.
 * Dispatches to GameAnalytics, AppLovin ALPlayableAnalytics, and on-screen debug HUD.
 * Tracking parameters are automatically synchronized with `playable-config.json`.
 */
@ccclass('PlayableTrackingController')
export class PlayableTrackingController extends Component {
  private static _instance: PlayableTrackingController | null = null;

  @property({ type: Label, tooltip: 'Optional Label to show debug event logs on screen (auto-finds if null)' })
  public debugEventLabel: Label | null = null;

  // Runtime properties loaded from PlayableConfigManager
  public enableHeartbeat: boolean = true;
  public heartbeatInterval: number = 5;

  private _firstInteractionTracked: boolean = false;
  private _elapsedSeconds: number = 0;
  private _heartbeatCount: number = 0;
  private _eventHistory: string[] = [];

  public static get instance(): PlayableTrackingController | null {
    return this._instance;
  }

  onLoad(): void {
    if (PlayableTrackingController._instance && PlayableTrackingController._instance !== this) {
      this.node.destroy();
      return;
    }
    PlayableTrackingController._instance = this;

    this.applyConfig();

    PlayableConfigManager.instance.onConfigChanged(() => {
      this.applyConfig();
    });
  }

  private applyConfig(): void {
    const trackConfig = PlayableConfigManager.instance.tracking;
    if (trackConfig) {
      this.enableHeartbeat = trackConfig.enableHeartbeat ?? true;
      this.heartbeatInterval = trackConfig.heartbeatInterval ?? 5;
    }
  }

  start(): void {
    // Auto-resolve debug label if null
    if (!this.debugEventLabel) {
      const debugNode = this.node.scene.getChildByPath('Canvas/DebugTrackingHUD') || this.node.getChildByName('DebugTrackingHUD');
      if (debugNode) {
        this.debugEventLabel = debugNode.getComponent(Label);
      }
    }

    this.trackEvent('DISPLAYED');

    const interval = this.heartbeatInterval > 0 ? this.heartbeatInterval : 5;
    if (this.enableHeartbeat) {
      this.schedule(this.onHeartbeatTick, interval);
    }
  }

  private onHeartbeatTick(): void {
    const interval = this.heartbeatInterval > 0 ? this.heartbeatInterval : 5;
    this._elapsedSeconds += interval;
    this._heartbeatCount++;
    this.trackEvent('HEARTBEAT', { seconds: this._elapsedSeconds, count: this._heartbeatCount });
  }

  public trackFirstInteraction(): void {
    if (this._firstInteractionTracked) return;
    this._firstInteractionTracked = true;
    this.trackEvent('FIRST_INTERACTION');
  }

  public trackGameStart(): void {
    this.trackEvent('GAME_START');
  }

  public trackStageComplete(stageId: number = 1): void {
    this.trackEvent(`STAGE_${stageId}_COMPLETE` as PlayableEventType, { stage: stageId });
  }

  public trackGameWin(): void {
    this.trackEvent('GAME_WIN');
  }

  public trackGameLose(): void {
    this.trackEvent('GAME_LOSE');
  }

  public trackCtaClicked(): void {
    this.trackEvent('CTA_CLICKED');
  }

  public trackEvent(eventName: string, params?: Record<string, any>): void {
    const timestamp = new Date().toISOString().substring(11, 19);
    const logStr = `[${timestamp}] [TRACK] ${eventName}${params ? ' ' + JSON.stringify(params) : ''}`;
    console.log(logStr);

    this._eventHistory.push(logStr);
    if (this._eventHistory.length > 5) {
      this._eventHistory.shift();
    }

    if (this.debugEventLabel && this.debugEventLabel.isValid) {
      this.debugEventLabel.string = this._eventHistory.join('\n');
    }

    // 1. AppLovin standard analytics
    try {
      const win = globalThis as any;
      if (win.ALPlayableAnalytics && typeof win.ALPlayableAnalytics.trackEvent === 'function') {
        win.ALPlayableAnalytics.trackEvent(eventName);
      }
    } catch (e) {
      // Ignore
    }

    // 2. Playable SDK Unified GameTrackingService
    try {
      GameTrackingService.logEvent(eventName, params);
    } catch (e) {
      // Ignore
    }
  }
}
