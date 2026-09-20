import { gfx, Texture2D } from 'cc';

/** Source TextureImporter sRGB sampling: decode before filtering/mipmap reduction.
 * Shader-side decode of an RGBA8 sample cannot recover the lost linear average.
 * Call during preload; keep data/normal textures outside this conversion.
 */
export class UnitySrgbTexture {
    private readonly cache = new Map<Texture2D, Map<number, Texture2D>>();

    get(source: Texture2D, alphaMode = 0): Texture2D {
        const previous = this.cache.get(source)?.get(alphaMode);
        if (previous) return previous;
        const image = source.image?.data;
        if (!image) throw new Error('Unity sRGB texture requires decoded source pixels');
        const canvas = document.createElement('canvas');
        canvas.width = source.width; canvas.height = source.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image as CanvasImageSource, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        // Unity AlphaSource.FromGrayScale averages ENCODED RGB at mip zero.
        // Alpha then filters linearly, independently from hardware-decoded RGB.
        for (let i = 0; i < pixels.length; i += 4) {
            if (alphaMode === 1) pixels[i + 3] = Math.round((pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3);
            else if (alphaMode === 2) pixels[i + 3] = 255;
        }
        const sampler = source.getSamplerInfo();
        const texture = new Texture2D();
        texture.name = `${source.name} (Unity sRGB)`;
        type Filter = Parameters<Texture2D['setFilters']>[0];
        type Wrap = Parameters<Texture2D['setWrapMode']>[0];
        texture.setFilters(sampler.minFilter as unknown as Filter, sampler.magFilter as unknown as Filter);
        texture.setMipFilter(sampler.mipFilter as unknown as Filter);
        texture.setWrapMode(sampler.addressU as unknown as Wrap, sampler.addressV as unknown as Wrap, sampler.addressW as unknown as Wrap);
        texture.setAnisotropy(sampler.maxAnisotropy);
        // PixelFormat maps directly to gfx.Format; SRGB8_A8 is supported by the
        // Cocos 3.8 WebGL2 backend although absent from its PixelFormat aliases.
        texture.reset({ width: source.width, height: source.height,
            format: gfx.Format.SRGB8_A8 as unknown as Parameters<Texture2D['reset']>[0]['format'] });
        texture.uploadData(pixels);
        let variants = this.cache.get(source);
        if (!variants) { variants = new Map(); this.cache.set(source, variants); }
        variants.set(alphaMode, texture);
        return texture;
    }

    destroy(): void {
        for (const variants of this.cache.values()) for (const texture of variants.values()) texture.destroy();
        this.cache.clear();
    }
}
