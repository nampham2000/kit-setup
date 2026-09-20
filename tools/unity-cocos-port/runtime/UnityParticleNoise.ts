import { ParticleSystem } from 'cc';
import { UnityNoiseKernel, UnityNoiseSpec, sampleNoiseCurve } from './UnityNoiseKernel';

// Installs the measured Medium/High native curl kernels into the CPU module
// chain. Unsupported native features stay explicit; do not silently approximate.
export function installUnityParticleNoise(system: ParticleSystem, spec: UnityNoiseSpec, seed?: number): void {
    const runtime = system as any, processor = runtime.processor;
    if (runtime.unityNoise) return;
    if (!spec.enabled || (spec.quality !== 1 && spec.quality !== 2) || spec.remapEnabled) throw new Error('Native Noise adapter requires Medium/High quality without remap');
    if (spec.rotationAmount.minMaxState !== 0 || spec.rotationAmount.scalar !== 0 || spec.sizeAmount.minMaxState !== 0 || spec.sizeAmount.scalar !== 0) throw new Error('Noise rotation/size amount needs a measured adapter');
    for (const curve of [spec.strength,spec.strengthY,spec.strengthZ,spec.scrollSpeed,spec.positionAmount]) {
        if (curve.minMaxState !== 0 && curve.minMaxState !== 1) throw new Error('Noise random curves need a native random-channel oracle');
        if (curve.maxCurve?.m_Curve.some(key => key.weightedMode)) throw new Error('Weighted Noise curves need a measured evaluator');
    }
    const chooseSeed = (): number => spec.autoRandomSeed ? (Math.random() * 4294967296) >>> 0 : spec.randomSeed;
    const initialSeed = seed === undefined ? chooseSeed() : seed;
    const kernel = new UnityNoiseKernel(initialSeed), field = new Float64Array(3);
    const state = runtime.unityNoise = {
        seed: initialSeed >>> 0, scroll: 0, lastTime: 0, samples: 0, spec,
        reset(nextSeed: number): void {
            this.seed = nextSeed >>> 0; this.scroll = 0; this.lastTime = 0; this.samples = 0;
            kernel.reset(nextSeed);
        },
    };
    const noise = system.noiseModule as any;
    noise.animate = function (particle: any, dt: number): void {
        const position = particle.position;
        // Source and target simulation coordinates are related by Z reflection.
        kernel.sample(field, position.x, position.y, -position.z, state.scroll, spec);
        const age = Math.max(0, Math.min(1, 1 - (particle.remainingLifetime + dt) / particle.startLifetime));
        const amount = sampleNoiseCurve(spec.positionAmount, age);
        const strength = sampleNoiseCurve(spec.strength, age) * amount;
        const x = field[0] * strength;
        const y = field[1] * (spec.separateAxes ? sampleNoiseCurve(spec.strengthY, age) * amount : strength);
        const z = -field[2] * (spec.separateAxes ? sampleNoiseCurve(spec.strengthZ, age) * amount : strength);
        const animated = particle.animatedVelocity, ultimate = particle.ultimateVelocity;
        animated.set(animated.x+x, animated.y+y, animated.z+z);
        ultimate.set(ultimate.x+x, ultimate.y+y, ultimate.z+z);
        state.samples++;
    };
    const reorder = (): void => {
        const list = processor._runAnimateList;
        const from = list.indexOf(noise), to = list.indexOf(system.limitVelocityOvertimeModule);
        if (from < 0 || to < 0 || from < to) return;
        for (let i = from; i > to; i--) list[i] = list[i - 1];
        list[to] = noise;
    };
    reorder();
    const enableModule = processor.enableModule, updateParticles = processor.updateParticles;
    processor.enableModule = function (name: string, value: boolean, module: any): void {
        enableModule.call(this, name, value, module); reorder();
    };
    processor.updateParticles = function (dt: number): number {
        if (system.time < state.lastTime) state.reset(chooseSeed());
        const phase = Math.max(0, system.time - dt) % system.duration / system.duration;
        if (this._particles.length > 0) state.scroll += sampleNoiseCurve(spec.scrollSpeed, phase) * dt;
        state.lastTime = system.time;
        return updateParticles.call(this, dt);
    };
}
