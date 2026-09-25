import { Mat4, ParticleSystem, Quat, Vec3 } from 'cc';

const CIRCLE = 1, CONE = 2, SPHERE = 3, HEMISPHERE = 4;
const BASE = 0, VOLUME = 3;
const identityMat = new Mat4();
const identityQuat = new Quat();
const spherical = new Vec3();

// Unity birth radius for a Cocos linear radius sample r = R * (inner + (1 - inner) * u),
// inner = 1 - radiusThickness (fixtures/shape-distribution-native.json):
//   Circle      r^2 uniform on [(R * inner)^2, R^2]   (uniform over the annulus area)
//   Cone        r^2 uniform on [R^2 * inner, R^2]     (Unity's cone inner radius is R * sqrt(inner))
//   Sphere/Hemi r^3 uniform on [(R * inner)^3, R^3]   (uniform over the shell volume)
// Cocos 3.8.8 draws u linearly for all of them, crowding particles near the centre.
export function unityShapeRadius(shapeType: number, r: number, radius: number, thickness: number): number {
    const inner = 1 - thickness;
    if (radius <= 0 || thickness <= 0 || inner >= 1) return r;
    const u = Math.min(1, Math.max(0, (r / radius - inner) / (1 - inner)));
    if (shapeType === CONE) return radius * Math.sqrt(inner + u * (1 - inner));
    if (shapeType === CIRCLE) return radius * Math.sqrt(inner * inner + u * (1 - inner * inner));
    return radius * Math.cbrt(inner * inner * inner + u * (1 - inner * inner * inner));
}

export function unityShapeDistributionApplies(shapeType: number, emitFrom: number): boolean {
    return shapeType === CIRCLE || (shapeType === CONE && (emitFrom === BASE || emitFrom === VOLUME))
        || ((shapeType === SPHERE || shapeType === HEMISPHERE) && emitFrom === VOLUME);
}

// Samples through the engine in the shape's own frame, moves the point to Unity's
// radius (keeping angle, arc mode and cone height), then applies the shape's
// transform steps exactly as ShapeModule.emit does. Safe to install on its own.
export function installUnityShapeDistribution(system: ParticleSystem): void {
    const shape = system.shapeModule as any;
    if (!shape || shape.unityShapeDistribution) return;
    shape.unityShapeDistribution = true;
    const originalEmit = shape.emit;
    shape.emit = function (p: any): void {
        const type = this.shapeType, from = this.emitFrom;
        if (!unityShapeDistributionApplies(type, from) || this.radiusThickness <= 0) { originalEmit.call(this, p); return; }
        const mat = this.mat, quat = this.quat, jitter = this.randomPositionAmount, sphere = this.sphericalDirectionAmount;
        this.mat = identityMat; this.quat = identityQuat; this.randomPositionAmount = 0; this.sphericalDirectionAmount = 0;
        try { originalEmit.call(this, p); }
        finally { this.mat = mat; this.quat = quat; this.randomPositionAmount = jitter; this.sphericalDirectionAmount = sphere; }
        const pos: Vec3 = p.position, dir: Vec3 = p.velocity, radius = this.radius, thickness = this.radiusThickness;
        if (type === CONE) {
            // Cocos Volume points sit on the base ray at height pos.z = -length * u:
            // base = pos - dir * (pos.z / dir.z). Unity instead travels length * u along
            // the ray, so tilted rays end lower (fixture cone-volume height quantiles).
            const along = from === VOLUME && Math.abs(dir.z) > 1e-6 ? pos.z / dir.z : 0;
            const travel = from === VOLUME ? -pos.z : 0;
            const bx = pos.x - dir.x * along, by = pos.y - dir.y * along;
            const r = Math.hypot(bx, by);
            const k = r > 0 ? unityShapeRadius(CONE, r, radius, thickness) / r : 1;
            const sin = Math.sin(this._angle);
            Vec3.set(dir, bx * k * sin, by * k * sin, -Math.cos(this._angle) * radius);
            Vec3.normalize(dir, dir);
            Vec3.set(pos, bx * k + dir.x * travel, by * k + dir.y * travel, dir.z * travel);
        } else {
            const r = type === CIRCLE ? Math.hypot(pos.x, pos.y) : pos.length();
            if (r > 0) Vec3.multiplyScalar(pos, pos, unityShapeRadius(type, r, radius, thickness) / r);
        }
        if (jitter > 0) {
            pos.x += (Math.random() * 2 - 1) * jitter;
            pos.y += (Math.random() * 2 - 1) * jitter;
            pos.z += (Math.random() * 2 - 1) * jitter;
        }
        Vec3.transformQuat(dir, dir, quat);
        Vec3.transformMat4(pos, pos, mat);
        if (sphere > 0) Vec3.lerp(dir, dir, Vec3.normalize(spherical, pos), sphere);
    };
}
