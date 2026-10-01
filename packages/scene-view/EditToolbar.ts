import { ensureStyles } from './DebugOverlay';
import { NODE_KINDS, NodeKind } from './NodeFactory';

export interface EditToolbarCallbacks {
    onCreate: (kind: NodeKind) => void;
    onDuplicate: () => void;
    onDelete: () => void;
    onUndo: () => void;
    onRedo: () => void;
}

/**
 * The row of edit buttons at the top of the Hierarchy: New (a menu of what can be
 * created), Duplicate, Delete, and Undo / Redo.
 *
 * Undo and Redo are here as well as on Ctrl+Z and Ctrl+Y so a click-only workflow has
 * them too, and their tooltips say what they would undo. DOM, so browser only, like the
 * panel it sits in.
 */
export class EditToolbar {
    /** True while the pointer is over the New menu, which lives outside the cards. */
    public get cursorInside (): boolean { return this._inside; }

    private _bar: HTMLElement = null;
    private _menu: HTMLElement = null;
    private _newButton: HTMLElement = null;
    private _buttons = new Map<string, HTMLButtonElement>();
    private _inside = false;

    constructor (private _callbacks: EditToolbarCallbacks) {}

    /** Insert the toolbar between a card's title and its body. */
    public mount (body: HTMLElement) {
        if (typeof document === 'undefined' || this._bar || !body || !body.parentElement) return;
        ensureStyles();

        this._bar = document.createElement('div');
        this._bar.className = 'sv-toolbar';

        this._newButton = this._button('new', 'New ▾', 'Create a node', (e) => this._toggleMenu(e));
        this._bar.appendChild(this._newButton);
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
        this._closeMenu();
        this._bar?.remove();
        this._bar = null;
        this._newButton = null;
        this._buttons.clear();
        this._inside = false;
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

    private _toggleMenu (e: MouseEvent) {
        if (this._menu) {
            this._closeMenu();
            return;
        }

        const menu = document.createElement('div');
        menu.className = 'sv-menu';
        menu.addEventListener('mouseenter', () => { this._inside = true; });
        menu.addEventListener('mouseleave', () => { this._inside = false; });

        let group = '';
        for (const info of NODE_KINDS) {
            if (info.group !== group) {
                group = info.group;
                const title = document.createElement('div');
                title.className = 'sv-menu-title';
                title.textContent = group;
                menu.appendChild(title);
            }
            const item = document.createElement('div');
            item.className = 'sv-menu-item';
            item.textContent = info.label;
            item.addEventListener('click', (ev) => {
                ev.stopPropagation();
                this._closeMenu();
                this._callbacks.onCreate(info.kind);
            });
            menu.appendChild(item);
        }

        document.body.appendChild(menu);
        const anchor = (e.currentTarget as HTMLElement).getBoundingClientRect();
        menu.style.left = `${anchor.left}px`;
        menu.style.top = `${anchor.bottom + 4}px`;
        this._menu = menu;

        // Any click elsewhere closes it. Registered next tick so the click that opened it does not.
        window.setTimeout(() => {
            if (this._menu === menu) document.addEventListener('mousedown', this._outside, true);
        }, 0);
    }

    private _outside = (e: Event) => {
        if (this._menu && !this._menu.contains(e.target as Node)) this._closeMenu();
    };

    private _closeMenu () {
        document.removeEventListener('mousedown', this._outside, true);
        this._menu?.remove();
        this._menu = null;
        this._inside = false;
    }
}
