import { ParticleSystem } from 'cc';
import { unityParticleSeedRandom } from './UnityParticleStartRotation';

/** Native size-over-lifetime uses one shared scalar for all three size axes. */
export function installUnityParticleSizeRandom(system:ParticleSystem):void {
    const runtime=system as any,module=system.sizeOvertimeModule as any;
    if(!module||runtime.unitySizeRandom)return;
    const curves=module.separateAxes?[module.x,module.y,module.z]:[module.size];
    if(!curves.some(curve=>curve&&(curve.mode===2||curve.mode===3)))return;
    runtime.unitySizeRandom=true;
    const animate=module.animate;
    module.animate=function(p:any,dt:number):void {
        if(p.unityNativeSeed===undefined){animate.call(this,p,dt);return;}
        const random=unityParticleSeedRandom(p.unityNativeSeed,0x8d2c8431);
        const age=1-p.remainingLifetime/p.startLifetime;
        if(this.separateAxes){
            p.size.x=p.startSize.x*this.x.evaluate(age,random);
            p.size.y=p.startSize.y*this.y.evaluate(age,random);
            p.size.z=p.startSize.z*this.z.evaluate(age,random);
        }else{
            const size=this.size.evaluate(age,random);
            p.size.x=p.startSize.x*size;p.size.y=p.startSize.y*size;p.size.z=p.startSize.z*size;
        }
    };
}
