import { Layers, ModelRenderer, Node, UIRenderer, UITransform, geometry, renderer } from 'cc';

type Model = renderer.scene.Model;

/**
 * Anything that draws a model: MeshRenderer, SkinnedMeshRenderer, and the 3D
 * SpriteRenderer.
 *
 * SpriteRenderer extends ModelRenderer, a sibling of MeshRenderer rather than a
 * child of it, so `getComponentsInChildren(MeshRenderer)` never returns one. The
 * scene view used to gather only MeshRenderers, which left sprite-based scenery
 * invisible to picking and to bounds: clicking a sprite background selected
 * nothing and drew no outline.
 *
 * The base class does not expose `model` publicly, only a protected `_models`.
 * Each subclass defines its own `model` getter, so this reads that and falls back
 * to the protected array.
 */
export function modelOf (r: ModelRenderer): Model | null {
    const any = r as any;
    return any.model ?? any._models?.[0] ?? null;
}

/**
 * World-space bounds, or null when there are none worth using.
 *
 * A model that has never been given bounds reports a zero-size box at the origin.
 * Drawing or picking against that would put a speck at the world origin for every
 * such renderer. A flat quad is fine: only one axis is zero, never all three.
 */
export function worldBoundsOf (r: ModelRenderer): geometry.AABB | null {
    const bounds = modelOf(r)?.worldBounds;
    if (!bounds) return null;

    const half = bounds.halfExtents;
    if (half.x <= 0 && half.y <= 0 && half.z <= 0) return null;
    return bounds;
}

/**
 * Whether an exact ray/triangle test can say anything about this model.
 *
 * The engine answers 0 - not an error - when a sub-mesh has no readable vertex
 * data, which is the case for meshes built without data access. 0 also means
 * "missed", so without this check a renderer that merely cannot be tested would
 * be rejected after its bounding box was hit.
 */
export function hasReadableTriangles (model: Model): boolean {
    try {
        const subModels = model.subModels;
        for (let i = 0; i < subModels.length; i++) {
            const positions = subModels[i].subMesh?.geometricInfo?.positions;
            if (positions && positions.length > 0) return true;
        }
    } catch {
        // Treated as unreadable.
    }
    return false;
}

const _accum = geometry.AABB.create();
const _part = geometry.AABB.create();

/** Editor scaffolding: present at runtime in the Preview panel, never content. */
const EDITOR_LAYER_MASK = Layers.Enum.GIZMOS
    | Layers.Enum.EDITOR
    | Layers.Enum.SCENE_GIZMO
    | Layers.Enum.PROFILER;

/**
 * Combined world bounds of a node and everything under it: model renderers and
 * UI elements alike. Null when there is nothing to measure.
 *
 * Framing needs this rather than the node's own renderer. Most of what one wants
 * to fly to is a container - "Background", "Canvas", a character rig - which has
 * no renderer of its own, and measuring only that would frame a point at its
 * pivot. Inactive nodes and editor scaffolding are skipped.
 */
export function subtreeBounds (root: Node, out: geometry.AABB): geometry.AABB | null {
    let found = false;

    const include = (box: geometry.AABB) => {
        if (!found) {
            geometry.AABB.copy(_accum, box);
            found = true;
        } else {
            geometry.AABB.merge(_accum, _accum, box);
        }
    };

    const visit = (node: Node) => {
        if (!node.activeInHierarchy || (node.layer & EDITOR_LAYER_MASK) !== 0) return;

        const modelRenderer = node.getComponent(ModelRenderer);
        const modelBox = modelRenderer ? worldBoundsOf(modelRenderer) : null;
        if (modelBox) {
            include(modelBox);
        } else if (UIRenderer && node.getComponent(UIRenderer)) {
            // Only drawn UI counts. A layout node's rect spans its whole container.
            const transform = node.getComponent(UITransform);
            if (transform) {
                transform.getComputeAABB(_part);
                include(_part);
            }
        }

        const children = node.children;
        for (let i = 0; i < children.length; i++) visit(children[i]);
    };

    visit(root);

    // A UI container with nothing drawn under it still has a rect worth framing.
    if (!found && UITransform) {
        const own = root.getComponent(UITransform);
        if (own) {
            own.getComputeAABB(_part);
            include(_part);
        }
    }

    if (!found) return null;
    geometry.AABB.copy(out, _accum);
    return out;
}
