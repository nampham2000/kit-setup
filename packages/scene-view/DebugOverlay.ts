import { game } from 'cc';
import { applyFontSize, fontSize } from './UiScale';

const STYLE_ID = 'scene-view-overlay-style';

const CSS = `
/* One text size drives everything. --sv-fs is published by UiScale; every length below
   is in em, so changing it scales rows, carets, chips and switches with the letters. */
.sv-root, .sv-help, .sv-help-btn, .sv-console, .sv-log-btn {
    --sv-ui: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    /* Monospace only where alignment matters: numbers and key caps. Names and labels
       are far easier to read in a proportional face. */
    --sv-mono: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    font-family: var(--sv-ui); font-size: var(--sv-fs, 13px); line-height: 1.45; color: #e3e7ee;
}

.sv-root {
    /* Above the canvas but deliberately below 99: the Cocos preview page draws its
       Design Resolution list as an absolutely positioned div at z-index 99, and a
       panel at 9999 covered that list whenever it dropped down. */
    position: fixed; top: 8px; bottom: 8px; z-index: 50;
    /* One column per window edge. The width is set from the free margin beside the
       canvas, so a dock stays out of the game. */
    width: 280px; display: flex; flex-direction: column;
    /* The container spans the viewport height, so it must stay transparent to the
       mouse; otherwise the gaps between cards become dead zones that swallow
       camera look and picking. Only the cards themselves take input. */
    pointer-events: none;
}
.sv-card {
    background: rgba(20, 22, 26, .93); border: 1px solid rgba(255, 255, 255, .14);
    border-radius: .4em; overflow: hidden; display: flex; flex-direction: column;
    pointer-events: auto;
}
.sv-title {
    display: flex; align-items: center; padding: .4em .7em; flex: none; cursor: pointer; user-select: none;
    background: rgba(255, 255, 255, .06); color: #a9b1c0;
    letter-spacing: .08em; text-transform: uppercase; font-size: .8em; font-weight: 600;
}
.sv-title-actions { margin-left: auto; display: flex; gap: .25em; }
/* A card folds down to its title bar, and its dock narrows with it, so the space goes
   back to the game and scene views. */
.sv-fold { flex: none; width: 1.2em; margin-right: .35em; text-align: center; font-size: 1.1em; line-height: 1; }
.sv-card.sv-collapsed { flex: 0 0 auto; }
/* !important because the Inspector shows and hides its body with an inline style. */
.sv-card.sv-collapsed .sv-body, .sv-card.sv-collapsed .sv-title-actions { display: none !important; }
.sv-title-btn {
    width: 1.9em; height: 1.6em; padding: 0; font: inherit; font-size: 1.15em; line-height: 1;
    border: 1px solid rgba(255, 255, 255, .18); border-radius: .3em;
    background: none; color: #c3cad7; cursor: pointer;
}
.sv-title-btn:hover { background: rgba(255, 255, 255, .14); color: #fff; }
.sv-body { overflow: auto; padding: .15em 0; flex: 1 1 auto; min-height: 0; }
/* Each dock's top, bottom, left and width are set from the canvas rect in layout(). */
.sv-tree { flex: 1 1 0; min-height: 0; }
.sv-inspector { flex: 0 1 auto; max-height: 100%; }

/* One row of the tree. The level is carried by the coloured guide lines and the
   caret rather than by indentation alone, which read as one flat colour. */
.sv-row {
    display: flex; align-items: center; padding: 0 .5em 0 .3em; min-height: 1.85em;
    cursor: pointer; white-space: nowrap;
}
.sv-row:nth-child(even) { background: rgba(255, 255, 255, .035); }
.sv-row:hover { background: rgba(255, 255, 255, .09); }
.sv-row.sv-selected { background: rgba(255, 152, 48, .3); }

/* Each ancestor level is a fixed-width cell with a left border. Rows touch, so the
   borders join into continuous vertical guide lines. */
.sv-guide { flex: none; align-self: stretch; width: 1em; border-left: 1px solid; }
.sv-d0 { color: #6fb4ff; border-color: rgba(111, 180, 255, .55); }
.sv-d1 { color: #86e886; border-color: rgba(134, 232, 134, .5); }
.sv-d2 { color: #ffd98a; border-color: rgba(255, 217, 138, .5); }
.sv-d3 { color: #ff9f80; border-color: rgba(255, 159, 128, .5); }
.sv-d4 { color: #d3a6f0; border-color: rgba(211, 166, 240, .5); }
.sv-d5 { color: #62dccf; border-color: rgba(98, 220, 207, .5); }

.sv-caret {
    flex: none; width: 1.2em; height: 1.2em; display: flex; align-items: center;
    justify-content: center; cursor: pointer;
}
.sv-caret::before {
    content: ''; border-style: solid; border-width: .32em 0 .32em .48em;
    border-color: transparent transparent transparent currentColor;
}
.sv-caret.sv-open::before {
    border-width: .48em .32em 0 .32em; border-color: currentColor transparent transparent transparent;
}
.sv-caret.sv-leaf { cursor: default; }
.sv-caret.sv-leaf::before { display: none; }

/* What the node is, at a glance. */
.sv-chip { flex: none; width: .6em; height: .6em; margin: 0 .5em 0 .15em; border-radius: .15em; }
.sv-k-camera { background: #ffd166; }
.sv-k-light { background: #ffb36b; border-radius: 50%; }
.sv-k-ui { background: #56c2ff; }
.sv-k-mesh { background: #9be38a; }
.sv-k-group { background: #a3abba; }
.sv-k-empty { background: transparent; box-shadow: inset 0 0 0 1px #8b93a3; }

.sv-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; color: #dde2ea; }
.sv-row.sv-has-children .sv-name { color: #f6f8fb; font-weight: 600; }
/* Prefab nodes are green, as in the editor. After the rule above so it wins, and before
   the dimmed rule so a hidden prefab node still greys out. */
.sv-row.sv-prefab .sv-name { color: #5fd35f; }
.sv-row.sv-inactive .sv-name, .sv-row.sv-inactive .sv-chip { opacity: .45; }
.sv-row.sv-dimmed .sv-name { color: #8b93a3; text-decoration: line-through; }
.sv-tag { margin: 0 .35em; color: #a3abba; font-size: .85em; }

.sv-btn {
    flex: none; width: 1.55em; height: 1.4em; margin-left: .2em; line-height: 1.4em;
    text-align: center; border: 1px solid transparent; border-radius: .3em;
    color: #aab2c0; background: none; font: inherit; font-size: .92em; cursor: pointer; padding: 0;
    opacity: .4;
}
.sv-row:hover .sv-btn, .sv-btn.sv-on { opacity: 1; }
.sv-btn:hover { background: rgba(255, 255, 255, .14); color: #fff; }
.sv-btn.sv-on { color: #ff9830; border-color: rgba(255, 152, 48, .55); }

.sv-field { display: flex; align-items: center; gap: .4em; padding: .15em .5em; }
.sv-label { flex: none; width: 3.6em; color: #a9b1c0; }
.sv-num {
    flex: 1 1 0; min-width: 0; width: 100%; background: rgba(255, 255, 255, .07);
    border: 1px solid rgba(255, 255, 255, .16); border-radius: .3em; color: #f0f3f8;
    font-family: var(--sv-mono); font-size: .85em; padding: .15em .25em; text-align: right;
}
.sv-num:focus { outline: none; border-color: #ff9830; background: rgba(255, 152, 48, .14); }
.sv-text { padding: .2em .7em; color: #c3cad7; white-space: pre-wrap; word-break: break-all; }
.sv-empty { padding: .5em .7em; color: #8b93a3; }

.sv-help-btn {
    position: fixed; z-index: 51; width: 2em; height: 2em; border-radius: 50%;
    background: rgba(20, 22, 26, .92); border: 1px solid rgba(255, 255, 255, .28);
    color: #e3e7ee; font-weight: 700; line-height: calc(2em - 2px);
    text-align: center; cursor: pointer; user-select: none;
}
.sv-help-btn:hover, .sv-help-btn.sv-on { background: #3b6fd4; border-color: #3b6fd4; color: #fff; }

/* The console: a button beside the help button, and a drawer above it. The drawer is at
   50 like the docks, below the preview page's own dropdown (99); the button at 51 so it
   stays clickable over the drawer's edge. */
.sv-log-btn {
    position: fixed; z-index: 51; display: flex; align-items: center; gap: .45em;
    height: 2em; padding: 0 .8em; border-radius: 1em; box-sizing: border-box;
    background: rgba(20, 22, 26, .92); border: 1px solid rgba(255, 255, 255, .28);
    color: #e3e7ee; font-weight: 600; font-size: .9em; cursor: pointer; user-select: none;
}
.sv-log-btn:hover, .sv-log-btn.sv-on { background: #3b6fd4; border-color: #3b6fd4; color: #fff; }
.sv-badge {
    min-width: 1.5em; padding: 0 .35em; border-radius: .8em; text-align: center;
    font-size: .85em; font-family: var(--sv-mono); line-height: 1.5;
}
.sv-badge-err { background: #d64545; color: #fff; }
.sv-badge-warn { background: #e2b93b; color: #241c00; }

.sv-console {
    position: fixed; z-index: 50; display: none; flex-direction: column; box-sizing: border-box;
    background: #101216; border: 1px solid rgba(255, 255, 255, .18);
    border-radius: .45em; overflow: hidden;
}
.sv-console.sv-open { display: flex; }
.sv-console-head {
    display: flex; align-items: center; gap: .5em; flex: none; padding: .35em .6em;
    background: rgba(255, 255, 255, .06);
}
.sv-console-title {
    margin-right: .4em; color: #a9b1c0; font-size: .8em; font-weight: 600;
    letter-spacing: .08em; text-transform: uppercase;
}
.sv-console-spacer { flex: 1; }
.sv-chip-btn {
    font: inherit; font-size: .9em; padding: .1em .65em; border-radius: .3em;
    border: 1px solid rgba(255, 255, 255, .2); background: none; color: #8b93a3; cursor: pointer;
}
.sv-chip-btn:hover { background: rgba(255, 255, 255, .12); color: #fff; }
.sv-chip-btn.sv-on { background: rgba(255, 255, 255, .14); color: #fff; }
.sv-lvbtn-warn.sv-on { color: #f0d070; }
.sv-lvbtn-error.sv-on { color: #ff9a9a; }
.sv-console-body {
    flex: 1 1 auto; min-height: 0; overflow: auto; user-select: text;
    font-family: var(--sv-mono); font-size: .88em;
}
.sv-log-row {
    display: flex; gap: .7em; padding: .12em .7em; white-space: pre-wrap; word-break: break-word;
    border-bottom: 1px solid rgba(255, 255, 255, .04);
}
.sv-log-time { flex: none; color: #6f7787; }
.sv-log-msg { flex: 1; min-width: 0; }
.sv-log-count {
    flex: none; align-self: flex-start; padding: 0 .5em; border-radius: .8em;
    background: rgba(255, 255, 255, .16); font-size: .85em;
}
.sv-lv-warn { background: rgba(226, 185, 59, .10); color: #f0d070; }
.sv-lv-error { background: rgba(214, 69, 69, .14); color: #ff9a9a; }
.sv-log-empty { padding: .8em; color: #8b93a3; }

.sv-help {
    position: fixed; z-index: 51; display: none; width: 25em; max-height: 72vh;
    overflow: auto; padding: .6em .8em; border-radius: .45em;
    background: rgba(20, 22, 26, .96); border: 1px solid rgba(255, 255, 255, .18);
}
.sv-help.sv-open { display: block; }
.sv-help-title {
    margin: .8em 0 .25em; color: #a9b1c0; font-size: .8em; font-weight: 600;
    letter-spacing: .08em; text-transform: uppercase;
}
.sv-help-status { color: #ffab57; padding-bottom: .15em; }
.sv-help-note {
    margin-bottom: .5em; padding: .35em .5em; border-radius: .3em; color: #f0d070;
    background: rgba(226, 193, 74, .12);
}
.sv-help-row { display: flex; align-items: center; gap: .6em; padding: .08em 0; }
.sv-help-text { flex: 1 1 auto; }
.sv-keycap {
    flex: none; min-width: 1.9em; padding: 0 .4em; text-align: center; color: #f0f3f8;
    font-family: var(--sv-mono); font-size: .92em;
    border: 1px solid rgba(255, 255, 255, .28); border-radius: .3em;
    background: rgba(255, 255, 255, .08);
}
.sv-toggle-row { cursor: pointer; }
.sv-toggle-row:hover { background: rgba(255, 255, 255, .07); }
.sv-toggle-row.sv-static { cursor: default; }
.sv-toggle-row.sv-static:hover { background: none; }
.sv-switch {
    flex: none; position: relative; width: 2.2em; height: 1.2em; border-radius: .6em;
    background: rgba(255, 255, 255, .2);
}
.sv-switch::after {
    content: ''; position: absolute; top: .15em; left: .15em; width: .9em; height: .9em;
    border-radius: 50%; background: #dfe4ec; transition: left .1s;
}
.sv-switch.sv-on { background: #3b6fd4; }
.sv-switch.sv-on::after { left: 1.15em; background: #fff; }

.sv-size-btn {
    flex: none; width: 2em; height: 1.6em; padding: 0; font: inherit; line-height: 1;
    border: 1px solid rgba(255, 255, 255, .24); border-radius: .3em;
    background: rgba(255, 255, 255, .06); color: #e3e7ee; cursor: pointer;
}
.sv-size-btn:hover { background: rgba(255, 255, 255, .16); }
.sv-size-btn.sv-static { cursor: default; opacity: .6; }
.sv-size-value { flex: none; min-width: 3.2em; text-align: center; font-family: var(--sv-mono); }
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
    if (typeof document === 'undefined') return;
    // Idempotent, and needed on every call: the size can change while the styles stay.
    applyFontSize();
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
}

/** Which window edge a card is docked to. */
export type Dock = 'left' | 'right';

/**
 * Narrowest and widest a docked panel may get, in ems. In ems rather than pixels so a
 * larger text size gets a wider panel instead of the same width with truncated names.
 * At the default 13px these come to about 210 and 420 px.
 */
const MIN_PANEL_EM = 20;
/** The Inspector holds three number fields per row, which need more room than a tree. */
const MIN_INSPECTOR_EM = 18;
/** Width of a dock whose card is folded: just its title bar. */
const COLLAPSED_EM = 11;
const COLLAPSE_KEY = 'scene-view-collapsed';
const MAX_PANEL_EM = 32;

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
function fit (free: number, minEm = MIN_PANEL_EM): number {
    const em = fontSize();
    return Math.round(Math.max(em * minEm, Math.min(em * MAX_PANEL_EM, free - EDGE - GAP)));
}

function loadCollapsed (): Partial<Record<Dock, boolean>> {
    try {
        const parsed = JSON.parse(globalThis.localStorage?.getItem(COLLAPSE_KEY) || '{}');
        return { left: !!parsed.left, right: !!parsed.right };
    } catch {
        return {};
    }
}

function saveCollapsed (state: Partial<Record<Dock, boolean>>) {
    try {
        globalThis.localStorage?.setItem(COLLAPSE_KEY, JSON.stringify(state));
    } catch {
        // Not remembered; still applies for this session.
    }
}

/**
 * DOM host for the Hierarchy (docked left) and the Inspector (docked right), like
 * the editor lays them out. Each dock is its own fixed column at a window edge, so
 * the canvas between them is left alone.
 */
export class DebugOverlay {
    public onFocusIn: () => void = null;

    /** Called after a card was folded or opened, so the owner can re-fit the views around it. */
    public onLayoutChange: () => void = null;

    private _roots: Partial<Record<Dock, HTMLElement>> = {};
    private _cursorInside = false;
    private _collapsed: Partial<Record<Dock, boolean>> = loadCollapsed();

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

        this.layout();
    }

    public unmount () {
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
        const leftWidth = this._collapsed.left ? this._foldedWidth() : fit(rect.left);
        const rightWidth = this._collapsed.right
            ? this._foldedWidth()
            : fit(window.innerWidth - rect.right, MIN_INSPECTOR_EM);
        left.style.width = `${leftWidth}px`;
        right.style.width = `${rightWidth}px`;
        left.style.left = `${Math.max(EDGE, rect.left - GAP - leftWidth)}px`;
        // Clamped so a window with no margin cannot push the dock off the screen.
        right.style.left = `${Math.min(rect.right + GAP, window.innerWidth - EDGE - rightWidth)}px`;
    }

    private _foldedWidth (): number {
        return Math.round(fontSize() * COLLAPSED_EM);
    }

    /**
     * How far, in CSS pixels, each dock's cards reach into the canvas.
     *
     * Docks sit in the margin beside the canvas when there is one, and overlap it
     * when there is not. The overlapped part is covered, so the game and scene views
     * are laid out in what is left rather than drawn partly underneath.
     */
    public insets (): { left: number; right: number } {
        const canvas = game.canvas as HTMLCanvasElement;
        const rect = canvas?.getBoundingClientRect?.();
        if (!rect || !this._roots.left || !this._roots.right) return { left: 0, right: 0 };

        let left = 0;
        let right = 0;
        const leftCards = this._roots.left.children;
        for (let i = 0; i < leftCards.length; i++) {
            const r = leftCards[i].getBoundingClientRect();
            if (r.width > 0) left = Math.max(left, r.right + GAP - rect.left);
        }
        const rightCards = this._roots.right.children;
        for (let i = 0; i < rightCards.length; i++) {
            const r = rightCards[i].getBoundingClientRect();
            if (r.width > 0) right = Math.max(right, rect.right - (r.left - GAP));
        }
        return { left: Math.max(0, left), right: Math.max(0, right) };
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
        heading.title = 'Click to fold or open';

        const fold = document.createElement('span');
        fold.className = 'sv-fold';
        heading.appendChild(fold);
        heading.appendChild(document.createTextNode(title));

        const apply = () => {
            const collapsed = !!this._collapsed[dock];
            card.classList.toggle('sv-collapsed', collapsed);
            fold.textContent = collapsed ? '\u25B8' : '\u25BE';
        };
        heading.addEventListener('click', (e) => {
            // The buttons in the title do their own thing and must not also fold the card.
            if ((e.target as HTMLElement).closest('.sv-title-actions')) return;
            this._collapsed[dock] = !this._collapsed[dock];
            saveCollapsed(this._collapsed);
            apply();
            this.layout();
            this.onLayoutChange?.();
        });
        heading.addEventListener('dblclick', (e) => e.stopPropagation());
        apply();

        const body = document.createElement('div');
        body.className = 'sv-body';

        card.appendChild(heading);
        card.appendChild(body);
        this._roots[dock].appendChild(card);
        return { card, body };
    }

    private _enter = () => { this._cursorInside = true; };
    private _leave = () => { this._cursorInside = false; };
    private _focusIn = () => { this.onFocusIn?.(); };
}
