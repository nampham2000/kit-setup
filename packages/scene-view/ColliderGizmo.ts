import { BoxCollider, CapsuleCollider, Collider, Color, Mat4, Node, SphereCollider, Vec3 } from 'cc';
import { physicsAvailable } from './ColliderEdit';
import { GeometryRenderer } from './SceneGizmos';

const SHAPE = new Color(123, 227, 123, 255);
const SEGMENTS = 32;

const _m = new Mat4();
const _s = new Vec3();
const _local = new Vec3();
const _a = new Vec3();
const _b = new Vec3();
const _c = new Vec3();
const _center = new Vec3();
const _axes = [new Vec3(), new Vec3(), new Vec3()];
const _corners: Vec3[] = [];
for (let i = 0; i < 8; i++) _corners.push(new Vec3());

/** Pairs of corner indices that form the twelve edges of a box. */
const EDGES = [
    [0, 1], [1, 3], [3, 2], [2, 0],
    [4, 5], [5, 7], [7, 6], [6, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
];

/**
 * Draw the shape of every collider on `node` as a green wireframe, in world space and
 * following the node's rotation and scale, which is how the physics engine applies them.
 *
 * This is what makes a collider editable by eye: the number in a field means nothing
 * until it can be seen against the mesh it is meant to match. Drawn without a depth
 * test, because a collider that sits inside its mesh would otherwise be hidden by it.
 */
export function drawColliders (gr: GeometryRenderer, node: Node) {
    if (!gr || !node || !node.isValid || !physicsAvailable()) return;

    for (const collider of node.getComponents(Collider)) {
        if (!collider.isValid) continue;
        if (collider instanceof BoxCollider) drawBox(gr, node, collider);
        else if (collider instanceof SphereCollider) drawSphere(gr, node, collider);
        else if (collider instanceof CapsuleCollider) drawCapsule(gr, node, collider);
    }
}

function drawBox (gr: GeometryRenderer, node: Node, collider: BoxCollider) {
    node.getWorldMatrix(_m);
    const c = collider.center;
    const h = collider.size;

    for (let i = 0; i < 8; i++) {
        _local.set(
            c.x + (i & 1 ? h.x : -h.x) / 2,
            c.y + (i & 2 ? h.y : -h.y) / 2,
            c.z + (i & 4 ? h.z : -h.z) / 2,
        );
        Vec3.transformMat4(_corners[i], _local, _m);
    }
    for (const [from, to] of EDGES) gr.addLine(_corners[from], _corners[to], SHAPE, false);
}

function drawSphere (gr: GeometryRenderer, node: Node, collider: SphereCollider) {
    node.getWorldMatrix(_m);
    Vec3.transformMat4(_center, collider.center, _m);
    node.getWorldScale(_s);
    // The physics engine scales a sphere by the largest axis.
    const radius = collider.radius * Math.max(Math.abs(_s.x), Math.abs(_s.y), Math.abs(_s.z));

    worldAxes(node);
    circle(gr, _center, _axes[0], _axes[1], radius);
    circle(gr, _center, _axes[1], _axes[2], radius);
    circle(gr, _center, _axes[0], _axes[2], radius);
}

function drawCapsule (gr: GeometryRenderer, node: Node, collider: CapsuleCollider) {
    node.getWorldMatrix(_m);
    Vec3.transformMat4(_center, collider.center, _m);
    node.getWorldScale(_s);
    worldAxes(node);

    const axis = Math.max(0, Math.min(2, collider.direction as number));
    const o1 = (axis + 1) % 3;
    const o2 = (axis + 2) % 3;
    const scale = [Math.abs(_s.x), Math.abs(_s.y), Math.abs(_s.z)];

    const half = (collider.cylinderHeight / 2) * scale[axis];
    const radius = collider.radius * Math.max(scale[o1], scale[o2]);
    const along = _axes[axis];
    const u = _axes[o1];
    const v = _axes[o2];

    for (const sign of [1, -1]) {
        // Ring where the straight part meets the cap, and the cap as two half circles.
        Vec3.scaleAndAdd(_a, _center, along, sign * half);
        circle(gr, _a, u, v, radius);
        halfCircle(gr, _a, u, along, radius, sign);
        halfCircle(gr, _a, v, along, radius, sign);
    }
    // Four lines joining the two rings.
    for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        Vec3.scaleAndAdd(_b, _center, u, x * radius);
        Vec3.scaleAndAdd(_b, _b, v, y * radius);
        Vec3.scaleAndAdd(_a, _b, along, half);
        Vec3.scaleAndAdd(_c, _b, along, -half);
        gr.addLine(_a, _c, SHAPE, false);
    }
}

/** The node's world X, Y and Z directions, as unit vectors. */
function worldAxes (node: Node) {
    Vec3.copy(_axes[0], node.right);
    Vec3.copy(_axes[1], node.up);
    Vec3.copy(_axes[2], node.forward);
}

function circle (gr: GeometryRenderer, center: Vec3, u: Vec3, v: Vec3, radius: number) {
    let prevX = 0;
    let prevY = 0;
    const from = new Vec3();
    const to = new Vec3();
    for (let i = 0; i <= SEGMENTS; i++) {
        const t = (i / SEGMENTS) * Math.PI * 2;
        const x = Math.cos(t) * radius;
        const y = Math.sin(t) * radius;
        if (i > 0) {
            Vec3.scaleAndAdd(from, center, u, prevX);
            Vec3.scaleAndAdd(from, from, v, prevY);
            Vec3.scaleAndAdd(to, center, u, x);
            Vec3.scaleAndAdd(to, to, v, y);
            gr.addLine(from, to, SHAPE, false);
        }
        prevX = x;
        prevY = y;
    }
}

/** Half a circle in the plane of `side` and `up`, bulging towards `up * sign`. */
function halfCircle (gr: GeometryRenderer, center: Vec3, side: Vec3, up: Vec3, radius: number, sign: number) {
    const from = new Vec3();
    const to = new Vec3();
    let prevX = radius;
    let prevY = 0;
    for (let i = 1; i <= SEGMENTS / 2; i++) {
        const t = (i / (SEGMENTS / 2)) * Math.PI;
        const x = Math.cos(t) * radius;
        const y = Math.sin(t) * radius * sign;
        Vec3.scaleAndAdd(from, center, side, prevX);
        Vec3.scaleAndAdd(from, from, up, prevY);
        Vec3.scaleAndAdd(to, center, side, x);
        Vec3.scaleAndAdd(to, to, up, y);
        gr.addLine(from, to, SHAPE, false);
        prevX = x;
        prevY = y;
    }
}
