import { _decorator, Component, ParticleSystem } from 'cc';
const { ccclass, executionOrder } = _decorator;

const PREWARM_STEP = 1 / 30;

interface PrewarmTarget {
    duration: number;
    startDelay: { mode: number; constant: number; };
    _time: number;
    _emit(dt: number): void;
    processor: { updateParticles(dt: number): number; };
    _prewarmSystem?: () => void;
    __unityPrewarm?: boolean;
}

// Unity prewarm starts a looping system as if one full cycle (duration, in system time) had already run. Cocos
// 3.8's _prewarmSystem does it in 1 s steps: a 16/s emitter bursts 16 particles per step and forces are integrated
// once per second, so a prewarmed smoke plume (Tanks! MoonSmoke) comes out banded until those particles die.
// This helper swaps in the same loop at 1/30 s steps for every ParticleSystem under its node, before they play.
@ccclass('UnityParticlePrewarm')
@executionOrder(-100)
export class UnityParticlePrewarm extends Component {
    onLoad(): void {
        for (const system of this.getComponentsInChildren(ParticleSystem)) {
            const target = system as unknown as PrewarmTarget;
            if (target.__unityPrewarm) continue;
            target.__unityPrewarm = true;
            target._prewarmSystem = function (this: PrewarmTarget): void {
                this.startDelay.mode = 0; // Constant: prewarm ignores the start delay, as in Cocos.
                this.startDelay.constant = 0;
                const steps = Math.ceil(this.duration / PREWARM_STEP);
                for (let i = 0; i < steps; i++) {
                    this._time += PREWARM_STEP;
                    this._emit(PREWARM_STEP);
                    this.processor.updateParticles(PREWARM_STEP);
                }
            };
        }
    }
}
