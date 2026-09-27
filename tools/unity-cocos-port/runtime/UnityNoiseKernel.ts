// Ken Perlin's fixed permutation, also used by Cocos' MIT-licensed ParticleNoise.
// The 2D gradient ordering, curl planes, phase RNG and integration contracts are
// independently checked against native Unity Shuriken probes. No frame jitter.
const permutation = new Uint8Array([
    151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,
    190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,
    20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,
    230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,
    18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,
    38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,
    152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,
    178,185,112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,
    14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,
    205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180,
]);
const gradientX = new Float64Array([0,0,Math.SQRT2,-Math.SQRT2,1,1,-1,-1]);
const gradientY = new Float64Array([Math.SQRT2,-Math.SQRT2,0,0,1,-1,1,-1]);
// Shuriken's 16 gradients differ from improved Perlin at indices 13–15.
const highX = new Int8Array([1,-1,1,-1,1,-1,1,-1,0,0,0,0,1,-1,0,0]);
const highY = new Int8Array([1,1,-1,-1,0,0,0,0,1,-1,1,-1,1,1,-1,-1]);
const highZ = new Int8Array([0,0,0,0,1,1,-1,-1,1,1,-1,-1,0,0,1,-1]);

export interface UnityNoiseKey { time: number; value: number; inSlope: number; outSlope: number; weightedMode?: number; }
export interface UnityNoiseCurve {
    minMaxState: number; scalar: number; minScalar?: number;
    maxCurve?: { m_Curve: UnityNoiseKey[] }; minCurve?: { m_Curve: UnityNoiseKey[] };
}
export interface UnityNoiseSpec {
    version: number; enabled: boolean; quality: number; separateAxes: boolean;
    autoRandomSeed: boolean; randomSeed: number;
    frequency: number; damping: boolean; octaves: number; octaveMultiplier: number; octaveScale: number;
    strength: UnityNoiseCurve; strengthY: UnityNoiseCurve; strengthZ: UnityNoiseCurve;
    scrollSpeed: UnityNoiseCurve; positionAmount: UnityNoiseCurve; rotationAmount: UnityNoiseCurve; sizeAmount: UnityNoiseCurve;
    remapEnabled: boolean;
    // Rotation noise: Unity start rotation mode and the renderer's Unity->Cocos Euler signs.
    rotation3D?: boolean; rotationSigns?: number[];
    size3D?: boolean;
}

export function sampleNoiseKeys(keys: UnityNoiseKey[] | undefined, time: number): number {
    if (!keys?.length) return 0;
    if (time <= keys[0].time) return keys[0].value;
    for (let i = 1; i < keys.length; i++) {
        const b = keys[i];
        if (time > b.time) continue;
        const a = keys[i - 1], duration = b.time - a.time, t = (time - a.time) / duration;
        if (!Number.isFinite(a.outSlope) || !Number.isFinite(b.inSlope)) return a.value;
        const t2 = t*t, t3 = t2*t;
        return (2*t3-3*t2+1)*a.value+(t3-2*t2+t)*duration*a.outSlope+(-2*t3+3*t2)*b.value+(t3-t2)*duration*b.inSlope;
    }
    return keys[keys.length - 1].value;
}

export function sampleNoiseCurve(curve: UnityNoiseCurve, time: number, random = 0): number {
    if (curve.minMaxState === 0) return curve.scalar;
    if (curve.minMaxState === 3) return (curve.minScalar || 0) + (curve.scalar - (curve.minScalar || 0)) * random;
    const maximum = sampleNoiseKeys(curve.maxCurve?.m_Curve, time);
    if (curve.minMaxState === 1) return maximum * curve.scalar;
    const minimum = sampleNoiseKeys(curve.minCurve?.m_Curve, time);
    return (minimum + (maximum - minimum) * random) * curve.scalar;
}

// Native two-constant strength uses a stable, independent XYZ channel per particle.
export function unityNoiseStrengthRandom(out: Float64Array, seed: number): void {
    let a = (seed + 0x3edcba94) >>> 0;
    let b = (Math.imul(a, 1812433253) + 1) >>> 0;
    let c = (Math.imul(b, 1812433253) + 1) >>> 0;
    let d = (Math.imul(c, 1812433253) + 1) >>> 0;
    for (let i = 0; i < 3; i++) {
        const t = a ^ (a << 11);
        a = b; b = c; c = d;
        d = (d ^ (d >>> 19) ^ t ^ (t >>> 8)) >>> 0;
        out[i] = Math.fround((d & 8388607) / 8388607);
    }
}

export class UnityNoiseKernel {
    readonly phase = new Float64Array(3);
    private readonly derivative = new Float64Array(2);

    constructor(seed: number) { this.reset(seed); }

    reset(seed: number): void {
        let a = seed >>> 0;
        let b = (Math.imul(a, 1812433253) + 1) >>> 0;
        let c = (Math.imul(b, 1812433253) + 1) >>> 0;
        let d = (Math.imul(c, 1812433253) + 1) >>> 0;
        for (let i = 0; i < 3; i++) {
            const t = a ^ (a << 11);
            a = b; b = c; c = d;
            d = (d ^ (d >>> 19) ^ t ^ (t >>> 8)) >>> 0;
            const value = Math.fround((d & 8388607) / 8388607);
            this.phase[i] = Math.fround(Math.fround(value * 100) + (i === 0 ? 100 : 0));
        }
    }

    gradient(out: Float64Array, x: number, y: number): void {
        const ix = Math.floor(x), iy = Math.floor(y), a = x - ix, b = y - iy;
        const y0 = permutation[iy & 255], y1 = permutation[(iy + 1) & 255];
        const c00 = permutation[(y0 + ix) & 255] & 7, c10 = permutation[(y0 + ix + 1) & 255] & 7;
        const c01 = permutation[(y1 + ix) & 255] & 7, c11 = permutation[(y1 + ix + 1) & 255] & 7;
        const n00 = gradientX[c00]*a+gradientY[c00]*b, n10 = gradientX[c10]*(a-1)+gradientY[c10]*b;
        const n01 = gradientX[c01]*a+gradientY[c01]*(b-1), n11 = gradientX[c11]*(a-1)+gradientY[c11]*(b-1);
        const u = a*a*a*(a*(a*6-15)+10), v = b*b*b*(b*(b*6-15)+10);
        const du = 30*a*a*(a-1)*(a-1), dv = 30*b*b*(b-1)*(b-1);
        const dx0 = gradientX[c00]+u*(gradientX[c10]-gradientX[c00])+du*(n10-n00);
        const dx1 = gradientX[c01]+u*(gradientX[c11]-gradientX[c01])+du*(n11-n01);
        const dy0 = gradientY[c00]+u*(gradientY[c10]-gradientY[c00]);
        const dy1 = gradientY[c01]+u*(gradientY[c11]-gradientY[c01]);
        out[0] = dx0+v*(dx1-dx0);
        out[1] = dy0+v*(dy1-dy0)+dv*((n01+u*(n11-n01))-(n00+u*(n10-n00)));
    }

    // Low quality: 1D gradient noise whose lattice slope is +-2 by permutation parity;
    // the field is its analytic derivative (fixtures/particle-noise-low-native.json).
    slope(t: number): number {
        const i = Math.floor(t), f = t - i;
        const g0 = permutation[i & 255] & 1 ? -2 : 2, g1 = permutation[(i + 1) & 255] & 1 ? -2 : 2;
        const u = f*f*f*(f*(f*6-15)+10), du = 30*f*f*(f-1)*(f-1);
        return g0+u*(g1-g0)+du*(g1*(f-1)-g0*f);
    }

    gradient3(out: Float64Array, x: number, y: number, z: number): void {
        const ix=Math.floor(x), iy=Math.floor(y), iz=Math.floor(z), a=x-ix, b=y-iy, c=z-iz;
        const u=a*a*a*(a*(a*6-15)+10), v=b*b*b*(b*(b*6-15)+10), w=c*c*c*(c*(c*6-15)+10);
        const du=30*a*a*(a-1)*(a-1), dv=30*b*b*(b-1)*(b-1);
        let dx=0, dy=0;
        for(let i=0;i<2;i++) for(let j=0;j<2;j++) for(let k=0;k<2;k++) {
            const h=permutation[(permutation[(permutation[(ix+i)&255]+iy+j)&255]+iz+k)&255]&15;
            const gx=highX[h], gy=highY[h], gz=highZ[h];
            const dot=gx*(a-i)+gy*(b-j)+gz*(c-k);
            const wx=i?u:1-u, wy=j?v:1-v, wz=k?w:1-w;
            dx+=(gx*wx+dot*(i?du:-du))*wy*wz;
            dy+=(gy*wy+dot*(j?dv:-dv))*wx*wz;
        }
        out[0]=dx; out[1]=dy;
    }

    sample(out: Float64Array, x: number, y: number, z: number, scroll: number, spec: UnityNoiseSpec): void {
        out[0] = 0; out[1] = 0; out[2] = 0;
        let frequency = spec.frequency, weight = 1, total = 0;
        const p = this.phase, g = this.derivative;
        for (let octave = 0; octave < spec.octaves; octave++) {
            const a = (x+p[0])*frequency, b = (y+p[1])*frequency, c = (z+p[2])*frequency, s = scroll*frequency;
            const amount = frequency * weight;
            if (spec.quality === 0) {
                // Low samples one coordinate per axis: X from Y, Y from Z, Z from X.
                out[0] += this.slope(b+s)*amount; out[1] += this.slope(c+s)*amount; out[2] += this.slope(a+s)*amount;
            } else if (spec.quality === 2) {
                // High uses three 3D potentials, scrolling their third coordinate.
                // Its first potential uses the unshifted X seed phase (Medium adds 100).
                this.gradient3(g, c, b, (x+p[0]-100+scroll)*frequency); const ax=g[0], ay=g[1];
                this.gradient3(g, b, a, c+s); const bx=g[0], by=g[1];
                this.gradient3(g, a, c, b+s); const cx=g[0], cy=g[1];
                out[0]+=(bx-cy)*amount; out[1]+=(ax-by)*amount; out[2]+=(cx-ay)*amount;
            } else {
                this.gradient(g, a+s, b); const ax = g[0], ay = g[1];
                this.gradient(g, c+s, a); const bx = g[0], by = g[1];
                this.gradient(g, b+s, c); const cx = g[0], cy = g[1];
                out[0] += (ay-bx)*amount; out[1] += (cy-ax)*amount; out[2] += (by-cx)*amount;
            }
            total += weight; weight *= spec.octaveMultiplier; frequency *= spec.octaveScale;
        }
        const divisor = total * (spec.damping ? spec.frequency : 1);
        if (divisor > 0) { out[0] /= divisor; out[1] /= divisor; out[2] /= divisor; }
    }
}
