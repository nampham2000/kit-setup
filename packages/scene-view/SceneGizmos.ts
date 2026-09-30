import { Camera, Color, MeshRenderer, Node, UIRenderer, UITransform, Vec3, geometry } from 'cc';

/**
 * Gizmo drawing helpers. Every function issues draw calls into a per-camera
 * GeometryRenderer, so whatever is drawn here is only visible in that camera —
 * which is exactly how the gizmos stay out of the game view.
 */

const GRID_COLOR = new Color(255, 255, 255, 40);
const GRID_AXIS_COLOR = new Color(255, 255, 255, 90);
const AXIS_X = new Color(226, 74, 74, 255);
const AXIS_Y = new Color(110, 205, 88, 255);
const AXIS_Z = new Color(74, 140, 226, 255);

const _a = new Vec3();
const _b = new Vec3();

export type GeometryRenderer = {
    addLine (v0: Vec3, v1: Vec3, color: Color, depthTest?: boolean): void;
    addBoundingBox (aabb: geometry.AABB, color: Color, wireframe?: boolean, depthTest?: boolean): void;
    addFrustum (frustum: geometry.Frustum, color: Color, depthTest?: boolean): void;
    addCross (position: Vec3, size: number, color: Color, depthTest?: boolean): void;
    addTriangle (v0: Vec3, v1: Vec3, v2: Vec3, color: Color, wireframe?: boolean,
        depthTest?: boolean, unlit?: boolean): void;
};

/** Ground grid on the XZ plane, with the world X/Z axes highlighted. */
export function drawGrid (gr: GeometryRenderer, halfSize = 20, step = 1) {
    for (let i = -halfSize; i <= halfSize; i += step) {
        const onAxis = i === 0;
        const color = onAxis ? GRID_AXIS_COLOR : GRID_COLOR;

        _a.set(i, 0, -halfSize); _b.set(i, 0, halfSize);
        gr.addLine(_a, _b, onAxis ? AXIS_Z : color);

        _a.set(-halfSize, 0, i); _b.set(halfSize, 0, i);
        gr.addLine(_a, _b, onAxis ? AXIS_X : color);
    }
}

/** Unit axis cross at the world origin. */
export function drawWorldAxes (gr: GeometryRenderer, length = 2) {
    const o = Vec3.ZERO;
    gr.addLine(o, _a.set(length, 0, 0), AXIS_X, false);
    gr.addLine(o, _a.set(0, length, 0), AXIS_Y, false);
    gr.addLine(o, _a.set(0, 0, length), AXIS_Z, false);
}

/** Wireframe world-space AABB for every renderer that currently has one. */
export function drawBounds (gr: GeometryRenderer, renderers: readonly MeshRenderer[], color: Color) {
    for (let i = 0; i < renderers.length; i++) {
        const r = renderers[i];
        if (!r || !r.isValid || !r.enabledInHierarchy) continue;
        const bounds = r.model?.worldBounds;
        if (!bounds) continue;
        gr.addBoundingBox(bounds, color, true, false);
    }
}

/** The game camera's view frustum, so you can see what the player actually sees. */
export function drawFrustum (gr: GeometryRenderer, camera: Camera, color: Color) {
    const frustum = (camera.camera as any)?.frustum as geometry.Frustum | undefined;
    if (!frustum) return;
    gr.addFrustum(frustum, color, false);
}

const SELECTION_COLOR = new Color(255, 152, 48, 255);
const _o = new Vec3();
const _e = new Vec3();

/** Highlight for the picked object: AABB, centre cross, and its local axes. */
export function drawSelection (gr: GeometryRenderer, node: Node) {
    // Selection is node-based so that lights, cameras and empty nodes picked from
    // the hierarchy get a gizmo too, not just things with a mesh.
    const renderer = node.getComponent(MeshRenderer);
    const bounds = renderer?.model?.worldBounds;

    node.getWorldPosition(_o);
    if (bounds) gr.addBoundingBox(bounds, SELECTION_COLOR, true, false);
    else gr.addCross(_o, 0.4, SELECTION_COLOR, false);

    // Local axes, scaled to the object so the gizmo stays readable at any size.
    const extent = bounds ? Math.max(bounds.halfExtents.x, bounds.halfExtents.y, bounds.halfExtents.z) : 0.5;
    const length = Math.max(extent * 1.4, 0.5);

    axis(gr, _o, node.right, length, AXIS_X);
    axis(gr, _o, node.up, length, AXIS_Y);
    axis(gr, _o, node.forward, length, AXIS_Z);
}

function axis (gr: GeometryRenderer, origin: Vec3, dir: Readonly<Vec3>, length: number, color: Color) {
    Vec3.scaleAndAdd(_e, origin, dir, length);
    gr.addLine(origin, _e, color, false);
}

const _uiBox = geometry.AABB.create();

/**
 * Outline for UI elements.
 *
 * The observer camera does not render the UI layers — screen-space UI drawn from
 * an arbitrary viewpoint is meaningless — so without an outline there would be
 * nothing on screen to aim a click at.
 */
export function drawUIBounds (gr: GeometryRenderer, elements: readonly UIRenderer[], color: Color) {
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i];
        if (!element || !element.isValid || !element.enabledInHierarchy) continue;

        const transform = element.node.getComponent(UITransform);
        if (!transform) continue;

        transform.getComputeAABB(_uiBox);
        gr.addBoundingBox(_uiBox, color, true, false);
    }
}
