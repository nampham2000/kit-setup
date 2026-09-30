/**
 * Bridge from the running scene view to the Cocos Creator editor's own Hierarchy
 * and Inspector panels.
 *
 * This works at all only because the in-editor Preview runs inside the editor's
 * scene process — the same context that owns the scene graph (which is also why
 * the editor's gizmo nodes are visible to the runtime). Outside that context —
 * browser preview, a real build — there is no editor and every call here is a
 * no-op, so the caller falls back to the built-in DOM panels.
 *
 * The editor's selection API is not part of the engine's typings and is minified
 * in the shipped bundle, so rather than assume one shape this probes the known
 * entry points in order and reports which one it found. `describe()` is logged
 * once on startup precisely so a failure says which API was missing.
 */

type Any = Record<string, any>;

function editor (): Any | null {
    const host = globalThis as Any;
    return host.Editor ?? null;
}

export class EditorBridge {
    private _selectFn: ((uuid: string) => void) | null = null;
    private _clearFn: (() => void) | null = null;
    private _getFn: (() => string[]) | null = null;
    private _route = 'none';

    public get available (): boolean { return this._selectFn !== null; }

    /** Human-readable account of what was detected, for a single startup log. */
    public describe (): string {
        if (!editor()) return 'no editor host (browser preview or build) - using built-in panels';
        return `editor selection route: ${this._route}`
            + `${this._getFn ? ', reverse sync on' : ', reverse sync unavailable'}`;
    }

    public probe () {
        const host = editor();
        if (!host) return;

        const selection = host.Selection as Any | undefined;
        const message = host.Message as Any | undefined;

        if (selection && typeof selection.select === 'function') {
            this._route = 'Editor.Selection.select';
            this._selectFn = (uuid) => selection.select('node', uuid);
            if (typeof selection.clear === 'function') this._clearFn = () => selection.clear('node');
        } else if (message && typeof message.send === 'function') {
            // Fallback: drive the same broadcast the Hierarchy panel listens to.
            this._route = 'Editor.Message.send(selection:select)';
            this._selectFn = (uuid) => message.send('selection', 'select', 'node', uuid);
            this._clearFn = () => message.send('selection', 'clear', 'node');
        }

        if (selection && typeof selection.getSelected === 'function') {
            this._getFn = () => selection.getSelected('node') ?? [];
        }
    }


    public select (uuid: string) {
        if (!this._selectFn) return;
        try {
            this._selectFn(uuid);
        } catch (e) {
            // A failing bridge must never take the scene view down with it.
            console.warn('[SceneView] editor selection failed:', e);
            this._selectFn = null;
        }
    }

    public clear () {
        if (!this._clearFn) return;
        try {
            this._clearFn();
        } catch {
            this._clearFn = null;
        }
    }

    /** The editor's current node selection, or null when it cannot be read. */
    public currentSelection (): string | null {
        if (!this._getFn) return null;
        try {
            const uuids = this._getFn();
            return uuids && uuids.length ? uuids[uuids.length - 1] : null;
        } catch {
            this._getFn = null;
            return null;
        }
    }
}
