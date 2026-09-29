import { Camera, Color, Vec3 } from 'cc';
import { GeometryRenderer } from './SceneGizmos';

/**
 * Screen-space drawing on top of a camera, built out of world-space geometry.
 *
 * `GeometryRenderer` only speaks world space, so each screen point is pushed back
 * out through `screenToWorld` at one fixed depth. Because every corner of a shape
 * is converted independently at the same depth, the result is exactly the screen
 * rectangle asked for — the perspective divide cancels out. Depth testing is off,
 * so it always lands on top of the scene.
 *
 * This is what lets the overlay widgets work identically in the editor Preview, a
 * browser and a native build: no DOM anywhere.
 */

/** Fraction of the way to the far plane. Near enough to be in front of anything. */
const DEPTH = 0.02;

const _in = new Vec3();
const _p0 = new Vec3();
const _p1 = new Vec3();
const _p2 = new Vec3();
const _p3 = new Vec3();

function toWorld (camera: Camera, x: number, y: number, out: Vec3): Vec3 {
    _in.set(x, y, DEPTH);
    return camera.screenToWorld(_in, out);
}

/** Rectangle outline, stroked with quads so it stacks with the fills. */
export function screenStroke (
    gr: GeometryRenderer, camera: Camera,
    x: number, y: number, w: number, h: number, width: number, color: Color,
) {
    screenThickPath(gr, camera,
        [x, y, x + w, y, x + w, y + h, x, y + h, x, y], width, color);
}

/** Filled quad from four screen-space corners, given in order around the shape. */
export function screenQuad (
    gr: GeometryRenderer, camera: Camera,
    x0: number, y0: number, x1: number, y1: number,
    x2: number, y2: number, x3: number, y3: number, color: Color,
) {
    toWorld(camera, x0, y0, _p0);
    toWorld(camera, x1, y1, _p1);
    toWorld(camera, x2, y2, _p2);
    toWorld(camera, x3, y3, _p3);

    // Both windings. The geometry renderer's material may cull back faces, and
    // which way these quads face depends on the camera — one of the two is always
    // the visible one, and drawing a handful of extra triangles costs nothing.
    gr.addTriangle(_p0, _p1, _p2, color, false, false, true);
    gr.addTriangle(_p0, _p2, _p3, color, false, false, true);
    gr.addTriangle(_p2, _p1, _p0, color, false, false, true);
    gr.addTriangle(_p3, _p2, _p0, color, false, false, true);
}

export function screenFill (
    gr: GeometryRenderer, camera: Camera,
    x: number, y: number, w: number, h: number, color: Color,
) {
    screenQuad(gr, camera, x, y, x + w, y, x + w, y + h, x, y + h, color);
}

/**
 * Polyline drawn as quads instead of lines.
 *
 * The geometry renderer keeps lines and triangles in separate batches and submits
 * every triangle after every line, so a filled panel drawn "behind" line art still
 * paints over it — the active tool button came out blank. Anything that has to
 * stack in a defined order therefore has to be triangles as well. Thick strokes
 * also read far better than hairlines at icon size.
 */
export function screenThickPath (
    gr: GeometryRenderer, camera: Camera,
    points: readonly number[], width: number, color: Color,
) {
    const half = width / 2;

    for (let i = 0; i + 3 < points.length; i += 2) {
        const x0 = points[i];
        const y0 = points[i + 1];
        const x1 = points[i + 2];
        const y1 = points[i + 3];

        const dx = x1 - x0;
        const dy = y1 - y0;
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length < 1e-4) continue;

        const nx = -dy / length * half;
        const ny = dx / length * half;
        screenQuad(gr, camera,
            x0 - nx, y0 - ny, x1 - nx, y1 - ny,
            x1 + nx, y1 + ny, x0 + nx, y0 + ny, color);
    }

    // Square caps at every vertex, so corners do not open up into notches.
    for (let i = 0; i + 1 < points.length; i += 2) {
        screenFill(gr, camera, points[i] - half, points[i + 1] - half, width, width, color);
    }
}
