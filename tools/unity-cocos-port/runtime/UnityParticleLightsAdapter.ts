import { _decorator, Component, ParticleSystem, Vec3 } from 'cc';
import { UnityParticleLightSpec,writeUnityParticleLight } from './UnityParticleLightKernel';
const {ccclass,property,executionOrder}=_decorator;
@ccclass('UnityParticleLightsAdapter')
@executionOrder(-90)
export class UnityParticleLightsAdapter extends Component {
    @property(ParticleSystem) source:ParticleSystem|null=null;
    @property sourceContract='';
    private spec!:UnityParticleLightSpec;
    private readonly position=new Vec3();
    private readonly scale=new Vec3();
    private tracks:{particle:any;seed:number}[]=[];
    private before:((particle:any)=>void)|null=null;
    private wrapper:((particle:any)=>void)|null=null;
    protected start():void {
        if(!this.source)throw new Error('Missing particle-light source');
        this.spec=JSON.parse(this.sourceContract);
        this.tracks=Array.from({length:this.spec.maxLights},()=>({particle:null,seed:0}));
        const processor=this.source.processor as any;
        this.before=processor.setNewParticle;
        this.wrapper=(p:any)=>{
            this.before!.call(processor,p);
            for(let i=0;i<this.tracks.length;i++){
                const track=this.tracks[i],old=track.particle;
                if(!old||old.remainingLifetime<=0||old.randomSeed!==track.seed){track.particle=p;track.seed=p.randomSeed;break;}
            }
        };
        processor.setNewParticle=this.wrapper;
    }
    writeSamples(out:Float32Array,count:number,capacity:number):number {
        if(!this.enabledInHierarchy||!this.source?.enabledInHierarchy)return count;
        this.source.node.getWorldScale(this.scale);
        if(Math.abs(Math.abs(this.scale.x)-Math.abs(this.scale.y))>1e-3||Math.abs(Math.abs(this.scale.x)-Math.abs(this.scale.z))>1e-3)throw new Error('Particle-light nonuniform world scale requires native verification');
        for(let i=0;i<this.tracks.length&&count<capacity;i++){
            const track=this.tracks[i],p=track.particle;
            if(!p||p.remainingLifetime<=0||p.randomSeed!==track.seed){track.particle=null;continue;}
            this.position.set(p.position);
            if(this.source.simulationSpace!==0)Vec3.transformMat4(this.position,this.position,this.source.node.worldMatrix);
            const offset=count*8;out[offset]=this.position.x;out[offset+1]=this.position.y;out[offset+2]=this.position.z;
            writeUnityParticleLight(out,offset,this.spec,p,Math.abs(this.scale.x));count++;
        }
        return count;
    }
    protected onDestroy():void {
        const processor=this.source?.processor as any;
        if(processor?.setNewParticle===this.wrapper)processor.setNewParticle=this.before;
    }
}
