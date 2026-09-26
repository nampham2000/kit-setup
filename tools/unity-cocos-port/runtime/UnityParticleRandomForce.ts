import { ParticleSystem, Vec3 } from 'cc';
import { UnityRandomForceKernel, unityFixedForceRandom } from './UnityRandomForceKernel';
export interface UnityRandomForceSpec { autoRandomSeed: boolean;randomSeed: number;randomized?:boolean;x:number[];y:number[];z:number[]; }
/** Keep native per-frame force randomness out of Cocos' fixed per-particle path. */
export function installUnityParticleRandomForce(system:ParticleSystem,spec:UnityRandomForceSpec):void {
    const runtime=system as any,processor=runtime.processor,module=system.forceOvertimeModule as any;
    if(runtime.unityRandomForce)return;
    if(!processor?._particles||!module?.enable)throw new Error('Randomized Force requires a loaded enabled CPU module');
    const kernel=new UnityRandomForceKernel(system.capacity),random=new Vec3(),force=new Vec3();
    let fallback=spec.autoRandomSeed?(Math.random()*4294967296)>>>0:spec.randomSeed,lastTime=-1;
    runtime.unityRandomForce={kernel,spec};
    const update=processor.updateParticles;
    if(spec.randomized!==false)processor.updateParticles=function(dt:number):number{
        if(system.time<lastTime){fallback=spec.autoRandomSeed?(Math.random()*4294967296)>>>0:spec.randomSeed;kernel.reset(runtime.unityNoise?.seed??fallback);}
        const seed=runtime.unityNoise?.seed??fallback,pool=this._particles;
        kernel.beginFrame(seed,pool.length);
        for(let i=0;i<pool.length;i++)pool.data[i].unityForcePoolIndex=i;
        lastTime=system.time;return update.call(this,dt);
    };
    module.animate=function(p:any,dt:number):void {
        if(spec.randomized===false)unityFixedForceRandom(random,p.randomSeed);
        else kernel.sample(random,p.unityForcePoolIndex);
        // Reflect the sampled source Z value; reversing endpoints alone maps
        // to the opposite random draw and breaks correlation with Noise.
        force.set(spec.x[0]+(spec.x[1]-spec.x[0])*random.x,spec.y[0]+(spec.y[1]-spec.y[0])*random.y,
            spec.z[1]+(spec.z[0]-spec.z[1])*random.z);
        if(module.needTransform)Vec3.transformQuat(force,force,module.rotation);
        Vec3.scaleAndAdd(p.velocity,p.velocity,force,dt);p.ultimateVelocity.set(p.velocity);
    };
}
