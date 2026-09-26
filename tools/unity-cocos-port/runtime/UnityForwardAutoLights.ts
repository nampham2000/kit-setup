interface Vector {x:number;y:number;z:number;}
/** Native selection uses authored gamma RGB luminance, not GPU-linear RGB max. */
export function unityForwardLightScore(gammaLuminance:number,distanceSquared:number,range:number):number {
    const f=Math.fround;
    return f(gammaLuminance/f(1+f(f(25/f(range*range))*f(distanceSquared))));
}
function fade(current:number,next:number,previous:number):number {
    const f=Math.fround;
    return Math.max(0,Math.min(1,f(f(current-next)/f(f(previous-next)+f(.001)))));
}
/** Measured Auto point-light selection at pixelLightCount=4, one main directional.
 * Samples: xyz,range,linearRGB,gammaLuminance. Up to 8 output slots include the
 * pixel/vertex overlap. Overflow after native sorted index 7 contributes packed Lambert L2 SH.
 */
export class UnityForwardAutoLights {
    readonly indices:Int32Array;
    readonly scores:Float64Array;
    readonly slots=new Int32Array(8);
    readonly weights=new Float64Array(8);
    readonly sh=new Float64Array(28);
    count=0;pixelCount=0;vertexCount=0;unverifiedSHOverflow=false;
    constructor(capacity:number){this.indices=new Int32Array(capacity);this.scores=new Float64Array(capacity);}
    select(samples:Float32Array,count:number,center:Vector,extents:Vector):void {
        if(count>this.indices.length)throw new Error('Forward light selection capacity exceeded');
        this.count=0;this.slots.fill(-1);this.weights.fill(0);
        for(let i=0;i<count;i++){
            const o=i*8,r=samples[o+3];if(!(r>0))continue;
            const x=samples[o]-center.x,y=samples[o+1]-center.y,z=samples[o+2]-center.z;
            const dx=Math.max(0,Math.abs(x)-extents.x),dy=Math.max(0,Math.abs(y)-extents.y),dz=Math.max(0,Math.abs(z)-extents.z);
            if(dx*dx+dy*dy+dz*dz>r*r)continue;
            const score=unityForwardLightScore(samples[o+7],x*x+y*y+z*z,r);if(!(score>0))continue;
            let at=this.count;while(at>0&&this.scores[at-1]<score){this.scores[at]=this.scores[at-1];this.indices[at]=this.indices[at-1];at--;}
            this.scores[at]=score;this.indices[at]=i;this.count++;
        }
        const n=this.count;this.pixelCount=Math.min(4,n);this.vertexCount=n>4?Math.min(4,n-3):0;
        this.unverifiedSHOverflow=false;this.sh.fill(0);
        const boundsSquared=extents.x*extents.x+extents.y*extents.y+extents.z*extents.z;
        for(let i=8;i<n;i++){
            const o=this.indices[i]*8,r2=samples[o+3]*samples[o+3];
            let x=samples[o]-center.x,y=samples[o+1]-center.y,z=samples[o+2]-center.z;
            const distanceSquared=x*x+y*y+z*z,length=Math.sqrt(distanceSquared);
            if(length>0){x/=length;y/=length;z/=length;}
            const attenuation=(16/17)/(1+25*Math.max(distanceSquared,boundsSquared)/r2)*Math.min(1,r2/Math.max(boundsSquared,1e-30));
            for(let c=0;c<3;c++){
                const v=samples[o+4+c]*attenuation,a=c*4,b=12+c*4;
                this.sh[a]+=v*.5*x;this.sh[a+1]+=v*.5*y;this.sh[a+2]+=v*.5*z;this.sh[a+3]+=v*(.328125-.234375*z*z);
                this.sh[b]+=v*.9375*x*y;this.sh[b+1]+=v*.9375*y*z;this.sh[b+2]+=v*(.703125*z*z-.234375);this.sh[b+3]+=v*.9375*z*x;
                this.sh[24+c]+=v*.234375*(x*x-y*y);
            }
        }
        const pixelFade=n>4?fade(this.scores[3],this.scores[4],this.scores[2]):1;
        for(let i=0;i<this.pixelCount;i++){this.slots[i]=this.indices[i];this.weights[i]=i===3?pixelFade:1;}
        for(let j=0;j<this.vertexCount;j++){
            const index=3+j,slot=4+j;this.slots[slot]=this.indices[index];
            this.weights[slot]=j===0?1-pixelFade:j===this.vertexCount-1?fade(this.scores[index-1],this.scores[index],this.scores[index-2]):1;
        }
    }
}
