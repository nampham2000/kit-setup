import { Camera, Layers, Material, MeshRenderer, Node, ParticleSystem, Prefab, RenderTexture, Texture2D, utils, screen } from 'cc';
import { initializeUnityLinearTarget } from './UnityLinearTarget';
import { UnitySrgbTexture } from './UnitySrgbTexture';

// Unity's HDR camera blends transparent emitters before its final sRGB transfer.
// A separate camera presents that linear floating-point color attachment.
export class AoeLinearFrame {
    private readonly srgbTextures = new UnitySrgbTexture();
    private readonly textureBindings: { material: Material; property: string; source: Texture2D }[] = [];
    private readonly colorBindings: { material: Material; srgb: unknown; alpha: unknown }[] = [];
    readonly texture = new RenderTexture();
    readonly opaqueTexture = new RenderTexture();
    private readonly opaqueNode = new Node('Unity opaque texture camera');
    private readonly presentation = new Node('Unity HDR presentation');
    private readonly quad = new Node('Linear frame');
    private readonly mesh = utils.createMesh({ positions: [-1,-1,0, 1,-1,0, 1,1,0, -1,1,0],
        uvs: [0,0, 1,0, 1,1, 0,1], indices: [0,1,2, 0,2,3] });
    private readonly resize = (): void => {
        const size = screen.windowSize;
        this.texture.resize(size.width, size.height);
        this.opaqueTexture.resize(size.width, size.height);
    };

    constructor(private readonly source: Camera, material: Material, background: number[]) {
        const size = screen.windowSize;
        initializeUnityLinearTarget(this.texture, size.width, size.height, 'Unity linear HDR');
        this.texture.setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
        initializeUnityLinearTarget(this.opaqueTexture, size.width, size.height, 'Unity opaque texture');
        this.opaqueTexture.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
        this.opaqueTexture.setWrapMode(Texture2D.WrapMode.CLAMP_TO_EDGE, Texture2D.WrapMode.CLAMP_TO_EDGE);
        source.targetTexture = this.texture;
        source.priority = 0;
        source.visibility = (source.visibility | Layers.Enum.UI_3D) & ~Layers.Enum.UI_2D;
        const decode = (v: number): number => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        // Color stores byte channels. The render camera accepts linear floats,
        // avoiding visible dark-background quantization before presentation.
        source.camera!.clearColor = { x: decode(background[0]), y: decode(background[1]), z: decode(background[2]), w: 1 };
        source.node.addChild(this.opaqueNode);
        const opaqueCamera = this.opaqueNode.addComponent(Camera);
        opaqueCamera.fov = source.fov; opaqueCamera.near = source.near; opaqueCamera.far = source.far;
        opaqueCamera.priority = -1; opaqueCamera.visibility = Layers.Enum.UI_3D;
        opaqueCamera.targetTexture = this.opaqueTexture;
        opaqueCamera.camera!.clearColor = source.camera!.clearColor;
        source.node.scene.addChild(this.presentation);
        this.presentation.setPosition(0, 0, 2);
        const camera = this.presentation.addComponent(Camera);
        camera.projection = Camera.ProjectionType.ORTHO;
        camera.orthoHeight = 1;
        camera.near = 0.1; camera.far = 10;
        camera.priority = 1;
        camera.visibility = Layers.Enum.UI_2D;
        source.node.scene.addChild(this.quad);
        this.quad.layer = Layers.Enum.UI_2D;
        const renderer = this.quad.addComponent(MeshRenderer);
        renderer.mesh = this.mesh;
        material.setProperty('linearFrame', this.texture);
        renderer.setSharedMaterial(material, 0);
        window.addEventListener('resize', this.resize);
    }

    bindPrefab(prefab: Prefab): void {
        for (const system of (prefab.data as Node).getComponentsInChildren(ParticleSystem)) {
            for (const material of system.sharedMaterials) {
                if (material?.effectAsset?.name.startsWith('aoe-particle')) material.setProperty('opaqueTexture', this.opaqueTexture);
                if (material?.effectAsset?.name !== 'aoe-particle-trail') continue;
                const srgb = material.getProperty('textureSrgb') as import('cc').Vec4;
                const alpha = material.getProperty('textureAlpha') as import('cc').Vec4;
                if (!srgb || !alpha || this.colorBindings.some(binding => binding.material === material)) continue;
                const nextSrgb = srgb.clone(), nextAlpha = alpha.clone();
                const channels = ['x', 'y', 'z', 'w'] as const;
                const properties = ['mainTexture', 'noiseTexture', 'flowTexture', 'maskTexture'];
                for (let i = 0; i < channels.length; i++) {
                    const channel = channels[i], property = properties[i];
                    const source = material.getProperty(property) as Texture2D;
                    if (srgb[channel] < 0.5 || !source) continue;
                    const texture = this.srgbTextures.get(source, Math.round(alpha[channel]));
                    this.textureBindings.push({ material, property, source });
                    material.setProperty(property, texture);
                    nextSrgb[channel] = 0; nextAlpha[channel] = 0;
                }
                this.colorBindings.push({ material, srgb, alpha });
                material.setProperty('textureSrgb', nextSrgb);
                material.setProperty('textureAlpha', nextAlpha);
            }
        }
    }

    destroy(): void {
        for (const binding of this.textureBindings) binding.material.setProperty(binding.property, binding.source);
        for (const binding of this.colorBindings) {
            binding.material.setProperty('textureSrgb', binding.srgb as import('cc').Vec4);
            binding.material.setProperty('textureAlpha', binding.alpha as import('cc').Vec4);
        }
        this.srgbTextures.destroy();
        window.removeEventListener('resize', this.resize);
        this.source.targetTexture = null;
        this.presentation.destroy(); this.quad.destroy();
        this.opaqueNode.destroy(); this.opaqueTexture.destroy();
        this.mesh.destroy(); this.texture.destroy();
    }
}
