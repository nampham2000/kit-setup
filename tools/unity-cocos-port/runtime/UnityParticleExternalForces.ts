import { director, Mat4, ParticleSystem, Vec3 } from 'cc';
import { UnityWindSample, UnityWindZone } from './UnityWindZone';

// Unity External Forces module driven by WindZones (law and spaces in UnityWindZone.ts).
// The acceleration is sampled at the start-of-step position and added to the stored
// velocity before the CPU processor integrates, like Unity's velocity-then-position step,
// so Limit Velocity and other animated modules compose with it as in Unity.
export interface UnityExternalForcesSpec {
    multiplier: number;
}

const LOCAL_SPACE = 1; // cc ParticleSystem Space.Local
const worldToSim = new Mat4();
const acceleration = new Vec3();
const samples: UnityWindSample[] = [];

export function installUnityParticleExternalForces(system: ParticleSystem, spec: UnityExternalForcesSpec): void {
    const runtime = system as any, processor = runtime.processor;
    if (runtime.unityExternalForces) return;
    if (!processor?._particles) throw new Error('External Forces requires the loaded CPU particle processor');
    runtime.unityExternalForces = spec;
    const update = processor.updateParticles;
    processor.updateParticles = function (this: any, dt: number): number {
        const zones = UnityWindZone.active;
        if (zones.length && dt > 0 && spec.multiplier !== 0) {
            const local = system.simulationSpace === LOCAL_SPACE;
            if (local) Mat4.invert(worldToSim, system.node.worldMatrix);
            const time = director.getTotalTime() / 1000;
            while (samples.length < zones.length) samples.push(new UnityWindSample());
            for (let z = 0; z < zones.length; z++) zones[z].prepare(samples[z], time, spec.multiplier, local ? worldToSim : null);
            const pool = this._particles;
            for (let i = 0; i < pool.length; i++) {
                const p = pool.data[i];
                acceleration.set(0, 0, 0);
                for (let z = 0; z < zones.length; z++) samples[z].accumulate(acceleration, p.position);
                Vec3.scaleAndAdd(p.velocity, p.velocity, acceleration, dt);
            }
        }
        return update.call(this, dt);
    };
}
