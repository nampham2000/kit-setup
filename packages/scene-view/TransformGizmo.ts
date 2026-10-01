import { Camera, Color, Node, NodeSpace, Quat, Vec2, Vec3, geometry, screen } from 'cc';
import { GeometryRenderer } from './SceneGizmos';

export type Axis = 0 | 1 | 2;
export type GizmoMode = 'move' | 'rotate' | 'scale' | 'view' | 'collider';

const AXIS_COLORS = [
    new Color(226, 74, 74, 255),
    new Color(110, 205, 88, 255),
    new Color(74, 140, 226, 255),
];
const HIGHLIGHT = new Color(255, 214, 64, 255);

/** Handle length as a fraction of the distance to the camera, so it looks constant. */
const HANDLE_SCALE = 0.16;

/** Grab radius around a handle, in CSS pixels. */
const GRAB_RADIUS_CSS = 9;

/** Segments per rotation ring. Also the resolution of its screen-space hit test. */
const RING_SEGMENTS = 32;

/** A scale drag across one full handle length doubles the axis. */
const SCALE_GAIN = 1;

const MIN_SCALE = 0.001;

const _origin = new Vec3();
const _tip = new Vec3();
const _p = new Vec3();
const _q = new Vec3();
const _dir = new Vec3();
const _u = new Vec3();
const _v = new Vec3();
const _scale = new Vec3();
const _viewDir = new Vec3();
const _screen = new Vec3();
const _originScreen = new Vec3();
const _tipScreen = new Vec3();
const _axisScreen = new Vec2();
const _mouseDelta = new Vec2();
const _rot = new Quat();
const _box = geometry.AABB.create();

/** Projected ring vertices, reused every frame: x, y pairs. */
const _ring = new Float64Array((RING_SEGMENTS + 1) * 2);
const _ringOk: boolean[] = new Array(RING_SEGMENTS + 1).fill(false);

/**
 * Move / rotate / scale gizmo for the selected node, on its local axes — the
 * equivalent of Unity's move, rotate and scale tools in Local mode.
 *
 * Every mode hit-tests and drags in *screen space* rather than intersecting 3D
 * solids. Cocos gives `worldToScreen` and `screenPointToRay` in the same
 * device-pixel, viewport-corrected space as mouse events, so projecting a handle
 * and comparing 2D distances is exact, needs no collision geometry, and degrades
 * gracefully: a handle pointing at the camera simply becomes a short 2D segment
 * that the drag rejects instead of amplifying into a wild delta.
 */
export class TransformGizmo {
    public mode: GizmoMode = 'move';

    private _camera: Camera = null;
    private _node: Node = null;
    private _length = 1;
    private _hover: Axis | null = null;
    private _active: Axis | null = null;
    private _lastX = 0;
    private _lastY = 0;
    private _lastAngle = 0;

    public get dragging (): boolean { return this._active !== null; }

    /** Recompute the handle size for this frame. Call before hitTest or draw. */
    public sync (camera: Camera, node: Node) {
        this._camera = camera;
        this._node = node;
        if (!camera || !node || !node.isValid) return;

        node.getWorldPosition(_origin);
        camera.node.getWorldPosition(_p);
        this._length = Math.max(Vec3.distance(_origin, _p) * HANDLE_SCALE, 0.05);
    }

    public setHover (screenX: number, screenY: number) {
        if (this._active === null) this._hover = this.hitTest(screenX, screenY);
    }

    public clearHover () {
        if (this._active === null) this._hover = null;
    }

    public hitTest (screenX: number, screenY: number): Axis | null {
        if (!this._ready() || this.mode === 'view' || this.mode === 'collider') return null;
        return this.mode === 'rotate'
            ? this._hitRings(screenX, screenY)
            : this._hitAxes(screenX, screenY);
    }

    public beginDrag (axis: Axis, screenX: number, screenY: number) {
        this._active = axis;
        this._hover = axis;
        this._lastX = screenX;
        this._lastY = screenY;

        if (this.mode === 'rotate' && this._projectOrigin(_originScreen)) {
            this._lastAngle = Math.atan2(screenY - _originScreen.y, screenX - _originScreen.x);
        }
    }

    public drag (screenX: number, screenY: number) {
        if (this._active === null || !this._ready()) return;

        if (this.mode === 'rotate') this._dragRotate(screenX, screenY);
        else this._dragAlongAxis(screenX, screenY);
    }

    public endDrag () {
        this._active = null;
    }

    public draw (gr: GeometryRenderer) {
        if (!this._ready() || this.mode === 'view' || this.mode === 'collider') return;
        this._node.getWorldPosition(_origin);

        for (let axis = 0 as Axis; axis < 3; axis++) {
            const lit = this._active === axis || (this._active === null && this._hover === axis);
            const color = lit ? HIGHLIGHT : AXIS_COLORS[axis];

            if (this.mode === 'rotate') this._drawRing(gr, axis, color);
            else this._drawAxis(gr, axis, color);
        }
    }

    // --- drawing -----------------------------------------------------------

    private _drawAxis (gr: GeometryRenderer, axis: Axis, color: Color) {
        this._direction(axis, _dir);
        Vec3.scaleAndAdd(_tip, _origin, _dir, this._length);
        gr.addLine(_origin, _tip, color, false);

        if (this.mode === 'scale') {
            // A solid cube end, so scale is distinguishable from move at a glance.
            const half = this._length * 0.07;
            geometry.AABB.set(_box, _tip.x, _tip.y, _tip.z, half, half, half);
            gr.addBoundingBox(_box, color, false, false);
        } else {
            gr.addCross(_tip, this._length * 0.16, color, false);
        }
    }

    private _drawRing (gr: GeometryRenderer, axis: Axis, color: Color) {
        this._basis(axis, _u, _v);
        for (let i = 0; i < RING_SEGMENTS; i++) {
            ringPoint(_origin, _u, _v, this._length, i / RING_SEGMENTS, _p);
            ringPoint(_origin, _u, _v, this._length, (i + 1) / RING_SEGMENTS, _q);
            gr.addLine(_p, _q, color, false);
        }
    }

    // --- hit testing -------------------------------------------------------

    private _hitAxes (screenX: number, screenY: number): Axis | null {
        if (!this._projectOrigin(_originScreen)) return null;

        let best: Axis | null = null;
        let bestDistance = GRAB_RADIUS_CSS * dpr();

        for (let axis = 0 as Axis; axis < 3; axis++) {
            this._direction(axis, _dir);
            this._node.getWorldPosition(_p);
            Vec3.scaleAndAdd(_p, _p, _dir, this._length);
            if (!this._project(_p, _tipScreen)) continue;

            const distance = pointToSegment(
                screenX, screenY,
                _originScreen.x, _originScreen.y,
                _tipScreen.x, _tipScreen.y,
            );
            if (distance < bestDistance) {
                bestDistance = distance;
                best = axis;
            }
        }
        return best;
    }

    private _hitRings (screenX: number, screenY: number): Axis | null {
        let best: Axis | null = null;
        let bestDistance = GRAB_RADIUS_CSS * dpr();

        this._node.getWorldPosition(_origin);
        for (let axis = 0 as Axis; axis < 3; axis++) {
            this._projectRing(axis);

            for (let i = 0; i < RING_SEGMENTS; i++) {
                // Skip only the segments that cross behind the camera, not the whole
                // ring — up close most of it is still on screen and grabbable.
                if (!_ringOk[i] || !_ringOk[i + 1]) continue;
                const distance = pointToSegment(
                    screenX, screenY,
                    _ring[i * 2], _ring[i * 2 + 1],
                    _ring[(i + 1) * 2], _ring[(i + 1) * 2 + 1],
                );
                if (distance < bestDistance) {
                    bestDistance = distance;
                    best = axis;
                }
            }
        }
        return best;
    }

    /** Fills `_ring` and `_ringOk`, flagging vertices that fell behind the camera. */
    private _projectRing (axis: Axis) {
        this._basis(axis, _u, _v);
        for (let i = 0; i <= RING_SEGMENTS; i++) {
            ringPoint(_origin, _u, _v, this._length, i / RING_SEGMENTS, _p);
            _ringOk[i] = this._project(_p, _screen);
            _ring[i * 2] = _screen.x;
            _ring[i * 2 + 1] = _screen.y;
        }
    }

    // --- dragging ----------------------------------------------------------

    private _dragAlongAxis (screenX: number, screenY: number) {
        const axis = this._active;
        if (!this._projectOrigin(_originScreen)) return;

        this._direction(axis, _dir);
        this._node.getWorldPosition(_p);
        Vec3.scaleAndAdd(_p, _p, _dir, this._length);
        if (!this._project(_p, _tipScreen)) return;

        _axisScreen.set(_tipScreen.x - _originScreen.x, _tipScreen.y - _originScreen.y);
        const lengthSqr = _axisScreen.lengthSqr();
        // The handle points (nearly) at the camera: any drag would map to a wild
        // delta, so ignore this frame and wait for a better angle.
        if (lengthSqr < 1) return;

        _mouseDelta.set(screenX - this._lastX, screenY - this._lastY);
        this._lastX = screenX;
        this._lastY = screenY;

        // Fraction of the handle the cursor travelled along.
        const t = (_mouseDelta.x * _axisScreen.x + _mouseDelta.y * _axisScreen.y) / lengthSqr;

        if (this.mode === 'scale') {
            Vec3.copy(_scale, this._node.scale);
            const factor = Math.max(MIN_SCALE, 1 + t * SCALE_GAIN);
            if (axis === 0) _scale.x = Math.max(MIN_SCALE, _scale.x * factor);
            else if (axis === 1) _scale.y = Math.max(MIN_SCALE, _scale.y * factor);
            else _scale.z = Math.max(MIN_SCALE, _scale.z * factor);
            this._node.setScale(_scale);
            return;
        }

        this._direction(axis, _dir);
        Vec3.multiplyScalar(_dir, _dir, t * this._length);
        this._node.getWorldPosition(_p);
        this._node.setWorldPosition(Vec3.add(_p, _p, _dir));
    }

    private _dragRotate (screenX: number, screenY: number) {
        const axis = this._active;
        if (!this._projectOrigin(_originScreen)) return;

        const angle = Math.atan2(screenY - _originScreen.y, screenX - _originScreen.x);
        let delta = angle - this._lastAngle;
        // Keep the step on the short way round, so crossing ±pi does not spin.
        if (delta > Math.PI) delta -= Math.PI * 2;
        else if (delta < -Math.PI) delta += Math.PI * 2;
        this._lastAngle = angle;

        this._direction(axis, _dir);

        // Screen angle grows counter-clockwise, which matches a right-handed
        // rotation only while the axis points towards the viewer; flip otherwise,
        // or the far side of the ring would drag backwards.
        this._node.getWorldPosition(_p);
        this._camera.node.getWorldPosition(_q);
        Vec3.subtract(_viewDir, _p, _q);
        const sign = Vec3.dot(_dir, _viewDir) < 0 ? 1 : -1;

        Quat.fromAxisAngle(_rot, _dir, delta * sign);
        this._node.rotate(_rot, NodeSpace.WORLD);
    }

    // --- helpers -----------------------------------------------------------

    private _ready (): boolean {
        return !!this._camera && !!this._node && this._node.isValid;
    }

    /** Local axes, so the handles match the object's own orientation. */
    private _direction (axis: Axis, out: Vec3): Vec3 {
        const dir = axis === 0 ? this._node.right : axis === 1 ? this._node.up : this._node.forward;
        return Vec3.copy(out, dir);
    }

    /** The two unit vectors spanning the plane perpendicular to `axis`. */
    private _basis (axis: Axis, u: Vec3, v: Vec3) {
        this._direction(((axis + 1) % 3) as Axis, u);
        this._direction(((axis + 2) % 3) as Axis, v);
    }

    private _projectOrigin (out: Vec3): boolean {
        this._node.getWorldPosition(_origin);
        return this._project(_origin, out);
    }

    /**
     * Returns false when the point is behind the camera, where the perspective
     * divide mirrors the result and every 2D comparison becomes nonsense.
     */
    private _project (world: Vec3, out: Vec3): boolean {
        this._camera.worldToScreen(world, out);
        return out.z > 0 && out.z < 1;
    }
}

function ringPoint (center: Vec3, u: Vec3, v: Vec3, radius: number, t: number, out: Vec3): Vec3 {
    const angle = t * Math.PI * 2;
    Vec3.scaleAndAdd(out, center, u, Math.cos(angle) * radius);
    return Vec3.scaleAndAdd(out, out, v, Math.sin(angle) * radius);
}

function dpr (): number {
    const ratio = screen.devicePixelRatio;
    return ratio > 0 ? ratio : 1;
}

function pointToSegment (px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSqr = dx * dx + dy * dy;
    if (lengthSqr < 1e-6) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);

    let t = ((px - ax) * dx + (py - ay) * dy) / lengthSqr;
    t = Math.min(1, Math.max(0, t));
    const cx = ax + dx * t;
    const cy = ay + dy * t;
    return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
}
