import { ensureStyles } from './DebugOverlay';

export interface EditToolbarCallbacks {
    /** Open the Create menu with its corner at this point, in CSS pixels. */
    onOpenCreateMenu: (x: number, y: number) => void;
    onDuplicate: () => void;
    onDelete: () => void;
    onUndo: () => void;
    onRedo: () => void;
}

/**
 * The row of edit buttons at the top of the Hierarchy: New (which opens the same menu as
 * a right-click), Duplicate, Delete, and Undo / Redo.
 *
 * Undo and Redo are here as well as on Ctrl+Z and Ctrl+Y so a click-only workflow has
 * them too, and their tooltips say what they would undo. DOM, so browser only, like the
 * panel it sits in.
 */
export class EditToolbar {
    private _bar: HTMLElement = null;
    private _buttons = new Map<string, HTMLButtonElement>();

    constructor (private _callbacks: EditToolbarCallbacks) {}

    /** Insert the toolbar between a card's title and its body. */
    public mount (body: HTMLElement) {
        if (typeof document === 'undefined' || this._bar || !body || !body.parentElement) return;
        ensureStyles();

        this._bar = document.createElement('div');
        this._bar.className = 'sv-toolbar';

        this._bar.appendChild(this._button('new', 'New ▾', 'Create a node (or right-click in the list)', (e) => {
            const anchor = (e.currentTarget as HTMLElement).getBoundingClientRect();
            this._callbacks.onOpenCreateMenu(anchor.left, anchor.bottom + 4);
        }));
        this._bar.appendChild(this._button('duplicate', 'Duplicate', 'Duplicate the selected node', () => this._callbacks.onDuplicate()));
        this._bar.appendChild(this._button('delete', 'Delete', 'Delete the selected node (Delete key)', () => this._callbacks.onDelete()));

        const spacer = document.createElement('span');
        spacer.className = 'sv-console-spacer';
        this._bar.appendChild(spacer);

        this._bar.appendChild(this._button('undo', '↶', 'Undo (Ctrl+Z)', () => this._callbacks.onUndo()));
        this._bar.appendChild(this._button('redo', '↷', 'Redo (Ctrl+Y)', () => this._callbacks.onRedo()));

        body.parentElement.insertBefore(this._bar, body);
        this.setState({ hasSelection: false, undoLabel: '', redoLabel: '' });
    }

    public unmount () {
        this._bar?.remove();
        this._bar = null;
        this._buttons.clear();
    }

    /** Enable or disable the buttons to match what can be done right now. */
    public setState (state: { hasSelection: boolean; undoLabel: string; redoLabel: string }) {
        const set = (name: string, enabled: boolean, title?: string) => {
            const btn = this._buttons.get(name);
            if (!btn) return;
            btn.disabled = !enabled;
            if (title) btn.title = title;
        };
        set('duplicate', state.hasSelection);
        set('delete', state.hasSelection);
        set('undo', !!state.undoLabel, state.undoLabel ? `Undo: ${state.undoLabel} (Ctrl+Z)` : 'Nothing to undo');
        set('redo', !!state.redoLabel, state.redoLabel ? `Redo: ${state.redoLabel} (Ctrl+Y)` : 'Nothing to redo');
    }

    private _button (name: string, label: string, title: string, run: (e: MouseEvent) => void): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.className = 'sv-chip-btn';
        btn.textContent = label;
        btn.title = title;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            run(e);
        });
        // A double-click on a button is two clicks, not a request to fly to anything.
        btn.addEventListener('dblclick', (e) => e.stopPropagation());
        this._buttons.set(name, btn);
        return btn;
    }
}
