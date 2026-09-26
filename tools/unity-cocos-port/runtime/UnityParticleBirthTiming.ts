import { ParticleSystem, pseudoRandom, Vec3 } from 'cc';

/** Native continuous births occur at counter crossings inside the simulation step. */
export function installUnityParticleBirthTiming(system:ParticleSystem,gravityY=-9.81):void {
    const runtime=system as any,processor=runtime.processor;
    if(runtime.unityBirthTiming)return;
    if(!processor?._particles||!Array.isArray(processor._runAnimateList)||!system.rateOverTime)return;
    const state=runtime.unityBirthTiming={rate:0,interval:0,clock:0,scheduled:0,lastRate:-1,lastTime:-1,first:0,index:0,rateDispatch:false,emitting:false,delay:0,dt:0,gravityY};
    const previousPosition=new Vec3(),currentPosition=new Vec3();
    system.node.getWorldPosition(previousPosition);
    const born=processor.setNewParticle,emit=runtime.emit,emission=runtime._emit,update=processor.updateParticles,enable=processor.enableModule;
    processor.setNewParticle=function(p:any):void {
        if(state.emitting){
            const delay=state.rateDispatch?state.first+state.index++*state.interval:state.delay;
            // Engine emit adds its dt to startLifetime. Source lifetime is fixed;
            // only the remaining first-frame integration interval changes.
            if(!state.rateDispatch){p.startLifetime-=state.delay;p.remainingLifetime-=state.delay;}
            p.unityBirthDelay=Math.max(0,delay);p.unityBirthPending=true;p.unityParticleDeltaTime=0;
            if(state.rateDispatch&&system.simulationSpace===0&&state.dt>0){
                const unused=1-Math.min(1,p.unityBirthDelay/state.dt);
                p.position.x-=(currentPosition.x-previousPosition.x)*unused;
                p.position.y-=(currentPosition.y-previousPosition.y)*unused;
                p.position.z-=(currentPosition.z-previousPosition.z)*unused;
            }
            if(!system.startSize3D){p.startSize.z=p.startSize.x;p.size.z=p.size.x;}
        }
        born.call(this,p);
    };
    runtime.emit=function(count:number,dt=0):void {
        const wasEmitting=state.emitting,delay=state.delay;
        state.emitting=true;state.delay=dt;
        try{emit.call(this,count,state.rateDispatch?0:dt);}
        finally{state.emitting=wasEmitting;state.delay=delay;state.rateDispatch=false;}
    };
    runtime._emit=function(dt:number):void {
        state.dt=dt;system.node.getWorldPosition(currentPosition);
        // This wrapper runs inside the source emission-window clipping wrapper.
        const rate=this.rateOverTime.evaluate(this._time/this.duration,1);
        const before=this._emitRateTimeCounter;
        state.rate=rate;state.interval=rate>0?1/rate:0;state.first=rate>0?(1-before)/rate:0;state.index=0;
        state.rateDispatch=rate>0&&before+rate*dt>1&&this._time>this.startDelay.evaluate(0,1)&&this._isEmitting;
        if(rate>0&&(this.rateOverTime.mode??0)===0&&this._time>this.startDelay.evaluate(0,1)&&this._isEmitting){
            // Native constant-rate emission divides its float clock by a float
            // interval. Multiplying a double counter by rate changes boundary
            // frames (e.g. rate 60 emits 1,2,3,4,4,5 particles in six ticks).
            const interval=Math.fround(1/rate);
            if(state.lastRate!==rate||this._time<=state.lastTime){state.clock=0;state.scheduled=0;previousPosition.set(currentPosition);}
            const previous=state.clock;
            state.clock=Math.fround(previous+Math.fround(dt));
            const total=Math.floor(state.clock/interval),count=total-state.scheduled;
            state.interval=interval;state.first=(state.scheduled+1)*interval-previous;
            state.scheduled=total;state.lastRate=rate;state.lastTime=this._time;
            const fraction=state.clock/interval-total;
            // Let engine dispatch its distance/burst paths normally. The tiny
            // guard only admits its strict >1 branch at a native exact boundary.
            this._emitRateTimeCounter=count+fraction+(count>0?1e-10:0)-rate*dt;
            state.rateDispatch=count>0;
        }
        try{emission.call(this,dt);}finally{state.rateDispatch=false;}
    };
    const enter={name:'unity-native-birth-enter',animate(p:any,dt:number):void {
        const effective=Math.max(0,dt-p.unityBirthDelay);p.unityParticleDeltaTime=effective;
        if(system.gravityModifier.isZero())return;
        const modifier=system.gravityModifier as any;
        const rand=modifier.mode===2||modifier.mode===3?pseudoRandom(p.randomSeed):0;
        const scalar=modifier.evaluate(1-p.remainingLifetime/p.startLifetime,rand);
        let gx=0,gy=-scalar*9.8*dt,gz=0;
        if(system.simulationSpace!==0){gx=processor._gravity.x;gy=processor._gravity.y;gz=processor._gravity.z;}
        const ratio=dt>0?(-state.gravityY/9.8)*effective/dt:0;
        const x=gx*(ratio-1),y=gy*(ratio-1),z=gz*(ratio-1);
        p.velocity.set(p.velocity.x+x,p.velocity.y+y,p.velocity.z+z);
        p.ultimateVelocity.set(p.ultimateVelocity.x+x,p.ultimateVelocity.y+y,p.ultimateVelocity.z+z);
    }};
    const leave={name:'unity-native-birth-leave',animate(p:any):void {
        // Engine position integration still uses global dt after the module chain.
        // Remove the unused birth interval with the final animated velocity.
        const offset=p.unityBirthDelay,v=p.ultimateVelocity;
        p.position.set(p.position.x-v.x*offset,p.position.y-v.y*offset,p.position.z-v.z*offset);
    }};
    const sync=():void=>{
        const list=processor._runAnimateList;
        for(let i=list.length-1;i>=0;i--)if(list[i]===enter||list[i]===leave){for(let j=i;j+1<list.length;j++)list[j]=list[j+1];list.length--;}
        for(let i=0;i<list.length;i++){
            const module=list[i];
            if(module.animate!==module.unityBirthTimingWrapper){
                const animate=module.animate;
                module.unityBirthTimingWrapper=function(p:any,dt:number):void{animate.call(this,p,p.unityParticleDeltaTime??dt);};
                module.animate=module.unityBirthTimingWrapper;
            }
        }
        for(let i=list.length;i>0;i--)list[i]=list[i-1];list[0]=enter;list.push(leave);
    };
    processor.enableModule=function(name:string,value:boolean,module:any):void{enable.call(this,name,value,module);sync();};
    processor.updateParticles=function(dt:number):number{
        state.dt=dt;sync();const pool=this._particles;
        for(let i=0;i<pool.length;i++){
            const p=pool.data[i];
            if(p.unityBirthPending){p.unityBirthDelay=Math.min(dt,p.unityBirthDelay);p.remainingLifetime+=p.unityBirthDelay;p.unityBirthPending=false;}
            else p.unityBirthDelay=0;
        }
        const count=update.call(this,dt);system.node.getWorldPosition(previousPosition);return count;
    };
    const trail=system.trailModule as any;
    if(trail?.animate){const animate=trail.animate;trail.animate=function(p:any,dt:number):void{animate.call(this,p,p.unityParticleDeltaTime??dt);};}
    sync();
}
