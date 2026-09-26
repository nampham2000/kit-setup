import { ParticleSystem, Vec3 } from 'cc';
import { addUnityShapeJitter } from './UnityParticleShapeDistribution';
export interface UnityEdgeShapeSpec {radius:number;speed:number;}

export function unityEdgeLoopPosition(radius:number,speed:number,time:number):number {
    if(radius<=0)return 0;
    // Native speed traverses 2*speed units/sec, independent of segment radius.
    const travel=Math.fround(2*Math.fround(Math.fround(time)*Math.fround(speed)));
    return Math.fround(travel%(2*radius)-radius);
}

/** Continuous constant-rate SingleSidedEdge: local X segment, initial +Y direction. */
export function installUnityParticleEdgeShape(system:ParticleSystem,spec:UnityEdgeShapeSpec):void {
    const runtime=system as any,shape=system.shapeModule as any;
    if(shape.unityEdgeShape)return;
    // SimulationStep may defer birth hooks until the first Update, after the
    // engine creates the CPU processor. Require them at emission, not Start.
    if(!runtime.unityBirthTiming&&!runtime.unitySimulationStep)throw new Error('Native edge requires sub-frame birth timing');
    shape.unityEdgeShape=true;
    shape.emit=function(p:any):void {
        const timing=runtime.unityBirthTiming;
        if(!timing)throw new Error('Native edge requires sub-frame birth timing before emission');
        if(!timing.rateDispatch)throw new Error('Native edge burst/manual emission has no measured contract');
        const birth=Math.max(0,Math.fround(timing.clock-timing.dt+timing.first+timing.index*timing.interval));
        const x=unityEdgeLoopPosition(spec.radius,spec.speed,birth),pos=p.position,dir=p.velocity;
        Vec3.set(pos,x,0,0);Vec3.set(dir,0,1,0);
        const random=this.randomDirectionAmount,sphere=this.sphericalDirectionAmount;
        if(random>0){
            const z=2*Math.random()-1,a=2*Math.PI*Math.random(),r=Math.sqrt(Math.max(0,1-z*z));
            dir.x=random*r*Math.cos(a);dir.y=1-random+random*r*Math.sin(a);dir.z=random*z;
        }
        // Native mixes both directions before one normalization; jitter does
        // not change the radial direction. Z reflection leaves this X/Y basis.
        if(sphere>0){dir.x=dir.x*(1-sphere)+(x===0?0:x>0?1:-1)*sphere;dir.y*=1-sphere;dir.z*=1-sphere;}
        Vec3.normalize(dir,dir);
        if(this.randomPositionAmount>0)addUnityShapeJitter(pos,this.randomPositionAmount,Math.random(),Math.random());
        Vec3.transformQuat(dir,dir,this.quat);Vec3.transformMat4(pos,pos,this.mat);
    };
}
