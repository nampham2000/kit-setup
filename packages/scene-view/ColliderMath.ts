/**
 * The arithmetic of dragging a collider's handles, apart from any engine type so it can
 * be tested on its own.
 *
 * A collider's shape is passed around as a plain array:
 *   box:     [centerX, centerY, centerZ, sizeX, sizeY, sizeZ]
 *   sphere:  [centerX, centerY, centerZ, radius]
 *   capsule: [centerX, centerY, centerZ, radius, height, direction]
 * Every function returns a new array and leaves its input alone, and every drag is
 * computed from the shape the drag started with, so the result depends on where the
 * cursor is and not on how many mouse events it took to get there.
 */

/** Smallest size, radius or height a drag can shrink to. A zero-size shape is a degenerate physics body. */
export const MIN_EXTENT = 0.001;

/**
 * Move one face of a box outwards by `delta` (local units; negative moves it in), with the
 * opposite face staying where it is. That changes the size along `axis` and shifts the
 * centre by half the change, towards the face that moved.
 */
export function dragBoxFace (shape: readonly number[], axis: 0 | 1 | 2, sign: 1 | -1, delta: number): number[] {
    const out = shape.slice();
    const start = shape[3 + axis];
    const size = Math.max(MIN_EXTENT, start + delta);
    out[3 + axis] = size;
    out[axis] = shape[axis] + sign * (size - start) / 2;
    return out;
}

/** Change a radius by `delta` (local units), at the given index of the shape array. */
export function dragRadius (shape: readonly number[], radiusIndex: number, delta: number): number[] {
    const out = shape.slice();
    out[radiusIndex] = Math.max(MIN_EXTENT, shape[radiusIndex] + delta);
    return out;
}

/**
 * Stretch a capsule's straight part. Its two ends move together, so the centre stays put:
 * pulling one end out by `delta` makes the part `2 * delta` longer.
 */
export function dragCapsuleHeight (shape: readonly number[], delta: number): number[] {
    const out = shape.slice();
    out[4] = Math.max(0, shape[4] + 2 * delta);
    return out;
}

/**
 * How far the cursor has dragged along an axis, in world units.
 *
 * `axisX/axisY` is the on-screen vector of a reference length `referenceWorld` along the
 * handle's direction, and `moveX/moveY` is the cursor's movement from where the drag
 * began. Returns 0 when the axis points (nearly) at the camera and projects to a dot:
 * a drag along it would turn any movement into an enormous distance.
 */
export function worldDelta (
    axisX: number, axisY: number, moveX: number, moveY: number, referenceWorld: number,
): number {
    const lengthSqr = axisX * axisX + axisY * axisY;
    if (lengthSqr < 1) return 0;
    return ((moveX * axisX + moveY * axisY) / lengthSqr) * referenceWorld;
}
