/**
 * Measured native front-face gate for a frozen sphere centered on a near-XZ
 * planar mesh. It supplements backend contact events, not the physics solver.
 * Geometry and queries use Unity coordinates; caller supplies the static,
 * axis-aligned uniform scale. Borders and off-plane centers return null.
 */
export class UnityPlanarMeshContactGate {
    private readonly triangles:Float64Array;
    private minX=Infinity;private maxX=-Infinity;
    private minZ=Infinity;private maxZ=-Infinity;
    constructor(positions:readonly number[],indices:readonly number[],scale:number) {
        if(!(scale>0)||!Number.isFinite(scale)||positions.length%3||indices.length%3)throw new Error('Invalid planar contact geometry');
        const f=Math.fround,vertices=new Float32Array(positions.length);
        for(let i=0;i<positions.length;i+=3){
            const x=f(positions[i]*scale),y=f(positions[i+1]*scale),z=f(positions[i+2]*scale);
            if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z)||Math.abs(y)>1e-12*scale)throw new Error('Contact gate requires source near-XZ plane');
            vertices[i]=x;vertices[i+1]=y;vertices[i+2]=z;
            this.minX=Math.min(this.minX,x);this.maxX=Math.max(this.maxX,x);
            this.minZ=Math.min(this.minZ,z);this.maxZ=Math.max(this.maxZ,z);
        }
        this.triangles=new Float64Array(indices.length/3*10);
        for(let i=0;i<indices.length;i+=3){
            for(let j=0;j<3;j++)if(!Number.isInteger(indices[i+j])||indices[i+j]<0||indices[i+j]*3>=positions.length)throw new Error('Invalid planar triangle index');
            const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
            const abx=f(vertices[b]-vertices[a]),aby=f(vertices[b+1]-vertices[a+1]),abz=f(vertices[b+2]-vertices[a+2]);
            const acx=f(vertices[c]-vertices[a]),acy=f(vertices[c+1]-vertices[a+1]),acz=f(vertices[c+2]-vertices[a+2]);
            let nx=f(f(aby*acz)-f(abz*acy)),ny=f(f(abz*acx)-f(abx*acz)),nz=f(f(abx*acy)-f(aby*acx));
            const length=f(Math.sqrt(f(f(f(nx*nx)+f(ny*ny))+f(nz*nz))));
            if(!(ny>0)||!length)throw new Error('Contact gate requires upward nondegenerate triangles');
            nx=f(nx/length);ny=f(ny/length);nz=f(nz/length);
            const o=i/3*10,t=this.triangles;
            t[o]=vertices[a];t[o+1]=vertices[a+2];t[o+2]=vertices[b];t[o+3]=vertices[b+2];t[o+4]=vertices[c];t[o+5]=vertices[c+2];
            t[o+6]=nx;t[o+7]=ny;t[o+8]=nz;
            t[o+9]=f(f(f(vertices[a]*nx)+f(vertices[a+1]*ny))+f(vertices[a+2]*nz));
        }
    }
    testSphereInterior(x:number,y:number,z:number,radius:number,contactDistance=.02):boolean|null {
        if(y!==0||!(radius>0)||!Number.isFinite(x)||!Number.isFinite(z)||!Number.isFinite(radius)||!(contactDistance>=0))return null;
        const margin=radius+contactDistance;
        if(x<this.minX+margin||x>this.maxX-margin||z<this.minZ+margin||z>this.maxZ-margin)return null;
        const f=Math.fround,t=this.triangles; x=f(x);z=f(z);
        for(let o=0;o<t.length;o+=10){
            const a=(t[o+2]-t[o])*(z-t[o+1])-(t[o+3]-t[o+1])*(x-t[o]);
            const b=(t[o+4]-t[o+2])*(z-t[o+3])-(t[o+5]-t[o+3])*(x-t[o+2]);
            const c=(t[o]-t[o+4])*(z-t[o+5])-(t[o+1]-t[o+5])*(x-t[o+4]);
            if(!((a>=0&&b>=0&&c>=0)||(a<=0&&b<=0&&c<=0)))continue;
            if(f(f(f(x*t[o+6])+f(z*t[o+8]))-t[o+9])>=0)return true;
        }
        return false;
    }
}
