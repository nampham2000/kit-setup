import { BoxCollider, CapsuleCollider, Collider, MeshRenderer, Node, SphereCollider, Vec3 } from 'cc';
import { Command } from './History';

export type ColliderKind = 'box' | 'sphere' | 'capsule';

/**
 * Whether the physics module is in this build. Colliders are classes from `cc`, and a
 * project that cropped physics out has them undefined, so every use is behind this.
 */
export function physicsAvailable (): boolean {
    return typeof Collider === 'function' && typeof BoxCollider === 'function'
        && typeof SphereCollider === 'function' && typeof CapsuleCollider === 'function';
}

export function kindOf (collider: Collider): ColliderKind | null {
    if (!physicsAvailable()) return null;
    if (collider instanceof BoxCollider) return 'box';
    if (collider instanceof SphereCollider) return 'sphere';
    if (collider instanceof CapsuleCollider) return 'capsule';
    return null;
}

export function ctorOf (kind: ColliderKind): new () => Collider {
    if (kind === 'box') return BoxCollider;
    if (kind === 'sphere') return SphereCollider;
    return CapsuleCollider;
}

type Triple = [number, number, number];

/** Everything an edit can change on a collider, as plain numbers, so it can be put back. */
export interface ColliderState {
    kind: ColliderKind;
    center: Triple;
    isTrigger: boolean;
    size?: Triple;
    radius?: number;
    cylinderHeight?: number;
    /** 0 = X, 1 = Y, 2 = Z. */
    direction?: number;
}

const triple = (v: Readonly<Vec3>): Triple => [v.x, v.y, v.z];

export function snapshot (collider: Collider): ColliderState {
    const kind = kindOf(collider);
    const state: ColliderState = { kind, center: triple(collider.center), isTrigger: collider.isTrigger };
    if (collider instanceof BoxCollider) {
        state.size = triple(collider.size);
    } else if (collider instanceof SphereCollider) {
        state.radius = collider.radius;
    } else if (collider instanceof CapsuleCollider) {
        state.radius = collider.radius;
        state.cylinderHeight = collider.cylinderHeight;
        state.direction = collider.direction as number;
    }
    return state;
}

export function restore (collider: Collider, state: ColliderState) {
    collider.center = new Vec3(state.center[0], state.center[1], state.center[2]);
    collider.isTrigger = state.isTrigger;
    if (collider instanceof BoxCollider && state.size) {
        collider.size = new Vec3(state.size[0], state.size[1], state.size[2]);
    } else if (collider instanceof SphereCollider && state.radius !== undefined) {
        collider.radius = state.radius;
    } else if (collider instanceof CapsuleCollider) {
        if (state.radius !== undefined) collider.radius = state.radius;
        if (state.cylinderHeight !== undefined) collider.cylinderHeight = state.cylinderHeight;
        if (state.direction !== undefined) collider.direction = state.direction;
    }
}

/**
 * A stable handle to "this collider", which survives it being removed and re-added.
 *
 * Undoing a removal builds a *new* component, so a command that held the old one would
 * silently do nothing afterwards. Commands hold this instead, and the add/remove command
 * keeps `comp` pointing at whichever component currently stands for it.
 */
export class ColliderRef {
    constructor (public comp: Collider | null) {}
}

const _refs = new WeakMap<Collider, ColliderRef>();

export function refOf (collider: Collider): ColliderRef {
    let ref = _refs.get(collider);
    if (!ref) {
        ref = new ColliderRef(collider);
        _refs.set(collider, ref);
    }
    return ref;
}

/**
 * Size a new collider to the node's mesh, as the editor does, so adding one gives a
 * shape around the object rather than a unit cube at its pivot. Quietly leaves the
 * defaults if there is no mesh to measure.
 */
export function fitToMesh (collider: Collider, node: Node) {
    try {
        const renderer = node.getComponent(MeshRenderer);
        const struct = renderer && renderer.mesh ? renderer.mesh.struct : null;
        if (!struct || !struct.minPosition || !struct.maxPosition) return;

        const min = struct.minPosition;
        const max = struct.maxPosition;
        const size = new Vec3(max.x - min.x, max.y - min.y, max.z - min.z);
        const center = new Vec3((max.x + min.x) / 2, (max.y + min.y) / 2, (max.z + min.z) / 2);
        if (!(size.x > 0 || size.y > 0 || size.z > 0)) return;

        collider.center = center;
        if (collider instanceof BoxCollider) {
            collider.size = size;
        } else if (collider instanceof SphereCollider) {
            collider.radius = Math.max(size.x, size.y, size.z) / 2;
        } else if (collider instanceof CapsuleCollider) {
            const radius = Math.max(size.x, size.z) / 2;
            collider.radius = radius;
            collider.cylinderHeight = Math.max(size.y - radius * 2, 0);
        }
    } catch {
        // No readable mesh data: the collider keeps the engine's defaults.
    }
}

/**
 * A collider was added to a node, or removed from it.
 *
 * `presentAfter` says which: true if the collider exists once the original edit is
 * done (an add), false if it does not (a remove). Undo and redo then simply make it
 * exist or not, rebuilding from the saved state when it has to come back.
 */
export class ColliderLifecycleCommand implements Command {
    constructor (
        public label: string,
        private _node: Node,
        private _ref: ColliderRef,
        private _state: ColliderState,
        private _presentAfter: boolean,
    ) {}

    public undo () {
        if (this._presentAfter) this._remove();
        else this._ensure();
    }

    public redo () {
        if (this._presentAfter) this._ensure();
        else this._remove();
    }

    private _remove () {
        const comp = this._ref.comp;
        if (comp && comp.isValid) {
            // Remember it as it is now, so a later undo brings back what was last on screen.
            this._state = snapshot(comp);
            comp.destroy();
        }
        this._ref.comp = null;
    }

    private _ensure () {
        if (!this._node.isValid) return;
        if (this._ref.comp && this._ref.comp.isValid) return;

        const comp = this._node.addComponent(ctorOf(this._state.kind));
        restore(comp, this._state);
        this._ref.comp = comp;
        _refs.set(comp, this._ref);
    }
}
