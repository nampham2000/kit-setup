import { installUnityParticleSizeRandom } from './UnityParticleSizeRandom';
import { Color, ParticleSystem } from 'cc';
import { UnityStartRotationKernel, unityStartSpeedRandom } from './UnityParticleStartRotation';
interface Curve {minMaxState:number;scalar:number;minScalar:number;}
export interface UnityInitialStateSpec {
    autoRandomSeed:boolean;randomSeed:number;size3D:boolean;rotation3D:boolean;
    lifetime:Curve;speed:Curve;size:Curve[];rotation:Curve[];signs:number[];
    color:{min:number[];max:number[];random:boolean};
}
export function sampleUnityInitialCurve(c:Curve,u:number,minimum=-Infinity):number {
    const max=Math.max(minimum,c.scalar),min=Math.max(minimum,c.minScalar);
    return c.minMaxState===0?max:Math.fround(min+Math.fround(Math.fround(max-min)*u));
}
/** Independent native birth channels; keep stock engine module seeds unsigned-safe. */
export function installUnityParticleInitialState(system:ParticleSystem,spec:UnityInitialStateSpec):void {
    const runtime=system as any,processor=runtime.processor;
    if(runtime.unityInitialState)return;
    if(!processor?._particles)throw new Error('Native initial state requires a loaded CPU pool');
    if(runtime.unityStartRotation)throw new Error('Install native initial state before legacy start rotation');
    const kernel=new UnityStartRotationKernel(system.capacity),color=new Color();
    const choose=():number=>spec.autoRandomSeed?(Math.random()*4294967296)>>>0:spec.randomSeed>>>0;
    const state=runtime.unityInitialState={seed:choose(),kernel,spec};
    // Existing generated start-rotation adapters become no-ops, avoiding two RNGs.
    runtime.unityStartRotation=state;
    installUnityParticleSizeRandom(system);
    let initialized=false,index=0,emitting=false;
    const emit=runtime.emit,born=processor.setNewParticle,clear=processor.clear;
    const bind=(target:any,curve:Curve,channel:number,sign=1,minimum=-Infinity):void=>{
        const evaluate=target.evaluate;
        target.evaluate=function(time:number,random:number):number {
            if(!emitting)return evaluate.call(this,time,random);
            const u=channel===8?unityStartSpeedRandom(kernel.birthSeed(index)):kernel.value(index,channel);
            return sign*sampleUnityInitialCurve(curve,u,minimum);
        };
    };
    bind(system.startLifetime,spec.lifetime,3,1,.0001);
    bind(system.startSpeed,spec.speed,8);
    bind(system.startSizeX,spec.size[0],4);
    bind(system.startSizeY,spec.size[1],5);
    bind(system.startSizeZ,spec.size[2],6);
    bind(system.startRotationX,spec.rotation[0],0,spec.signs[0]);
    bind(system.startRotationY,spec.rotation[1],1,spec.signs[1]);
    bind(system.startRotationZ,spec.rotation[2],2,spec.signs[2]);
    const gradient=system.startColor as any,evaluateColor=gradient.evaluate;
    gradient.evaluate=function(time:number,random:number):Color {
        if(!emitting)return evaluateColor.call(this,time,random);
        const c=spec.color,u=c.random?kernel.value(index,7):1;
        color.set(Math.round(255*(c.min[0]+(c.max[0]-c.min[0])*u)),Math.round(255*(c.min[1]+(c.max[1]-c.min[1])*u)),
            Math.round(255*(c.min[2]+(c.max[2]-c.min[2])*u)),Math.round(255*(c.min[3]+(c.max[3]-c.min[3])*u)));
        return color;
    };
    runtime.emit=function(count:number,dt?:number):void {
        const available=Math.max(0,Math.min(Math.ceil(count),system.capacity-processor._particles.length));
        if(!available){emit.call(this,count,dt);return;}
        if(emitting)throw new Error('Recursive same-system birth needs a native initialization contract');
        const seed=(runtime.unityNoise?.seed??state.seed)>>>0;
        if(!initialized||seed!==state.seed){state.seed=seed;kernel.reset(seed);initialized=true;}
        kernel.beginBatch(available,spec.size3D,spec.rotation3D);index=0;emitting=true;
        try{emit.call(this,count,dt);}finally{emitting=false;}
    };
    processor.setNewParticle=function(p:any):void {
        if(emitting){
            p.unityNativeSeed=kernel.birthSeed(index);
            p.unityStartRotationSeed=p.unityNativeSeed;
            if(!spec.size3D){p.startSize.z=p.startSize.x;p.size.z=p.size.x;}
        }
        born.call(this,p);
        if(emitting)index++;
    };
    processor.clear=function():void {
        clear.call(this);state.seed=choose();initialized=false;index=0;
        if(runtime.unityNoise)runtime.unityNoise.reset(state.seed);
    };
}
