import { ParticleSystem, Vec3 } from 'cc';

interface Vector { x:number;y:number;z:number; }
interface Rotation extends Vector { w:number; }
/** Native Hierarchy scaling of module vectors; startSpeed is intentionally separate. */
export function transformUnityModuleVector(out:Vector,x:number,y:number,z:number,q:Rotation,s:Vector,systemWorld:boolean,moduleWorld:boolean):void {
    if(!systemWorld&&!moduleWorld){out.x=x;out.y=y;out.z=z;return;}
    x*=s.x;y*=s.y;z*=s.z;
    if(systemWorld&&moduleWorld){out.x=x;out.y=y;out.z=z;return;}
    const sign=systemWorld?1:-1,qx=q.x*sign,qy=q.y*sign,qz=q.z*sign;
    const tx=2*(qy*z-qz*y),ty=2*(qz*x-qx*z),tz=2*(qx*y-qy*x);
    out.x=x+q.w*tx+qy*tz-qz*ty;out.y=y+q.w*ty+qz*tx-qx*tz;out.z=z+q.w*tz+qx*ty-qy*tx;
    if(!systemWorld){out.x/=s.x;out.y/=s.y;out.z/=s.z;}
}

/** Preserve each existing module's sampling while replacing its rotation-only frame. */
export function installUnityParticleModuleScale(system:ParticleSystem):void {
    const runtime=system as any;
    if(runtime.unityParticleModuleScale)return;
    runtime.unityParticleModuleScale=true;
    const force=system.forceOvertimeModule as any,velocity=system.velocityOvertimeModule as any;
    const forceDelta=new Vec3(),velocityDelta=new Vec3();
    const transform=(out:Vector,x:number,y:number,z:number,module:any):void=>{
        transformUnityModuleVector(out,x,y,z,system.node.worldRotation,system.node.worldScale,system.simulationSpace===0,module.space===0);
    };
    if(force){const animate=force.animate;force.animate=function(p:any,dt:number):void{
        const x=p.velocity.x,y=p.velocity.y,z=p.velocity.z,need=this.needTransform;
        this.needTransform=false;try{animate.call(this,p,dt);}finally{this.needTransform=need;}
        transform(forceDelta,p.velocity.x-x,p.velocity.y-y,p.velocity.z-z,this);
        p.velocity.set(x+forceDelta.x,y+forceDelta.y,z+forceDelta.z);p.ultimateVelocity.set(p.velocity);
    };}
    // Orbit already applies its measured full emitter matrix, including scale.
    if(velocity&&!runtime.unityOrbit){const animate=velocity.animate;velocity.animate=function(p:any,dt:number):void{
        const x=p.animatedVelocity.x,y=p.animatedVelocity.y,z=p.animatedVelocity.z,need=this.needTransform;
        this.needTransform=false;try{animate.call(this,p,dt);}finally{this.needTransform=need;}
        transform(velocityDelta,p.animatedVelocity.x-x,p.animatedVelocity.y-y,p.animatedVelocity.z-z,this);
        p.animatedVelocity.set(x+velocityDelta.x,y+velocityDelta.y,z+velocityDelta.z);
        // Same deterministic speed-modifier draw as the Cocos CPU module.
        const mode=this.speedModifier.mode,random=mode===2||mode===3?(((p.randomSeed+197866)*9301+49297)%233280)/233280:0;
        const speed=this.speedModifier.evaluate(1-p.remainingLifetime/p.startLifetime,random);
        p.ultimateVelocity.set((p.velocity.x+p.animatedVelocity.x)*speed,(p.velocity.y+p.animatedVelocity.y)*speed,(p.velocity.z+p.animatedVelocity.z)*speed);
    };}
}
