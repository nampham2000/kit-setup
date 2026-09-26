import { ParticleSystem } from 'cc';
import { UnityNoiseKernel, UnityNoiseSpec, sampleNoiseCurve, unityNoiseStrengthRandom } from './UnityNoiseKernel';
import { installUnityParticleLimitVelocity } from './UnityParticleLimitVelocity';

const DEG_TO_RAD = Math.PI / 180;

// Installs the measured Low/Medium/High native Noise kernels into the CPU module
// chain. Unsupported native features stay explicit; do not silently approximate.
export function installUnityParticleNoise(system: ParticleSystem, spec: UnityNoiseSpec, seed?: number): void {
    const runtime = system as any, processor = runtime.processor;
    if (runtime.unityNoise) return;
    if (!spec.enabled || (spec.quality !== 0 && spec.quality !== 1 && spec.quality !== 2) || spec.remapEnabled) throw new Error('Native Noise adapter requires Low/Medium/High quality without remap');
    const rotate = spec.rotationAmount.minMaxState !== 0 || spec.rotationAmount.scalar !== 0;
    const resize = spec.sizeAmount.minMaxState !== 0 || spec.sizeAmount.scalar !== 0;
    const curves = [spec.strength,spec.strengthY,spec.strengthZ,spec.scrollSpeed,spec.positionAmount,spec.sizeAmount];
    if (rotate) curves.push(spec.rotationAmount);
    for (const curve of curves) {
        const strength = curve === spec.strength || curve === spec.strengthY || curve === spec.strengthZ;
        if (curve.minMaxState !== 0 && curve.minMaxState !== 1 && !(strength && curve.minMaxState === 3)) throw new Error('Noise random curves need a native random-channel oracle');
        if (curve.maxCurve?.m_Curve.some(key => key.weightedMode)) throw new Error('Weighted Noise curves need a measured evaluator');
    }
    // fixtures/particle-noise-rotation-native.json: rotation noise accumulates in the
    // Unity Euler angles. The Euler adapter (Mesh/Local billboard rotation over lifetime)
    // packs them; without rotation over lifetime Particle.rotation is read as Euler.
    const signs = spec.rotationSigns, rotation3D = spec.rotation3D !== false, eulerManaged = !!runtime.unityEulerRotation;
    if (rotate && (!signs || signs.length !== 3)) throw new Error('Noise rotation needs the renderer Euler signs');
    if (rotate && !eulerManaged && system.rotationOvertimeModule?.enable) throw new Error('Noise rotation with rotation over lifetime needs the Unity Euler rotation adapter');
    const limit = system.limitVelocityOvertimeModule as any;
    if (limit?.enable) {
        // fixtures/velocity-limit-composition-native.json: Unity limits stored + Noise
        // velocity and stores only the non-animated part.
        installUnityParticleLimitVelocity(system);
        if (!limit.unityAnimatedComposition) throw new Error('Noise with a velocity limit requires the Unity limit composition runtime');
    }
    const chooseSeed = (): number => spec.autoRandomSeed ? (Math.random() * 4294967296) >>> 0 : spec.randomSeed;
    const initialSeed = seed === undefined ? chooseSeed() : seed;
    const kernel = new UnityNoiseKernel(initialSeed), field = new Float64Array(3), strengthRandom = new Float64Array(3);
    const randomStrength = [spec.strength, spec.strengthY, spec.strengthZ].some(curve => curve.minMaxState === 3);
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
        if (randomStrength) unityNoiseStrengthRandom(strengthRandom, particle.randomSeed);
        const sx = sampleNoiseCurve(spec.strength, age, strengthRandom[0]);
        const sy = spec.separateAxes ? sampleNoiseCurve(spec.strengthY, age, strengthRandom[1]) : sx;
        const sz = spec.separateAxes ? sampleNoiseCurve(spec.strengthZ, age, strengthRandom[2]) : sx;
        const x = field[0] * sx * amount, y = field[1] * sy * amount, z = -field[2] * sz * amount;
        const animated = particle.animatedVelocity, ultimate = particle.ultimateVelocity;
        animated.set(animated.x+x, animated.y+y, animated.z+z);
        ultimate.set(ultimate.x+x, ultimate.y+y, ultimate.z+z);
        if (resize) {
            // Native BakeMesh, not GetCurrentSize3D: true scalar particles use X
            // for every rendered axis. Particle.startSize3D sets a per-particle
            // flag even when main.startSize3D is off (see native fixtures).
            // Size-over-lifetime has already refreshed p.size; otherwise rebase
            // on startSize so the previous frame's Noise factor cannot accumulate.
            const base = system.sizeOvertimeModule?.enable ? particle.size : particle.startSize;
            const k = 0.5 * sampleNoiseCurve(spec.sizeAmount, age);
            const nx = 1 + field[0] * sx * k;
            particle.size.set(base.x * nx, base.y * (spec.size3D === false ? nx : 1 + field[1] * sy * k), base.z * (spec.size3D === false ? nx : 1 + field[2] * sz * k));
        }
        if (rotate) {
            // rotation3D grows by 0.5 * field * strength * rotationAmount degrees per
            // second on each axis (positionAmount does not apply); 2D rotation is Z only.
            const k = 0.5 * sampleNoiseCurve(spec.rotationAmount, age) * dt * DEG_TO_RAD;
            const rx = rotation3D ? signs![0] * field[0] * sx * k : 0, ry = rotation3D ? signs![1] * field[1] * sy * k : 0, rz = signs![2] * field[2] * sz * k;
            const euler = particle.startEuler;
            euler.x += rx; euler.y += ry; euler.z += rz;
            if (!eulerManaged) { const r = particle.rotation; r.x += rx; r.y += ry; r.z += rz; }
        }
        state.samples++;
    };
    // Unity adds Noise with the other animated velocity before the limit, and its
    // rotation before the particle rotation is packed for rendering.
    const reorder = (): void => {
        const list = processor._runAnimateList;
        const from = list.indexOf(noise);
        let to = -1;
        for (const module of [system.limitVelocityOvertimeModule, system.rotationOvertimeModule]) {
            const at = module ? list.indexOf(module) : -1;
            if (at >= 0 && (to < 0 || at < to)) to = at;
        }
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
