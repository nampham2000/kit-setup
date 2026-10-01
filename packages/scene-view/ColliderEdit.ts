import { BoxCollider, CapsuleCollider, Collider, SphereCollider } from 'cc';

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
