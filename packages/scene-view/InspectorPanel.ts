import { Component, Node, Vec3 } from 'cc';
import { DebugOverlay } from './DebugOverlay';

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
    private _body: HTMLElement = null;
    private _header: HTMLElement = null;
    private _path: HTMLElement = null;
    private _active: HTMLInputElement = null;
    private _meta: HTMLElement = null;
    private _components: HTMLElement = null;
    private _fields = new Map<string, HTMLInputElement>();
    private _node: Node = null;

    public mount (overlay: DebugOverlay) {
        const { body } = overlay.card('inspector', 'sv-inspector', 'right');
        this._body = body;

        this._header = text(body, 'sv-text');
        this._path = text(body, 'sv-text sv-tag');

        this._active = this._checkbox(body, 'active');
        this._vector(body, 'position');
        this._vector(body, 'rotation');
        this._vector(body, 'scale');

        this._meta = text(body, 'sv-text sv-tag');
        this._components = text(body, 'sv-text sv-tag');

        this.show(null);
    }

    public unmount () {
        this._body = null;
        this._fields.clear();
        this._node = null;
    }

    public show (node: Node) {
        this._node = node && node.isValid ? node : null;
        if (!this._body) return;

        const empty = !this._node;
        this._body.style.display = empty ? 'none' : 'block';
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
        field.appendChild(label);

        for (const axis of ['x', 'y', 'z']) {
            const input = document.createElement('input');
            input.className = 'sv-num';
            input.type = 'text';
            input.spellcheck = false;
            input.addEventListener('change', () => this._commit(kind));
            field.appendChild(input);
            this._fields.set(`${kind}.${axis}`, input);
        }

        parent.appendChild(field);
    }

    private _commit (kind: Vector) {
        const node = this._node;
        if (!node || !node.isValid) return;

        const current = kind === 'position' ? node.position
            : kind === 'rotation' ? node.eulerAngles
                : node.scale;

        // A field left unparseable keeps its current value rather than becoming NaN.
        const x = parse(this._fields.get(`${kind}.x`).value, current.x);
        const y = parse(this._fields.get(`${kind}.y`).value, current.y);
        const z = parse(this._fields.get(`${kind}.z`).value, current.z);

        if (kind === 'position') node.setPosition(x, y, z);
        else if (kind === 'rotation') node.setRotationFromEuler(x, y, z);
        else node.setScale(x, y, z);
    }

    private _checkbox (parent: HTMLElement, label: string): HTMLInputElement {
        const field = document.createElement('div');
        field.className = 'sv-field';

        const caption = document.createElement('span');
        caption.className = 'sv-label';
        caption.textContent = label;

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.addEventListener('change', () => {
            if (this._node && this._node.isValid) this._node.active = input.checked;
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

function parse (raw: string, fallback: number): number {
    const value = parseFloat(raw);
    return isFinite(value) ? value : fallback;
}

/** Up to three decimals with the trailing zeros dropped: 500, not 500.000, so a field stays short. */
function fixed (n: number): string {
    const text = String(parseFloat(n.toFixed(3)));
    return text === '-0' ? '0' : text;
}
