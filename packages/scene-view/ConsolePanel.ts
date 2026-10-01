import { copyText } from './Clipboard';
import { consoleLog, LogEntry, LogLevel } from './ConsoleCapture';
import { ContextMenu, MenuItem } from './ContextMenu';
import { ensureStyles } from './DebugOverlay';
import { clock, formatLine, formatMessage, LogSelection } from './LogText';
import { CONSOLE_TIPS } from './Tips';
import { tip } from './Tooltip';

const OPEN_KEY = 'scene-view-console-open';

/** Rows kept in the page. Older ones are dropped from the top, which is where nobody is looking. */
const MAX_ROWS = 400;

/** Within this many pixels of the bottom counts as "following the log". */
const STICK_PX = 24;

/** How long a "Copied" note stays up, in milliseconds. */
const NOTE_MS = 1800;

const FILTERS: { level: LogLevel; label: string }[] = [
    { level: 'log', label: 'Log' },
    { level: 'warn', label: 'Warn' },
    { level: 'error', label: 'Error' },
];

interface Row {
    row: HTMLElement;
    count: HTMLElement;
    shown: number;
    entry: LogEntry;
}

/**
 * The page's console, inside the page: a button beside the help button that carries
 * the error and warning counts, and a drawer above it with the log itself.
 *
 * It exists so that reading a log does not mean opening F12, which on a small screen
 * means shrinking the game. The drawer sits between the two side panels and over the
 * bottom of the views; it is closed until asked for, and the button keeps counting,
 * so an error is noticed without it being open.
 *
 * Lines can be picked (click, Ctrl-click, Shift-click) and copied: with Ctrl+C, with the
 * Copy button, from a button on each line, or from the right-click menu. Text can still
 * be selected with the mouse like on any page.
 *
 * DOM like the other panels, so clickable in a browser and not in the editor Preview.
 */
export class ConsolePanel {
    /** Called after the panel was clicked, so the owner can give the canvas keyboard focus back. */
    public onInteract: () => void = null;
    /** Called when the drawer opens or closes, so the owner can make the views give up or take back its space. */
    public onToggle: () => void = null;
    /** The menu to use for a right-click on a line. Without one, the browser's own menu appears. */
    public menu: ContextMenu = null;

    private _button: HTMLElement = null;
    private _errBadge: HTMLElement = null;
    private _warnBadge: HTMLElement = null;
    private _drawer: HTMLElement = null;
    private _body: HTMLElement = null;
    private _copyButton: HTMLElement = null;
    private _note: HTMLElement = null;
    private _hidden: HTMLElement = null;
    private _noteTimer = 0;
    private _filterButtons = new Map<LogLevel, HTMLElement>();
    private _filterCounts = new Map<LogLevel, HTMLElement>();
    private _rows = new Map<number, Row>();
    private _picked = new LogSelection();
    private _shown: Record<LogLevel, boolean> = { log: true, warn: true, error: true };
    private _open = false;
    private _inside = false;
    private _unsubscribe: () => void = null;
    private _flushTimer = 0;
    private _lastId = 0;
    private _generation = 0;
    private _reserved = 0;

    public get isOpen (): boolean { return this._open; }

    /**
     * How many pixels at the bottom of the canvas the drawer takes, or 0 when it is
     * closed. The views are laid out above this rather than drawn underneath it.
     */
    public get reservedBottom (): number { return this._reserved; }

    /** True while the pointer is over the button or the drawer. */
    public get cursorInside (): boolean { return this._inside; }

    public mount () {
        if (typeof document === 'undefined' || this._button) return;
        ensureStyles();

        this._button = document.createElement('div');
        this._button.className = 'sv-log-btn';
        tip(this._button, CONSOLE_TIPS.button);
        const label = document.createElement('span');
        label.textContent = 'Console';
        this._errBadge = badge('sv-badge-err');
        this._warnBadge = badge('sv-badge-warn');
        this._button.appendChild(label);
        this._button.appendChild(this._errBadge);
        this._button.appendChild(this._warnBadge);
        this._button.addEventListener('click', () => {
            this.toggle();
            this.onInteract?.();
        });
        this._track(this._button);

        this._drawer = document.createElement('div');
        this._drawer.className = 'sv-console';
        // Focusable, so Ctrl+C and Ctrl+A reach it once a line has been clicked.
        this._drawer.tabIndex = 0;
        this._drawer.addEventListener('keydown', (e) => this._onKey(e));
        this._track(this._drawer);

        const head = document.createElement('div');
        head.className = 'sv-console-head';
        const title = document.createElement('span');
        title.className = 'sv-console-title';
        title.textContent = 'Console';
        head.appendChild(title);

        for (const { level, label: text } of FILTERS) {
            const btn = document.createElement('button');
            btn.className = `sv-chip-btn sv-on sv-lvbtn-${level}`;
            tip(btn, CONSOLE_TIPS[level]);
            btn.appendChild(document.createTextNode(`${text} `));
            const count = document.createElement('span');
            btn.appendChild(count);
            btn.addEventListener('click', () => {
                this._shown[level] = !this._shown[level];
                this._rebuild();
                this.onInteract?.();
            });
            head.appendChild(btn);
            this._filterButtons.set(level, btn);
            this._filterCounts.set(level, count);
        }

        const spacer = document.createElement('span');
        spacer.className = 'sv-console-spacer';
        head.appendChild(spacer);

        this._hidden = document.createElement('span');
        this._hidden.className = 'sv-console-hidden';
        this._hidden.style.display = 'none';
        this._hidden.title = 'Errors thrown by browser extensions (their URLs start with chrome-extension://) are left out: '
            + 'they come from the browser, not from the game. Press Clear to reset the count.';
        head.appendChild(this._hidden);

        this._note = document.createElement('span');
        this._note.className = 'sv-console-note';
        head.appendChild(this._note);

        this._copyButton = this._action('Copy all', '', () => this._copyPrimary());
        head.appendChild(this._copyButton);
        head.appendChild(this._action('Clear', 'Remove every message', () => consoleLog.clear()));
        head.appendChild(this._action('×', 'Close (L)', () => this.setOpen(false)));
        this._drawer.appendChild(head);

        this._body = document.createElement('div');
        this._body.className = 'sv-console-body';
        this._drawer.appendChild(this._body);

        document.body.appendChild(this._button);
        document.body.appendChild(this._drawer);

        try {
            this._open = globalThis.localStorage?.getItem(OPEN_KEY) === '1';
        } catch {
            this._open = false;
        }

        this._unsubscribe = consoleLog.subscribe(() => this._schedule());
        this._rebuild();
        this._apply();
    }

    public unmount () {
        this._unsubscribe?.();
        this._unsubscribe = null;
        window.clearTimeout(this._flushTimer);
        window.clearTimeout(this._noteTimer);
        this._flushTimer = 0;
        this._noteTimer = 0;
        this._button?.remove();
        this._drawer?.remove();
        this._button = null;
        this._drawer = null;
        this._body = null;
        this._copyButton = null;
        this._note = null;
        this._hidden = null;
        this._errBadge = null;
        this._warnBadge = null;
        this._filterButtons.clear();
        this._filterCounts.clear();
        this._rows.clear();
        this._picked.clear();
        this._inside = false;
        this._lastId = 0;
        this._reserved = 0;
    }

    public toggle () { this.setOpen(!this._open); }

    public setOpen (open: boolean) {
        this._open = open;
        try {
            globalThis.localStorage?.setItem(OPEN_KEY, open ? '1' : '0');
        } catch {
            // Not remembered; still applies for this session.
        }
        this._apply();
        if (open && this._body) this._body.scrollTop = this._body.scrollHeight;
        if (!open) this._reserved = 0;
        this.onToggle?.();
    }

    /**
     * Place the button after the help button and the drawer above both.
     *
     * `canvas` is the canvas rect, the insets are the share of its width the side
     * panels cover, and `anchor` is the help button. The drawer fills what is left
     * between the panels.
     */
    public sync (canvas: DOMRect, insetLeft: number, insetRight: number, anchor: DOMRect | null) {
        if (!this._button || !anchor) return;

        this._button.style.left = `${anchor.right + 6}px`;
        this._button.style.top = `${anchor.top + (anchor.height - this._button.offsetHeight) / 2}px`;

        const left = canvas.left + canvas.width * insetLeft;
        const right = canvas.right - canvas.width * insetRight;
        const width = Math.max(right - left, Math.min(canvas.width, 240));
        const height = Math.max(110, Math.min(canvas.height * 0.21, 260));

        this._drawer.style.left = `${left}px`;
        this._drawer.style.width = `${width}px`;
        this._drawer.style.height = `${height}px`;
        // Above the button row rather than behind it.
        this._drawer.style.bottom = `${window.innerHeight - anchor.top + 8}px`;

        // The drawer's top edge, measured from the canvas bottom: what the views must leave free.
        const drawerTop = anchor.top - 8 - height;
        this._reserved = this._open ? Math.max(0, canvas.bottom - drawerTop) : 0;
    }

    private _apply () {
        this._drawer?.classList.toggle('sv-open', this._open);
        this._button?.classList.toggle('sv-on', this._open);
    }

    private _action (label: string, title: string, run: () => void): HTMLElement {
        const btn = document.createElement('button');
        btn.className = 'sv-chip-btn';
        btn.textContent = label;
        btn.title = title;
        btn.addEventListener('click', () => {
            run();
            this.onInteract?.();
        });
        return btn;
    }

    /** Several messages can arrive in one frame; one update per short interval is enough. */
    private _schedule () {
        if (this._flushTimer || !this._body) return;
        this._flushTimer = window.setTimeout(() => {
            this._flushTimer = 0;
            this._flush();
        }, 80);
    }

    private _flush () {
        if (!this._body) return;

        // Cleared: the rows describe entries that no longer exist, so start again.
        if (this._generation !== consoleLog.generation) {
            this._rebuild();
            return;
        }

        const entries = consoleLog.entries;
        // Do not scroll the log away from someone who is reading or selecting in it.
        const stick = this._atBottom() && this._picked.size === 0 && !this._hasTextSelection();
        for (const entry of entries) {
            const known = this._rows.get(entry.id);
            if (known) {
                this._updateCount(known, entry);
            } else if (entry.id > this._lastId && this._shown[entry.level]) {
                this._append(entry);
            }
        }
        this._lastId = entries.length ? entries[entries.length - 1].id : 0;
        this._trim();
        if (stick) this._body.scrollTop = this._body.scrollHeight;
        this._refreshCounts();
    }

    private _rebuild () {
        if (!this._body) return;
        this._body.textContent = '';
        this._rows.clear();
        if (this._generation !== consoleLog.generation) this._picked.clear();
        this._generation = consoleLog.generation;

        const entries = consoleLog.entries;
        for (const entry of entries) {
            if (this._shown[entry.level]) this._append(entry);
        }
        this._lastId = entries.length ? entries[entries.length - 1].id : 0;

        if (!this._body.firstChild) {
            const empty = document.createElement('div');
            empty.className = 'sv-log-empty';
            empty.textContent = entries.length ? 'Every level is switched off.' : 'Nothing logged yet.';
            this._body.appendChild(empty);
        }
        this._trim();
        this._picked.retain(this._order());
        this._paint();
        this._body.scrollTop = this._body.scrollHeight;
        this._refreshCounts();
        for (const [level, btn] of this._filterButtons) btn.classList.toggle('sv-on', this._shown[level]);
    }

    private _append (entry: LogEntry) {
        // The placeholder goes away with the first real row.
        const placeholder = this._body.querySelector('.sv-log-empty');
        if (placeholder) placeholder.remove();

        const row = document.createElement('div');
        row.className = `sv-log-row sv-lv-${entry.level}`;
        row.dataset.id = String(entry.id);

        const time = document.createElement('span');
        time.className = 'sv-log-time';
        tip(time, CONSOLE_TIPS.time);
        time.textContent = clock(entry.time);

        const message = document.createElement('span');
        message.className = 'sv-log-msg';
        message.textContent = entry.text;

        const count = document.createElement('span');
        count.className = 'sv-log-count';

        const copy = document.createElement('button');
        copy.className = 'sv-log-copy';
        copy.textContent = 'Copy';
        copy.title = 'Copy this line';
        copy.addEventListener('click', (e) => {
            e.stopPropagation();
            this._copy(formatLine(entry), '1 line');
            copy.textContent = 'Copied';
            window.setTimeout(() => { copy.textContent = 'Copy'; }, NOTE_MS / 2);
        });

        row.appendChild(time);
        row.appendChild(message);
        row.appendChild(count);
        row.appendChild(copy);

        row.addEventListener('click', (e) => this._onRowClick(entry, e));
        row.addEventListener('contextmenu', (e) => this._onRowMenu(entry, e));

        this._body.appendChild(row);

        const record: Row = { row, count, shown: 0, entry };
        this._rows.set(entry.id, record);
        this._updateCount(record, entry);
        if (this._picked.has(entry.id)) row.classList.add('sv-picked');
    }

    private _updateCount (record: Row, entry: LogEntry) {
        if (record.shown === entry.count) return;
        record.shown = entry.count;
        record.count.textContent = entry.count > 1 ? String(entry.count) : '';
        tip(record.count, CONSOLE_TIPS.repeated(entry.count));
        record.count.style.display = entry.count > 1 ? '' : 'none';
    }

    private _trim () {
        while (this._body.childElementCount > MAX_ROWS) {
            const oldest = this._body.firstElementChild;
            if (!oldest) break;
            oldest.remove();
        }
        // Forget rows that are gone, so the map does not grow without bound.
        if (this._rows.size > MAX_ROWS * 2) {
            for (const [id, record] of this._rows) {
                if (!record.row.isConnected) this._rows.delete(id);
            }
        }
    }

    private _refreshCounts () {
        const counts = consoleLog.counts;
        for (const [level, el] of this._filterCounts) el.textContent = String(counts[level]);

        if (this._hidden) {
            const n = consoleLog.ignored;
            this._hidden.textContent = `${n} from extensions hidden`;
            this._hidden.style.display = n ? '' : 'none';
        }

        if (this._errBadge) {
            this._errBadge.textContent = String(counts.error);
            this._errBadge.style.display = counts.error ? '' : 'none';
        }
        if (this._warnBadge) {
            this._warnBadge.textContent = String(counts.warn);
            this._warnBadge.style.display = counts.warn ? '' : 'none';
        }
    }

    private _atBottom (): boolean {
        const body = this._body;
        return body.scrollTop + body.clientHeight >= body.scrollHeight - STICK_PX;
    }

    // --- picking and copying lines --------------------------------------------

    /** The ids of the rows on screen, top to bottom. */
    private _order (): number[] {
        const ids: number[] = [];
        const children = this._body.children;
        for (let i = 0; i < children.length; i++) {
            // The "nothing logged" placeholder has no id and is not a line.
            const raw = (children[i] as HTMLElement).dataset.id;
            if (raw !== undefined) ids.push(Number(raw));
        }
        return ids;
    }

    private _paint () {
        for (const [id, record] of this._rows) record.row.classList.toggle('sv-picked', this._picked.has(id));
        if (this._copyButton) {
            const n = this._picked.size;
            this._copyButton.textContent = n ? `Copy (${n})` : 'Copy all';
            this._copyButton.title = n
                ? `Copy the ${n} picked line${n === 1 ? '' : 's'} (Ctrl+C)`
                : 'Copy every shown line. Click a line to pick it first.';
        }
    }

    /** Text the user has dragged over in the log, as opposed to rows picked by clicking. */
    private _hasTextSelection (): boolean {
        const selection = typeof window !== 'undefined' && window.getSelection ? window.getSelection() : null;
        if (!selection || selection.isCollapsed || !selection.anchorNode || !this._body) return false;
        return this._body.contains(selection.anchorNode);
    }

    private _onRowClick (entry: LogEntry, e: MouseEvent) {
        // The end of a drag that selected text is not a click on the row.
        if (this._hasTextSelection()) return;
        this._picked.click(entry.id, this._order(), e.ctrlKey || e.metaKey, e.shiftKey);
        this._paint();
        // Keep the keyboard here, for Ctrl+C. Not handed back to the canvas, which would take it away.
        this._drawer.focus({ preventScroll: true });
    }

    private _onRowMenu (entry: LogEntry, e: MouseEvent) {
        if (!this.menu) return; // No menu of ours: leave the browser's.
        e.preventDefault();
        e.stopPropagation();

        // Like a file list: right-clicking something outside the pick picks it instead.
        if (!this._picked.has(entry.id)) {
            this._picked.click(entry.id, this._order(), false, false);
            this._paint();
        }
        const n = this._picked.size;
        const items: MenuItem[] = [
            { label: 'Copy line', run: () => this._copy(formatLine(entry), '1 line') },
            { label: 'Copy message only', run: () => this._copy(formatMessage(entry), 'message') },
            { label: n > 1 ? `Copy ${n} picked lines` : 'Copy picked line', shortcut: 'Ctrl+C', run: () => this._copyPicked() },
            { label: 'Copy all shown', run: () => this._copyAll() },
            { separator: true },
            { label: 'Select all', shortcut: 'Ctrl+A', run: () => this._selectAll() },
            { label: 'Clear console', run: () => consoleLog.clear() },
        ];
        this.menu.open(e.clientX, e.clientY, items);
    }

    private _onKey (e: KeyboardEvent) {
        const ctrl = e.ctrlKey || e.metaKey;
        const key = e.key.toLowerCase();
        // With text dragged over, Ctrl+C is the browser's and copies exactly that.
        if (ctrl && key === 'c' && this._picked.size > 0 && !this._hasTextSelection()) {
            e.preventDefault();
            this._copyPicked();
        } else if (ctrl && key === 'a') {
            e.preventDefault();
            this._selectAll();
        } else if (key === 'escape' && this._picked.size > 0) {
            this._picked.clear();
            this._paint();
        }
    }

    private _selectAll () {
        this._picked.selectAll(this._order());
        this._paint();
    }

    /** The picked lines if there are any, otherwise every shown line. What the Copy button does. */
    private _copyPrimary () {
        if (this._picked.size > 0) this._copyPicked();
        else this._copyAll();
    }

    private _copyPicked () {
        const wanted = new Set(this._picked.inOrder(this._order()));
        const lines = consoleLog.entries.filter((entry) => wanted.has(entry.id)).map(formatLine);
        this._copy(lines.join('\n'), `${lines.length} line${lines.length === 1 ? '' : 's'}`);
    }

    private _copyAll () {
        const lines = consoleLog.entries.filter((entry) => this._shown[entry.level]).map(formatLine);
        this._copy(lines.join('\n'), `${lines.length} line${lines.length === 1 ? '' : 's'}`);
    }

    private _copy (text: string, what: string) {
        if (!text) {
            this._say('Nothing to copy');
            return;
        }
        this._say(copyText(text) ? `Copied ${what}` : 'Copy failed: select the text and press Ctrl+C');
    }

    /** A short note beside the buttons that fades after a moment. */
    private _say (message: string) {
        if (!this._note) return;
        this._note.textContent = message;
        window.clearTimeout(this._noteTimer);
        this._noteTimer = window.setTimeout(() => { if (this._note) this._note.textContent = ''; }, NOTE_MS);
    }

    /** The pointer over either element must not reach the scene underneath. */
    private _track (el: HTMLElement) {
        el.addEventListener('mouseenter', () => { this._inside = true; });
        el.addEventListener('mouseleave', () => { this._inside = false; });
    }
}

function badge (className: string): HTMLElement {
    const el = document.createElement('span');
    el.className = `sv-badge ${className}`;
    el.style.display = 'none';
    return el;
}
