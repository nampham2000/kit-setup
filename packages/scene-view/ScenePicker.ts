import { Camera, MeshRenderer, UIRenderer, UITransform, geometry, screen } from 'cc';

const _ray = geometry.Ray.create();
const _uiBounds = geometry.AABB.create();

/** rayModel needs both fields; they are not optional in IRaySubMeshOptions. */
const RAY_MODEL_OPTIONS = {
    mode: geometry.ERaycastMode.CLOSEST,
    distance: Infinity,
};

export interface UIPickResult {
    element: UIRenderer;
    distance: number;
}

export interface PickResult {
    renderer: MeshRenderer;
    distance: number;
}

/**
 * Ray-picks a MeshRenderer under the cursor. No colliders and no physics module
 * required — it walks the renderers the scene view already tracks.
 *
 * Two phases: a cheap ray/AABB sweep to reject most candidates, then an exact
 * ray/mesh test on the survivors. The exact test needs readable vertex data, so
 * it falls back to the AABB hit distance whenever that data is unavailable.
 */
export function pickRenderer (
    camera: Camera,
    screenX: number,
    screenY: number,
    renderers: readonly MeshRenderer[],
): PickResult | null {
    camera.screenPointToRay(screenX, screenY, _ray);

    let best: PickResult = null;
    for (let i = 0; i < renderers.length; i++) {
        const renderer = renderers[i];
        if (!renderer || !renderer.isValid || !renderer.enabledInHierarchy) continue;

        const model = renderer.model;
        const bounds = model?.worldBounds;
        if (!bounds) continue;

        const broad = geometry.intersect.rayAABB(_ray, bounds);
        if (!broad) continue;
        // A farther bounding box cannot contain a nearer surface.
        if (best && broad > best.distance) continue;

        let distance = broad;
        try {
            const exact = geometry.intersect.rayModel(_ray, model, RAY_MODEL_OPTIONS);
            if (!exact) continue; // Bounds were hit but no triangle was.
            distance = exact;
        } catch {
            // Mesh data not readable (allowDataAccess off) — keep the bounds hit.
        }

        if (!best || distance < best.distance) best = { renderer, distance };
    }

    return best;
}

/**
 * Left edge of a camera's viewport, in the coordinate space mouse events use.
 *
 * Derived from the camera's own render-window width rather than `screen.windowSize`.
 * The two agree in a browser, but not in the editor Preview panel, which renders at
 * the project's design resolution while the window reports its physical size — and
 * a threshold in the wrong space silently rejects every click in the viewport.
 * `screenPointToRay` and `worldToScreen` both normalise by this same width, so
 * taking it from the camera keeps hit-testing consistent by construction.
 */
export function viewportMinX (camera: Camera): number {
    if (!camera) return 0;
    const width = (camera.camera as any)?.width;
    const usable = width > 0 ? width : screen.windowSize.width;
    return usable * camera.rect.x;
}

export function isInsideViewport (camera: Camera, screenX: number): boolean {
    return screenX >= viewportMinX(camera);
}


/** The camera's render size in the coordinate space mouse events use. */
export function cameraPixelSize (camera: Camera): { width: number; height: number } {
    const internal = camera?.camera as any;
    const width = internal?.width > 0 ? internal.width : screen.windowSize.width;
    const height = internal?.height > 0 ? internal.height : screen.windowSize.height;
    return { width, height };
}

/**
 * Ray-picks a UI element under the cursor.
 *
 * UI is screen-space but still lives in the world: `UITransform.getComputeAABB`
 * gives a real world-space box, so the same ray that finds meshes finds UI too.
 * Only `UIRenderer` nodes are considered — Sprites, Labels and the like. Bare
 * layout nodes and the Canvas root have boxes that span the whole design
 * resolution and would swallow every click aimed at what is inside them.
 *
 * `UITransform.hitTest` is the other route, but it resolves through the UI
 * camera, so it only answers for the game viewport, never the observer one.
 */
/** Face area of a box. UI is flat, so its two large extents are what count. */
function boxArea (box: geometry.AABB): number {
    const e = [box.halfExtents.x, box.halfExtents.y, box.halfExtents.z].sort((a, b) => b - a);
    return e[0] * e[1];
}

export function pickUI (
    camera: Camera,
    screenX: number,
    screenY: number,
    elements: readonly UIRenderer[],
): UIPickResult | null {
    camera.screenPointToRay(screenX, screenY, _ray);

    let best: (UIPickResult & { area: number }) | null = null;
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i];
        if (!element || !element.isValid || !element.enabledInHierarchy) continue;

        const transform = element.node.getComponent(UITransform);
        if (!transform) continue;

        transform.getComputeAABB(_uiBounds);
        const distance = geometry.intersect.rayAABB(_ray, _uiBounds);
        if (!distance) continue;

        // Flat UI stacks in draw order, so depth alone cannot say which one the
        // eye sees on top, and sibling index is meaningless across unrelated
        // branches. The most specific element is the smallest one under the
        // cursor: a button sits on a panel that sits on a background.
        const area = boxArea(_uiBounds);
        if (!best || area < best.area
            || (area === best.area
                && element.node.getSiblingIndex() >= best.element.node.getSiblingIndex())) {
            best = { element, distance, area };
        }
    }
    return best ? { element: best.element, distance: best.distance } : null;
}
