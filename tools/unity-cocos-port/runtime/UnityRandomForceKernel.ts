interface Lane { a: number; b: number; c: number; d: number; }
/** Native randomized Force uses four SIMD lanes and two XYZ passes per tick. */
export class UnityRandomForceKernel {
    private readonly lanes: Lane[];
    private readonly values: Float32Array;
    private count = 0;
    private seed = -1;
    constructor(capacity: number) {
        this.lanes=Array.from({length:4},()=>({a:0,b:0,c:0,d:0}));
        this.values=new Float32Array(capacity*3);
    }
    beginFrame(seed: number,count: number): void {
        seed>>>=0;
        if(this.seed!==seed) this.reset(seed);
        if(count*3>this.values.length)throw new Error('Force pool exceeded source capacity');
        this.count=count;
        const groups=Math.ceil(count/4);
        for(let group=0;group<groups;group++)for(let lane=0;lane<4;lane++){
            const i=group*4+lane,l=this.lanes[lane];
            const x=this.next(l),y=this.next(l),z=this.next(l);
            if(i<count){const offset=i*3;this.values[offset]=x;this.values[offset+1]=y;this.values[offset+2]=z;}
        }
        for(let group=0;group<groups;group++)for(let lane=0;lane<4;lane++){
            const l=this.lanes[lane];this.next(l);this.next(l);this.next(l);
        }
    }
    reset(seed: number): void {
        this.seed=seed>>>0;this.count=0;
        for(let i=0;i<this.lanes.length;i++){
            const l=this.lanes[i];l.a=(this.seed+Math.imul(i,367))>>>0;
            l.b=(Math.imul(l.a,1812433253)+1)>>>0;
            l.c=(Math.imul(l.b,1812433253)+1)>>>0;
            l.d=(Math.imul(l.c,1812433253)+1)>>>0;
        }
    }
    private next(l: Lane): number {
        const t=l.a^(l.a<<11);l.a=l.b;l.b=l.c;l.c=l.d;
        l.d=(l.d^(l.d>>>19)^t^(t>>>8))>>>0;
        return Math.fround((l.d&8388607)/8388607);
    }
    sample(out: {x:number;y:number;z:number},index: number): void {
        if(index<0||index>=this.count)throw new Error('Force pool lane exceeded source count');
        const offset=index*3;out.x=this.values[offset];out.y=this.values[offset+1];out.z=this.values[offset+2];
    }
}
