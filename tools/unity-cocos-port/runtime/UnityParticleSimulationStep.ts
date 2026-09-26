import { ParticleSystem } from 'cc';
import { installUnityParticleBirthTiming } from './UnityParticleBirthTiming';

/** Keep a long render frame from extending a short Unity emission window. */
export function installUnityParticleSimulationStep(system: ParticleSystem, maximumDeltaTime: number, gravityY = -9.81): void {
    const runtime = system as any;
    if (runtime.unitySimulationStep) return;
    if (!(maximumDeltaTime > 0) || !Number.isFinite(maximumDeltaTime)) throw new Error('Invalid Unity maximumParticleDeltaTime');
    installUnityParticleBirthTiming(system,gravityY);
    runtime.unitySimulationStep = true;
    const update = runtime.update;
    const emit = runtime._emit;
    runtime._emit = function (dt: number): void {
        if (this.loop || !this._isEmitting) { emit.call(this, dt); return; }
        const delay = this.startDelay.evaluate(0, 1);
        const end = this._time, stop = delay + this.duration;
        const activeDelta = Math.max(0, Math.min(end, stop) - Math.max(end - dt, delay));
        if (activeDelta > 0) {
            this._time = Math.min(end, stop);
            try { emit.call(this, activeDelta); } finally { this._time = end; }
        }
        if (end >= stop) this._isEmitting = false;
    };
    runtime.update = function (dt: number): void {
        if (!(dt > maximumDeltaTime) || !this._isPlaying) { update.call(this, dt); return; }
        let remaining = dt;
        while (remaining > 1e-9) {
            const step = Math.min(remaining, maximumDeltaTime);
            update.call(this, step); remaining -= step;
        }
    };
}
