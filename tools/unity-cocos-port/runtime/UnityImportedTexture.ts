import { gfx, Texture2D } from 'cc';

export interface UnityImportedTextureData {
    schemaVersion: number;
    textureUuid: string;
    srgb: boolean;
    sampler?: { filterMode: string; wrapU: string; wrapV: string; wrapW: string; anisoLevel: number; mipMapBias: number };
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
        if (!Number.isInteger(first.width) || !Number.isInteger(first.height) || first.width < 1 || first.height < 1)
            throw new Error('Invalid native imported texture dimensions');
        if (source._uuid && data.textureUuid !== source._uuid)
            throw new Error('Native imported texture UUID differs from source');
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
        const native = data.sampler;
        const wrap = (value: string): gfx.Address => {
            if (value === 'Repeat') return gfx.Address.WRAP;
            if (value === 'Clamp') return gfx.Address.CLAMP;
            if (value === 'Mirror') return gfx.Address.MIRROR;
            throw new Error(`Unsupported native texture wrap: ${value}`);
        };
        if (native && (native.mipMapBias !== 0 || ['Point', 'Bilinear', 'Trilinear'].indexOf(native.filterMode) < 0))
            throw new Error('Native texture sampler needs a measured shader adapter');
        const minFilter = native ? (native.filterMode === 'Point' ? gfx.Filter.POINT : gfx.Filter.LINEAR) : sampler.minFilter;
        const mipFilter = native ? (pixels.length === 1 ? gfx.Filter.NONE : native.filterMode === 'Trilinear' ? gfx.Filter.LINEAR : gfx.Filter.POINT) : sampler.mipFilter;
        const addressU = native ? wrap(native.wrapU) : sampler.addressU;
        const addressV = native ? wrap(native.wrapV) : sampler.addressV;
        const addressW = native ? wrap(native.wrapW) : sampler.addressW;
        const texture = new ImportedMipTexture();
        texture.name = `${source.name} (Unity imported mips)`;
        type Filter = Parameters<Texture2D['setFilters']>[0];
        type Wrap = Parameters<Texture2D['setWrapMode']>[0];
        texture.setFilters(minFilter as unknown as Filter, (native ? minFilter : sampler.magFilter) as unknown as Filter);
        texture.setMipFilter(mipFilter as unknown as Filter);
        texture.setWrapMode(addressU as unknown as Wrap, addressV as unknown as Wrap, addressW as unknown as Wrap);
        texture.setAnisotropy(native ? Math.max(1, native.anisoLevel) : sampler.maxAnisotropy);
        texture.reset({ width: first.width, height: first.height, mipmapLevel: pixels.length,
            format: gfx.Format.SRGB8_A8 as unknown as Parameters<Texture2D['reset']>[0]['format'] });
        pixels.forEach((bytes, level) => texture.uploadData(bytes, level));
        this.cache.set(source, texture);
        return texture;
    }

    destroy(): void { for (const texture of this.cache.values()) texture.destroy(); this.cache.clear(); }
}
