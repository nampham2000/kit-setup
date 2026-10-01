import { Camera, game } from 'cc';
import { ensureStyles } from './DebugOverlay';
import { cameraPixelSize } from './ScenePicker';
import { STATUS_TIP, TEXT_SIZE_TIP } from './Tips';
import { tip } from './Tooltip';
import { fontSize } from './UiScale';

/** What the round button shows. One constant so the symbol is trivial to change. */
const ICON = '!';

export interface HelpToggle {
    label: string;
    /** The keyboard shortcut shown on the row, or '' when there is none. */
    key: string;
    get: () => boolean;
    set: (on: boolean) => void;
    /** What it does, shown on hover. A heading, a line break, then the explanation. */
    tip?: string;
}

interface ShortcutRow {
    keys: string;
    text: string;
    /** What it does, shown on hover. A heading, a line break, then the explanation. */
    tip?: string;
}

const SHORTCUTS: { title: string; rows: ShortcutRow[] }[] = [
    {
        title: 'Tools',
        rows: [
            { keys: '1', text: 'Move', tip: 'Move tool (1)\nDrag an arrow to move the selected node along that axis. Red is X, green is Y, blue is Z.' },
            { keys: '2', text: 'Rotate', tip: 'Rotate tool (2)\nDrag a ring to turn the selected node around that axis.' },
            { keys: '3', text: 'Scale', tip: 'Scale tool (3)\nDrag a handle to stretch the selected node along that axis.' },
            { keys: '4', text: 'No gizmo', tip: 'No gizmo (4)\nHide the handles, so a click only selects and cannot grab anything by accident.' },
            { keys: '5', text: 'Collider: drag its handles', tip: 'Collider tool (5)\nShows handles on the selected node\'s collider. Drag one to resize the shape; the opposite side stays where it is.' },
        ],
    },
    {
        title: 'Select and focus',
        rows: [
            { keys: 'Click', text: 'Select', tip: 'Select\nClick an object in the scene view to select it. It is highlighted in the Hierarchy and shown in the Inspector.' },
            { keys: '2x Click', text: 'Fly to the object', tip: 'Fly to the object\nDouble-click an object and the scene camera flies to it.' },
            { keys: 'F', text: 'Fly to the selection', tip: 'Fly to the selection\nFrame the selected node, keeping the direction you are looking in.' },
            { keys: 'Esc', text: 'Deselect', tip: 'Deselect\nClear the selection.' },
        ],
    },
    {
        title: 'Camera',
        rows: [
            { keys: 'RMB', text: 'Look around (hold)', tip: 'Look around\nHold the right mouse button in the scene view and move the mouse to turn the camera.' },
            { keys: 'W A S D', text: 'Move', tip: 'Fly\nW forward, S back, A left, D right, relative to where the camera looks. The scene view needs keyboard focus: click it first.' },
            { keys: 'Q E', text: 'Down / up', tip: 'Down / up\nMove the camera straight down (Q) or up (E).' },
            { keys: 'Shift', text: 'Move faster', tip: 'Move faster\nHold it while flying to go several times faster.' },
            { keys: 'MMB', text: 'Pan (hold)', tip: 'Pan\nHold the middle mouse button and drag to slide the camera sideways.' },
            { keys: 'Wheel', text: 'Dolly', tip: 'Dolly\nScroll to move the camera forward or back.' },
        ],
    },
    {
        title: 'Edit',
        rows: [
            { keys: 'Ctrl Z', text: 'Undo', tip: 'Undo\nTake back the last edit: a gizmo drag, an Inspector change, a created or deleted node.' },
            { keys: 'Ctrl Y', text: 'Redo (also Ctrl Shift Z)', tip: 'Redo\nPut back what Undo took away.' },
            { keys: 'Ctrl C / V', text: 'Copy / paste the selected node', tip: 'Copy and paste\nCopy the selected node, then paste a fresh copy of it under the selection.' },
            { keys: 'Delete', text: 'Delete the selected node', tip: 'Delete\nRemove the selected node from the scene. Undo brings it back.' },
            { keys: 'Right-click', text: 'Node menu, in the Hierarchy', tip: 'Node menu\nRight-click a row in the Hierarchy for Create, Copy, Paste, Duplicate, Delete and Copy UUID / PATH.' },
        ],
    },
    {
        title: 'Panel',
        rows: [
            { keys: 'H', text: 'Show or hide this panel', tip: 'Help panel\nShow or hide this panel.' },
            { keys: 'L', text: 'Show or hide the console', tip: 'Console\nShow or hide the log drawer at the bottom.' },
            { keys: 'F1', text: 'Close the scene view', tip: 'Close the scene view\nGo back to the plain game. Press F1 again to open it.' },
        ],
    },
];

/**
 * One round button that opens a single panel holding every shortcut and every
 * on/off switch, replacing the long hint line that used to run along the bottom
 * of the window and sat across both viewports.
 *
 * It is DOM, so clicks work in a browser and do not in the editor Preview, which
 * delivers no DOM events to the page. The keys always work, so nothing here is
 * the only way to do a thing: the panel also opens with H, and each switch has a
 * key of its own. In the editor the rows are shown but not clickable, and the
 * panel says why.
 */
export class HelpPanel {
    public toggles: HelpToggle[] = [];
    public status: () => string = () => '';
    /** Called after the panel was clicked, so the owner can give the canvas keyboard focus back. */
    public onInteract: () => void = null;
    /** Called with -1 or +1 when the text size buttons are pressed. */
    public onFontSize: (delta: number) => void = null;

    private _button: HTMLElement = null;
    private _panel: HTMLElement = null;
    private _statusEl: HTMLElement = null;
    private _sizeEl: HTMLElement = null;
    private _rows: { toggle: HelpToggle; switchEl: HTMLElement }[] = [];
    private _open = false;
    private _inside = false;
    private _camera: Camera = null;
    private _fraction = 0.5;

    public get isOpen (): boolean { return this._open; }

    /** True while the pointer is over the button or the panel. */
    public get cursorInside (): boolean { return this._inside; }

    public mount (clickable: boolean) {
        if (typeof document === 'undefined' || this._button) return;
        ensureStyles();

        this._button = document.createElement('div');
        this._button.className = 'sv-help-btn';
        this._button.textContent = ICON;
        this._button.title = 'Scene view: shortcuts and switches (H)';
        this._button.addEventListener('click', () => {
            this.toggle();
            this.onInteract?.();
        });
        this._track(this._button);

        this._panel = document.createElement('div');
        this._panel.className = 'sv-help';
        this._track(this._panel);

        if (!clickable) {
            const note = document.createElement('div');
            note.className = 'sv-help-note';
            note.textContent = 'The editor Preview sends no clicks to the page, so use the keys. '
                + 'Clicking these switches works in a browser.';
            this._panel.appendChild(note);
        }

        this._statusEl = document.createElement('div');
        this._statusEl.className = 'sv-help-status';
        tip(this._statusEl, STATUS_TIP);
        this._panel.appendChild(this._statusEl);

        this._panel.appendChild(heading('Switches'));
        this._rows = [];
        for (const toggle of this.toggles) {
            const row = document.createElement('div');
            row.className = 'sv-help-row sv-toggle-row' + (clickable ? '' : ' sv-static');
            if (toggle.tip) tip(row, toggle.tip);

            const switchEl = document.createElement('div');
            switchEl.className = 'sv-switch';
            row.appendChild(switchEl);
            row.appendChild(text(toggle.label));
            if (toggle.key) row.appendChild(keycap(toggle.key));

            if (clickable) {
                row.addEventListener('click', () => {
                    toggle.set(!toggle.get());
                    this.refresh();
                    this.onInteract?.();
                });
            }
            this._panel.appendChild(row);
            this._rows.push({ toggle, switchEl });
        }

        this._panel.appendChild(heading('Text size'));
        this._panel.appendChild(this._sizeRow(clickable));

        for (const section of SHORTCUTS) {
            this._panel.appendChild(heading(section.title));
            for (const shortcut of section.rows) {
                const row = document.createElement('div');
                row.className = 'sv-help-row';
                if (shortcut.tip) tip(row, shortcut.tip);
                row.appendChild(keycap(shortcut.keys));
                row.appendChild(text(shortcut.text));
                this._panel.appendChild(row);
            }
        }

        document.body.appendChild(this._button);
        document.body.appendChild(this._panel);
        this.refresh();
        this._apply();
    }

    public unmount () {
        this._button?.remove();
        this._panel?.remove();
        this._button = null;
        this._panel = null;
        this._statusEl = null;
        this._sizeEl = null;
        this._rows = [];
        this._open = false;
        this._inside = false;
    }

    /** Where the round button is on screen, or null before it is mounted. */
    public buttonRect (): DOMRect | null {
        return this._button ? this._button.getBoundingClientRect() : null;
    }

    public toggle () { this.setOpen(!this._open); }

    public setOpen (open: boolean) {
        this._open = open;
        this._apply();
        if (open) this.refresh();
    }

    /** Bring the switches and the status line in step with the tool's real state. */
    public refresh () {
        if (!this._panel) return;
        if (this._statusEl) this._statusEl.textContent = this.status();
        if (this._sizeEl) this._sizeEl.textContent = `${fontSize()}px`;
        for (const { toggle, switchEl } of this._rows) {
            switchEl.classList.toggle('sv-on', toggle.get());
        }
    }

    /**
     * Keep the button at the bottom-left of the scene viewport, which moves when the
     * divider is dragged. Camera pixels are converted to CSS pixels through the canvas
     * rect, so this stays right when the canvas is scaled.
     */
    public sync (camera: Camera, fraction: number) {
        this._camera = camera;
        this._fraction = fraction;
        if (!this._button || !camera) return;

        const canvas = game.canvas as HTMLCanvasElement;
        const rect = canvas?.getBoundingClientRect?.();
        if (!rect) return;

        const size = cameraPixelSize(camera);
        if (size.width <= 0 || size.height <= 0) return;

        const left = rect.left + size.width * this._fraction * (rect.width / size.width) + 8;
        // Measured, not assumed: the button grows with the text size.
        const top = rect.bottom - (this._button.offsetHeight || 26) - 8;

        this._button.style.left = `${left}px`;
        this._button.style.top = `${top}px`;
        this._panel.style.left = `${left}px`;
        // Anchored by its bottom edge so it grows upwards from the button.
        this._panel.style.bottom = `${window.innerHeight - top + 6}px`;
    }

    /** The A- and A+ buttons: make every panel smaller or larger. The keys [ and ] do the same. */
    private _sizeRow (clickable: boolean): HTMLElement {
        const row = document.createElement('div');
        row.className = 'sv-help-row';

        const button = (label: string, title: string, delta: number) => {
            const el = document.createElement('button');
            el.className = 'sv-size-btn' + (clickable ? '' : ' sv-static');
            el.textContent = label;
            el.title = title;
            if (clickable) {
                el.addEventListener('click', () => {
                    this.onFontSize?.(delta);
                    this.onInteract?.();
                });
            }
            return el;
        };

        tip(row, TEXT_SIZE_TIP);
        row.appendChild(button('A-', 'Smaller text ( [ )', -1));
        this._sizeEl = document.createElement('span');
        this._sizeEl.className = 'sv-size-value';
        this._sizeEl.textContent = `${fontSize()}px`;
        row.appendChild(this._sizeEl);
        row.appendChild(button('A+', 'Larger text ( ] )', 1));
        row.appendChild(keycap('[ ]'));
        return row;
    }

    private _apply () {
        this._panel?.classList.toggle('sv-open', this._open);
        this._button?.classList.toggle('sv-on', this._open);
    }

    /** The pointer over either element must not reach the scene underneath. */
    private _track (el: HTMLElement) {
        el.addEventListener('mouseenter', () => { this._inside = true; });
        el.addEventListener('mouseleave', () => { this._inside = false; });
    }
}

function heading (title: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'sv-help-title';
    el.textContent = title;
    return el;
}

function text (value: string): HTMLElement {
    const el = document.createElement('span');
    el.className = 'sv-help-text';
    el.textContent = value;
    return el;
}

function keycap (value: string): HTMLElement {
    const el = document.createElement('span');
    el.className = 'sv-keycap';
    el.textContent = value;
    return el;
}
