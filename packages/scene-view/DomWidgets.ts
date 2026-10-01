import { ensureStyles } from './DebugOverlay';
import { ICONS, TOOL_ORDER } from './ToolPalette';
import { SPLITTER_TIP, TOOL_TIPS } from './Tips';
import { GizmoMode } from './TransformGizmo';
import { tip } from './Tooltip';

const SVG = 'http://www.w3.org/2000/svg';

/** Where the tool strip sits inside the scene view, in CSS pixels. */
const MARGIN = 10;

/** Width of the divider's grab area. The visible bar inside it is thinner. */
const GRAB = 10;

export interface WidgetLayout {
    strip: { left: number; top: number };
    divider: { left: number; top: number; height: number };
}

/**
 * Where the tool strip and the divider go, from the canvas rect, the split (a fraction of
 * the canvas width) and how much of the canvas bottom is taken by the console.
 *
 * Kept apart from the DOM so it can be checked on its own. It depends on nothing but the
 * canvas and the split, which is the point: the camera's pose does not enter into it, so
 * moving the camera cannot move the widgets.
 */
export function layoutWidgets (
    canvas: { left: number; top: number; width: number; height: number },
    split: number,
    reservedBottom: number,
): WidgetLayout {
    const x = canvas.left + canvas.width * split;
    return {
        strip: { left: x + MARGIN, top: canvas.top + MARGIN },
        divider: {
            left: x - GRAB / 2,
            top: canvas.top,
            height: Math.max(0, canvas.height - Math.max(0, reservedBottom)),
        },
    };
}

/** Clamp a split to the range the divider may take. */
export function splitFromPointer (clientX: number, canvasLeft: number, canvasWidth: number): number {
    if (canvasWidth <= 0) return 0.5;
    return Math.min(0.9, Math.max(0.1, (clientX - canvasLeft) / canvasWidth));
}

/**
 * The tool strip (Move, Rotate, Scale, No gizmo, Collider) and the divider between the
 * game and the scene view, as page elements.
 *
 * The same two widgets can also be drawn by the engine, which is how they work in the
 * editor Preview, where the page gets no mouse events. In a browser that way has a flaw:
 * the engine draws the game's UI after everything else, so a full-screen UI element
 * covers anything drawn before it, widgets included. A page element is above the whole
 * canvas whatever it renders, never lags the camera, and gets hover and click for free.
 */
export class DomWidgets {
    /** A tool button was pressed. */
    public onTool: (mode: GizmoMode) => void = null;
    /** The divider was dragged to this fraction of the canvas width. */
    public onSplit: (fraction: number) => void = null;
    /** Called after any press, so the owner can give the canvas keyboard focus back. */
    public onInteract: () => void = null;

    private _strip: HTMLElement = null;
    private _divider: HTMLElement = null;
    private _buttons = new Map<GizmoMode, HTMLElement>();
    private _inside = false;
    private _dragging = false;
    private _canvas = { left: 0, width: 1 };

    public get mounted (): boolean { return this._strip !== null; }
    public get cursorInside (): boolean { return this._inside; }
    public get dragging (): boolean { return this._dragging; }

    public mount () {
        if (typeof document === 'undefined' || this._strip) return;
        ensureStyles();

        this._strip = document.createElement('div');
        this._strip.className = 'sv-tools';
        this._track(this._strip);
        for (const mode of TOOL_ORDER) {
            const button = document.createElement('button');
            button.className = 'sv-tool';
            button.appendChild(icon(mode));
            tip(button, TOOL_TIPS[mode]);
            button.addEventListener('click', () => {
                this.onTool?.(mode);
                this.onInteract?.();
            });
            this._strip.appendChild(button);
            this._buttons.set(mode, button);
        }

        this._divider = document.createElement('div');
        this._divider.className = 'sv-divider';
        tip(this._divider, SPLITTER_TIP);
        this._track(this._divider);
        this._divider.addEventListener('pointerdown', (e) => {
            this._dragging = true;
            this._divider.classList.add('sv-drag');
            // Captured, so the drag keeps going when the pointer leaves the thin bar.
            this._divider.setPointerCapture?.(e.pointerId);
            e.preventDefault();
        });
        this._divider.addEventListener('pointermove', (e) => {
            if (!this._dragging) return;
            this.onSplit?.(splitFromPointer(e.clientX, this._canvas.left, this._canvas.width));
        });
        const end = (e: PointerEvent) => {
            if (!this._dragging) return;
            this._dragging = false;
            this._divider.classList.remove('sv-drag');
            this._divider.releasePointerCapture?.(e.pointerId);
            this.onInteract?.();
        };
        this._divider.addEventListener('pointerup', end);
        this._divider.addEventListener('pointercancel', end);

        document.body.appendChild(this._strip);
        document.body.appendChild(this._divider);
    }

    public unmount () {
        this._strip?.remove();
        this._divider?.remove();
        this._strip = null;
        this._divider = null;
        this._buttons.clear();
        this._inside = false;
        this._dragging = false;
    }

    public setMode (mode: GizmoMode) {
        for (const [m, button] of this._buttons) button.classList.toggle('sv-on', m === mode);
    }

    /** Place both widgets. `showStrip` and `showDivider` follow the tool's own switches. */
    public sync (
        canvas: { left: number; top: number; width: number; height: number },
        split: number, reservedBottom: number, showStrip: boolean, showDivider: boolean,
    ) {
        if (!this._strip) return;
        this._canvas = { left: canvas.left, width: canvas.width };
        const layout = layoutWidgets(canvas, split, reservedBottom);

        this._strip.style.display = showStrip ? 'flex' : 'none';
        this._strip.style.left = `${layout.strip.left}px`;
        this._strip.style.top = `${layout.strip.top}px`;

        this._divider.style.display = showDivider ? 'block' : 'none';
        this._divider.style.left = `${layout.divider.left}px`;
        this._divider.style.top = `${layout.divider.top}px`;
        this._divider.style.height = `${layout.divider.height}px`;
    }

    private _track (el: HTMLElement) {
        el.addEventListener('mouseenter', () => { this._inside = true; });
        el.addEventListener('mouseleave', () => { this._inside = false; });
    }
}

/** A tool's icon as an SVG, from the same line art the engine-drawn strip uses (y up, in a 0..1 box). */
function icon (mode: GizmoMode): SVGElement {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 1 1');
    svg.setAttribute('aria-hidden', 'true');
    for (const path of ICONS[mode]) {
        const points: string[] = [];
        for (let i = 0; i + 1 < path.length; i += 2) points.push(`${path[i]},${1 - path[i + 1]}`);
        const line = document.createElementNS(SVG, 'polyline');
        line.setAttribute('points', points.join(' '));
        line.setAttribute('fill', 'none');
        line.setAttribute('stroke', 'currentColor');
        line.setAttribute('stroke-width', '0.09');
        line.setAttribute('stroke-linecap', 'round');
        line.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(line);
    }
    return svg;
}
