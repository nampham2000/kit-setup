import { sampleNoiseKeys, UnityNoiseKey } from './UnityNoiseKernel';

export interface UnityTrailGradientKey { time: number; r: number; g: number; b: number; a: number; }
export interface UnityTrailSpec {
    time: number; minVertexDistance: number; widthMultiplier: number; widthKeys: UnityNoiseKey[];
    colors: UnityTrailGradientKey[]; alphas: UnityTrailGradientKey[];
}
/** View-aligned, Stretch TrailRenderer geometry. Buffers and views are allocated once. */
export class UnityTrailRendererGeometry {
    count = 0;
    readonly points: Float64Array;
    readonly stamps: Float64Array;
    readonly positions: Float32Array;
    readonly uvs: Float32Array;
    readonly colors: Float32Array;
    readonly indices: Uint16Array;
    private readonly distance: Float64Array;
    private renderStart = 0;
    constructor(readonly spec: UnityTrailSpec, readonly capacity = 2048) {
        if (!(spec.time > 0) || capacity < 2 || capacity > 32766) throw new Error('Invalid native TrailRenderer capacity/lifetime');
        this.points=new Float64Array(capacity*3);this.stamps=new Float64Array(capacity);
        this.positions=new Float32Array((capacity+1)*6);this.uvs=new Float32Array((capacity+1)*4);
        this.colors=new Float32Array((capacity+1)*8);this.indices=new Uint16Array(capacity*6);this.distance=new Float64Array(capacity);
        for(let i=0;i<capacity;i++){const v=i*2,k=i*6;this.indices[k]=v;this.indices[k+1]=v+1;this.indices[k+2]=v+2;this.indices[k+3]=v+1;this.indices[k+4]=v+3;this.indices[k+5]=v+2;}
    }
    clear(): void { this.count=0;this.renderStart=0; }
    append(x:number,y:number,z:number,time:number): void {
        const n=this.count,p=this.points;
        if(n && Math.hypot(x-p[(n-1)*3],y-p[(n-1)*3+1],z-p[(n-1)*3+2])<this.spec.minVertexDistance)return;
        if(n===this.capacity)throw new Error('Native TrailRenderer buffer exhausted; increase source-specific capacity');
        p[n*3]=x;p[n*3+1]=y;p[n*3+2]=z;this.stamps[n]=time;this.count++;
    }
    expire(time:number): void {
        // Keep the preceding endpoint while crossing a lifetime boundary. Exact
        // live endpoint retention is separately checked against native captures.
        let remove=0;while(remove+3<this.count && this.stamps[remove+2]<time-this.spec.time)remove++;
        if(remove){this.points.copyWithin(0,remove*3,this.count*3);this.stamps.copyWithin(0,remove,this.count);this.count-=remove;}
        let first=0;while(first+1<this.count && this.stamps[first]<time-this.spec.time)first++;
        this.renderStart=Math.max(0,first-1);
    }
    private channel(keys:UnityTrailGradientKey[],u:number,channel:'r'|'g'|'b'|'a'):number {
        if(!keys.length)return 1;
        let value=keys[keys.length-1][channel];
        if(u<=keys[0].time)value=keys[0][channel];
        else for(let i=1;i<keys.length;i++)if(u<=keys[i].time){const a=keys[i-1],b=keys[i],t=(u-a.time)/(b.time-a.time);value=a[channel]+(b[channel]-a[channel])*t;break;}
        // Unity TrailRenderer writes Color32, even with linear project color space.
        return Math.round(Math.max(0,Math.min(1,value))*255)/255;
    }
    build(fx:number,fy:number,fz:number):number {
        const n=this.count,p=this.points;if(!n)return 0;
        this.distance[n-1]=0;
        for(let i=n-2;i>=0;i--){const a=i*3,b=a+3;this.distance[i]=this.distance[i+1]+Math.hypot(p[a]-p[b],p[a+1]-p[b+1],p[a+2]-p[b+2]);}
        const total=this.distance[this.renderStart];
        for(let pair=0;pair<=n;pair++){
            const i=Math.max(this.renderStart,pair===0?n-1:n-pair),a=i*3;
            const prev=Math.max(this.renderStart,i-1)*3,next=Math.min(n-1,i+1)*3;
            const tx=p[next]-p[prev],ty=p[next+1]-p[prev+1],tz=p[next+2]-p[prev+2];
            let sx=ty*fz-tz*fy,sy=tz*fx-tx*fz,sz=tx*fy-ty*fx;
            const length=Math.hypot(sx,sy,sz),u=total>0?this.distance[i]/total:0;
            const width=this.spec.widthMultiplier*sampleNoiseKeys(this.spec.widthKeys,u)*.5;
            const scale=length>1e-10?width/length:0;sx*=scale;sy*=scale;sz*=scale;
            const v=pair*6;
            this.positions[v]=p[a]+sx;this.positions[v+1]=p[a+1]+sy;this.positions[v+2]=p[a+2]+sz;
            this.positions[v+3]=p[a]-sx;this.positions[v+4]=p[a+1]-sy;this.positions[v+5]=p[a+2]-sz;
            const uv=pair*4;this.uvs[uv]=this.uvs[uv+2]=u;this.uvs[uv+1]=1;this.uvs[uv+3]=0;
            const c=pair*8;this.colors[c]=this.colors[c+4]=this.channel(this.spec.colors,u,'r');this.colors[c+1]=this.colors[c+5]=this.channel(this.spec.colors,u,'g');this.colors[c+2]=this.colors[c+6]=this.channel(this.spec.colors,u,'b');this.colors[c+3]=this.colors[c+7]=this.channel(this.spec.alphas,u,'a');
        }
        return (n+1)*2;
    }
}
