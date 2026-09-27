import { _decorator, Component, gfx, Mesh, MeshRenderer, ParticleSystem, Vec3 } from 'cc';

const { ccclass, executionOrder, property } = _decorator;

// Unity's FBX importer reflects X and applies ModelImporter.globalScale; the Cocos
// FBX importer keeps the file's right-handed axes without globalScale (measured in
// tools/unity-cocos-port/fixtures/model-import-basis.json). Unity transforms are
// ported by reflecting Z, so the vertices Unity draws are the Cocos mesh through
// diag(-k, k, -k): a Y180 turn scaled by k. The turn keeps triangle winding and the
// tangent handedness; normals and tangents only take its sign.

const converted = new Map<string, Mesh>();

function transformAttribute(view: DataView, bundle: Mesh.IVertexBundle, offset: number, sx: number, sy: number, sz: number): void {
    const { count, stride } = bundle.view;
    for (let i = 0, p = bundle.view.offset + offset; i < count; i++, p += stride) {
        view.setFloat32(p, view.getFloat32(p, true) * sx, true);
        view.setFloat32(p + 4, view.getFloat32(p + 4, true) * sy, true);
        view.setFloat32(p + 8, view.getFloat32(p + 8, true) * sz, true);
    }
}

/** The Cocos FBX mesh re-expressed in the vertex basis Unity draws (cached per mesh and scale). */
export function unityModelBasisMesh(source: Mesh, scale: number): Mesh {
    const key = `${source.uuid}|${scale}`;
    const cached = converted.get(key);
    if (cached) return cached;
    source.initialize();
    const struct = source.struct;
    if (struct.compressed || struct.encoded || struct.quantized) throw new Error(`[UnityModelMeshBasis] ${source.name}: mesh data is still packed`);
    if (struct.morph || struct.jointMaps?.length) throw new Error(`[UnityModelMeshBasis] ${source.name}: skinned or morph meshes need a bind-pose basis`);
    if (!source.data?.byteLength) throw new Error(`[UnityModelMeshBasis] ${source.name}: mesh data is not accessible (allowDataAccess)`);
    const data = new Uint8Array(source.data);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (const bundle of struct.vertexBundles) {
        let offset = 0;
        for (const attribute of bundle.attributes) {
            const scaled = attribute.name === gfx.AttributeName.ATTR_POSITION;
            if (scaled || attribute.name === gfx.AttributeName.ATTR_NORMAL || attribute.name === gfx.AttributeName.ATTR_TANGENT) {
                if (attribute.format !== gfx.Format.RGB32F && attribute.format !== gfx.Format.RGBA32F) {
                    throw new Error(`[UnityModelMeshBasis] ${source.name}: ${attribute.name} is not a 32-bit float attribute`);
                }
                const k = scaled ? scale : 1;
                transformAttribute(view, bundle, offset, -k, k, -k);
            }
            offset += gfx.FormatInfos[attribute.format].size;
        }
    }
    const min = struct.minPosition, max = struct.maxPosition;
    const mesh = new Mesh();
    mesh.reset({
        struct: {
            ...struct,
            minPosition: min && max ? new Vec3(-max.x * scale, min.y * scale, -max.z * scale) : undefined,
            maxPosition: min && max ? new Vec3(-min.x * scale, max.y * scale, -min.z * scale) : undefined,
        },
        data,
    });
    mesh.name = `${source.name}@unity-basis`;
    converted.set(key, mesh);
    return mesh;
}

/**
 * Generated for a Unity MeshRenderer or Mesh-mode ParticleSystemRenderer that draws
 * an FBX mesh. Runs before the renderer builds its model, so Unity's vertices are the
 * only ones ever uploaded.
 */
@ccclass('UnityModelMeshBasis')
@executionOrder(-1000)
export class UnityModelMeshBasis extends Component {
    @property(Component) source: Component | null = null;
    @property scale = 1;

    protected onLoad(): void {
        const source = this.source;
        if (source instanceof MeshRenderer) {
            if (!source.mesh) throw new Error(`[UnityModelMeshBasis] ${this.node.name}: renderer has no mesh`);
            source.mesh = unityModelBasisMesh(source.mesh, this.scale);
        } else if (source instanceof ParticleSystem) {
            const mesh = source.renderer.mesh;
            if (!mesh) throw new Error(`[UnityModelMeshBasis] ${this.node.name}: particle renderer has no mesh`);
            source.renderer.mesh = unityModelBasisMesh(mesh, this.scale);
        } else {
            throw new Error(`[UnityModelMeshBasis] ${this.node.name}: source must be a MeshRenderer or ParticleSystem`);
        }
    }
}
