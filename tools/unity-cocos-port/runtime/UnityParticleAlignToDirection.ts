import { ParticleSystem, Vec3 } from 'cc';

/**
 * Unity ShapeModule.alignToDirection (fixtures/align-to-direction.json). Cocos 3.8.8
 * declares ShapeModule.alignToDirection but never reads it. Unity adds, per particle,
 * pitch = -asin(dir.y) and yaw = atan2(dir.x, -dir.z) (degrees, dir = normalized
 * birth velocity) to the start rotation3D; roll is untouched.
 *
 * In Cocos the simulation frame is Unity's with Z reflected, so dir.z flips, and the
 * porter stores Unity rotation3D with `eulerSigns` per renderer (mesh: -X, -Y, +Z).
 */
export function unityAlignToDirectionDelta(out: Vec3, cocosDirection: Vec3, eulerSigns: readonly number[]): Vec3 {
    const length = cocosDirection.length();
    if (length < 1e-8) return Vec3.set(out, 0, 0, 0);
    const x = cocosDirection.x / length, y = cocosDirection.y / length, unityZ = -cocosDirection.z / length;
    const pitch = -Math.asin(Math.max(-1, Math.min(1, y)));
    const yaw = Math.atan2(x, -unityZ);
    return Vec3.set(out, pitch * eulerSigns[0], yaw * eulerSigns[1], 0);
}

const delta = new Vec3();

export class UnityParticleAlignToDirection {
    private readonly processor: any;
    private readonly shape: any;
    private readonly shapeEmit: (particle: any) => void;
    private readonly birthBefore: (particle: any) => void;
    private readonly direction = new Vec3();

    constructor(private readonly system: ParticleSystem, private readonly eulerSigns: readonly number[]) {
        this.processor = system.processor;
        this.shape = system.shapeModule;
        this.shapeEmit = this.shape.emit;
        this.birthBefore = this.processor.setNewParticle;
        // The shape writes the unit birth direction in the shape's local frame, before
        // startSpeed scales it (a zero start speed would lose it otherwise).
        this.shape.emit = this.emitShape;
        this.processor.setNewParticle = this.birth;
    }

    private readonly emitShape = (particle: any): void => {
        this.shapeEmit.call(this.shape, particle);
        this.direction.set(particle.velocity);
    };

    private readonly birth = (particle: any): void => {
        unityAlignToDirectionDelta(delta, this.direction, this.eulerSigns);
        Vec3.add(particle.startEuler, particle.startEuler, delta);
        Vec3.add(particle.rotation, particle.rotation, delta);
        this.birthBefore.call(this.processor, particle);
    };

    destroy(): void {
        this.shape.emit = this.shapeEmit;
        this.processor.setNewParticle = this.birthBefore;
    }
}
