import { ParticleSystem } from 'cc';

interface Lane { a:number;b:number;c:number;d:number; }
interface Curve { minMaxState:number;scalar:number;minScalar?:number; }
export interface UnityStartRotationSpec {
    autoRandomSeed:boolean;randomSeed:number;size3D:boolean;
    x:Curve;y:Curve;z:Curve;signs:number[];
}

/** Automatic native births, not the distinct EmitParams initialization path. */
export class UnityStartRotationKernel {
    private readonly lanes:Lane[];
    private readonly values:Float32Array;
    private readonly seeds:Uint32Array;
    private count=0;
    constructor(capacity:number) {
        this.lanes=Array.from({length:4},()=>({a:0,b:0,c:0,d:0}));
        this.values=new Float32Array(capacity*3);this.seeds=new Uint32Array(capacity);
    }
    reset(seed:number):void {
        this.count=0;
        for(let i=0;i<4;i++){
            const l=this.lanes[i];l.a=(seed+Math.imul(i,367))>>>0;
            l.b=(Math.imul(l.a,1812433253)+1)>>>0;
            l.c=(Math.imul(l.b,1812433253)+1)>>>0;
            l.d=(Math.imul(l.c,1812433253)+1)>>>0;
        }
    }
    private next(l:Lane):number {
        const t=l.a^(l.a<<11);l.a=l.b;l.b=l.c;l.c=l.d;
        return l.d=(l.d^(l.d>>>19)^t^(t>>>8))>>>0;
    }
    private unit(l:Lane):number { return Math.fround((this.next(l)&8388607)/8388607); }
    beginBatch(count:number,size3D:boolean,rotation3D=true):void {
        if(!Number.isInteger(count)||count<0||count>this.seeds.length)throw new Error('Native start rotation birth count exceeds capacity');
        this.count=count;
        for(let group=0;group<Math.ceil(count/4);group++)for(let lane=0;lane<4;lane++){
            const l=this.lanes[lane],index=group*4+lane;
            const seed=this.next(l);
            this.next(l); // Start speed.
            this.next(l); // Start size X (also consumed for constant curves).
            if(size3D){this.next(l);this.next(l);}
            const z=this.unit(l),x=rotation3D?this.unit(l):0,y=rotation3D?this.unit(l):0;
            this.next(l); // Start color.
            if(index<count){this.seeds[index]=seed;const offset=index*3;this.values[offset]=x;this.values[offset+1]=y;this.values[offset+2]=z;}
        }
    }
    value(index:number,axis:number):number {
        if(index<0||index>=this.count)throw new Error('Native start rotation birth index is outside its batch');
        return this.values[index*3+axis];
    }
    birthSeed(index:number):number {return this.seeds[index];}
}

function angle(curve:Curve,random:number):number {
    if(curve.minMaxState===0)return curve.scalar;
    const min=curve.minScalar||0;
    return Math.fround(min+Math.fround(Math.fround(curve.scalar-min)*random));
}

/** Replace correlated Cocos start XYZ, before birth-state quaternion packing. */
export function installUnityParticleStartRotation(system:ParticleSystem,spec:UnityStartRotationSpec):void {
    const runtime=system as any,processor=runtime.processor;
    if(runtime.unityStartRotation)return;
    if(!processor?._particles)throw new Error('Native start rotation requires the CPU particle pool');
    if(spec.signs.length!==3||[spec.x,spec.y,spec.z].some(c=>c.minMaxState!==0&&c.minMaxState!==3))throw new Error('Unmeasured start rotation curve or renderer signs');
    const kernel=new UnityStartRotationKernel(system.capacity);
    const choose=():number=>spec.autoRandomSeed?(Math.random()*4294967296)>>>0:spec.randomSeed>>>0;
    let fallback=choose(),seed=-1,index=0,emitting=false;
    runtime.unityStartRotation={kernel,spec};
    const emit=runtime.emit,born=processor.setNewParticle,clear=processor.clear;
    runtime.emit=function(count:number,dt?:number):void {
        const available=Math.max(0,Math.min(Math.ceil(count),system.capacity-processor._particles.length));
        if(!available){emit.call(this,count,dt);return;}
        if(emitting)throw new Error('Recursive emission needs a separate native birth contract');
        const current=(runtime.unityNoise?.seed??fallback)>>>0;
        if(seed!==current){kernel.reset(current);seed=current;}
        kernel.beginBatch(available,spec.size3D);index=0;emitting=true;
        try{emit.call(this,count,dt);}finally{emitting=false;}
    };
    processor.setNewParticle=function(p:any):void {
        born.call(this,p);
        if(!emitting)return;
        p.startEuler.set(spec.signs[0]*angle(spec.x,kernel.value(index,0)),spec.signs[1]*angle(spec.y,kernel.value(index,1)),spec.signs[2]*angle(spec.z,kernel.value(index,2)));
        p.rotation.set(p.startEuler);
        p.unityStartRotationSeed=kernel.birthSeed(index++);
    };
    processor.clear=function():void {clear.call(this);fallback=choose();seed=-1;index=0;};
}
