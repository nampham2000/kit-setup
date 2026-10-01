import { Component, Node, Vec3 } from 'cc';
import { ColliderInspector } from './ColliderInspector';
import { DebugOverlay } from './DebugOverlay';
import { NODE_TIPS, TRANSFORM_TIPS } from './Tips';
import { tip } from './Tooltip';
import { Command, ValueCommand } from './History';
import { bindLiveNumbers } from './LiveFields';

type Vector = 'position' | 'rotation' | 'scale';

const _v = new Vec3();

/**
 * Live, editable inspector for the selected node.
 *
 * Values are pushed into the fields every frame so animated objects read true,
 * except for the field being edited — overwriting that would fight the user
 * mid-keystroke. Edits are committed on `change` (blur or Enter), not on every
 * input event, so a half-typed "-" or "1." is never parsed.
 */
export class InspectorPanel {
    /** Called with each edit made here, so the owner can put it on the undo stack. */
    public onEdit: (command: Command) => void = null;

    private _body: HTMLElement = null;
    private _header: HTMLElement = null;
    private _path: HTMLElement = null;
    private _active: HTMLInputElement = null;
    private _meta: HTMLElement = null;
    private _components: HTMLElement = null;
    private _fields = new Map<string, HTMLInputElement>();
    private _colliders = new ColliderInspector();
    private _node: Node = null;

    public mount (overlay: DebugOverlay) {
        const { body } = overlay.card('inspector', 'sv-inspector', 'right');
        this._body = body;

        this._header = text(body, 'sv-text');
        this._path = text(body, 'sv-text sv-tag');
        tip(this._header, NODE_TIPS.name);
        tip(this._path, NODE_TIPS.path);

        this._active = this._checkbox(body, 'active');
        this._vector(body, 'position');
        this._vector(body, 'rotation');
        this._vector(body, 'scale');

        this._meta = text(body, 'sv-text sv-tag');
        this._components = text(body, 'sv-text sv-tag');
        tip(this._meta, NODE_TIPS.meta);
        tip(this._components, NODE_TIPS.components);

        this._colliders.onEdit = (command) => this.onEdit?.(command);
        this._colliders.mount(body);

        this.show(null);
    }

    public unmount () {
        this._colliders.unmount();
        this._body = null;
        this._fields.clear();
        this._node = null;
    }

    public show (node: Node) {
        this._node = node && node.isValid ? node : null;
        if (!this._body) return;

        const empty = !this._node;
        this._body.style.display = empty ? 'none' : 'block';
        this._colliders.show(this._node);
        if (empty) return;
        this.sync();
    }

    /** Refresh every field the user is not currently editing. */
    public sync () {
        const node = this._node;
        if (!this._body || !node || !node.isValid) return;

        this._header.textContent = node.name || '(unnamed)';
        this._path.textContent = pathOf(node);

        if (document.activeElement !== this._active) this._active.checked = node.active;

        this._writeVector('position', node.position);
        this._writeVector('rotation', node.eulerAngles);
        this._writeVector('scale', node.scale);

        node.getWorldPosition(_v);
        this._meta.textContent = `world  ${fixed(_v.x)} ${fixed(_v.y)} ${fixed(_v.z)}\n`
            + `layer  ${node.layer}   children  ${node.children.length}`;

        const names = node.components.map((c: Component) => c.constructor.name);
        this._components.textContent = names.length ? names.join(', ') : '(no components)';
        this._colliders.sync();
    }

    private _writeVector (kind: Vector, v: Readonly<Vec3>) {
        this._write(`${kind}.x`, v.x);
        this._write(`${kind}.y`, v.y);
        this._write(`${kind}.z`, v.z);
    }

    private _write (key: string, value: number) {
        const input = this._fields.get(key);
        if (!input || document.activeElement === input) return;
        const next = fixed(value);
        if (input.value !== next) input.value = next;
    }

    private _vector (parent: HTMLElement, kind: Vector) {
        const field = document.createElement('div');
        field.className = 'sv-field';

        const label = document.createElement('span');
        label.className = 'sv-label';
        label.textContent = kind;
        tip(field, TRANSFORM_TIPS[kind]);
        field.appendChild(label);

        const inputs: HTMLInputElement[] = [];
        for (const axis of ['x', 'y', 'z']) {
            const input = document.createElement('input');
            input.className = 'sv-num';
            input.type = 'text';
            input.spellcheck = false;
            field.appendChild(input);
            inputs.push(input);
            this._fields.set(`${kind}.${axis}`, input);
        }

        // Applied as it is typed, and one undo step when the user leaves the field.
        bindLiveNumbers(inputs, {
            read: () => this._read(kind),
            write: (values) => this._apply(kind, values),
            commit: (before, after) => {
                const node = this._node;
                if (!node || !node.isValid) return;
                this.onEdit?.(new ValueCommand<number[]>(
                    `Edit ${kind} of ${node.name}`, () => node.isValid,
                    (value) => { this._writeTo(node, kind, value); }, before, after,
                ));
            },
        });

        parent.appendChild(field);
    }

    private _read (kind: Vector): number[] {
        const node = this._node;
        if (!node || !node.isValid) return [0, 0, 0];
        const v = kind === 'position' ? node.position : kind === 'rotation' ? node.eulerAngles : node.scale;
        return [v.x, v.y, v.z];
    }

    private _apply (kind: Vector, values: number[]) {
        const node = this._node;
        if (node && node.isValid) this._writeTo(node, kind, values);
    }

    private _writeTo (node: Node, kind: Vector, values: number[]) {
        if (kind === 'position') node.setPosition(values[0], values[1], values[2]);
        else if (kind === 'rotation') node.setRotationFromEuler(values[0], values[1], values[2]);
        else node.setScale(values[0], values[1], values[2]);
    }

    private _checkbox (parent: HTMLElement, label: string): HTMLInputElement {
        const field = document.createElement('div');
        field.className = 'sv-field';

        const caption = document.createElement('span');
        caption.className = 'sv-label';
        caption.textContent = label;
        if (label === 'active') tip(field, NODE_TIPS.active);

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.addEventListener('change', () => {
            const node = this._node;
            if (!node || !node.isValid) return;
            const before = node.active;
            node.active = input.checked;
            if (before !== input.checked) {
                this.onEdit?.(new ValueCommand<boolean>(
                    `${input.checked ? 'Enable' : 'Disable'} ${node.name}`,
                    () => node.isValid,
                    (value) => { node.active = value; },
                    before,
                    input.checked,
                ));
            }
        });

        field.appendChild(caption);
        field.appendChild(input);
        parent.appendChild(field);
        return input;
    }
}

function text (parent: HTMLElement, className: string): HTMLElement {
    const el = document.createElement('div');
    el.className = className;
    parent.appendChild(el);
    return el;
}

function pathOf (node: Node): string {
    const parts: string[] = [];
    // Stop before the scene root so the path stays readable.
    for (let n = node.parent; n && n.parent; n = n.parent) parts.unshift(n.name);
    return parts.length ? `${parts.join(' / ')} /` : '(root)';
}

/** Up to three decimals with the trailing zeros dropped: 500, not 500.000, so a field stays short. */
function fixed (n: number): string {
    const text = String(parseFloat(n.toFixed(3)));
    return text === '-0' ? '0' : text;
}
