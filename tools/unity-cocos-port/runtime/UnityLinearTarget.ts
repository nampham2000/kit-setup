import { director, gfx, RenderTexture } from 'cc';

/** Cocos 3.8.8 RenderTexture._initWindow overwrites requested color formats
 * with swapchainFormat. Recreate the unattached window before binding cameras
 * or materials, then verify the actual GPU attachment, not the request. */
export function initializeUnityLinearTarget(texture: RenderTexture, width: number, height: number, name: string): void {
    texture.initialize({ name, width, height });
    const window = texture.window;
    if (!window || !director.root) throw new Error('Linear render target requires a render window');
    window.destroy();
    window.initialize(director.root.device, { title: name, width, height,
        renderPassInfo: new gfx.RenderPassInfo([new gfx.ColorAttachment(gfx.Format.RGBA16F)],
            new gfx.DepthStencilAttachment(gfx.Format.DEPTH_STENCIL)) });
    if (texture.getGFXTexture()?.format !== gfx.Format.RGBA16F) {
        throw new Error('Unity linear HDR requires an RGBA16F GPU attachment');
    }
}
