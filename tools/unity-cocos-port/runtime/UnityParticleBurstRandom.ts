import { ParticleSystem } from 'cc';

export interface UnityBurstRandomSpec { time: number; min: number; max: number; }

/** Independent native emission stream: one draw per simulation step, followed
 * by an unsigned inclusive integer draw at a random-count burst. */
export class UnityBurstRandomKernel {
    private a=0; private b=0; private c=0; private d=0;
    reset(seed:number):void {
        this.a=seed>>>0;this.b=(Math.imul(this.a,1812433253)+1)>>>0;
        this.c=(Math.imul(this.b,1812433253)+1)>>>0;this.d=(Math.imul(this.c,1812433253)+1)>>>0;
    }
    next():number {
        const t=this.a^(this.a<<11);this.a=this.b;this.b=this.c;this.c=this.d;
        return this.d=(this.d^(this.d>>>19)^t^(t>>>8))>>>0;
    }
    count(min:number,max:number):number { return min+this.next()%(max-min+1); }
}

/** Source-gated: ordered integer TwoConstants bursts, probability 1, no repeats,
 * zero start delay, constant time rate and zero distance rate. Other emission contracts retain their path. */
export function installUnityParticleBurstRandom(system:ParticleSystem,specs:UnityBurstRandomSpec[]):void {
    const runtime=system as any,processor=runtime.processor;
    if(runtime.unityBurstRandom)return;
    if(!runtime.unityInitialState||system.bursts.length!==specs.length)throw new Error('Native burst count binding is incomplete');
    const kernel=new UnityBurstRandomKernel();
    const emittedCycles=new Int32Array(specs.length); emittedCycles.fill(-1);
    const state=runtime.unityBurstRandom={clock:0,cycles:0,begin:0,end:0,firstCycle:0,lastCycle:0,emittedCycle:-1,initialized:false,kernel};
    const emission=runtime._emit,clear=processor.clear;
    runtime._emit=function(dt:number):void {
        if(dt>0&&this._isEmitting){
            if(!state.initialized){kernel.reset(runtime.unityInitialState.seed);state.clock=0;state.cycles=0;state.emittedCycle=-1;emittedCycles.fill(-1);state.initialized=true;}
            const duration=Math.fround(system.duration),before=state.clock,next=Math.fround(before+Math.fround(dt));
            state.firstCycle=state.cycles;state.begin=state.cycles*duration+before;state.end=state.cycles*duration+next;
            state.clock=next;
            if(system.loop&&duration>0)while(state.clock>=duration){state.clock=Math.fround(state.clock-duration);state.cycles++;}
            state.lastCycle=state.cycles;
            kernel.next();
        }
        emission.call(this,dt);
    };
    specs.forEach((spec,index)=>{
    const burst=system.bursts[index] as any;
    burst.update=(_ps:ParticleSystem,dt:number):void=>{
        if(!(dt>0)||!state.initialized)return;
        const duration=Math.fround(system.duration);
        for(let cycle=state.firstCycle;cycle<=state.lastCycle;cycle++){
            const at=cycle*duration+Math.fround(spec.time);
            if(cycle<=emittedCycles[index]||at<state.begin||at>=state.end||spec.time>=duration)continue;
            emittedCycles[index]=cycle;
            runtime.emit(kernel.count(spec.min,spec.max),Math.max(0,at-state.begin));
        }
    };
    });
    processor.clear=function():void{clear.call(this);state.initialized=false;};
}
