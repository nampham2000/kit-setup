import { BoxCollider, Collider, Color, director, gfx, Mat4, MeshCollider, ParticleSystem, SphereCollider, Vec3 } from 'cc';

// Unity Collision module, World type (particle-collision-binding.js). Cocos has no
// particle collision, so every simulation step each particle's travelled segment is
// cast against the scene's collider geometry in world space (MeshCollider triangles,
// BoxCollider and SphereCollider bounds). The physics engine is not queried: Cocos
// 3.8.8 + cannon ignores node scale on MeshCollider trimeshes (a 50x50 floor quad
// answered raycasts only near its origin). On a hit, as Unity does:
// - the particle moves to the contact point, offset by radiusScale * size along the normal;
// - the normal velocity is reflected by Bounce, then the velocity is scaled by 1 - Dampen;
// - Lifetime Loss removes that fraction of the start lifetime;
// - particles below Min Kill Speed or above Max Kill Speed, or out of lifetime, die;
// - Collision sub-emitters fire at the contact point with their probability.
// Without that, a stretched streak keeps falling through the ground (its tail stays visible)
// and splash/ripple sub-emitters never fire.

export interface UnityCollisionSubEmitter { target: ParticleSystem; probability: number; inheritColor: boolean; countMin: number; countMax: number; }
export interface UnityCollisionSpec { dampen: number; bounce: number; lifetimeLoss: number; minKillSpeed: number; maxKillSpeed: number; radiusScale: number; }

interface Shape { collider: Collider; kind: 'mesh' | 'box' | 'sphere'; triangles: Float32Array; min: Vec3; max: Vec3; matrix: Mat4; }

const from = new Vec3(), to = new Vec3(), dir = new Vec3(), normal = new Vec3(), contact = new Vec3();
const velocity = new Vec3(), along = new Vec3(), local = new Vec3();
const inverse = new Mat4(), targetInverse = new Mat4();
const lower = new Vec3(), upper = new Vec3();
const e1 = new Vec3(), e2 = new Vec3(), pv = new Vec3(), tv = new Vec3(), qv = new Vec3();
const hitPoint = new Vec3(), hitNormal = new Vec3();
const inherited = new Color();

class SubEmitterSink {
    private readonly processor: any;
    private readonly before: (particle: any) => void;
    private readonly offset = new Vec3();
    private color: Color | null = null;
    private emitting = false;

    constructor(private readonly entry: UnityCollisionSubEmitter) {
        const target = entry.target;
        // A Unity sub-emitter only emits when its parent triggers it.
        target.stop(); target.clear(); target.bursts.length = 0;
        target.rateOverTime.mode = 0; target.rateOverTime.constant = 0;
        target.rateOverDistance.mode = 0; target.rateOverDistance.constant = 0;
        target.play();
        this.processor = target.processor;
        this.before = this.processor.setNewParticle;
        this.processor.setNewParticle = this.birth;
    }

    fire(world: Vec3, parentColor: Color): void {
        const { target, probability, countMin, countMax, inheritColor } = this.entry;
        if (Math.random() >= probability) return;
        const count = Math.round(countMin + Math.random() * (countMax - countMin));
        if (count <= 0) return;
        Vec3.subtract(this.offset, world, target.node.worldPosition);
        if (target.simulationSpace !== 0) {
            Mat4.invert(targetInverse, target.node.worldMatrix);
            Vec3.transformMat4Normal(this.offset, this.offset, targetInverse);
        }
        this.color = inheritColor ? parentColor : null;
        this.emitting = true;
        try { (target as any).emit(count, 0); } finally { this.emitting = false; this.color = null; }
    }

    private readonly birth = (particle: any): void => {
        this.before.call(this.processor, particle);
        if (!this.emitting) return;
        Vec3.add(particle.position, particle.position, this.offset);
        if (this.color) {
            Color.multiply(inherited, particle.color, this.color);
            particle.color.set(inherited);
        }
    };

    destroy(): void { this.processor.setNewParticle = this.before; }
}

export class UnityParticleCollision {
    private readonly processor: any;
    private readonly before: (dt: number) => number;
    private readonly sinks: SubEmitterSink[];
    private shapes: Shape[] | null = null;
    public collisions = 0;

    constructor(private readonly source: ParticleSystem, private readonly spec: UnityCollisionSpec, subEmitters: UnityCollisionSubEmitter[]) {
        this.processor = source.processor;
        this.before = this.processor.updateParticles;
        this.processor.updateParticles = this.step;
        this.sinks = subEmitters.map(entry => new SubEmitterSink(entry));
    }

    private readonly step = (dt: number): number => {
        const pool = this.processor._particles;
        for (let i = 0; i < pool.length; i++) {
            const p = pool.data[i];
            // One Vec3 per pooled particle object, reused for its whole life.
            (p.unityCollisionPrev ||= new Vec3()).set(p.position);
        }
        const count = this.before.call(this.processor, dt);
        if (!this.bounds()) return count;
        const localSpace = this.source.simulationSpace !== 0;
        const world = this.source.node.worldMatrix;
        if (localSpace) Mat4.invert(inverse, world);
        for (let i = pool.length - 1; i >= 0; i--) {
            const p = pool.data[i];
            const prev: Vec3 | undefined = p.unityCollisionPrev;
            if (!prev) continue;
            from.set(prev); to.set(p.position);
            if (localSpace) { Vec3.transformMat4(from, from, world); Vec3.transformMat4(to, to, world); }
            Vec3.subtract(dir, to, from);
            const length = dir.length();
            if (length < 1e-6) continue;
            const radius = this.spec.radiusScale * Math.max(p.size.x, p.size.y, p.size.z) * 0.5;
            if (!this.segmentMayHit(from, to, radius)) continue;
            Vec3.multiplyScalar(dir, dir, 1 / length);
            if (!this.raycast(from, dir, length + radius)) continue;
            normal.set(hitNormal);
            Vec3.scaleAndAdd(contact, hitPoint, normal, radius);
            this.collisions++;
            for (const sink of this.sinks) sink.fire(contact, p.color);
            // Velocity response in simulation space (rotation only for local space).
            if (localSpace) Vec3.transformMat4Normal(local, normal, inverse); else local.set(normal);
            local.normalize();
            velocity.set(p.velocity);
            Vec3.multiplyScalar(along, local, Vec3.dot(velocity, local));
            Vec3.subtract(velocity, velocity, along);
            Vec3.scaleAndAdd(velocity, velocity, along, -this.spec.bounce);
            Vec3.multiplyScalar(velocity, velocity, 1 - this.spec.dampen);
            p.remainingLifetime -= this.spec.lifetimeLoss * p.startLifetime;
            const speed = velocity.length();
            if (p.remainingLifetime <= 0 || speed < this.spec.minKillSpeed || speed > this.spec.maxKillSpeed) {
                if (this.source.trailModule.enable) this.source.trailModule.removeParticle(p);
                pool.removeAt(i);
                continue;
            }
            p.velocity.set(velocity);
            if (localSpace) Vec3.transformMat4(p.position, contact, inverse); else p.position.set(contact);
        }
        return pool.length;
    };

    // World-space collider geometry, rebuilt when a collider's node moves; returns
    // whether any collider exists and fills the union bounds.
    private bounds(): boolean {
        if (!this.shapes) {
            // Queried once (no per-frame allocation); scene colliders exist before emitters start.
            const scene = director.getScene();
            const colliders = scene ? scene.getComponentsInChildren(Collider).filter(c => !c.isTrigger) : [];
            this.shapes = colliders
                .filter(c => c instanceof MeshCollider || c instanceof BoxCollider || c instanceof SphereCollider)
                .map(collider => ({
                    collider,
                    kind: collider instanceof MeshCollider ? 'mesh' : collider instanceof BoxCollider ? 'box' : 'sphere',
                    triangles: new Float32Array(0), min: new Vec3(), max: new Vec3(), matrix: new Mat4(),
                } as Shape));
            for (const shape of this.shapes) this.rebuild(shape);
        }
        lower.set(Infinity, Infinity, Infinity); upper.set(-Infinity, -Infinity, -Infinity);
        let any = false;
        for (const shape of this.shapes) {
            if (!shape.collider.isValid || !shape.collider.enabledInHierarchy) continue;
            if (!Mat4.strictEquals(shape.matrix, shape.collider.node.worldMatrix)) this.rebuild(shape);
            if (!shape.triangles.length) continue;
            Vec3.min(lower, lower, shape.min); Vec3.max(upper, upper, shape.max);
            any = true;
        }
        return any;
    }

    private rebuild(shape: Shape): void {
        const collider = shape.collider as any;
        const world = collider.node.worldMatrix;
        shape.matrix.set(world);
        const points: number[] = [];
        const pushBox = (cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): void => {
            const corner = (i: number): number[] => [cx + (i & 1 ? hx : -hx), cy + (i & 2 ? hy : -hy), cz + (i & 4 ? hz : -hz)];
            for (const [a, b, c, d] of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) {
                points.push(...corner(a), ...corner(b), ...corner(c), ...corner(a), ...corner(c), ...corner(d));
            }
        };
        if (shape.kind === 'mesh') {
            const mesh = collider.mesh;
            for (let prim = 0; mesh && prim < mesh.struct.primitives.length; prim++) {
                const positions = mesh.readAttribute(prim, gfx.AttributeName.ATTR_POSITION);
                const indices = mesh.readIndices(prim);
                if (!positions) continue;
                const count = indices ? indices.length : positions.length / 3;
                for (let i = 0; i < count; i++) {
                    const k = (indices ? indices[i] : i) * 3;
                    points.push(positions[k], positions[k + 1], positions[k + 2]);
                }
            }
        } else if (shape.kind === 'box') {
            const size = collider.size, center = collider.center;
            pushBox(center.x, center.y, center.z, size.x / 2, size.y / 2, size.z / 2);
        } else {
            // Sphere collider: its bounding box faces (particles rarely hit spheres in scope).
            const r = collider.radius, center = collider.center;
            pushBox(center.x, center.y, center.z, r, r, r);
        }
        shape.triangles = new Float32Array(points.length);
        shape.min.set(Infinity, Infinity, Infinity); shape.max.set(-Infinity, -Infinity, -Infinity);
        for (let i = 0; i < points.length; i += 3) {
            tv.set(points[i], points[i + 1], points[i + 2]);
            Vec3.transformMat4(tv, tv, world);
            shape.triangles[i] = tv.x; shape.triangles[i + 1] = tv.y; shape.triangles[i + 2] = tv.z;
            Vec3.min(shape.min, shape.min, tv); Vec3.max(shape.max, shape.max, tv);
        }
    }

    private segmentMayHit(a: Vec3, b: Vec3, radius: number): boolean {
        return Math.max(a.x, b.x) + radius >= lower.x && Math.min(a.x, b.x) - radius <= upper.x
            && Math.max(a.y, b.y) + radius >= lower.y && Math.min(a.y, b.y) - radius <= upper.y
            && Math.max(a.z, b.z) + radius >= lower.z && Math.min(a.z, b.z) - radius <= upper.z;
    }

    // Closest hit within maxDistance over every shape's triangles (Moller-Trumbore);
    // the normal faces the incoming ray.
    private raycast(origin: Vec3, direction: Vec3, maxDistance: number): boolean {
        let nearest = maxDistance;
        let found = false;
        for (const shape of this.shapes!) {
            const t = shape.triangles;
            if (!t.length || !shape.collider.enabledInHierarchy) continue;
            for (let i = 0; i < t.length; i += 9) {
                e1.set(t[i + 3] - t[i], t[i + 4] - t[i + 1], t[i + 5] - t[i + 2]);
                e2.set(t[i + 6] - t[i], t[i + 7] - t[i + 1], t[i + 8] - t[i + 2]);
                Vec3.cross(pv, direction, e2);
                const det = Vec3.dot(e1, pv);
                if (Math.abs(det) < 1e-12) continue;
                const inv = 1 / det;
                tv.set(origin.x - t[i], origin.y - t[i + 1], origin.z - t[i + 2]);
                const u = Vec3.dot(tv, pv) * inv;
                if (u < 0 || u > 1) continue;
                Vec3.cross(qv, tv, e1);
                const v = Vec3.dot(direction, qv) * inv;
                if (v < 0 || u + v > 1) continue;
                const distance = Vec3.dot(e2, qv) * inv;
                if (distance < 0 || distance >= nearest) continue;
                nearest = distance;
                Vec3.cross(hitNormal, e1, e2);
                hitNormal.normalize();
                if (Vec3.dot(hitNormal, direction) > 0) Vec3.negate(hitNormal, hitNormal);
                found = true;
            }
        }
        if (found) Vec3.scaleAndAdd(hitPoint, origin, direction, nearest);
        return found;
    }

    destroy(): void {
        this.processor.updateParticles = this.before;
        for (const sink of this.sinks) sink.destroy();
    }
}
