import { Node, Quat, Vec3 } from 'cc';

/** One undoable edit. `redo` must reproduce the edit; `undo` must put things back exactly. */
export interface Command {
    label: string;
    undo (): void;
    redo (): void;
}

const LIMIT = 200;

/**
 * Undo and redo for everything done in the scene view.
 *
 * A command is pushed *after* the edit has been made, so the code that makes an edit
 * stays as it was and only has to describe how to reverse it. Pushing a new command
 * discards the redo stack, as in any editor. Commands are kept to a fixed count so a
 * long session does not hold on to every node it ever touched.
 *
 * Nothing here knows about the scene: a command that refers to a node that has since
 * been destroyed must check for that itself and do nothing.
 */
export class History {
    /** Called after every change to either stack, so a UI can enable or disable its buttons. */
    public onChange: () => void = null;

    private _undo: Command[] = [];
    private _redo: Command[] = [];

    public get canUndo (): boolean { return this._undo.length > 0; }
    public get canRedo (): boolean { return this._redo.length > 0; }
    public get undoLabel (): string { return this.canUndo ? this._undo[this._undo.length - 1].label : ''; }
    public get redoLabel (): string { return this.canRedo ? this._redo[this._redo.length - 1].label : ''; }

    public push (command: Command) {
        this._undo.push(command);
        if (this._undo.length > LIMIT) this._undo.shift();
        this._redo.length = 0;
        this.onChange?.();
    }

    /** Reverse the latest edit. Returns its label, or '' when there was nothing to undo. */
    public undo (): string {
        const command = this._undo.pop();
        if (!command) return '';
        this._run(() => command.undo(), 'undo', command);
        this._redo.push(command);
        this.onChange?.();
        return command.label;
    }

    public redo (): string {
        const command = this._redo.pop();
        if (!command) return '';
        this._run(() => command.redo(), 'redo', command);
        this._undo.push(command);
        this.onChange?.();
        return command.label;
    }

    public clear () {
        this._undo.length = 0;
        this._redo.length = 0;
        this.onChange?.();
    }

    private _run (action: () => void, what: string, command: Command) {
        // A command that fails must not wedge the stack: it stays moved, and the rest still work.
        try {
            action();
        } catch (error) {
            console.error(`[SceneView] ${what} "${command.label}" failed:`, error);
        }
    }
}

/** Changes a value through `set`, remembering both sides. For anything that is one number, flag or vector. */
export class ValueCommand<T> implements Command {
    constructor (
        public label: string,
        private _valid: () => boolean,
        private _set: (value: T) => void,
        private _before: T,
        private _after: T,
    ) {}

    public undo () { if (this._valid()) this._set(this._before); }
    public redo () { if (this._valid()) this._set(this._after); }
}

/** A node's local transform. Rotation is the quaternion, so a gizmo drag reverses exactly. */
export interface Pose {
    position: Vec3;
    rotation: Quat;
    scale: Vec3;
}

export function capturePose (node: Node): Pose {
    return {
        position: node.position.clone(),
        rotation: node.rotation.clone(),
        scale: node.scale.clone(),
    };
}

export function applyPose (node: Node, pose: Pose) {
    node.setPosition(pose.position);
    node.setRotation(pose.rotation);
    node.setScale(pose.scale);
}

const EPSILON = 1e-6;

export function poseChanged (a: Pose, b: Pose): boolean {
    const vec = (p: Vec3, q: Vec3) => Math.abs(p.x - q.x) > EPSILON || Math.abs(p.y - q.y) > EPSILON || Math.abs(p.z - q.z) > EPSILON;
    return vec(a.position, b.position) || vec(a.scale, b.scale)
        || Math.abs(a.rotation.x - b.rotation.x) > EPSILON || Math.abs(a.rotation.y - b.rotation.y) > EPSILON
        || Math.abs(a.rotation.z - b.rotation.z) > EPSILON || Math.abs(a.rotation.w - b.rotation.w) > EPSILON;
}

export class PoseCommand implements Command {
    constructor (public label: string, private _node: Node, private _before: Pose, private _after: Pose) {}

    public undo () { if (this._node.isValid) applyPose(this._node, this._before); }
    public redo () { if (this._node.isValid) applyPose(this._node, this._after); }
}
