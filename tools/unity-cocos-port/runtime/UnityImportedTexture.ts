import { gfx, Texture2D } from 'cc';

export interface UnityImportedTextureData {
    schemaVersion: number;
    textureUuid: string;
    srgb: boolean;
    mips: { width: number; height: number; rgba: string }[];
}

// Prevent WebGL from replacing the captured native mip chain with generated mips.
class ImportedMipTexture extends Texture2D {
    isUsingOfflineMipmaps(): boolean { return true; }
}

/** Decoded native import pixels, including compression and authored mip filtering.
 * Data is encoded RGBA8 in top-to-bottom row order. Upload only during preload. */
export class UnityImportedTexture {
    private readonly cache = new Map<Texture2D, Texture2D>();

    get(source: Texture2D, data: UnityImportedTextureData): Texture2D {
        const previous = this.cache.get(source);
        if (previous) return previous;
        if (data.schemaVersion !== 1 || !data.srgb || !data.mips.length)
            throw new Error('Unsupported native texture contract');
        const first = data.mips[0];
        if (first.width !== source.width || first.height !== source.height)
            throw new Error('Native imported texture dimensions differ from source');
        const fullMipCount = 1 + Math.floor(Math.log2(Math.max(first.width, first.height)));
        if (data.mips.length !== 1 && data.mips.length !== fullMipCount)
            throw new Error('Incomplete native texture mip chain');
        const pixels = data.mips.map((mip, level) => {
            if (mip.width !== Math.max(1, first.width >> level) || mip.height !== Math.max(1, first.height >> level))
                throw new Error('Invalid native texture mip dimensions');
            const raw = atob(mip.rgba);
            if (raw.length !== mip.width * mip.height * 4) throw new Error('Invalid native texture byte count');
            const bytes = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
            return bytes;
        });
        const sampler = source.getSamplerInfo();
        const texture = new ImportedMipTexture();
        texture.name = `${source.name} (Unity imported mips)`;
        type Filter = Parameters<Texture2D['setFilters']>[0];
        type Wrap = Parameters<Texture2D['setWrapMode']>[0];
        texture.setFilters(sampler.minFilter as unknown as Filter, sampler.magFilter as unknown as Filter);
        texture.setMipFilter(sampler.mipFilter as unknown as Filter);
        texture.setWrapMode(sampler.addressU as unknown as Wrap, sampler.addressV as unknown as Wrap, sampler.addressW as unknown as Wrap);
        texture.setAnisotropy(sampler.maxAnisotropy);
        texture.reset({ width: first.width, height: first.height, mipmapLevel: pixels.length,
            format: gfx.Format.SRGB8_A8 as unknown as Parameters<Texture2D['reset']>[0]['format'] });
        pixels.forEach((bytes, level) => texture.uploadData(bytes, level));
        this.cache.set(source, texture);
        return texture;
    }

    destroy(): void { for (const texture of this.cache.values()) texture.destroy(); this.cache.clear(); }
}
