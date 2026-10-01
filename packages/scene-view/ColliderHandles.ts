import { Camera, Collider, Color, Mat4, Node, Vec3, geometry, screen } from 'cc';
import { applyShape, kindOf, physicsAvailable, shapeOf } from './ColliderEdit';
import { dragBoxFace, dragCapsuleHeight, dragRadius, worldDelta } from './ColliderMath';
import { Command, ValueCommand } from './History';
import { GeometryRenderer } from './SceneGizmos';

const IDLE = new Color(236, 244, 236, 255);
const LIT = new Color(255, 214, 64, 255);

/** Handle size, and the reference length drags are measured against, as fractions of the distance to the camera. */
const HANDLE_SCALE = 0.014;
const REFERENCE_SCALE = 0.2;

/** Grab radius around a handle, in CSS pixels. */
const GRAB_RADIUS_CSS = 10;

type HandleKind = 'face' | 'radius' | 'height';

interface Handle {
    id: string;
    collider: Collider;
    kind: HandleKind;
    axis: 0 | 1 | 2;
    /** +1 or -1: which end of the axis the handle sits on. */
    sign: 1 | -1;
    position: Vec3;
    /** World direction that counts as "outwards" for this handle. */
    direction: Vec3;
    /** World units per local unit along that direction, since the node may be scaled. */
    unit: number;
}

interface Drag {
    handle: Handle;
    shape: number[];
    start: Vec3;
    mouseX: number;
    mouseY: number;
    reference: number;
}

const _m = new Mat4();
const _scale = new Vec3();
const _center = new Vec3();
const _local = new Vec3();
const _cam = new Vec3();
const _p = new Vec3();
const _a = new Vec3();
const _b = new Vec3();
const _box = geometry.AABB.create();

/**
 * Grab-and-drag handles on the colliders of the selected node, for the Collider tool.
 *
 * A box gets a handle on each face, a sphere on six points of its surface, a capsule a
 * handle on each end and four around its middle. Dragging a handle resizes the shape and
 * leaves the opposite side where it was. Like the transform gizmo it works in screen
 * space: it projects a short length along the handle's direction to the screen and
 * measures the cursor against that, so it needs no collision geometry and degrades to
 * "does nothing" when the direction points at the camera.
 *
 * Each drag is computed from the shape it started with, and ends as one undo step.
 */
export class ColliderHandles {
    private _camera: Camera = null;
    private _node: Node = null;
    private _handles: Handle[] = [];
    private _size = 0.1;
    private _reference = 1;
    private _hover: string | null = null;
    private _drag: Drag | null = null;

    public get dragging (): boolean { return this._drag !== null; }

    /** True while the pointer rests on a handle and no drag is under way. */
    public get hovering (): boolean { return this._drag === null && this._hover !== null; }

    /** True when there is at least one handle to grab, so the caller can tell the user otherwise. */
    public get hasHandles (): boolean { return this._handles.length > 0; }

    /** Rebuild the handles for this frame from the colliders as they are now. */
    public sync (camera: Camera, node: Node | null) {
        this._camera = camera;
        this._node = node;
        this._handles.length = 0;
        if (!camera || !node || !node.isValid || !physicsAvailable()) return;

        node.getWorldMatrix(_m);
        node.getWorldScale(_scale);
        const axes = [node.right, node.up, node.forward];
        const scale = [Math.abs(_scale.x), Math.abs(_scale.y), Math.abs(_scale.z)];

        camera.node.getWorldPosition(_cam);
        node.getWorldPosition(_p);
        const distance = Math.max(Vec3.distance(_cam, _p), 0.1);
        this._size = distance * HANDLE_SCALE;
        this._reference = distance * REFERENCE_SCALE;

        for (const collider of node.getComponents(Collider)) {
            if (!collider.isValid) continue;
            const kind = kindOf(collider);
            if (!kind) continue;
            const shape = shapeOf(collider);
            Vec3.transformMat4(_center, new Vec3(shape[0], shape[1], shape[2]), _m);

            if (kind === 'box') {
                for (let axis = 0 as 0 | 1 | 2; axis < 3; axis++) {
                    for (const sign of [1, -1] as (1 | -1)[]) {
                        _local.set(shape[0], shape[1], shape[2]);
                        _local[axis === 0 ? 'x' : axis === 1 ? 'y' : 'z'] += sign * shape[3 + axis] / 2;
                        const position = Vec3.transformMat4(new Vec3(), _local, _m);
                        const direction = Vec3.multiplyScalar(new Vec3(), axes[axis], sign);
                        this._add(collider, 'face', axis, sign, position, direction, scale[axis]);
                    }
                }
            } else if (kind === 'sphere') {
                // Drawn as circles of the largest scale around the world centre, so the handles sit on those.
                const unit = Math.max(scale[0], scale[1], scale[2]);
                for (let axis = 0 as 0 | 1 | 2; axis < 3; axis++) {
                    for (const sign of [1, -1] as (1 | -1)[]) {
                        const direction = Vec3.multiplyScalar(new Vec3(), axes[axis], sign);
                        const position = Vec3.scaleAndAdd(new Vec3(), _center, direction, shape[3] * unit);
                        this._add(collider, 'radius', axis, sign, position, direction, unit);
                    }
                }
            } else {
                const along = Math.max(0, Math.min(2, shape[5])) as 0 | 1 | 2;
                const o1 = ((along + 1) % 3) as 0 | 1 | 2;
                const o2 = ((along + 2) % 3) as 0 | 1 | 2;
                const radiusUnit = Math.max(scale[o1], scale[o2]);
                const half = (shape[4] / 2) * scale[along];
                const radius = shape[3] * radiusUnit;

                for (const sign of [1, -1] as (1 | -1)[]) {
                    const direction = Vec3.multiplyScalar(new Vec3(), axes[along], sign);
                    // The tip of the cap: the end of the straight part plus one radius.
                    const position = Vec3.scaleAndAdd(new Vec3(), _center, direction, half + radius);
                    this._add(collider, 'height', along, sign, position, direction, scale[along]);
                }
                for (const o of [o1, o2]) {
                    for (const sign of [1, -1] as (1 | -1)[]) {
                        const direction = Vec3.multiplyScalar(new Vec3(), axes[o], sign);
                        const position = Vec3.scaleAndAdd(new Vec3(), _center, direction, radius);
                        this._add(collider, 'radius', o, sign, position, direction, radiusUnit);
                    }
                }
            }
        }
    }

    private _add (
        collider: Collider, kind: HandleKind, axis: 0 | 1 | 2, sign: 1 | -1,
        position: Vec3, direction: Vec3, unit: number,
    ) {
        this._handles.push({
            id: `${collider.uuid}:${kind}:${axis}:${sign}`,
            collider, kind, axis, sign, position, direction,
            unit: Math.max(unit, 1e-6),
        });
    }

    public setHover (x: number, y: number) {
        if (this._drag) return;
        this._hover = this.hitTest(x, y);
    }

    public clearHover () {
        if (!this._drag) this._hover = null;
    }

    /** The id of the handle under the cursor, or null. Nearest wins when several overlap. */
    public hitTest (screenX: number, screenY: number): string | null {
        if (!this._camera) return null;
        let best: string | null = null;
        let bestDistance = GRAB_RADIUS_CSS * dpr();

        for (const handle of this._handles) {
            if (!this._project(handle.position, _a)) continue;
            const distance = Math.hypot(screenX - _a.x, screenY - _a.y);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = handle.id;
            }
        }
        return best;
    }

    public beginDrag (id: string, screenX: number, screenY: number) {
        const handle = this._handles.find((h) => h.id === id);
        if (!handle) return;
        this._hover = id;
        this._drag = {
            handle,
            shape: shapeOf(handle.collider),
            start: handle.position.clone(),
            mouseX: screenX,
            mouseY: screenY,
            reference: this._reference,
        };
    }

    public drag (screenX: number, screenY: number) {
        const drag = this._drag;
        if (!drag || !drag.handle.collider.isValid || !this._camera) return;

        // The on-screen vector of a reference length along the handle's direction.
        Vec3.scaleAndAdd(_b, drag.start, drag.handle.direction, drag.reference);
        if (!this._project(drag.start, _a) || !this._project(_b, _p)) return;

        const world = worldDelta(_p.x - _a.x, _p.y - _a.y, screenX - drag.mouseX, screenY - drag.mouseY, drag.reference);
        const local = world / drag.handle.unit;

        let shape: number[];
        if (drag.handle.kind === 'face') shape = dragBoxFace(drag.shape, drag.handle.axis, drag.handle.sign, local);
        else if (drag.handle.kind === 'height') shape = dragCapsuleHeight(drag.shape, local);
        else shape = dragRadius(drag.shape, 3, local);

        applyShape(drag.handle.collider, shape);
    }

    /** Finish the drag. Returns the undo step for it, or null if nothing changed. */
    public endDrag (): Command | null {
        const drag = this._drag;
        this._drag = null;
        if (!drag) return null;

        const collider = drag.handle.collider;
        if (!collider.isValid) return null;

        const before = drag.shape;
        const after = shapeOf(collider);
        if (before.every((value, i) => Math.abs(value - after[i]) < 1e-9)) return null;

        const name = this._node && this._node.isValid ? this._node.name : collider.node.name;
        return new ValueCommand<number[]>(
            `Resize ${collider.constructor.name} of ${name}`,
            () => collider.isValid,
            (value) => applyShape(collider, value),
            before, after,
        );
    }

    public draw (gr: GeometryRenderer) {
        for (const handle of this._handles) {
            const lit = this._drag ? this._drag.handle.id === handle.id : this._hover === handle.id;
            const half = this._size * (lit ? 1.35 : 1);
            geometry.AABB.set(_box, handle.position.x, handle.position.y, handle.position.z, half, half, half);
            gr.addBoundingBox(_box, lit ? LIT : IDLE, false, false);
        }
    }

    /** Returns false when the point is behind the camera, where the perspective divide mirrors it. */
    private _project (world: Vec3, out: Vec3): boolean {
        this._camera.worldToScreen(world, out);
        return out.z > 0 && out.z < 1;
    }
}

function dpr (): number {
    const ratio = screen.devicePixelRatio;
    return ratio > 0 ? ratio : 1;
}
