import { Camera, Color } from 'cc';
import { GeometryRenderer } from './SceneGizmos';
import { cameraPixelSize } from './ScenePicker';
import { screenFill } from './ScreenDraw';

const MIN_FRACTION = 0.1;
const MAX_FRACTION = 0.9;

/** Grab tolerance either side of the divider, in camera pixels. */
const GRAB = 6;

/** Drawn width. The bar sits inside the scene viewport; see `draw`. */
const BAR = 4;

const IDLE = new Color(255, 255, 255, 36);
const LIT = new Color(255, 152, 48, 255);

/**
 * Draggable divider between the game view and the scene view, like the one
 * between Unity's Game and Scene tabs.
 *
 * Drawn with the geometry renderer and driven by engine mouse input, with no DOM
 * at all — the editor Preview panel dispatches no DOM events into the preview
 * document, and a native build has no document. Camera pixels are the only
 * coordinate space involved, so hit-testing and drawing cannot drift apart.
 */
export class ViewSplitter {
    public onChange: (fraction: number) => void = null;

    private _fraction = 0.5;
    private _dragging = false;
    private _hover = false;
    private _camera: Camera = null;

    public get fraction (): number { return this._fraction; }
    public get dragging (): boolean { return this._dragging; }

    public sync (camera: Camera, fraction: number) {
        this._camera = camera;
        this._fraction = fraction;
    }

    public hitTest (screenX: number): boolean {
        if (!this._camera) return false;
        const { width } = cameraPixelSize(this._camera);
        return Math.abs(screenX - width * this._fraction) <= GRAB;
    }

    public setHover (on: boolean) { this._hover = on; }

    public beginDrag () { this._dragging = true; }

    public drag (screenX: number) {
        if (!this._dragging || !this._camera) return;
        const { width } = cameraPixelSize(this._camera);
        if (width <= 0) return;

        const raw = screenX / width;
        this._fraction = Math.min(MAX_FRACTION, Math.max(MIN_FRACTION, raw));
        this.onChange?.(this._fraction);
    }

    public endDrag () { this._dragging = false; }

    public draw (gr: GeometryRenderer) {
        if (!this._camera) return;
        const { width, height } = cameraPixelSize(this._camera);

        // Drawn by the scene camera, whose viewport is scissored to the right half,
        // so the bar has to sit just inside the boundary — anything to the left of
        // it would simply be clipped away.
        const x = width * this._fraction;
        const color = this._dragging || this._hover ? LIT : IDLE;
        screenFill(gr, this._camera, x, 0, BAR, height, color);
    }
}
