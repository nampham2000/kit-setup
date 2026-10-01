import { Camera, Color } from 'cc';
import { GeometryRenderer } from './SceneGizmos';
import { cameraPixelSize } from './ScenePicker';
import { screenFill, screenStroke, screenThickPath } from './ScreenDraw';
import { GizmoMode } from './TransformGizmo';

const ORDER: GizmoMode[] = ['move', 'rotate', 'scale', 'view', 'collider'];
/** The tools in key order, for anything else that lists them (the DOM strip). */
export const TOOL_ORDER: readonly GizmoMode[] = ORDER;

/** Geometry in camera pixels. Hit-testing and drawing read the same numbers. */
const MARGIN = 10;
const BUTTON = 28;
const GAP = 2;
const PAD = 3;
const STROKE = 1.8;

const PANEL_BG = new Color(24, 26, 31, 255);
const PANEL_EDGE = new Color(255, 255, 255, 46);
const ICON = new Color(198, 205, 217, 255);
const ICON_HOVER = new Color(230, 233, 239, 255);
const ICON_ON = new Color(255, 255, 255, 255);
const FILL_ON = new Color(59, 111, 212, 255);
const FILL_HOVER = new Color(62, 67, 78, 255);

/** Arc as a polyline, angles in degrees counter-clockwise from +x. */
function arc (cx: number, cy: number, r: number, from: number, to: number, steps: number): number[] {
    const points: number[] = [];
    for (let i = 0; i <= steps; i++) {
        const a = (from + (to - from) * (i / steps)) * Math.PI / 180;
        points.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    return points;
}

/**
 * Icons as polylines in a 0..1 box, y up. Line art rather than glyphs or SVG: the
 * geometry renderer draws neither text nor images, and a monospace font has
 * nothing that reads as "rotate" anyway.
 */
export const ICONS: Record<GizmoMode, readonly number[][]> = {
    move: [
        [0.5, 0.1, 0.5, 0.9],
        [0.1, 0.5, 0.9, 0.5],
        [0.38, 0.78, 0.5, 0.9, 0.62, 0.78],
        [0.38, 0.22, 0.5, 0.1, 0.62, 0.22],
        [0.22, 0.38, 0.1, 0.5, 0.22, 0.62],
        [0.78, 0.38, 0.9, 0.5, 0.78, 0.62],
    ],
    rotate: [arc(0.5, 0.5, 0.36, -150, 110, 14), [0.62, 0.86, 0.80, 0.80, 0.75, 0.62]],
    scale: [
        [0.30, 0.30, 0.70, 0.70],
        [0.12, 0.12, 0.30, 0.12, 0.30, 0.30, 0.12, 0.30, 0.12, 0.12],
        [0.62, 0.62, 0.90, 0.62, 0.90, 0.90, 0.62, 0.90, 0.62, 0.62],
    ],
    view: [[0.32, 0.90, 0.32, 0.20, 0.50, 0.38, 0.62, 0.10, 0.73, 0.15, 0.61, 0.43, 0.84, 0.45, 0.32, 0.90]],
    // A box outline with a grab handle on two of its faces.
    collider: [
        [0.18, 0.18, 0.74, 0.18, 0.74, 0.74, 0.18, 0.74, 0.18, 0.18],
        [0.74, 0.40, 0.90, 0.40, 0.90, 0.56, 0.74, 0.56, 0.74, 0.40],
        [0.34, 0.74, 0.34, 0.90, 0.50, 0.90, 0.50, 0.74],
    ],
};

/**
 * Vertical tool strip at the left edge of the scene viewport, like the one in
 * Unity's Scene view.
 *
 * Drawn with the geometry renderer and driven by engine mouse input, with no DOM
 * at all. The editor Preview panel never dispatches DOM events into the preview
 * document, and a native build has no document to draw into — routing both halves
 * through the engine is the only way this behaves the same everywhere.
 *
 * Buttons are listed in key order (1-5) rather than Unity's order, which puts the
 * hand first: a strip whose positions disagree with the numbers printed in its own
 * documentation is worse than one that does not copy Unity exactly.
 */
export class ToolPalette {
    private _camera: Camera = null;
    private _fraction = 0.5;
    private _mode: GizmoMode = 'move';
    private _hover: GizmoMode | null = null;

    public sync (camera: Camera, fraction: number) {
        this._camera = camera;
        this._fraction = fraction;
    }

    public setMode (mode: GizmoMode) { this._mode = mode; }

    public setHover (mode: GizmoMode | null) { this._hover = mode; }

    /** Which tool sits under the cursor, in camera pixels (origin bottom-left). */
    public hitTest (screenX: number, screenY: number): GizmoMode | null {
        if (!this._camera) return null;
        const { width, height } = cameraPixelSize(this._camera);

        const left = width * this._fraction + MARGIN;
        if (screenX < left || screenX > left + BUTTON) return null;

        // Screen y grows upward while the strip grows downward from the top edge.
        const offset = (height - MARGIN) - screenY;
        if (offset < 0) return null;

        const index = Math.floor(offset / (BUTTON + GAP));
        if (index >= ORDER.length) return null;
        // Land in the gap between two buttons and nothing is hit, rather than
        // silently snapping to whichever neighbour happens to be nearer.
        if (offset - index * (BUTTON + GAP) > BUTTON) return null;

        return ORDER[index];
    }

    public draw (gr: GeometryRenderer) {
        if (!this._camera) return;
        const { width, height } = cameraPixelSize(this._camera);

        const left = width * this._fraction + MARGIN;
        const top = height - MARGIN;
        const strip = ORDER.length * BUTTON + (ORDER.length - 1) * GAP;

        screenFill(gr, this._camera, left - PAD, top - strip - PAD,
            BUTTON + PAD * 2, strip + PAD * 2, PANEL_BG);
        screenStroke(gr, this._camera, left - PAD, top - strip - PAD,
            BUTTON + PAD * 2, strip + PAD * 2, 1, PANEL_EDGE);

        for (let i = 0; i < ORDER.length; i++) {
            const tool = ORDER[i];
            const bottom = top - (i + 1) * BUTTON - i * GAP;
            const active = tool === this._mode;

            if (active) {
                screenFill(gr, this._camera, left, bottom, BUTTON, BUTTON, FILL_ON);
            } else if (tool === this._hover) {
                screenFill(gr, this._camera, left, bottom, BUTTON, BUTTON, FILL_HOVER);
            }

            const color = active ? ICON_ON : tool === this._hover ? ICON_HOVER : ICON;
            this._icon(gr, tool, left, bottom, color);
        }
    }

    private _icon (gr: GeometryRenderer, tool: GizmoMode, left: number, bottom: number, color: Color) {
        const size = BUTTON - 10;
        const x = left + 5;
        const y = bottom + 5;

        for (const path of ICONS[tool]) {
            const points: number[] = [];
            for (let i = 0; i + 1 < path.length; i += 2) {
                points.push(x + path[i] * size, y + path[i + 1] * size);
            }
            screenThickPath(gr, this._camera, points, STROKE, color);
        }
    }
}
