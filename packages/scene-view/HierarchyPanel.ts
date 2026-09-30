import { Node } from 'cc';
import { DebugOverlay } from './DebugOverlay';
import { VisibilityController } from './VisibilityController';

const INDENT_PX = 11;

export interface HierarchyCallbacks {
    onSelect: (node: Node) => void;
    onToggleHide: (node: Node) => void;
    onToggleSolo: (node: Node) => void;
    /** Double-click on a row: fly the scene camera to the node. */
    onFocus: (node: Node) => void;
}

/**
 * Scene hierarchy as a DOM tree, with per-node hide and solo buttons.
 *
 * The tree is only rebuilt when its shape actually changes — rebuilding every
 * frame would reset the scroll position and destroy the row the cursor is on
 * mid-click.
 */
export class HierarchyPanel {
    private _body: HTMLElement = null;
    private _rows = new Map<Node, HTMLElement>();
    private _signature = '';
    private _selected: Node = null;
    private _scrollToSelected = false;

    constructor (
        private _visibility: VisibilityController,
        private _callbacks: HierarchyCallbacks,
    ) {}

    public mount (overlay: DebugOverlay) {
        this._body = overlay.card('hierarchy', 'sv-tree').body;
    }

    public unmount () {
        this._body = null;
        this._rows.clear();
        this._signature = '';
    }

    public setSelected (node: Node) {
        if (this._selected === node) return;
        this._selected = node;
        this._scrollToSelected = true;
        this._applySelection();
    }

    /** `excluded` is a layer mask; a node entirely on excluded layers is skipped. */
    public refresh (roots: readonly Node[], excluded: number, skip: Node) {
        if (!this._body) return;

        const visible: { node: Node; depth: number }[] = [];
        for (let i = 0; i < roots.length; i++) collect(roots[i], 0, visible, excluded, skip);

        const signature = visible.map((e) => `${e.depth}:${e.node.name}:${e.node.uuid}`).join('|');
        if (signature !== this._signature) {
            this._signature = signature;
            this._rebuild(visible);
        }
        this._applyState();
    }

    private _rebuild (entries: readonly { node: Node; depth: number }[]) {
        this._body.textContent = '';
        this._rows.clear();

        if (!entries.length) {
            const empty = document.createElement('div');
            empty.className = 'sv-empty';
            empty.textContent = '(no nodes)';
            this._body.appendChild(empty);
            return;
        }

        for (let i = 0; i < entries.length; i++) {
            const { node, depth } = entries[i];
            this._body.appendChild(this._row(node, depth));
        }
    }

    private _row (node: Node, depth: number): HTMLElement {
        const row = document.createElement('div');
        row.className = 'sv-row';
        row.style.paddingLeft = `${4 + depth * INDENT_PX}px`;
        row.addEventListener('click', () => this._callbacks.onSelect(node));
        row.addEventListener('dblclick', () => this._callbacks.onFocus(node));

        const name = document.createElement('span');
        name.className = 'sv-name';
        name.textContent = node.name || '(unnamed)';
        row.appendChild(name);

        if (node.children.length) {
            const count = document.createElement('span');
            count.className = 'sv-tag';
            count.textContent = String(node.children.length);
            row.appendChild(count);
        }

        row.appendChild(this._button('o', 'Hide / show', () => this._callbacks.onToggleHide(node), 'hide'));
        row.appendChild(this._button('S', 'Solo', () => this._callbacks.onToggleSolo(node), 'solo'));

        this._rows.set(node, row);
        return row;
    }

    private _button (label: string, title: string, action: () => void, role: string): HTMLElement {
        const btn = document.createElement('button');
        btn.className = 'sv-btn';
        btn.textContent = label;
        btn.title = title;
        btn.dataset.role = role;
        // A double-click on a button is two button clicks, not a request to fly there.
        btn.addEventListener('dblclick', (e) => e.stopPropagation());
        btn.addEventListener('click', (e) => {
            // Without this the row's own click handler would also select the node.
            e.stopPropagation();
            action();
        });
        return btn;
    }

    private _applyState () {
        for (const [node, row] of this._rows) {
            if (!node.isValid) continue;
            const hidden = this._visibility.isHidden(node);
            row.classList.toggle('sv-dimmed', hidden);

            const buttons = row.querySelectorAll('.sv-btn');
            for (let i = 0; i < buttons.length; i++) {
                const btn = buttons[i] as HTMLElement;
                const on = btn.dataset.role === 'hide' ? hidden : this._visibility.isSolo(node);
                btn.classList.toggle('sv-on', on);
            }
        }
        this._applySelection();
    }

    private _applySelection () {
        for (const [node, row] of this._rows) {
            const selected = node === this._selected;
            row.classList.toggle('sv-selected', selected);

            // Bring a newly chosen row into view - a pick in the viewport can land on a
            // node far down a long tree. Only once per change: doing it on every refresh
            // would drag the list back while the user is scrolling it.
            if (selected && this._scrollToSelected) {
                row.scrollIntoView?.({ block: 'nearest' });
                this._scrollToSelected = false;
            }
        }
    }
}

function collect (
    node: Node,
    depth: number,
    out: { node: Node; depth: number }[],
    excluded: number,
    skip: Node,
) {
    if (!node || !node.isValid || node === skip) return;
    // A node sitting entirely on excluded layers is editor scaffolding, not content.
    if ((node.layer & ~excluded) === 0) return;

    out.push({ node, depth });
    const children = node.children;
    for (let i = 0; i < children.length; i++) collect(children[i], depth + 1, out, excluded, skip);
}
