import { _decorator, Component, Mat4, Quat, Vec3 } from 'cc';

const { ccclass, property } = _decorator;

// Unity WindZone as the particle External Forces module sees it, measured with
// ParticleSystem.Simulate (fixtures/wind-zone-native.json):
//   pulse      = 1 + windPulseMagnitude * (cos x + cos 0.375x + cos 0.05x) / 3,  x = PI * windPulseFrequency * Time.time
//   directional: acceleration = forward * windMain * pulse
//   spherical  : acceleration = normalize(p - zone) * windMain * pulse * (1 - |p - zone|^2 / radius^2)  (|p - zone| < radius)
// multiplied by the module multiplier and added to the stored velocity each step.
// windTurbulence has no effect on particles; the zone's scale does not scale the radius.
// A Local-space system evaluates the zone in its simulation space: zone position and
// forward go through the emitter's inverse world matrix (forward not renormalised) and
// the radius and falloff use local lengths.

export function unityWindPulse(magnitude: number, frequency: number, time: number): number {
    const x = Math.PI * frequency * time;
    return 1 + magnitude * (Math.cos(x) + Math.cos(0.375 * x) + Math.cos(0.05 * x)) / 3;
}

const FORWARD = new Vec3(0, 0, -1);
const worldForward = new Vec3();

/** One zone prepared for a simulation space (see UnityWindZone.prepare). */
export class UnityWindSample {
    readonly position = new Vec3();
    readonly direction = new Vec3();
    spherical = false;
    radiusSq = 0;
    strength = 0;

    /** Adds this zone's acceleration at `p` (same space as prepare) to `out`. */
    accumulate(out: Vec3, p: Readonly<Vec3>): void {
        if (!this.spherical) {
            Vec3.scaleAndAdd(out, out, this.direction, this.strength);
            return;
        }
        const dx = p.x - this.position.x, dy = p.y - this.position.y, dz = p.z - this.position.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq >= this.radiusSq || distSq <= 0) return;
        const scale = this.strength * (1 - distSq / this.radiusSq) / Math.sqrt(distSq);
        out.x += dx * scale; out.y += dy * scale; out.z += dz * scale;
    }
}

@ccclass('UnityWindZone')
export class UnityWindZone extends Component {
    /** Enabled zones, in enable order. */
    static readonly active: UnityWindZone[] = [];

    /** Unity WindZoneMode: 0 Directional, 1 Spherical. */
    @property mode = 0;
    @property radius = 20;
    @property windMain = 1;
    /** Kept for scripts that drive it; it does not move particles (see header). */
    @property windTurbulence = 1;
    @property windPulseMagnitude = 0.5;
    @property windPulseFrequency = 0.01;

    protected onEnable(): void {
        UnityWindZone.active.push(this);
    }

    protected onDisable(): void {
        const index = UnityWindZone.active.indexOf(this);
        if (index >= 0) UnityWindZone.active.splice(index, 1);
    }

    /**
     * Fills `out` for particles simulated in world space (`worldToSim` null) or in the space
     * whose inverse world matrix is `worldToSim`; `time` is Unity Time.time in seconds.
     */
    prepare(out: UnityWindSample, time: number, multiplier: number, worldToSim: Readonly<Mat4> | null): void {
        const node = this.node;
        out.spherical = this.mode === 1;
        out.radiusSq = this.radius * this.radius;
        out.strength = this.windMain * unityWindPulse(this.windPulseMagnitude, this.windPulseFrequency, time) * multiplier;
        if (out.spherical) {
            if (worldToSim) Vec3.transformMat4(out.position, node.worldPosition, worldToSim);
            else out.position.set(node.worldPosition);
        } else {
            Vec3.transformQuat(worldForward, FORWARD, node.worldRotation as Quat);
            if (worldToSim) Vec3.transformMat4Normal(out.direction, worldForward, worldToSim);
            else out.direction.set(worldForward);
        }
    }
}
