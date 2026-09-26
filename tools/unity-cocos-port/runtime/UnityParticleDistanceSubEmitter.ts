import { Mat4, ParticleSystem, Vec3 } from 'cc';
import { installUnityParticleBirthTiming } from './UnityParticleBirthTiming';

interface Track { particle: any; seed: number; position: Vec3; remainder: number; }
/** Constant Birth rate-over-distance, measured against native Unity samples. */
export class UnityParticleDistanceSubEmitter {
    private readonly tracks: Track[];
    private length = 0;
    private readonly sample = new Vec3();
    private readonly current = new Vec3();
    private readonly world = new Vec3();
    private readonly offset = new Vec3();
    private readonly inverse = new Mat4();
    private readonly initialEmitter = new Vec3();
    private emitting = false;
    private readonly sourceProcessor: any;
    private readonly targetProcessor: any;
    private readonly sourceBefore: (particle: any) => void;
    private readonly targetBefore: (particle: any) => void;
    private readonly updateBefore: (dt: number) => number;
    public emitted = 0;

    constructor(private readonly source: ParticleSystem, private readonly target: ParticleSystem,
        private readonly rate: number, simulationSpace: number) {
        if (!(rate > 0) || !Number.isFinite(rate)) throw new Error('Invalid constant distance sub-emitter rate');
        if (!source.processor || !target.processor) throw new Error('Distance sub-emitter requires loaded CPU processors');
        installUnityParticleBirthTiming(source); installUnityParticleBirthTiming(target);
        this.tracks = Array.from({ length: source.capacity }, () => ({ particle: null, seed: 0, position: new Vec3(), remainder: 0 }));
        target.stop(); target.bursts.length = 0; target.simulationSpace = simulationSpace;
        target.rateOverTime.mode = 0; target.rateOverTime.constant = 0;
        target.rateOverDistance.mode = 0; target.rateOverDistance.constant = 0;
        target.play();
        this.initialEmitter.set(target.node.worldPosition);
        this.sourceProcessor = source.processor; this.targetProcessor = target.processor;
        this.sourceBefore = this.sourceProcessor.setNewParticle;
        this.targetBefore = this.targetProcessor.setNewParticle;
        this.updateBefore = this.sourceProcessor.updateParticles;
        this.sourceProcessor.setNewParticle = this.sourceBirth;
        this.targetProcessor.setNewParticle = this.targetBirth;
        this.sourceProcessor.updateParticles = this.advance;
    }

    private readonly sourceBirth = (particle: any): void => {
        // Birth timing adjusts moving World emission before we capture origin.
        this.sourceBefore.call(this.sourceProcessor, particle);
        let index = 0;
        for (; index < this.length; index++) if (this.tracks[index].particle === particle) break;
        if (index === this.length) {
            if (index === this.tracks.length) throw new Error('Distance tracking exceeded source capacity');
            this.length++;
        }
        const track = this.tracks[index];
        track.particle = particle; track.seed = particle.randomSeed;
        track.remainder = 0; track.position.set(particle.position);
    };

    private readonly advance = (dt: number): number => {
        // Cross-space moving transforms expose native float-crossing frame
        // quantization. Keep this unresolved case explicit instead of moving
        // births by an arbitrary frame or loosening position tolerances.
        if (this.source.simulationSpace !== this.target.simulationSpace && Vec3.distance(this.initialEmitter,this.target.node.worldPosition)>1e-6)
            throw new Error('Unverified moving cross-space distance sub-emitter');
        const count = this.updateBefore.call(this.sourceProcessor, dt);
        for (let i = this.length - 1; i >= 0; i--) {
            const track = this.tracks[i], p = track.particle;
            if (track.seed !== p.randomSeed) throw new Error('Distance source recycled without birth notification');
            this.current.set(p.position);
            // Native Local distance excludes movement of the emitter itself.
            // Uniform scale transforms local travel into world distance.
            let distance = Vec3.distance(track.position, this.current);
            if (this.source.simulationSpace !== 0) {
                const scale = this.source.node.worldScale;
                if (Math.abs(scale.x-scale.y)>1e-5 || Math.abs(scale.x-scale.z)>1e-5) throw new Error('Unverified nonuniform distance source scale');
                distance *= Math.abs(scale.x);
            }
            const units = distance * this.rate;
            if (units > 0) {
                let next = 1-track.remainder;
                while (next <= units) {
                    const fraction = Math.min(1,next/units);
                    Vec3.lerp(this.sample,track.position,this.current,fraction);
                    this.world.set(this.sample);
                    if (this.source.simulationSpace !== 0) Vec3.transformMat4(this.world,this.world,this.source.node.worldMatrix);
                    Vec3.subtract(this.offset,this.world,this.target.node.worldPosition);
                    if (this.target.simulationSpace !== 0) {
                        Mat4.invert(this.inverse,this.target.node.worldMatrix);
                        Vec3.transformMat4Normal(this.offset,this.offset,this.inverse);
                    }
                    const effective = p.unityParticleDeltaTime ?? dt;
                    const delay = Math.max(0,dt-effective) + effective*fraction;
                    this.emitting = true;
                    try { (this.target as any).emit(1,delay); }
                    finally { this.emitting = false; }
                    this.emitted++; next++;
                }
                track.remainder = Math.max(0,units-next+1);
            }
            track.position.set(this.current);
            if (p.remainingLifetime <= 0) {
                this.length--; this.tracks[i] = this.tracks[this.length];
                this.tracks[this.length] = track; track.particle = null;
            }
        }
        return count;
    };

    private readonly targetBirth = (particle: any): void => {
        if (this.emitting) Vec3.add(particle.position,particle.position,this.offset);
        this.targetBefore.call(this.targetProcessor,particle);
    };

    reset(): void { for (let i=0;i<this.length;i++) this.tracks[i].particle=null; this.length=0; }
    destroy(): void {
        this.sourceProcessor.setNewParticle=this.sourceBefore;
        this.targetProcessor.setNewParticle=this.targetBefore;
        this.sourceProcessor.updateParticles=this.updateBefore;
    }
}
