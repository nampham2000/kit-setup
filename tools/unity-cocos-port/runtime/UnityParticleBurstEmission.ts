import { ParticleSystem } from 'cc';

// Cocos 3.8.8 Burst.update dispatches only one repeat per frame and can permanently
// miss later repeats when a frame spans multiple intervals. Unity catches them up.
export function installUnityParticleBurstEmission(system: ParticleSystem): void {
    const shape = system.shapeModule as any;
    if (shape?.arcMode === 3 && !shape.unityBurstSpread) {
        shape.unityBurstSpread = true;
        const originalEmit = (system as any).emit;
        const originalAngle = shape.generateArcAngle;
        let count = 0, index = 0;
        shape.generateArcAngle = function (): number {
            if (count <= 0) return originalAngle.call(this);
            const intervals = this._arc >= Math.PI * 2 - 1e-6 ? count : Math.max(1, count - 1);
            let angle = index++ * this._arc / intervals;
            if (this.arcSpread > 0) angle = Math.floor(angle / (this._arc * this.arcSpread)) * this._arc * this.arcSpread;
            return angle;
        };
        (system as any).emit = function (amount: number, dt: number): void {
            count = Math.ceil(amount); index = 0;
            try { originalEmit.call(this, amount, dt); }
            finally { count = 0; }
        };
    }
    for (const burst of system.bursts) {
        const b = burst as any;
        if (b.unityBurstCatchUp) continue;
        b.unityBurstCatchUp = true;
        let emitted = 0, loop = -1;
        const originalReset = b.reset;
        b.reset = function (): void { originalReset.call(this); emitted = 0; loop = -1; };
        b.update = (ps: ParticleSystem, dt: number): void => {
            const time = ps.time - ps.startDelay.evaluate(0, 1);
            if (time < 0) return;
            const currentLoop = Math.floor(time / ps.duration);
            if (currentLoop !== loop) { loop = currentLoop; emitted = 0; }
            const local = time - currentLoop * ps.duration;
            while (emitted < burst.repeatCount) {
                const at = burst.time + emitted * burst.repeatInterval;
                if (at >= ps.duration || at >= local) break;
                (ps as any).emit(burst.count.evaluate(at / ps.duration, 1), dt - (local - at));
                emitted++;
            }
        };
    }
}
