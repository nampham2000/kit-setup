import { BoxCollider, CapsuleCollider, Collider, Node, SphereCollider, Vec3 } from 'cc';
import {
    ColliderKind, ColliderLifecycleCommand, ColliderRef, fitToMesh, kindOf, physicsAvailable, refOf, snapshot,
    ctorOf,
} from './ColliderEdit';
import { Command, ValueCommand } from './History';

interface Row {
    refresh (): void;
}

const ADD_KINDS: { kind: ColliderKind; label: string }[] = [
    { kind: 'box', label: '+ Box' },
    { kind: 'sphere', label: '+ Sphere' },
    { kind: 'capsule', label: '+ Capsule' },
];

const AXES = ['X', 'Y', 'Z'];

/**
 * The collider section of the Inspector: one block per collider on the selected node,
 * with its shape fields, a Trigger switch and a Remove button, and buttons to add more.
 *
 * Every edit goes through a ColliderRef rather than the component itself, so the undo
 * stack still reaches the right collider after it has been removed and brought back.
 * The blocks are only rebuilt when the set of colliders changes, never while a field
 * is being typed in; the fields refresh in place, except the one with focus.
 */
export class ColliderInspector {
    /** Called with each edit made here, so the owner can put it on the undo stack. */
    public onEdit: (command: Command) => void = null;

    private _root: HTMLElement = null;
    private _node: Node = null;
    private _signature = '';
    private _rows: Row[] = [];
    /** Colliders just removed. They stay on the node until the end of the frame. */
    private _gone = new Set<Collider>();

    public mount (parent: HTMLElement) {
        if (typeof document === 'undefined' || this._root || !physicsAvailable()) return;
        this._root = document.createElement('div');
        this._root.className = 'sv-colliders';
        parent.appendChild(this._root);
    }

    public unmount () {
        this._root?.remove();
        this._root = null;
        this._node = null;
        this._rows = [];
        this._signature = '';
    }

    public show (node: Node | null) {
        this._node = node && node.isValid ? node : null;
        this._signature = '\u0000';
        this.sync();
    }

    public sync () {
        if (!this._root) return;
        const node = this._node;
        if (!node || !node.isValid) {
            if (this._signature !== '') this._clear();
            return;
        }

        const colliders = this._colliders(node);
        const signature = `${node.uuid}|${colliders.map((c) => c.uuid).join(',')}`;
        if (signature !== this._signature) {
            this._signature = signature;
            this._build(node, colliders);
            return;
        }
        for (const row of this._rows) row.refresh();
    }

    private _colliders (node: Node): Collider[] {
        return node.getComponents(Collider).filter((c) => c.isValid && !this._gone.has(c));
    }

    private _clear () {
        this._root.textContent = '';
        this._rows = [];
        this._signature = '';
    }

    private _build (node: Node, colliders: Collider[]) {
        this._root.textContent = '';
        this._rows = [];

        for (const collider of colliders) this._section(node, collider);
        this._addRow(node);
    }

    private _section (node: Node, collider: Collider) {
        const kind = kindOf(collider);
        const ref = refOf(collider);

        const section = document.createElement('div');
        section.className = 'sv-section';

        const head = document.createElement('div');
        head.className = 'sv-section-head';
        const title = document.createElement('span');
        title.textContent = collider.constructor.name;
        head.appendChild(title);
        const remove = document.createElement('button');
        remove.className = 'sv-chip-btn sv-section-remove';
        remove.textContent = 'Remove';
        remove.title = 'Remove this collider';
        remove.addEventListener('click', () => this._remove(node, collider));
        head.appendChild(remove);
        section.appendChild(head);

        this._vector(section, node, ref, 'center',
            (c) => [c.center.x, c.center.y, c.center.z],
            (c, v) => { c.center = new Vec3(v[0], v[1], v[2]); });

        if (kind === 'box') {
            this._vector(section, node, ref, 'size',
                (c) => { const s = (c as BoxCollider).size; return [s.x, s.y, s.z]; },
                (c, v) => { (c as BoxCollider).size = new Vec3(v[0], v[1], v[2]); }, 0);
        } else if (kind === 'sphere') {
            this._number(section, node, ref, 'radius',
                (c) => (c as SphereCollider).radius,
                (c, v) => { (c as SphereCollider).radius = v; }, 0.001);
        } else if (kind === 'capsule') {
            this._number(section, node, ref, 'radius',
                (c) => (c as CapsuleCollider).radius,
                (c, v) => { (c as CapsuleCollider).radius = v; }, 0.001);
            this._number(section, node, ref, 'height',
                (c) => (c as CapsuleCollider).cylinderHeight,
                (c, v) => { (c as CapsuleCollider).cylinderHeight = v; }, 0);
            this._choice(section, node, ref, 'direction', AXES,
                (c) => (c as CapsuleCollider).direction as number,
                (c, v) => { (c as CapsuleCollider).direction = v; });
        }

        this._flag(section, node, ref, 'trigger',
            (c) => c.isTrigger,
            (c, v) => { c.isTrigger = v; });

        this._root.appendChild(section);
    }

    private _addRow (node: Node) {
        const row = document.createElement('div');
        row.className = 'sv-section sv-add-row';
        for (const { kind, label } of ADD_KINDS) {
            const btn = document.createElement('button');
            btn.className = 'sv-chip-btn';
            btn.textContent = label;
            btn.title = `Add a ${kind} collider, sized to the mesh if there is one`;
            btn.addEventListener('click', () => this._add(node, kind));
            row.appendChild(btn);
        }
        this._root.appendChild(row);
    }

    // --- structural edits ------------------------------------------------------

    private _add (node: Node, kind: ColliderKind) {
        if (!node.isValid) return;
        const collider = node.addComponent(ctorOf(kind));
        fitToMesh(collider, node);
        this.onEdit?.(new ColliderLifecycleCommand(
            `Add ${kind} collider to ${node.name}`, node, refOf(collider), snapshot(collider), true,
        ));
        // Rebuilt on the next sync, which sees the new component.
    }

    private _remove (node: Node, collider: Collider) {
        if (!collider.isValid) return;
        const ref = refOf(collider);
        const state = snapshot(collider);
        collider.destroy();
        ref.comp = null;
        this._gone.add(collider);
        this.onEdit?.(new ColliderLifecycleCommand(
            `Remove ${state.kind} collider from ${node.name}`, node, ref, state, false,
        ));
        this._signature = '\u0000';
        this.sync();
    }

    // --- field rows ------------------------------------------------------------

    private _vector (
        parent: HTMLElement, node: Node, ref: ColliderRef, label: string,
        get: (c: Collider) => number[], set: (c: Collider, v: number[]) => void, min = -Infinity,
    ) {
        const { field, inputs } = fieldRow(parent, label, 3);
        const refresh = () => {
            const comp = ref.comp;
            if (!comp || !comp.isValid) return;
            const values = get(comp);
            inputs.forEach((input, i) => {
                if (document.activeElement !== input) input.value = fixed(values[i]);
            });
        };
        inputs.forEach((input) => input.addEventListener('change', () => {
            const comp = ref.comp;
            if (!comp || !comp.isValid) return;
            const before = get(comp);
            const next = inputs.map((el, i) => Math.max(min, parse(el.value, before[i])));
            this._commit(node, ref, label, before, next, set);
            refresh();
        }));
        field.dataset.row = label;
        this._rows.push({ refresh });
        refresh();
    }

    private _number (
        parent: HTMLElement, node: Node, ref: ColliderRef, label: string,
        get: (c: Collider) => number, set: (c: Collider, v: number) => void, min: number,
    ) {
        const { inputs } = fieldRow(parent, label, 1);
        const input = inputs[0];
        const refresh = () => {
            const comp = ref.comp;
            if (comp && comp.isValid && document.activeElement !== input) input.value = fixed(get(comp));
        };
        input.addEventListener('change', () => {
            const comp = ref.comp;
            if (!comp || !comp.isValid) return;
            const before = [get(comp)];
            const next = [Math.max(min, parse(input.value, before[0]))];
            this._commit(node, ref, label, before, next, (c, v) => set(c, v[0]));
            refresh();
        });
        this._rows.push({ refresh });
        refresh();
    }

    private _flag (
        parent: HTMLElement, node: Node, ref: ColliderRef, label: string,
        get: (c: Collider) => boolean, set: (c: Collider, v: boolean) => void,
    ) {
        const field = labelled(parent, label);
        const input = document.createElement('input');
        input.type = 'checkbox';
        field.appendChild(input);
        const refresh = () => {
            const comp = ref.comp;
            if (comp && comp.isValid && document.activeElement !== input) input.checked = get(comp);
        };
        input.addEventListener('change', () => {
            const comp = ref.comp;
            if (!comp || !comp.isValid) return;
            const before = get(comp);
            if (before === input.checked) return;
            set(comp, input.checked);
            this.onEdit?.(new ValueCommand<boolean>(
                `Set ${label} of ${node.name}`,
                () => !!ref.comp && ref.comp.isValid,
                (value) => set(ref.comp, value),
                before, input.checked,
            ));
        });
        this._rows.push({ refresh });
        refresh();
    }

    private _choice (
        parent: HTMLElement, node: Node, ref: ColliderRef, label: string, options: string[],
        get: (c: Collider) => number, set: (c: Collider, v: number) => void,
    ) {
        const field = labelled(parent, label);
        const select = document.createElement('select');
        select.className = 'sv-select';
        options.forEach((name, i) => {
            const option = document.createElement('option');
            option.value = String(i);
            option.textContent = name;
            select.appendChild(option);
        });
        field.appendChild(select);
        const refresh = () => {
            const comp = ref.comp;
            if (comp && comp.isValid && document.activeElement !== select) select.value = String(get(comp));
        };
        select.addEventListener('change', () => {
            const comp = ref.comp;
            if (!comp || !comp.isValid) return;
            const before = get(comp);
            const next = parseInt(select.value, 10);
            if (before === next) return;
            set(comp, next);
            this.onEdit?.(new ValueCommand<number>(
                `Set ${label} of ${node.name}`,
                () => !!ref.comp && ref.comp.isValid,
                (value) => set(ref.comp, value),
                before, next,
            ));
        });
        this._rows.push({ refresh });
        refresh();
    }

    /** Apply `next`, and record it only if it differs from `before`. */
    private _commit (
        node: Node, ref: ColliderRef, label: string, before: number[], next: number[],
        set: (c: Collider, v: number[]) => void,
    ) {
        const same = before.every((value, i) => Math.abs(value - next[i]) < 1e-9);
        if (same) return;
        set(ref.comp, next);
        this.onEdit?.(new ValueCommand<number[]>(
            `Edit ${label} of ${node.name}`,
            () => !!ref.comp && ref.comp.isValid,
            (value) => set(ref.comp, value),
            before, next,
        ));
    }
}

function labelled (parent: HTMLElement, label: string): HTMLElement {
    const field = document.createElement('div');
    field.className = 'sv-field';
    const caption = document.createElement('span');
    caption.className = 'sv-label';
    caption.textContent = label;
    field.appendChild(caption);
    parent.appendChild(field);
    return field;
}

function fieldRow (parent: HTMLElement, label: string, count: number): { field: HTMLElement; inputs: HTMLInputElement[] } {
    const field = labelled(parent, label);
    const inputs: HTMLInputElement[] = [];
    for (let i = 0; i < count; i++) {
        const input = document.createElement('input');
        input.className = 'sv-num';
        input.type = 'text';
        input.spellcheck = false;
        field.appendChild(input);
        inputs.push(input);
    }
    return { field, inputs };
}

function parse (raw: string, fallback: number): number {
    const value = parseFloat(raw);
    return isFinite(value) ? value : fallback;
}

function fixed (n: number): string {
    const text = String(parseFloat(n.toFixed(3)));
    return text === '-0' ? '0' : text;
}
