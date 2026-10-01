import { BoxCollider, CapsuleCollider, Collider, SphereCollider, Vec3 } from 'cc';

export type ColliderKind = 'box' | 'sphere' | 'capsule';

/**
 * Whether the physics module is in this build. Colliders are classes from `cc`, and a
 * project that cropped physics out has them undefined, so every use is behind this.
 */
export function physicsAvailable (): boolean {
    return typeof Collider === 'function' && typeof BoxCollider === 'function'
        && typeof SphereCollider === 'function' && typeof CapsuleCollider === 'function';
}

/** Which of the shapes this tool can draw and edit a collider is, or null for any other kind. */
export function kindOf (collider: Collider): ColliderKind | null {
    if (!physicsAvailable()) return null;
    if (collider instanceof BoxCollider) return 'box';
    if (collider instanceof SphereCollider) return 'sphere';
    if (collider instanceof CapsuleCollider) return 'capsule';
    return null;
}

/** The collider's shape as plain numbers; see ColliderMath for the layout of each kind. */
export function shapeOf (collider: Collider): number[] {
    const c = collider.center;
    if (collider instanceof BoxCollider) {
        const s = collider.size;
        return [c.x, c.y, c.z, s.x, s.y, s.z];
    }
    if (collider instanceof SphereCollider) return [c.x, c.y, c.z, collider.radius];
    if (collider instanceof CapsuleCollider) {
        return [c.x, c.y, c.z, collider.radius, collider.cylinderHeight, collider.direction as number];
    }
    return [c.x, c.y, c.z];
}

/** Write a shape made by `shapeOf` (or by ColliderMath from one) back onto the collider. */
export function applyShape (collider: Collider, shape: readonly number[]) {
    collider.center = new Vec3(shape[0], shape[1], shape[2]);
    if (collider instanceof BoxCollider) {
        collider.size = new Vec3(shape[3], shape[4], shape[5]);
    } else if (collider instanceof SphereCollider) {
        collider.radius = shape[3];
    } else if (collider instanceof CapsuleCollider) {
        collider.radius = shape[3];
        collider.cylinderHeight = shape[4];
    }
}
