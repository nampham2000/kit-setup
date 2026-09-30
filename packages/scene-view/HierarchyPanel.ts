import { Camera, Light, ModelRenderer, Node, UIRenderer, UITransform } from 'cc';
import { DebugOverlay } from './DebugOverlay';
import { VisibilityController } from './VisibilityController';

/** How many distinct guide colours there are. The CSS defines sv-d0 .. sv-d5. */
const DEPTH_COLOURS = 6;

export interface HierarchyCallbacks {
    onSelect: (node: Node) => void;
    onToggleHide: (node: Node) => void;
    onToggleSolo: (node: Node) => void;
    /** Double-click on a row: fly the scene camera to the node. */
    onFocus: (node: Node) => void;
}

type Kind = 'camera' | 'light' | 'ui' | 'mesh' | 'group' | 'empty';

const KIND_TITLES: Record<Kind, string> = {
    camera: 'Camera',
    light: 'Light',
    ui: 'UI',
    mesh: 'Model',
    group: 'Group (has children)',
    empty: 'Empty node',
};

interface Entry {
    node: Node;
    depth: number;
    hasChildren: boolean;
}

/**
 * Scene hierarchy as a DOM tree, with per-node hide and solo buttons.
 *
 * Reading a long tree is mostly a matter of telling levels apart, so each row
 * carries its level three ways instead of indentation alone: a coloured guide
 * line per ancestor, a caret tinted for the row's own level, and a chip for what
 * the node is. Branches collapse. A scene can have a hundred children under one
 * node, and showing them all by default buries everything else.
 *
 * The tree is only rebuilt when its shape actually changes - rebuilding every
 * frame would reset the scroll position and destroy the row the cursor is on
 * mid-click.
 */
export class HierarchyPanel {
    private _body: HTMLElement = null;
    private _rows = new Map<Node, HTMLElement>();
    private _signature = '';
    private _selected: Node = null;
    private _scrollToSelected = false;
    private _expanded = new Set<Node>();
    private _seeded = false;
    private _last: { roots: readonly Node[]; excluded: number; skip: Node } = null;

    constructor (
        private _visibility: VisibilityController,
        private _callbacks: HierarchyCallbacks,
    ) {}

    public mount (overlay: DebugOverlay) {
        const { card, body } = overlay.card('hierarchy', 'sv-tree', 'left');
        this._body = body;
        this._addTitleActions(card);
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

        // A pick in the viewport can land on a node inside a collapsed branch. Open the
        // way to it, or there would be no row to highlight.
        if (node && node.isValid && this._reveal(node)) this._redraw();
        this._applySelection();
    }

    /** `excluded` is a layer mask; a node entirely on excluded layers is skipped. */
    public refresh (roots: readonly Node[], excluded: number, skip: Node) {
        if (!this._body) return;
        this._last = { roots, excluded, skip };

        // Start with the top level open, so the first thing seen is a real outline
        // rather than one row per root.
        if (!this._seeded) {
            this._seeded = true;
            for (let i = 0; i < roots.length; i++) {
                if (isListed(roots[i], excluded, skip)) this._expanded.add(roots[i]);
            }
        }

        const visible: Entry[] = [];
        for (let i = 0; i < roots.length; i++) collect(roots[i], 0, visible, excluded, skip, this._expanded);

        const signature = visible
            .map((e) => `${e.depth}:${e.node.uuid}:${e.node.name}:${e.hasChildren ? 1 : 0}${this._expanded.has(e.node) ? 'o' : 'c'}`)
            .join('|');
        if (signature !== this._signature) {
            this._signature = signature;
            this._rebuild(visible);
        }
        this._applyState();
    }

    private _redraw () {
        if (this._last) this.refresh(this._last.roots, this._last.excluded, this._last.skip);
    }

    private _toggle (node: Node) {
        if (this._expanded.has(node)) this._expanded.delete(node);
        else this._expanded.add(node);
        this._redraw();
    }

    private _reveal (node: Node): boolean {
        let changed = false;
        for (let p = node.parent; p; p = p.parent) {
            if (!this._expanded.has(p)) {
                this._expanded.add(p);
                changed = true;
            }
        }
        return changed;
    }

    private _expandAll () {
        if (!this._last) return;
        const { roots, excluded, skip } = this._last;

        const visit = (node: Node) => {
            if (!isListed(node, excluded, skip)) return;
            if (hasListedChildren(node, excluded, skip)) this._expanded.add(node);
            const children = node.children;
            for (let i = 0; i < children.length; i++) visit(children[i]);
        };
        for (let i = 0; i < roots.length; i++) visit(roots[i]);
        this._redraw();
    }

    private _collapseAll () {
        if (!this._last) return;
        const { roots, excluded, skip } = this._last;

        this._expanded.clear();
        for (let i = 0; i < roots.length; i++) {
            if (isListed(roots[i], excluded, skip)) this._expanded.add(roots[i]);
        }
        this._redraw();
    }

    private _addTitleActions (card: HTMLElement) {
        const title = card.querySelector('.sv-title');
        if (!title) return;

        const actions = document.createElement('span');
        actions.className = 'sv-title-actions';
        actions.appendChild(titleButton('+', 'Expand everything', () => this._expandAll()));
        actions.appendChild(titleButton('-', 'Collapse to the top level', () => this._collapseAll()));
        title.appendChild(actions);
    }

    private _rebuild (entries: readonly Entry[]) {
        // Rebuilding empties the list, which would otherwise throw the scroll position away.
        const scrollTop = this._body.scrollTop;
        this._body.textContent = '';
        this._rows.clear();

        if (!entries.length) {
            const empty = document.createElement('div');
            empty.className = 'sv-empty';
            empty.textContent = '(no nodes)';
            this._body.appendChild(empty);
            return;
        }

        for (let i = 0; i < entries.length; i++) this._body.appendChild(this._row(entries[i]));
        this._body.scrollTop = scrollTop;
    }

    private _row (entry: Entry): HTMLElement {
        const { node, depth, hasChildren } = entry;
        const expanded = this._expanded.has(node);

        const row = document.createElement('div');
        row.className = 'sv-row' + (hasChildren ? ' sv-has-children' : '');
        row.addEventListener('click', () => this._callbacks.onSelect(node));
        row.addEventListener('dblclick', () => this._callbacks.onFocus(node));

        // One guide per ancestor level, each in that level's colour.
        for (let d = 0; d < depth; d++) {
            const guide = document.createElement('span');
            guide.className = `sv-guide sv-d${d % DEPTH_COLOURS}`;
            row.appendChild(guide);
        }

        const caret = document.createElement('span');
        caret.className = `sv-caret sv-d${depth % DEPTH_COLOURS}`
            + (hasChildren ? (expanded ? ' sv-open' : '') : ' sv-leaf');
        if (hasChildren) {
            caret.addEventListener('click', (e) => {
                // Opening a branch must not also select it.
                e.stopPropagation();
                this._toggle(node);
            });
            caret.addEventListener('dblclick', (e) => e.stopPropagation());
        }
        row.appendChild(caret);

        const kind = kindOf(node);
        const chip = document.createElement('span');
        chip.className = `sv-chip sv-k-${kind}`;
        chip.title = KIND_TITLES[kind];
        row.appendChild(chip);

        const name = document.createElement('span');
        name.className = 'sv-name';
        name.textContent = node.name || '(unnamed)';
        row.appendChild(name);

        if (hasChildren) {
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
            // A node that is switched off, or sits under one that is, still exists; fade it.
            row.classList.toggle('sv-inactive', !node.activeInHierarchy);

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
            // would drag the list back while the user is scrolling it. The flag survives
            // until the row exists, since opening a branch rebuilds the list.
            if (selected && this._scrollToSelected) {
                row.scrollIntoView?.({ block: 'nearest' });
                this._scrollToSelected = false;
            }
        }
    }
}

function titleButton (label: string, title: string, action: () => void): HTMLElement {
    const btn = document.createElement('button');
    btn.className = 'sv-title-btn';
    btn.textContent = label;
    btn.title = title;
    btn.addEventListener('click', action);
    return btn;
}

/** What a node is, from what it carries. Order matters: a UI node has a transform and more. */
function kindOf (node: Node): Kind {
    if (node.getComponent(Camera)) return 'camera';
    if (Light && node.getComponent(Light)) return 'light';
    if ((UIRenderer && node.getComponent(UIRenderer)) || (UITransform && node.getComponent(UITransform))) return 'ui';
    if (node.getComponent(ModelRenderer)) return 'mesh';
    return node.children.length ? 'group' : 'empty';
}

/** A node entirely on excluded layers is editor scaffolding, not content. */
function isListed (node: Node, excluded: number, skip: Node): boolean {
    return !!node && node.isValid && node !== skip && (node.layer & ~excluded) !== 0;
}

function hasListedChildren (node: Node, excluded: number, skip: Node): boolean {
    const children = node.children;
    for (let i = 0; i < children.length; i++) {
        if (isListed(children[i], excluded, skip)) return true;
    }
    return false;
}

function collect (
    node: Node,
    depth: number,
    out: Entry[],
    excluded: number,
    skip: Node,
    expanded: ReadonlySet<Node>,
) {
    if (!isListed(node, excluded, skip)) return;

    const hasChildren = hasListedChildren(node, excluded, skip);
    out.push({ node, depth, hasChildren });
    if (!hasChildren || !expanded.has(node)) return;

    const children = node.children;
    for (let i = 0; i < children.length; i++) collect(children[i], depth + 1, out, excluded, skip, expanded);
}
