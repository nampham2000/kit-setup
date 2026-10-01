import { Vec3 } from 'cc';

/**
 * Mesh data in the shape `utils.MeshUtils.createMesh` takes.
 *
 * Built here rather than with the engine's `primitives`, because a project can leave
 * that module out of its engine build (SmashFest does, to keep the playable small) and
 * `primitives` is then undefined at runtime. Nothing below needs any engine module.
 */
export interface MeshData {
    positions: number[];
    normals: number[];
    uvs: number[];
    indices: number[];
    minPos: Vec3;
    maxPos: Vec3;
    boundingRadius: number;
}

const TAU = Math.PI * 2;

class Builder {
    public positions: number[] = [];
    public normals: number[] = [];
    public uvs: number[] = [];
    public indices: number[] = [];

    public vertex (x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): number {
        this.positions.push(x, y, z);
        this.normals.push(nx, ny, nz);
        this.uvs.push(u, v);
        return this.positions.length / 3 - 1;
    }

    /** A triangle whose winding is flipped if needed so it faces the way its vertex normals do. */
    public triangle (a: number, b: number, c: number) {
        const p = this.positions;
        const n = this.normals;
        const e1x = p[b * 3] - p[a * 3];
        const e1y = p[b * 3 + 1] - p[a * 3 + 1];
        const e1z = p[b * 3 + 2] - p[a * 3 + 2];
        const e2x = p[c * 3] - p[a * 3];
        const e2y = p[c * 3 + 1] - p[a * 3 + 1];
        const e2z = p[c * 3 + 2] - p[a * 3 + 2];
        const fx = e1y * e2z - e1z * e2y;
        const fy = e1z * e2x - e1x * e2z;
        const fz = e1x * e2y - e1y * e2x;
        const nx = n[a * 3] + n[b * 3] + n[c * 3];
        const ny = n[a * 3 + 1] + n[b * 3 + 1] + n[c * 3 + 1];
        const nz = n[a * 3 + 2] + n[b * 3 + 2] + n[c * 3 + 2];

        if (fx * nx + fy * ny + fz * nz < 0) this.indices.push(a, c, b);
        else this.indices.push(a, b, c);
    }

    /** Join a grid of `rows` x `cols + 1` vertices (laid out row by row) with triangles. */
    public grid (first: number, rows: number, cols: number) {
        const stride = cols + 1;
        for (let i = 0; i < rows - 1; i++) {
            for (let j = 0; j < cols; j++) {
                const a = first + i * stride + j;
                const b = a + 1;
                const c = a + stride;
                const d = c + 1;
                this.triangle(a, c, b);
                this.triangle(b, c, d);
            }
        }
    }

    public build (): MeshData {
        const min = new Vec3(Infinity, Infinity, Infinity);
        const max = new Vec3(-Infinity, -Infinity, -Infinity);
        let radius = 0;
        for (let i = 0; i < this.positions.length; i += 3) {
            const x = this.positions[i];
            const y = this.positions[i + 1];
            const z = this.positions[i + 2];
            min.set(Math.min(min.x, x), Math.min(min.y, y), Math.min(min.z, z));
            max.set(Math.max(max.x, x), Math.max(max.y, y), Math.max(max.z, z));
            radius = Math.max(radius, Math.sqrt(x * x + y * y + z * z));
        }
        return {
            positions: this.positions,
            normals: this.normals,
            uvs: this.uvs,
            indices: this.indices,
            minPos: min,
            maxPos: max,
            boundingRadius: radius,
        };
    }
}

/** A cube centred on the origin, with four vertices per face so each face is lit flat. */
export function boxData (size = 1): MeshData {
    const h = size / 2;
    const b = new Builder();
    // Each face: its outward normal, then two in-plane directions.
    const faces: [number[], number[], number[]][] = [
        [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
        [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
        [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
        [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
        [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
        [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
    ];
    for (const [n, u, v] of faces) {
        const corner = (su: number, sv: number) => b.vertex(
            (n[0] + u[0] * su + v[0] * sv) * h,
            (n[1] + u[1] * su + v[1] * sv) * h,
            (n[2] + u[2] * su + v[2] * sv) * h,
            n[0], n[1], n[2], (su + 1) / 2, (sv + 1) / 2,
        );
        const a = corner(-1, -1);
        const c = corner(1, -1);
        const d = corner(1, 1);
        const e = corner(-1, 1);
        b.triangle(a, c, d);
        b.triangle(a, d, e);
    }
    return b.build();
}

/** A flat square in the XZ plane facing up. */
export function planeData (width = 2, length = 2): MeshData {
    const w = width / 2;
    const l = length / 2;
    const b = new Builder();
    const a = b.vertex(-w, 0, -l, 0, 1, 0, 0, 0);
    const c = b.vertex(w, 0, -l, 0, 1, 0, 1, 0);
    const d = b.vertex(w, 0, l, 0, 1, 0, 1, 1);
    const e = b.vertex(-w, 0, l, 0, 1, 0, 0, 1);
    b.triangle(a, e, d);
    b.triangle(a, d, c);
    return b.build();
}

/** A sphere of `radius`, as latitude rings by longitude segments. */
export function sphereData (radius = 0.5, rings = 16, segments = 32): MeshData {
    return capsuleData(radius, 0, rings, segments);
}

/**
 * A capsule along Y: a straight part of `height` between two hemispheres of `radius`.
 * With a height of 0 it is a sphere, which is how `sphereData` is made.
 */
export function capsuleData (radius = 0.5, height = 1, rings = 16, segments = 32): MeshData {
    const b = new Builder();
    const half = Math.max(2, Math.floor(rings / 2));
    const rowAngles: number[] = [];
    for (let i = 0; i <= half; i++) rowAngles.push((i / half) * (Math.PI / 2));
    for (let i = 0; i <= half; i++) rowAngles.push(Math.PI / 2 + (i / half) * (Math.PI / 2));

    rowAngles.forEach((theta, row) => {
        const offset = row <= half ? height / 2 : -height / 2;
        const ny = Math.cos(theta);
        const ring = Math.sin(theta);
        for (let j = 0; j <= segments; j++) {
            const phi = (j / segments) * TAU;
            const nx = ring * Math.cos(phi);
            const nz = ring * Math.sin(phi);
            b.vertex(nx * radius, ny * radius + offset, nz * radius, nx, ny, nz, j / segments, row / (rowAngles.length - 1));
        }
    });
    b.grid(0, rowAngles.length, segments);
    return b.build();
}

/** A cylinder along Y with flat caps. */
export function cylinderData (radius = 0.5, height = 1, segments = 32): MeshData {
    const b = new Builder();
    const half = height / 2;

    // Side: two rings with outward normals.
    for (const y of [half, -half]) {
        for (let j = 0; j <= segments; j++) {
            const phi = (j / segments) * TAU;
            const x = Math.cos(phi);
            const z = Math.sin(phi);
            b.vertex(x * radius, y, z * radius, x, 0, z, j / segments, y > 0 ? 0 : 1);
        }
    }
    b.grid(0, 2, segments);

    // Caps: a fan around a centre vertex, with the cap's own normal.
    for (const sign of [1, -1]) {
        const centre = b.vertex(0, half * sign, 0, 0, sign, 0, 0.5, 0.5);
        const first = b.positions.length / 3;
        for (let j = 0; j <= segments; j++) {
            const phi = (j / segments) * TAU;
            const x = Math.cos(phi);
            const z = Math.sin(phi);
            b.vertex(x * radius, half * sign, z * radius, 0, sign, 0, 0.5 + x / 2, 0.5 + z / 2);
        }
        for (let j = 0; j < segments; j++) b.triangle(centre, first + j + 1, first + j);
    }
    return b.build();
}
