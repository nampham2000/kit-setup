import { ParticleSystem } from 'cc';
import { installUnityParticleBirthTiming } from './UnityParticleBirthTiming';

/** Preserve native float-clock emission windows and bounded particle steps. */
export function installUnityParticleSimulationStep(system: ParticleSystem, maximumDeltaTime: number, gravityY = -9.81): void {
    const runtime = system as any;
    if (runtime.unitySimulationStep) return;
    if (!(maximumDeltaTime > 0) || !Number.isFinite(maximumDeltaTime)) throw new Error('Invalid Unity maximumParticleDeltaTime');
    installUnityParticleBirthTiming(system,gravityY);
    runtime.unitySimulationStep = true;
    const update = runtime.update;
    const emit = runtime._emit;
    let clock = 0, waiting = true, lastEngineTime = -1;
    runtime._emit = function (dt: number): void {
        if (this.loop || !this._isEmitting) { emit.call(this, dt); return; }
        const delay = Math.fround(this.startDelay.evaluate(0, 1));
        const end = this._time;
        if(end<=lastEngineTime){clock=0;waiting=true;}
        lastEngineTime=end;
        clock=Math.fround(clock+Math.fround(dt));
        let activeDelta=Math.fround(dt);
        if(waiting){
            if(clock<=delay)return;
            clock=Math.fround(clock-delay);activeDelta=clock;waiting=false;
        }
        // Native stops before emission on the step that reaches duration;
        // integrating a clipped final step creates an extra particle batch.
        if(clock>=Math.fround(this.duration)){this._isEmitting=false;return;}
        if (activeDelta > 0) {
            this._time = delay+clock;
            try { emit.call(this, activeDelta); } finally { this._time = end; }
        }
    };
    runtime.update = function (dt: number): void {
        // Inactive prefabs can be staged before ParticleSystem.onLoad creates
        // the CPU processor. Initialize birth hooks before their first Update.
        installUnityParticleBirthTiming(system,gravityY);
        if (!(dt > maximumDeltaTime) || !this._isPlaying) { update.call(this, dt); return; }
        let remaining = dt;
        while (remaining > 1e-9) {
            const step = Math.min(remaining, maximumDeltaTime);
            update.call(this, step); remaining -= step;
        }
    };
}
