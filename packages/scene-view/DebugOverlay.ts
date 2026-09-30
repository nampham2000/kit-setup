import { game } from 'cc';

const STYLE_ID = 'scene-view-overlay-style';

const CSS = `
.sv-root {
    /* Above the canvas but deliberately below 99: the Cocos preview page draws its
       Design Resolution list as an absolutely positioned div at z-index 99, and a
       panel at 9999 covered that list whenever it dropped down. */
    position: fixed; top: 8px; bottom: 8px; z-index: 50;
    /* One column per window edge. The width is set from the free margin beside the
       canvas, so a dock stays out of the game. */
    width: 280px; display: flex; flex-direction: column;
    font: 11px/1.5 ui-monospace, Menlo, Consolas, monospace; color: #cfd3dc;
    /* The container spans the viewport height, so it must stay transparent to the
       mouse; otherwise the gaps between cards become dead zones that swallow
       camera look and picking. Only the cards themselves take input. */
    pointer-events: none;
}
.sv-card {
    background: rgba(20, 22, 26, .9); border: 1px solid rgba(255, 255, 255, .1);
    border-radius: 5px; overflow: hidden; display: flex; flex-direction: column;
    pointer-events: auto;
}
.sv-title {
    display: flex; align-items: center; padding: 4px 8px; flex: none;
    background: rgba(255, 255, 255, .05); color: #8b93a3;
    letter-spacing: .08em; text-transform: uppercase; font-size: 10px;
}
.sv-title-actions { margin-left: auto; display: flex; gap: 2px; }
.sv-title-btn {
    width: 20px; height: 16px; padding: 0; border: 1px solid rgba(255, 255, 255, .12);
    border-radius: 3px; background: none; color: #a9b0bd; font: inherit; cursor: pointer;
}
.sv-title-btn:hover { background: rgba(255, 255, 255, .12); color: #fff; }
.sv-body { overflow: auto; padding: 2px 0; flex: 1 1 auto; min-height: 0; }
/* Each dock's top, bottom, left and width are set from the canvas rect in layout(). */
.sv-tree { flex: 1 1 0; min-height: 0; }
.sv-inspector { flex: 0 1 auto; max-height: 100%; }

/* One row of the tree. The level is carried by the coloured guide lines and the
   caret rather than by indentation alone, which read as one flat colour. */
.sv-row {
    display: flex; align-items: center; padding: 0 6px 0 4px; min-height: 19px;
    cursor: pointer; white-space: nowrap;
}
.sv-row:nth-child(even) { background: rgba(255, 255, 255, .03); }
.sv-row:hover { background: rgba(255, 255, 255, .08); }
.sv-row.sv-selected { background: rgba(255, 152, 48, .28); }

/* Each ancestor level is a fixed-width cell with a left border. Rows touch, so the
   borders join into continuous vertical guide lines. */
.sv-guide { flex: none; align-self: stretch; width: 12px; border-left: 1px solid; }
.sv-d0 { color: #5aa9ff; border-color: rgba(90, 169, 255, .5); }
.sv-d1 { color: #7be07b; border-color: rgba(123, 224, 123, .45); }
.sv-d2 { color: #ffd166; border-color: rgba(255, 209, 102, .45); }
.sv-d3 { color: #ff8f6b; border-color: rgba(255, 143, 107, .45); }
.sv-d4 { color: #c792ea; border-color: rgba(199, 146, 234, .45); }
.sv-d5 { color: #4fd1c5; border-color: rgba(79, 209, 197, .45); }

.sv-caret {
    flex: none; width: 14px; height: 14px; display: flex; align-items: center;
    justify-content: center; cursor: pointer;
}
.sv-caret::before {
    content: ''; border-style: solid; border-width: 4px 0 4px 6px;
    border-color: transparent transparent transparent currentColor;
}
.sv-caret.sv-open::before {
    border-width: 6px 4px 0 4px; border-color: currentColor transparent transparent transparent;
}
.sv-caret.sv-leaf { cursor: default; }
.sv-caret.sv-leaf::before { display: none; }

/* What the node is, at a glance. */
.sv-chip { flex: none; width: 7px; height: 7px; margin: 0 6px 0 2px; border-radius: 2px; }
.sv-k-camera { background: #ffd166; }
.sv-k-light { background: #ffb36b; border-radius: 50%; }
.sv-k-ui { background: #56c2ff; }
.sv-k-mesh { background: #9be38a; }
.sv-k-group { background: #8b93a3; }
.sv-k-empty { background: transparent; box-shadow: inset 0 0 0 1px #6b7280; }

.sv-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; color: #b8bfcc; }
.sv-row.sv-has-children .sv-name { color: #eef1f6; font-weight: 600; }
.sv-row.sv-inactive .sv-name, .sv-row.sv-inactive .sv-chip { opacity: .4; }
.sv-row.sv-dimmed .sv-name { color: #6b7280; text-decoration: line-through; }
.sv-tag { margin: 0 4px; color: #6b7280; font-size: 10px; }

.sv-btn {
    flex: none; width: 17px; height: 15px; margin-left: 2px; line-height: 15px;
    text-align: center; border: 1px solid transparent; border-radius: 3px;
    color: #7b8393; background: none; font: inherit; cursor: pointer; padding: 0;
    opacity: .3;
}
.sv-row:hover .sv-btn, .sv-btn.sv-on { opacity: 1; }
.sv-btn:hover { background: rgba(255, 255, 255, .12); color: #e6e9ef; }
.sv-btn.sv-on { color: #ff9830; border-color: rgba(255, 152, 48, .5); }

.sv-field { display: flex; align-items: center; gap: 4px; padding: 1px 8px; }
.sv-label { flex: none; width: 58px; color: #8b93a3; }
.sv-num {
    flex: 1 1 0; min-width: 0; width: 100%; background: rgba(255, 255, 255, .06);
    border: 1px solid rgba(255, 255, 255, .1); border-radius: 3px; color: #e6e9ef;
    font: inherit; padding: 1px 4px; text-align: right;
}
.sv-num:focus { outline: none; border-color: #ff9830; background: rgba(255, 152, 48, .12); }
.sv-text { padding: 2px 8px; color: #8b93a3; white-space: pre-wrap; word-break: break-all; }
.sv-empty { padding: 6px 8px; color: #6b7280; }


.sv-help-btn {
    position: fixed; z-index: 51; width: 26px; height: 26px; border-radius: 13px;
    background: rgba(20, 22, 26, .88); border: 1px solid rgba(255, 255, 255, .22);
    color: #cfd3dc; font: 700 14px/24px ui-monospace, Menlo, Consolas, monospace;
    text-align: center; cursor: pointer; user-select: none;
}
.sv-help-btn:hover, .sv-help-btn.sv-on { background: #3b6fd4; border-color: #3b6fd4; color: #fff; }

.sv-help {
    position: fixed; z-index: 51; display: none; width: 300px; max-height: 72vh;
    overflow: auto; padding: 8px 10px; border-radius: 6px;
    background: rgba(20, 22, 26, .95); border: 1px solid rgba(255, 255, 255, .14);
    font: 11px/1.6 ui-monospace, Menlo, Consolas, monospace; color: #cfd3dc;
}
.sv-help.sv-open { display: block; }
.sv-help-title {
    margin: 9px 0 3px; color: #8b93a3; font-size: 10px; letter-spacing: .08em;
    text-transform: uppercase;
}
.sv-help-status { color: #ff9830; padding-bottom: 2px; }
.sv-help-note {
    margin-bottom: 6px; padding: 4px 6px; border-radius: 3px; color: #e2c14a;
    background: rgba(226, 193, 74, .1);
}
.sv-help-row { display: flex; align-items: center; gap: 8px; padding: 1px 0; }
.sv-help-text { flex: 1 1 auto; }
.sv-keycap {
    flex: none; min-width: 22px; padding: 0 5px; text-align: center; color: #e6e9ef;
    border: 1px solid rgba(255, 255, 255, .22); border-radius: 3px;
    background: rgba(255, 255, 255, .06);
}
.sv-toggle-row { cursor: pointer; }
.sv-toggle-row:hover { background: rgba(255, 255, 255, .05); }
.sv-toggle-row.sv-static { cursor: default; }
.sv-toggle-row.sv-static:hover { background: none; }
.sv-switch {
    flex: none; position: relative; width: 26px; height: 14px; border-radius: 7px;
    background: rgba(255, 255, 255, .16);
}
.sv-switch::after {
    content: ''; position: absolute; top: 2px; left: 2px; width: 10px; height: 10px;
    border-radius: 5px; background: #cfd3dc; transition: left .1s;
}
.sv-switch.sv-on { background: #3b6fd4; }
.sv-switch.sv-on::after { left: 14px; background: #fff; }
`;

/**
 * Shared DOM host for the scene view panels, plus the input bookkeeping the
 * panels force on the rest of the tool.
 *
 * Two quirks of Cocos web input drive this class:
 *  - `mouseup` is registered on `window` (unlike `mousedown`, which is on the
 *    canvas), so releasing a click on a panel still reaches the engine and would
 *    trigger a pick. `cursorInside` lets the picker ignore those.
 *  - `keydown`/`keyup` are registered on the canvas, so typing in a field never
 *    reaches the engine — but a key held down *before* focusing a field never
 *    gets its keyup either, and would stay stuck. Hence `onFocusIn`.
 */
/** Inject the stylesheet once. The hint bar needs it even when panels are off. */
export function ensureStyles () {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
}

/** Which window edge a card is docked to. */
export type Dock = 'left' | 'right';

/** Narrowest and widest a docked panel is allowed to get, in CSS pixels. */
const MIN_PANEL = 210;
const MAX_PANEL = 420;

/** Gap kept to the window edge, and to the canvas a panel sits beside. */
const EDGE = 8;
const GAP = 8;

/**
 * Width for a panel given the free space beside the canvas.
 *
 * A panel sized from the window would sit on top of the game whenever the window
 * is narrower than the canvas plus two panels. Sizing it from the margin that is
 * actually free keeps it in the dark bars beside the canvas. Below the minimum it
 * has to overlap, and the P key hides it.
 */
function fit (free: number): number {
    return Math.round(Math.max(MIN_PANEL, Math.min(MAX_PANEL, free - EDGE - GAP)));
}

/**
 * DOM host for the Hierarchy (docked left) and the Inspector (docked right), like
 * the editor lays them out. Each dock is its own fixed column at a window edge, so
 * the canvas between them is left alone.
 */
export class DebugOverlay {
    public onFocusIn: () => void = null;

    private _roots: Partial<Record<Dock, HTMLElement>> = {};
    private _cursorInside = false;

    public get cursorInside (): boolean { return this._cursorInside; }

    public get available (): boolean {
        return typeof document !== 'undefined';
    }

    public mount () {
        if (!this.available || this._roots.left) return;

        ensureStyles();

        for (const dock of ['left', 'right'] as Dock[]) {
            const root = document.createElement('div');
            root.className = `sv-root sv-${dock}`;
            // focusin bubbles and is unaffected by pointer-events, so it can live on the
            // root; hover has to be tracked per card (see `card`).
            root.addEventListener('focusin', this._focusIn);
            document.body.appendChild(root);
            this._roots[dock] = root;
        }

        window.addEventListener('resize', this._onResize);
        this.layout();
    }

    public unmount () {
        window.removeEventListener('resize', this._onResize);
        for (const dock of ['left', 'right'] as Dock[]) {
            const root = this._roots[dock];
            if (!root) continue;
            root.removeEventListener('focusin', this._focusIn);
            root.remove();
        }
        this._roots = {};
        this._cursorInside = false;
    }

    /**
     * Fit each dock into the margin beside the canvas. Call after anything that moves
     * the canvas; the window resize case is handled here.
     */
    public layout () {
        const left = this._roots.left;
        const right = this._roots.right;
        if (!left || !right) return;

        const canvas = game.canvas as HTMLCanvasElement;
        const rect = canvas?.getBoundingClientRect?.();
        if (!rect) return;

        // Both docks take the canvas' own vertical extent. Anchored to the window they
        // started at the top edge and covered the preview page's toolbar, which sits
        // above the canvas.
        const top = Math.max(0, rect.top);
        const bottom = Math.max(0, window.innerHeight - rect.bottom);
        left.style.top = `${top}px`;
        left.style.bottom = `${bottom}px`;
        right.style.top = `${top}px`;
        right.style.bottom = `${bottom}px`;

        // Each dock sits against the canvas edge, not the window edge. With a cap on the
        // width, a dock pinned to the window left a gap whenever the margin was wider
        // than the cap, which showed as dead space beside the game.
        const leftWidth = fit(rect.left);
        const rightWidth = fit(window.innerWidth - rect.right);
        left.style.width = `${leftWidth}px`;
        right.style.width = `${rightWidth}px`;
        left.style.left = `${Math.max(EDGE, rect.left - GAP - leftWidth)}px`;
        // Clamped so a window with no margin cannot push the dock off the screen.
        right.style.left = `${Math.min(rect.right + GAP, window.innerWidth - EDGE - rightWidth)}px`;
    }

    public card (
        title: string,
        className: string,
        dock: Dock = 'right',
    ): { card: HTMLElement; body: HTMLElement } {
        const card = document.createElement('div');
        card.className = `sv-card ${className}`;
        card.addEventListener('mouseenter', this._enter);
        card.addEventListener('mouseleave', this._leave);

        const heading = document.createElement('div');
        heading.className = 'sv-title';
        heading.textContent = title;

        const body = document.createElement('div');
        body.className = 'sv-body';

        card.appendChild(heading);
        card.appendChild(body);
        this._roots[dock].appendChild(card);
        return { card, body };
    }

    private _onResize = () => { this.layout(); };
    private _enter = () => { this._cursorInside = true; };
    private _leave = () => { this._cursorInside = false; };
    private _focusIn = () => { this.onFocusIn?.(); };
}
