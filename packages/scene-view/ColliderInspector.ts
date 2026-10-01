import { BoxCollider, CapsuleCollider, Collider, Node, SphereCollider, Vec3 } from 'cc';
import { kindOf, physicsAvailable } from './ColliderEdit';
import { Command, ValueCommand } from './History';
import { bindLiveNumbers } from './LiveFields';

interface Row {
    refresh (): void;
}

const AXES = ['X', 'Y', 'Z'];

/**
 * The collider section of the Inspector: one block per collider that is already on the
 * selected node, with its shape fields and its Trigger and Enabled switches.
 *
 * It shows and edits what is there; it does not add or remove colliders. Every edit goes
 * on the undo stack. The blocks are only rebuilt when the node or its set of colliders
 * changes, never while a field is being typed in; the fields refresh in place, except
 * the one with focus.
 */
export class ColliderInspector {
    /** Called with each edit made here, so the owner can put it on the undo stack. */
    public onEdit: (command: Command) => void = null;

    private _root: HTMLElement = null;
    private _node: Node = null;
    private _signature = '';
    private _rows: Row[] = [];

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

        const colliders = node.getComponents(Collider).filter((c) => c.isValid);
        const signature = `${node.uuid}|${colliders.map((c) => c.uuid).join(',')}`;
        if (signature !== this._signature) {
            this._signature = signature;
            this._build(node, colliders);
            return;
        }
        for (const row of this._rows) row.refresh();
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
    }

    private _section (node: Node, collider: Collider) {
        const kind = kindOf(collider);

        const section = document.createElement('div');
        section.className = 'sv-section';

        const head = document.createElement('div');
        head.className = 'sv-section-head';
        head.textContent = collider.constructor.name;
        section.appendChild(head);

        this._vector(section, node, collider, 'center',
            (c) => [c.center.x, c.center.y, c.center.z],
            (c, v) => { c.center = new Vec3(v[0], v[1], v[2]); });

        if (kind === 'box') {
            this._vector(section, node, collider, 'size',
                (c) => { const s = (c as BoxCollider).size; return [s.x, s.y, s.z]; },
                (c, v) => { (c as BoxCollider).size = new Vec3(v[0], v[1], v[2]); }, 0);
        } else if (kind === 'sphere') {
            this._number(section, node, collider, 'radius',
                (c) => (c as SphereCollider).radius,
                (c, v) => { (c as SphereCollider).radius = v; }, 0.001);
        } else if (kind === 'capsule') {
            this._number(section, node, collider, 'radius',
                (c) => (c as CapsuleCollider).radius,
                (c, v) => { (c as CapsuleCollider).radius = v; }, 0.001);
            this._number(section, node, collider, 'height',
                (c) => (c as CapsuleCollider).cylinderHeight,
                (c, v) => { (c as CapsuleCollider).cylinderHeight = v; }, 0);
            this._choice(section, node, collider, 'direction', AXES,
                (c) => (c as CapsuleCollider).direction as number,
                (c, v) => { (c as CapsuleCollider).direction = v; });
        }

        this._flag(section, node, collider, 'trigger', (c) => c.isTrigger, (c, v) => { c.isTrigger = v; });
        this._flag(section, node, collider, 'enabled', (c) => c.enabled, (c, v) => { c.enabled = v; });

        this._root.appendChild(section);
    }

    // --- field rows ------------------------------------------------------------

    private _vector (
        parent: HTMLElement, node: Node, collider: Collider, label: string,
        get: (c: Collider) => number[], set: (c: Collider, v: number[]) => void, min = -Infinity,
    ) {
        const inputs = fieldRow(parent, label, 3);
        const refresh = () => {
            if (!collider.isValid) return;
            const values = get(collider);
            inputs.forEach((input, i) => {
                if (document.activeElement !== input) input.value = fixed(values[i]);
            });
        };
        bindLiveNumbers(inputs, {
            read: () => (collider.isValid ? get(collider) : []),
            write: (values) => { if (collider.isValid) set(collider, values); },
            commit: (before, after) => this.onEdit?.(new ValueCommand<number[]>(
                `Edit ${label} of ${node.name}`, () => collider.isValid, (value) => set(collider, value), before, after,
            )),
            min,
        });
        this._rows.push({ refresh });
        refresh();
    }

    private _number (
        parent: HTMLElement, node: Node, collider: Collider, label: string,
        get: (c: Collider) => number, set: (c: Collider, v: number) => void, min: number,
    ) {
        const input = fieldRow(parent, label, 1)[0];
        const refresh = () => {
            if (collider.isValid && document.activeElement !== input) input.value = fixed(get(collider));
        };
        bindLiveNumbers([input], {
            read: () => (collider.isValid ? [get(collider)] : []),
            write: (values) => { if (collider.isValid) set(collider, values[0]); },
            commit: (before, after) => this.onEdit?.(new ValueCommand<number[]>(
                `Edit ${label} of ${node.name}`, () => collider.isValid, (value) => set(collider, value[0]), before, after,
            )),
            min,
        });
        this._rows.push({ refresh });
        refresh();
    }

    private _flag (
        parent: HTMLElement, node: Node, collider: Collider, label: string,
        get: (c: Collider) => boolean, set: (c: Collider, v: boolean) => void,
    ) {
        const field = labelled(parent, label);
        const input = document.createElement('input');
        input.type = 'checkbox';
        field.appendChild(input);
        const refresh = () => {
            if (collider.isValid && document.activeElement !== input) input.checked = get(collider);
        };
        input.addEventListener('change', () => {
            if (!collider.isValid) return;
            const before = get(collider);
            if (before === input.checked) return;
            set(collider, input.checked);
            this.onEdit?.(new ValueCommand<boolean>(
                `Set ${label} of ${node.name}`, () => collider.isValid, (value) => set(collider, value),
                before, input.checked,
            ));
        });
        this._rows.push({ refresh });
        refresh();
    }

    private _choice (
        parent: HTMLElement, node: Node, collider: Collider, label: string, options: string[],
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
            if (collider.isValid && document.activeElement !== select) select.value = String(get(collider));
        };
        select.addEventListener('change', () => {
            if (!collider.isValid) return;
            const before = get(collider);
            const next = parseInt(select.value, 10);
            if (before === next) return;
            set(collider, next);
            this.onEdit?.(new ValueCommand<number>(
                `Set ${label} of ${node.name}`, () => collider.isValid, (value) => set(collider, value),
                before, next,
            ));
        });
        this._rows.push({ refresh });
        refresh();
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

function fieldRow (parent: HTMLElement, label: string, count: number): HTMLInputElement[] {
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
    return inputs;
}

function fixed (n: number): string {
    const text = String(parseFloat(n.toFixed(3)));
    return text === '-0' ? '0' : text;
}
