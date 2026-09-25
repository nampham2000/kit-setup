import { Mat4, ParticleSystem, Vec3 } from 'cc';
import { UnityNoiseCurve, sampleNoiseCurve } from './UnityNoiseKernel';
import { installUnityParticleLimitVelocity } from './UnityParticleLimitVelocity';

export interface UnityOrbitSpec {
    enabled: boolean; simulationSpace: number; inWorldSpace: boolean; limitEnabled: boolean;
    scalingMode?: number;
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
    if((spec.simulationSpace!==0&&spec.simulationSpace!==1)||spec.inWorldSpace)throw new Error('Orbital custom-space/world-velocity integration requires a measured adapter');
    if(spec.simulationSpace===1&&spec.scalingMode!==0)throw new Error('World orbital nonhierarchical scaling requires a measured adapter');
    const curves=spec.velocity;
    if(spec.limitEnabled){
        // fixtures/velocity-limit-composition-native.json: Unity limits the stored
        // plus orbital/radial velocity and stores only the non-animated part. Its
        // speed modifier scales the displacement after the limit (Cocos: before).
        const speed=curves.speedModifier;
        if(speed&&(speed.minMaxState!==0||speed.scalar!==1))throw new Error('Orbital velocity limit with a speed modifier requires a measured adapter');
        installUnityParticleLimitVelocity(system);
        if(!(system.limitVelocityOvertimeModule as any)?.unityAnimatedComposition)throw new Error('Orbital velocity limit requires the Unity limit composition runtime');
    }
    for(const key of ['orbitalOffsetX','orbitalOffsetY','orbitalOffsetZ']) {
        if(curves[key].minMaxState!==0||curves[key].scalar!==0)throw new Error('Orbital offsets require a measured adapter');
    }
    const delta=new Float64Array(3);
    const worldSpace=spec.simulationSpace===1;
    const world=worldSpace?new Mat4():null,inverse=worldSpace?new Mat4():null,local=worldSpace?new Vec3():null;
    if(worldSpace){
        const processor=runtime.processor,update=processor.updateParticles;
        Mat4.copy(world,system.node.worldMatrix);Mat4.invert(inverse,world);
        // Cocos 3.8.8 CPU renderer does not call module.update. Refresh once
        // per simulation step here, including moved/scaled emitter parents.
        processor.updateParticles=function(dt:number):number {
            system.node.getWorldMatrix(world);Mat4.invert(inverse,world);
            return update.call(this,dt);
        };
    }
    const state=runtime.unityOrbit={samples:0,spec};
    system.velocityOvertimeModule.animate=function(p:any,dt:number):void {
        if(dt<=0)return;
        const age=Math.max(0,Math.min(1,1-(p.remainingLifetime+dt)/p.startLifetime));
        // Stable per-particle uniform draw. Native random-channel seed identity
        // is not claimed; constants and deterministic curves are native-tested.
        const random=((Math.imul(p.randomSeed,1664525)+1013904223)>>>0)/4294967296;

        // World particles still orbit in the emitter's local frame. Unity
        // applies its full transform (including scale) to the resulting delta.
        if(worldSpace)Vec3.transformMat4(local,p.position,inverse);
        const position=worldSpace?local:p.position;
        orbitalDelta(delta,position.x,position.y,-position.z,sampleNoiseCurve(curves.orbitalX,age,random),sampleNoiseCurve(curves.orbitalY,age,random),sampleNoiseCurve(curves.orbitalZ,age,random),sampleNoiseCurve(curves.radial,age,random),dt);
        let x=delta[0]+sampleNoiseCurve(curves.x,age,random),y=delta[1]+sampleNoiseCurve(curves.y,age,random),z=-(delta[2]+sampleNoiseCurve(curves.z,age,random));
        if(worldSpace){
            const lx=x,ly=y,lz=z;
            x=world.m00*lx+world.m04*ly+world.m08*lz;
            y=world.m01*lx+world.m05*ly+world.m09*lz;
            z=world.m02*lx+world.m06*ly+world.m10*lz;
        }
        const speed=sampleNoiseCurve(curves.speedModifier,age,random);
        p.animatedVelocity.set(x,y,z);
        p.ultimateVelocity.set((p.velocity.x+x)*speed,(p.velocity.y+y)*speed,(p.velocity.z+z)*speed);
        state.samples++;
    };
}
