import { consoleLog, LogEntry, LogLevel } from './ConsoleCapture';
import { ensureStyles } from './DebugOverlay';

const OPEN_KEY = 'scene-view-console-open';

/** Rows kept in the page. Older ones are dropped from the top, which is where nobody is looking. */
const MAX_ROWS = 400;

/** Within this many pixels of the bottom counts as "following the log". */
const STICK_PX = 24;

const FILTERS: { level: LogLevel; label: string }[] = [
    { level: 'log', label: 'Log' },
    { level: 'warn', label: 'Warn' },
    { level: 'error', label: 'Error' },
];

/**
 * The page's console, inside the page: a button beside the help button that carries
 * the error and warning counts, and a drawer above it with the log itself.
 *
 * It exists so that reading a log does not mean opening F12, which on a small screen
 * means shrinking the game. The drawer sits between the two side panels and over the
 * bottom of the views; it is closed until asked for, and the button keeps counting,
 * so an error is noticed without it being open.
 *
 * DOM like the other panels, so clickable in a browser and not in the editor Preview.
 */
export class ConsolePanel {
    /** Called after the panel was clicked, so the owner can give the canvas keyboard focus back. */
    public onInteract: () => void = null;
    /** Called when the drawer opens or closes, so the owner can make the views give up or take back its space. */
    public onToggle: () => void = null;

    private _button: HTMLElement = null;
    private _errBadge: HTMLElement = null;
    private _warnBadge: HTMLElement = null;
    private _drawer: HTMLElement = null;
    private _body: HTMLElement = null;
    private _filterButtons = new Map<LogLevel, HTMLElement>();
    private _filterCounts = new Map<LogLevel, HTMLElement>();
    private _rows = new Map<number, { row: HTMLElement; count: HTMLElement; shown: number }>();
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
        this._button.title = 'Console (L)';
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
            btn.title = `Show or hide ${text.toLowerCase()} messages`;
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
        head.appendChild(this._action('Copy', 'Copy the shown messages to the clipboard', () => this._copy()));
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
        this._flushTimer = 0;
        this._button?.remove();
        this._drawer?.remove();
        this._button = null;
        this._drawer = null;
        this._body = null;
        this._errBadge = null;
        this._warnBadge = null;
        this._filterButtons.clear();
        this._filterCounts.clear();
        this._rows.clear();
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
        const height = Math.max(140, Math.min(canvas.height * 0.3, 360));

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
        const stick = this._atBottom();
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

        const time = document.createElement('span');
        time.className = 'sv-log-time';
        time.textContent = clock(entry.time);

        const message = document.createElement('span');
        message.className = 'sv-log-msg';
        message.textContent = entry.text;

        const count = document.createElement('span');
        count.className = 'sv-log-count';

        row.appendChild(time);
        row.appendChild(message);
        row.appendChild(count);
        this._body.appendChild(row);

        const record = { row, count, shown: 0 };
        this._rows.set(entry.id, record);
        this._updateCount(record, entry);
    }

    private _updateCount (record: { row: HTMLElement; count: HTMLElement; shown: number }, entry: LogEntry) {
        if (record.shown === entry.count) return;
        record.shown = entry.count;
        record.count.textContent = entry.count > 1 ? String(entry.count) : '';
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

    private _copy () {
        const lines = consoleLog.entries
            .filter((entry) => this._shown[entry.level])
            .map((entry) => `${clock(entry.time)} [${entry.level}] ${entry.text}${entry.count > 1 ? ` (x${entry.count})` : ''}`);
        const text = lines.join('\n');
        try {
            void navigator.clipboard?.writeText(text);
        } catch {
            // Clipboard access can be refused outside a secure context; nothing else to try.
        }
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

function clock (ms: number): string {
    const d = new Date(ms);
    // No String.padStart: the projects this is dropped into may target an older library.
    const pad = (n: number, width = 2) => {
        let text = String(n);
        while (text.length < width) text = `0${text}`;
        return text;
    };
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}
