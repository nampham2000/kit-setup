# Unity sRGB texture sampling

Use `UnitySrgbTexture.get(texture, alphaMode)` during preload for source importers with `sRGBTexture=true`. Bind the returned texture and disable software RGB decoding for that sampler. Modes 0/1/2 retain input alpha, derive alpha from encoded grayscale, or force opaque respectively. Data and normal samplers must retain their source import semantics. Dispose the cache only after restoring/unbinding materials.

This addresses mip reduction and filtering, not brightness calibration. RGBA8 automatic mip generation averages encoded RGB; calling `SRGBToLinear` after sampling cannot recover the linear average. `SRGB8_A8` decodes before filtering and mip generation, while alpha is independently linear. Do not derive grayscale alpha from an already downsampled/decoded RGB sample. Do not disable mipmaps or increase emission/width as a workaround.

The Cocos 3.8 WebGL2 implementation uses the engine's `gfx.Format.SRGB8_A8` through Texture2D.reset and retains source min/mag/mip/wrap/anisotropy. It operates on decoded browser image assets at preload, never in update. It does not modify imported assets or their UUIDs. It is not a native/minigame image decoder; additional backends need equivalent source-pixel access and GPU acceptance.

Required port regression: inspect actual GPU format, disable double decoding, sample the smallest mip against native Unity RGB/alpha, and capture thin/small geometry as well as a complete effect. Debuff 1 HealthEnergyRor's Point12 smallest mip was native RGB≈0.078/alpha≈0.149 versus old Cocos RGB≈0.018. Unit tests cover alpha ownership, sampler policy, cache and disposal; live GPU checkpoints must still accompany integration.
