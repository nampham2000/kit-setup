import { _decorator, Component, Mesh, ParticleSystem, utils } from 'cc';
import { unitySphereMesh } from './UnityParticleBuiltinMeshData';
const { ccclass, property, executeInEditMode, playOnFocus, executionOrder } = _decorator;
let sphere: Mesh | null = null;
export function nativeParticleSphere(): Mesh {
    if (!sphere) {
        const positions = unitySphereMesh.positions.slice();
        const normals = unitySphereMesh.normals.slice();
        const uvs = unitySphereMesh.uvs.slice();
        const indices = unitySphereMesh.indices.slice();
        for (let i = 2; i < positions.length; i += 3) { positions[i] = -positions[i]; normals[i] = -normals[i]; }
        for (let i = 1; i < uvs.length; i += 2) uvs[i] = 1 - uvs[i];
        for (let i = 0; i < indices.length; i += 3) { const second = indices[i + 1]; indices[i + 1] = indices[i + 2]; indices[i + 2] = second; }
        sphere = utils.createMesh({ positions, normals, uvs, indices });
    }
    return sphere;
}
@ccclass('UnityParticleBuiltinMeshAdapter')
@executeInEditMode
@playOnFocus
@executionOrder(-104)
export class UnityParticleBuiltinMeshAdapter extends Component {
    @property(ParticleSystem) source: ParticleSystem | null = null;
    protected onLoad(): void { this.bind(); }
    protected start(): void { this.bind(); }
    private bind(): void {
        if (!this.source) throw new Error('Missing native primitive particle source');
        if (!(this.source as any).processor) return;
        const mesh = nativeParticleSphere();
        if (this.source.renderer.mesh !== mesh) this.source.renderer.mesh = mesh;
    }
}
