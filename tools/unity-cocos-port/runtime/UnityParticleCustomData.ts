import { director, gfx, ParticleSystem, Texture2D, Vec4 } from 'cc';

interface Key { time: number; value: number; inSlope: number; outSlope: number; }
/** Unity MinMaxCurve: mode = minMaxState (0 constant, 1 curve, 2 two curves, 3 two constants). */
export interface UnityCustomCurve { mode: number; scalar: number; minimum: number; keys: Key[]; minKeys: Key[]; }
/** Unity CustomDataModule Custom1 (vector mode), limited to the components the renderer streams. */
export interface UnityCustomDataSpec { curves: UnityCustomCurve[]; }

export function sampleUnityKeys(keys: Key[], time: number): number {
    if (keys.length === 0) return 0;
    if (time <= keys[0].time) return keys[0].value;
    for (let i = 1; i < keys.length; i++) {
        const b = keys[i];
        if (time > b.time) continue;
        const a = keys[i - 1], duration = b.time - a.time, t = (time - a.time) / duration;
        if (!Number.isFinite(a.outSlope) || !Number.isFinite(b.inSlope)) return a.value;
        const t2 = t * t, t3 = t2 * t;
        return (2 * t3 - 3 * t2 + 1) * a.value + (t3 - 2 * t2 + t) * duration * a.outSlope + (-2 * t3 + 3 * t2) * b.value + (t3 - t2) * duration * b.inSlope;
    }
    return keys[keys.length - 1].value;
}

export function sampleUnityCustomCurve(curve: UnityCustomCurve, time: number, random: number): number {
    if (curve.mode === 0) return curve.scalar;
    if (curve.mode === 3) return curve.minimum + (curve.scalar - curve.minimum) * random;
    const maximum = sampleUnityKeys(curve.keys, time);
    if (curve.mode === 1) return maximum * curve.scalar;
    const minimum = sampleUnityKeys(curve.minKeys, time);
    return (minimum + (maximum - minimum) * random) * curve.scalar;
}

/** Stable per-particle, per-component random in [0,1); no draw per frame. */
export function unityCustomRandom(seed: number, component: number): number {
    return (((seed + component * 0x9e3779b9) * 1664525 + 1013904223) >>> 0) / 4294967296;
}

/** Particle texel index plus the normalized texture-sheet frame, kept below the next index. */
export function packUnityCustomIndex(index: number, frame: number): number {
    return index + Math.min(Math.max(frame, 0), 0.999);
}

/**
 * Feeds Unity Custom1.xyzw to the particle material through a 1-row float texture.
 * The per-vertex frame index carries `particleIndex + frame` (Cocos frames are
 * normalized to [0,1)), so the material must read `customDataTexture` at
 * floor(index) and animate with fract(index) under UNITY_PARTICLE_CUSTOM_DATA.
 */
export class UnityParticleCustomDataStream {
    private readonly texture = new Texture2D();
    private readonly data: Float32Array;
    private readonly buffers: ArrayBufferView[];
    private readonly regions = [new gfx.BufferTextureCopy()];
    private readonly processor: any;
    private readonly before: () => void;
    public uploads = 0;

    constructor(private readonly system: ParticleSystem, private readonly spec: UnityCustomDataSpec) {
        const width = system.capacity;
        this.data = new Float32Array(width * 4); this.buffers = [this.data];
        this.texture.reset({ width, height: 1, format: Texture2D.PixelFormat.RGBA32F, mipmapLevel: 1 });
        this.texture.setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
        this.texture.setMipFilter(Texture2D.Filter.NONE);
        this.texture.setWrapMode(Texture2D.WrapMode.CLAMP_TO_EDGE, Texture2D.WrapMode.CLAMP_TO_EDGE);
        this.regions[0].texExtent.width = width; this.regions[0].texExtent.height = 1;
        const material = system.getMaterialInstance(0)!;
        material.recompileShaders({ UNITY_PARTICLE_CUSTOM_DATA: true });
        material.setProperty('customDataTexture', this.texture);
        material.setProperty('customDataParameters', new Vec4(1 / width, 0, 0, 0));
        this.processor = system.processor; this.before = this.processor.updateRenderData;
        this.processor.updateRenderData = this.fill;
    }

    private readonly fill = (): void => {
        const pool = this.processor._particles, curves = this.spec.curves;
        const animated = this.system.textureAnimationModule.enable;
        for (let i = 0; i < pool.length; i++) {
            const p = pool.data[i], time = 1 - p.remainingLifetime / p.startLifetime;
            for (let channel = 0; channel < 4; channel++) {
                this.data[i * 4 + channel] = channel < curves.length ? sampleUnityCustomCurve(curves[channel], time, unityCustomRandom(p.randomSeed, channel)) : 0;
            }
            this.processor._fillDataFunc(p, i * 4, packUnityCustomIndex(i, animated ? p.frameIndex : 0));
        }
        if (pool.length > 0) {
            director.root!.device.copyBuffersToTexture(this.buffers, this.texture.getGFXTexture()!, this.regions);
            this.uploads++;
        }
    };

    destroy(): void { this.processor.updateRenderData = this.before; this.texture.destroy(); }
}
