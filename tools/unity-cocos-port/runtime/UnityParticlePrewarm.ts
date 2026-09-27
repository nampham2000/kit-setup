import { ParticleSystem } from 'cc';

// Unity starts a prewarmed looping system in its steady state: every cycle
// whose particles can still be alive has already been emitted. Measured on
// Unity 6000.3.1f1 (duration 0.5, lifetime 1.2): the first frame already holds
// particles aged ~1.0 s and ~0.5 s. Cocos 3.8.8 prewarms with a single 1 s
// step, whose burst window test fails, so none of those particles exist.
export const UNITY_PREWARM_STEP = 1 / 60;

export function unityPrewarmSeconds(duration: number, maxLifetime: number): number {
    if (!(duration > 0)) return 0;
    return Math.max(1, Math.ceil(Math.max(0, maxLifetime) / duration - 1e-6)) * duration;
}

export function installUnityParticlePrewarm(system: ParticleSystem): void {
    const runtime = system as any;
    if (runtime.unityPrewarm) return;
    runtime.unityPrewarm = true;
    runtime._prewarmSystem = function (this: any): void {
        // Keep the Cocos side effect: a prewarmed system ignores its start delay.
        this.startDelay.mode = 0;
        this.startDelay.constant = 0;
        const total = unityPrewarmSeconds(this.duration, this.startLifetime.getMax());
        const steps = Math.round(total / UNITY_PREWARM_STEP);
        for (let i = 0; i < steps; i++) {
            this._time += UNITY_PREWARM_STEP;
            this._emit(UNITY_PREWARM_STEP);
            this.processor.updateParticles(UNITY_PREWARM_STEP);
        }
    };
}
