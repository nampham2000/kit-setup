import { _decorator, Camera, Component, director, Material, Mesh, MeshRenderer, Node, Quat, utils, Vec3 } from 'cc';
import { UnityTrailRendererGeometry, UnityTrailSpec } from './UnityTrailRendererGeometry';
import { unitySortPriority, UnityParticleSortSpec } from './UnityParticleSorting';
const { ccclass, property, executionOrder }=_decorator;
const zero=new Vec3(),one=new Vec3(1,1,1),identity=new Quat();
interface Contract extends UnityTrailSpec { sorting: UnityParticleSortSpec; }
interface BufferViews { positions:Float32Array;normals:Float32Array;uvs:Float32Array;colors:Float32Array;indices16:Uint16Array;positionBytes:Uint8Array;normalBytes:Uint8Array;uvBytes:Uint8Array;colorBytes:Uint8Array;indexBytes:Uint8Array; }

/**
 * Native View/Stretch TrailRenderer. No per-frame buffer/view allocation.
 * Normals face the camera (a View-aligned strip has no lighting data; mesh effects such as
 * aoe-particle's AOE_LINE_MESH still read a_normal). An empty cameraPath (generic porter output,
 * which cannot know the scene) uses the first enabled camera that renders this node's layer.
 */
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
    private normals:Float32Array|null=null;
    private readonly slots={position:0,normal:1,uv:2,color:3};
    private instance:Material|null=null;
    /** Per-renderer material (Unity Renderer.material): a copy of sourceMaterial, usable before start. */
    get materialInstance():Material|null {
        if(!this.instance&&this.sourceMaterial){const m=new Material();m.copy(this.sourceMaterial);this.instance=m;this.renderer?.setSharedMaterial(m,0);}
        return this.instance;
    }
    protected start():void {
        if(!this.sourceMaterial||!this.sourceContract)throw new Error('Missing native TrailRenderer material/contract');
        const spec=this.contract=JSON.parse(this.sourceContract) as Contract;
        const g=this.geometry=new UnityTrailRendererGeometry(spec);
        this.camera=this.cameraPath?director.getScene()?.getChildByPath(this.cameraPath)?.getComponent(Camera)||null:this.renderingCamera();
        if(!this.camera)throw new Error('Missing source TrailRenderer camera: '+(this.cameraPath||'<layer camera>'));
        const normals=this.normals=new Float32Array((g.capacity+1)*6);
        for(let n=0;n<=g.capacity;n++)this.views.push({positions:g.positions.subarray(0,(n+1)*6),normals:normals.subarray(0,(n+1)*6),uvs:g.uvs.subarray(0,(n+1)*4),colors:g.colors.subarray(0,(n+1)*8),indices16:g.indices.subarray(0,n*6),positionBytes:new Uint8Array(g.positions.buffer,0,(n+1)*24),normalBytes:new Uint8Array(normals.buffer,0,(n+1)*24),uvBytes:new Uint8Array(g.uvs.buffer,0,(n+1)*16),colorBytes:new Uint8Array(g.colors.buffer,0,(n+1)*32),indexBytes:new Uint8Array(g.indices.buffer,0,n*12)});
        const world=this.worldNode=new Node('Native TrailRenderer mesh');this.node.addChild(world);
        world.layer=this.node.layer;world.setWorldPosition(zero);world.setWorldRotation(identity);world.setWorldScale(one);
        const renderer=this.renderer=world.addComponent(MeshRenderer);
        this.mesh=utils.MeshUtils.createDynamicMesh(0,{...this.views[1],minPos:new Vec3(-1,-1,-1),maxPos:new Vec3(1,1,1)},undefined,{maxSubMeshes:1,maxSubMeshVertices:(g.capacity+1)*2,maxSubMeshIndices:g.capacity*6});
        // Vertex buffers follow the mesh's attribute bundles; look them up by name.
        this.mesh.struct.vertexBundles.forEach((bundle,i)=>{const name=bundle.attributes[0]?.name;if(name==='a_position')this.slots.position=i;else if(name==='a_normal')this.slots.normal=i;else if(name==='a_texCoord')this.slots.uv=i;else if(name==='a_color')this.slots.color=i;});
        renderer.mesh=this.mesh;renderer.setSharedMaterial(this.instance||this.sourceMaterial,0);
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
        const normals=this.normals!,slots=this.slots;
        for(let i=0;i<vertices*3;i+=3){normals[i]=-forward.x;normals[i+1]=-forward.y;normals[i+2]=-forward.z;}
        buffers[slots.position].update(view.positionBytes as unknown as ArrayBuffer,view.positionBytes.byteLength);buffers[slots.normal].update(view.normalBytes as unknown as ArrayBuffer,view.normalBytes.byteLength);
        buffers[slots.uv].update(view.uvBytes as unknown as ArrayBuffer,view.uvBytes.byteLength);buffers[slots.color].update(view.colorBytes as unknown as ArrayBuffer,view.colorBytes.byteLength);
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
    private renderingCamera():Camera|null {
        const layer=this.node.layer,cameras=director.getScene()?.getComponentsInChildren(Camera)||[];
        let best:Camera|null=null;
        for(const c of cameras)if(c.enabledInHierarchy&&(c.visibility&layer)&&(!best||c.priority<best.priority))best=c;
        return best;
    }
    snapshot():unknown {
        const g=this.geometry;return {points:g?.count||0,vertices:g?(g.count+1)*2:0,positions:g?Array.from(g.points.slice(0,g.count*3)):[],mesh:g?Array.from(g.positions.slice(0,(g.count+1)*6)):[],elapsed:this.elapsed};
    }
    protected onDestroy():void { this.worldNode?.destroy();this.mesh?.destroy(); }
}
