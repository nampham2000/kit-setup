import { _decorator, Camera, CCString, Component, js, Layers, Material, rendering, Texture2D, Vec4, view } from 'cc';
import { PlayableConfigManager } from '../config/PlayableConfigManager';

const { ccclass, property, requireComponent } = _decorator;

/** Unity URP volume stack values (the effective profile of the source camera), as authored in Unity. */
export interface UnityUrpPostProcessConfig {
  /** URP Tonemapping.mode: 'None' | 'Neutral'. */
  tonemapping?: string;
  vignette?: {
    color?: number[];
    center?: number[];
    intensity?: number;
    smoothness?: number;
    rounded?: boolean;
  };
  /** MSAA sample count for the graded camera (0 disables; WebGL1 never multisamples). */
  msaa?: number;
}

interface BuiltinSettingsLike extends Component {
  getPipelineSettings(): {
    msaa: { enabled: boolean; sampleCount: number };
    colorGrading: { enabled: boolean; material: Material | null; contribute: number; colorGradingMap: Texture2D | null };
  };
}

interface ResizeCameraLike { visibility: number; window: { renderWindowId: number } }
interface PipelineBuilderLike {
  windowResize?: (ppl: unknown, window: { renderWindowId: number }, camera: ResizeCameraLike, width: number, height: number) => void;
  __unityFullPipelineResize?: boolean;
}

/**
 * Cocos 3.8.8's builtin pipeline allocates a render window's Radiance/MSAA targets in windowResize once per camera
 * drawing to that window, with that camera's HDR decision (rendering/custom/framework.ts warns about the collision).
 * With float output the full-pipeline 3D camera wants RGBA16F, then the UI camera re-adds the same targets as RGBA8,
 * so the RGBA16F MSAA resolve into the RGBA8 radiance fails (blitFramebuffer GL_INVALID_OPERATION) and the 3D frame
 * is black. Replay the full-pipeline camera's resize after any other camera resized the same window.
 */
function keepFullPipelineWindowTargets(): void {
  const registry = (rendering as unknown as { customPipelineBuilderMap?: Map<string, PipelineBuilderLike> }).customPipelineBuilderMap;
  const builder = registry?.get('Builtin');
  if (!builder?.windowResize || builder.__unityFullPipelineResize) return;
  const original = builder.windowResize.bind(builder);
  const fullCameraByWindow = new Map<number, ResizeCameraLike>();
  builder.windowResize = (ppl, window, camera, width, height) => {
    original(ppl, window, camera, width, height);
    if ((camera.visibility & Layers.Enum.DEFAULT) !== 0) {
      fullCameraByWindow.set(window.renderWindowId, camera);
      return;
    }
    const fullCamera = fullCameraByWindow.get(window.renderWindowId);
    if (fullCamera && fullCamera.window === window) original(ppl, window, fullCamera, width, height);
  };
  builder.__unityFullPipelineResize = true;
}

/**
 * Replays Unity URP LDR post-processing (UberPost vignette + Neutral tonemapping) on a Cocos camera through
 * the builtin pipeline's colour-grading pass. The material must use the shared-kit URP LDR grading effect
 * (tools/unity-cocos-port/urp-ldr-grading.effect installed under assets/effects). Values come from the
 * playable config at `configPath` so a port binds the source profile instead of tuning numbers here.
 */
@ccclass('UnityUrpPostProcess')
@requireComponent(Camera)
export class UnityUrpPostProcess extends Component {
  @property(Material)
  public gradingMaterial: Material | null = null;

  @property(CCString)
  public configPath = 'custom.unityPostProcess';

  private _settings: BuiltinSettingsLike | null = null;
  private _placeholderLut: Texture2D | null = null;
  private _rounded = false;
  private readonly _vignetteColor = new Vec4(0, 0, 0, 1);
  private readonly _onResize = (): void => this._applyRoundness();

  start(): void {
    PlayableConfigManager.instance.ensureLoaded().then(() => this.apply(
      PlayableConfigManager.instance.get<UnityUrpPostProcessConfig | null>(this.configPath, null),
    ));
  }

  onDestroy(): void {
    view.off('canvas-resize', this._onResize);
    if (this._settings?.isValid) this._settings.enabled = false;
  }

  /** Applies a source profile; returns false when the active pipeline has no builtin colour-grading pass. */
  public apply(config: UnityUrpPostProcessConfig | null): boolean {
    if (!config || !this.gradingMaterial) return false;
    const settingsClass = js.getClassByName('BuiltinPipelineSettings') as (new () => BuiltinSettingsLike) | undefined;
    if (!settingsClass) {
      console.warn('[UnityUrpPostProcess] BuiltinPipelineSettings is unavailable; Unity post-processing not applied');
      return false;
    }
    const vignette = config.vignette ?? {};
    const color = vignette.color ?? [0, 0, 0];
    const center = vignette.center ?? [0.5, 0.5];
    this._rounded = !!vignette.rounded;
    // URP PostProcessPass.SetupVignette: (color, rounded ? aspect : 1) and (center, intensity * 3, smoothness * 5).
    this._vignetteColor.set(color[0] ?? 0, color[1] ?? 0, color[2] ?? 0, 1);
    this.gradingMaterial.setProperty('vignetteParams2', new Vec4(center[0] ?? 0.5, center[1] ?? 0.5,
      (vignette.intensity ?? 0) * 3, (vignette.smoothness ?? 0.2) * 5));
    this.gradingMaterial.setProperty('gradingParams', new Vec4(config.tonemapping === 'Neutral' ? 1 : 0, 0, 0, 0));
    this._applyRoundness();

    if (!this._placeholderLut) {
      // The pipeline only enables its colour-grading pass with a LUT bound; the effect grades analytically.
      this._placeholderLut = new Texture2D();
      this._placeholderLut.reset({ width: 2, height: 1, format: Texture2D.PixelFormat.RGBA8888 });
      this._placeholderLut.uploadData(new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255]));
    }
    const component = (this.getComponent(settingsClass) ?? this.addComponent(settingsClass)) as BuiltinSettingsLike;
    const settings = component.getPipelineSettings();
    settings.msaa.enabled = (config.msaa ?? 0) > 1;
    if (settings.msaa.enabled) settings.msaa.sampleCount = config.msaa!;
    settings.colorGrading.enabled = true;
    settings.colorGrading.material = this.gradingMaterial;
    settings.colorGrading.colorGradingMap = this._placeholderLut;
    settings.colorGrading.contribute = 1;
    keepFullPipelineWindowTargets();
    // Re-enable so the component pushes the updated settings object to the camera.
    component.enabled = false;
    component.enabled = true;
    // The builtin pipeline allocates per-window targets (MSAA radiance, LDR ping-pong) on window resize only;
    // settings applied after the first frame must re-run that allocation or the render graph misses them.
    (rendering as unknown as { forceResizeAllWindows?: () => void })?.forceResizeAllWindows?.();
    this._settings = component;
    view.on('canvas-resize', this._onResize);
    return true;
  }

  private _applyRoundness(): void {
    if (!this.gradingMaterial) return;
    const size = view.getVisibleSizeInPixel();
    this._vignetteColor.w = this._rounded && size.height > 0 ? size.width / size.height : 1;
    this.gradingMaterial.setProperty('vignetteParams1', this._vignetteColor);
  }
}
