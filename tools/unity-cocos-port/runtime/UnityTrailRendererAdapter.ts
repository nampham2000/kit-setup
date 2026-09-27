import { _decorator, Camera, Component, director, Material, Mesh, MeshRenderer, Node, Quat, utils, Vec3 } from 'cc';
import { UnityTrailRendererGeometry, UnityTrailSpec } from './UnityTrailRendererGeometry';
import { unitySortPriority, UnityParticleSortSpec } from './UnityParticleSorting';
const { ccclass, property, executionOrder }=_decorator;
const zero=new Vec3(),one=new Vec3(1,1,1),identity=new Quat();
interface Contract extends UnityTrailSpec { sorting: UnityParticleSortSpec; }
interface BufferViews { positions:Float32Array;uvs:Float32Array;colors:Float32Array;indices16:Uint16Array;positionBytes:Uint8Array;uvBytes:Uint8Array;colorBytes:Uint8Array;indexBytes:Uint8Array; }

/** Native View/Stretch TrailRenderer. No per-frame buffer/view allocation. */
@ccclass('UnityTrailRendererAdapter')
@executionOrder(100)
export class UnityTrailRendererAdapter extends Component {
    @property sourceContract='';
    @property(Material) sourceMaterial:Material|null=null;
    @property cameraPath='Main Camera';
    private geometry:UnityTrailRendererGeometry|null=null;
    private contract:Contract|null=null;
    private camera:Camera|null=null;
    private mesh:Mesh|null=null;
    private renderer:MeshRenderer|null=null;
    private worldNode:Node|null=null;
    private elapsed=0;
    private readonly views:BufferViews[]=[];
    protected start():void {
        if(!this.sourceMaterial||!this.sourceContract)throw new Error('Missing native TrailRenderer material/contract');
        const spec=this.contract=JSON.parse(this.sourceContract) as Contract;
        const g=this.geometry=new UnityTrailRendererGeometry(spec);
        this.camera=director.getScene()?.getChildByPath(this.cameraPath)?.getComponent(Camera)||null;
        if(!this.camera)throw new Error('Missing source TrailRenderer camera: '+this.cameraPath);
        for(let n=0;n<=g.capacity;n++)this.views.push({positions:g.positions.subarray(0,(n+1)*6),uvs:g.uvs.subarray(0,(n+1)*4),colors:g.colors.subarray(0,(n+1)*8),indices16:g.indices.subarray(0,n*6),positionBytes:new Uint8Array(g.positions.buffer,0,(n+1)*24),uvBytes:new Uint8Array(g.uvs.buffer,0,(n+1)*16),colorBytes:new Uint8Array(g.colors.buffer,0,(n+1)*32),indexBytes:new Uint8Array(g.indices.buffer,0,n*12)});
        const world=this.worldNode=new Node('Native TrailRenderer mesh');this.node.addChild(world);
        world.layer=this.node.layer;world.setWorldPosition(zero);world.setWorldRotation(identity);world.setWorldScale(one);
        const renderer=this.renderer=world.addComponent(MeshRenderer);
        this.mesh=utils.MeshUtils.createDynamicMesh(0,{...this.views[1],minPos:new Vec3(-1,-1,-1),maxPos:new Vec3(1,1,1)},undefined,{maxSubMeshes:1,maxSubMeshVertices:(g.capacity+1)*2,maxSubMeshIndices:g.capacity*6});
        renderer.mesh=this.mesh;renderer.setSharedMaterial(this.sourceMaterial,0);
    }
    protected onEnable():void { this.geometry?.clear(); }
    protected lateUpdate(dt:number):void {
        const g=this.geometry,camera=this.camera,renderer=this.renderer,mesh=this.mesh,world=this.worldNode;
        if(!g||!camera||!renderer||!mesh||!world)return;
        this.elapsed+=dt;const position=this.node.worldPosition;
        g.expire(this.elapsed);g.append(position.x,position.y,position.z,this.elapsed);
        const forward=camera.node.forward,vertices=g.build(forward.x,forward.y,forward.z),view=this.views[g.count];
        world.setWorldPosition(zero);world.setWorldRotation(identity);world.setWorldScale(one);world.layer=this.node.layer;
        // Mesh.updateSubMesh creates arrays/views internally. Reuse the imported
        // dynamic mesh's buffers and draw state, with no engine hot-path helper.
        const subMesh=mesh.renderingSubMeshes[0],buffers=subMesh.vertexBuffers;
        // The 3.8.8 declaration omits ArrayBufferView from gfx.BufferSource;
        // WebGL accepts it and the engine's own updateSubMesh passes these views.
        buffers[0].update(view.positionBytes as unknown as ArrayBuffer,view.positionBytes.byteLength);buffers[1].update(view.uvBytes as unknown as ArrayBuffer,view.uvBytes.byteLength);buffers[2].update(view.colorBytes as unknown as ArrayBuffer,view.colorBytes.byteLength);
        subMesh.indexBuffer!.update(view.indexBytes as unknown as ArrayBuffer,view.indexBytes.byteLength);
        const draw=subMesh.drawInfo!;draw.vertexCount=vertices;draw.indexCount=view.indices16.length;
        const model=renderer.model;if(!model)return;
        const ia=model.subModels[0].inputAssembler;ia.vertexCount=vertices;ia.indexCount=view.indices16.length;
        let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
        for(let i=0;i<vertices*3;i+=3){const x=g.positions[i],y=g.positions[i+1],z=g.positions[i+2];minX=Math.min(minX,x);minY=Math.min(minY,y);minZ=Math.min(minZ,z);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);maxZ=Math.max(maxZ,z);}
        const bounds=model.modelBounds!;bounds.center.set((minX+maxX)*.5,(minY+maxY)*.5,(minZ+maxZ)*.5);bounds.halfExtents.set((maxX-minX)*.5,(maxY-minY)*.5,(maxZ-minZ)*.5);model.updateWorldBound();
        const eye=camera.node.worldPosition,center=bounds.center;
        model.priority=unitySortPriority(this.contract!.sorting,Math.hypot(center.x-eye.x,center.y-eye.y,center.z-eye.z));
    }
    snapshot():unknown {
        const g=this.geometry;return {points:g?.count||0,vertices:g?(g.count+1)*2:0,positions:g?Array.from(g.points.slice(0,g.count*3)):[],mesh:g?Array.from(g.positions.slice(0,(g.count+1)*6)):[],elapsed:this.elapsed};
    }
    protected onDestroy():void { this.worldNode?.destroy();this.mesh?.destroy(); }
}
