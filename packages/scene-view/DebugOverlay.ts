const STYLE_ID = 'scene-view-overlay-style';

const CSS = `
.sv-root {
    position: fixed; top: 8px; right: 8px; bottom: 8px; z-index: 9999;
    width: 292px; display: flex; flex-direction: column; gap: 6px;
    font: 11px/1.5 ui-monospace, Menlo, Consolas, monospace; color: #cfd3dc;
    /* The container spans the viewport height, so it must stay transparent to the
       mouse; otherwise the gaps between cards become dead zones that swallow
       camera look and picking. Only the cards themselves take input. */
    pointer-events: none;
}
.sv-card {
    background: rgba(20, 22, 26, .88); border: 1px solid rgba(255, 255, 255, .1);
    border-radius: 5px; overflow: hidden; display: flex; flex-direction: column;
    pointer-events: auto;
}
.sv-title {
    padding: 4px 8px; background: rgba(255, 255, 255, .05); color: #8b93a3;
    letter-spacing: .08em; text-transform: uppercase; font-size: 10px; flex: none;
}
.sv-body { overflow: auto; padding: 4px 0; }
.sv-tree { flex: 0 1 auto; max-height: 45%; }
.sv-inspector { flex: 0 0 auto; max-height: 52%; }

.sv-row {
    display: flex; align-items: center; gap: 4px; padding: 1px 6px 1px 0;
    cursor: pointer; white-space: nowrap;
}
.sv-row:hover { background: rgba(255, 255, 255, .06); }
.sv-row.sv-selected { background: rgba(255, 152, 48, .22); }
.sv-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; }
.sv-row.sv-dimmed .sv-name { color: #6b7280; text-decoration: line-through; }
.sv-tag { color: #6b7280; font-size: 10px; }

.sv-btn {
    flex: none; width: 17px; height: 15px; line-height: 15px; text-align: center;
    border: 1px solid transparent; border-radius: 3px; color: #7b8393;
    background: none; font: inherit; cursor: pointer; padding: 0;
}
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
    position: fixed; z-index: 10001; width: 26px; height: 26px; border-radius: 13px;
    background: rgba(20, 22, 26, .88); border: 1px solid rgba(255, 255, 255, .22);
    color: #cfd3dc; font: 700 14px/24px ui-monospace, Menlo, Consolas, monospace;
    text-align: center; cursor: pointer; user-select: none;
}
.sv-help-btn:hover, .sv-help-btn.sv-on { background: #3b6fd4; border-color: #3b6fd4; color: #fff; }

.sv-help {
    position: fixed; z-index: 10001; display: none; width: 300px; max-height: 72vh;
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

export class DebugOverlay {
    public onFocusIn: () => void = null;

    private _root: HTMLElement = null;
    private _cursorInside = false;

    public get root (): HTMLElement { return this._root; }
    public get cursorInside (): boolean { return this._cursorInside; }

    public get available (): boolean {
        return typeof document !== 'undefined';
    }

    public mount (): HTMLElement {
        if (!this.available || this._root) return this._root;

        ensureStyles();

        this._root = document.createElement('div');
        this._root.className = 'sv-root';
        // focusin bubbles and is unaffected by pointer-events, so it can live on the
        // root; hover has to be tracked per card (see `card`).
        this._root.addEventListener('focusin', this._focusIn);
        document.body.appendChild(this._root);
        return this._root;
    }

    public unmount () {
        if (!this._root) return;
        this._root.removeEventListener('focusin', this._focusIn);
        this._root.remove();
        this._root = null;
        this._cursorInside = false;
    }

    public card (title: string, className: string): { card: HTMLElement; body: HTMLElement } {
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
        this._root.appendChild(card);
        return { card, body };
    }

    private _enter = () => { this._cursorInside = true; };
    private _leave = () => { this._cursorInside = false; };
    private _focusIn = () => { this.onFocusIn?.(); };
}
