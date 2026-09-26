import { ParticleSystem, Vec3 } from 'cc';
interface Lane {a:number;b:number;c:number;d:number;}
/** Automatic Circle/Cone Base shape stream is independent of initial-value RNG. */
export class UnityShapeRandomKernel {
    private readonly lanes:Lane[]=Array.from({length:4},()=>({a:0,b:0,c:0,d:0}));
    readonly values:Float64Array;
    constructor(capacity:number){this.values=new Float64Array(capacity*6);}
    reset(seed:number):void {for(let i=0;i<4;i++){const l=this.lanes[i];l.a=(seed+Math.imul(i,367))>>>0;l.b=(Math.imul(l.a,1812433253)+1)>>>0;l.c=(Math.imul(l.b,1812433253)+1)>>>0;l.d=(Math.imul(l.c,1812433253)+1)>>>0;}}
    private unit(l:Lane):number {const t=l.a^(l.a<<11);l.a=l.b;l.b=l.c;l.c=l.d;l.d=(l.d^(l.d>>>19)^t^(t>>>8))>>>0;return Math.fround((l.d&8388607)/8388607);}
    beginBatch(count:number,type:number,radius:number,thickness:number,arc:number,angle:number):void {
        if(type!==10&&type!==4)throw new Error('Unmeasured native shape RNG type');
        for(let base=0;base<count;base+=4)for(let lane=0;lane<4;lane++){
            const u=this.unit(this.lanes[lane]),v=this.unit(this.lanes[lane]);if(base+lane>=count)continue;
            const theta=u*arc*Math.PI/180,c=Math.cos(theta),s=Math.sin(theta),inner=1-thickness;
            const r=radius*Math.sqrt(type===10?inner*inner+v*(1-inner*inner):1-v*Math.min(thickness,.999));
            const o=(base+lane)*6;this.values[o]=c*r;this.values[o+1]=s*r;this.values[o+2]=0;
            if(type===10){this.values[o+3]=c;this.values[o+4]=s;this.values[o+5]=0;}
            else {const sin=Math.sin(angle*Math.PI/180),x=c*r*sin,y=s*r*sin,z=Math.cos(angle*Math.PI/180)*radius,length=Math.hypot(x,y,z);this.values[o+3]=x/length;this.values[o+4]=y/length;this.values[o+5]=z/length;}
        }
    }
}
export function installUnityParticleShapeRandom(system:ParticleSystem):{reset(seed:number):void;beginBatch(count:number):void}|null {
    const shape=system.shapeModule as any;
    if(!shape?.enable||shape.unityShapeRandom||shape.arcMode!==0||(shape.arcSpread??0)!==0||shape.randomDirectionAmount!==0||shape.sphericalDirectionAmount!==0||shape.randomPositionAmount!==0||shape.alignToDirection)return null;
    const type=shape.shapeType===1?10:shape.shapeType===2&&shape.emitFrom===0?4:-1;
    if(type<0||!(shape.radius>0))return null;
    const kernel=new UnityShapeRandomKernel(system.capacity);let index=0;
    const state={reset(seed:number):void{kernel.reset(seed);index=0;},beginBatch(count:number):void{index=0;kernel.beginBatch(count,type,shape.radius,shape.radiusThickness,shape.arc,shape.angle);}};
    shape.unityShapeRandom=state;
    shape.emit=function(p:any):void {
        const o=index++*6,v=kernel.values;
        Vec3.set(p.position,v[o],v[o+1],-v[o+2]);Vec3.set(p.velocity,v[o+3],v[o+4],-v[o+5]);
        Vec3.transformQuat(p.velocity,p.velocity,this.quat);Vec3.transformMat4(p.position,p.position,this.mat);
    };
    return state;
}
