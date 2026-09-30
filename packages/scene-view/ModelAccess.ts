import { ModelRenderer, geometry, renderer } from 'cc';

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
