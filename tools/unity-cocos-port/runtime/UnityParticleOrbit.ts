import { ParticleSystem } from 'cc';
import { UnityNoiseCurve, sampleNoiseCurve } from './UnityNoiseKernel';

export interface UnityOrbitSpec {
    enabled: boolean; simulationSpace: number; inWorldSpace: boolean; limitEnabled: boolean;
    velocity: Record<string, UnityNoiseCurve>;
}

// Native Shuriken rotates the position around the emitter (Z, then X, then Y),
// not an independently sampled velocity ellipse. Radial follows that rotation.
export function orbitalDelta(out: Float64Array, x: number, y: number, z: number,
    wx: number, wy: number, wz: number, radial: number, dt: number): void {
    const cz=Math.cos(wz*dt),sz=Math.sin(wz*dt),cx=Math.cos(wx*dt),sx=Math.sin(wx*dt),cy=Math.cos(wy*dt),sy=Math.sin(wy*dt);
    const zx=cz*x-sz*y,zy=sz*x+cz*y;
    const xy=cx*zy-sx*z,xz=sx*zy+cx*z;
    let rx=cy*zx+sy*xz,ry=xy,rz=-sy*zx+cy*xz;
    const length=Math.hypot(rx,ry,rz);
    const scale=length>0?radial*dt/length:0;
    rx+=rx*scale;ry+=ry*scale;rz+=rz*scale;
    out[0]=(rx-x)/dt;out[1]=(ry-y)/dt;out[2]=(rz-z)/dt;
}

export function installUnityParticleOrbit(system: ParticleSystem,spec: UnityOrbitSpec): void {
    const runtime=system as any;
    if(runtime.unityOrbit)return;
    if(spec.simulationSpace!==0||spec.inWorldSpace||spec.limitEnabled)throw new Error('Orbital world/limit integration requires a measured adapter');
    const curves=spec.velocity;
    for(const key of ['orbitalOffsetX','orbitalOffsetY','orbitalOffsetZ']) {
        if(curves[key].minMaxState!==0||curves[key].scalar!==0)throw new Error('Orbital offsets require a measured adapter');
    }
    const delta=new Float64Array(3);
    const state=runtime.unityOrbit={samples:0,spec};
    system.velocityOvertimeModule.animate=function(p:any,dt:number):void {
        if(dt<=0)return;
        const age=Math.max(0,Math.min(1,1-(p.remainingLifetime+dt)/p.startLifetime));
        // Stable per-particle uniform draw. Native random-channel seed identity
        // is not claimed; constants and deterministic curves are native-tested.
        const random=((Math.imul(p.randomSeed,1664525)+1013904223)>>>0)/4294967296;

        orbitalDelta(delta,p.position.x,p.position.y,-p.position.z,sampleNoiseCurve(curves.orbitalX,age,random),sampleNoiseCurve(curves.orbitalY,age,random),sampleNoiseCurve(curves.orbitalZ,age,random),sampleNoiseCurve(curves.radial,age,random),dt);
        const x=delta[0]+sampleNoiseCurve(curves.x,age,random),y=delta[1]+sampleNoiseCurve(curves.y,age,random),z=-(delta[2]+sampleNoiseCurve(curves.z,age,random));
        const speed=sampleNoiseCurve(curves.speedModifier,age,random);
        p.animatedVelocity.set(x,y,z);
        p.ultimateVelocity.set((p.velocity.x+x)*speed,(p.velocity.y+y)*speed,(p.velocity.z+z)*speed);
        state.samples++;
    };
}
