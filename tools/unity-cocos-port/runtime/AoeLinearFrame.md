# Native Linear particle presentation

This is the unchanged frame implementation measured in the AOE project and
Electricity VFX pack. Its historical class name is retained to avoid changing
the measured implementation during promotion. Copy AoeLinearFrame.ts together
with UnityLinearTarget.ts and UnitySrgbTexture.ts to assets/script; import
UnityLinearPresent.effect through AssetDB and create a material using it.

Construct once with the active camera, presentation material and source sRGB
background RGB normalized to 0..1. Destroy with the scene owner. It owns linear
HDR targets and a final sRGB presentation camera, and resizes with the viewport.
It does not infer source texture or material semantics. For Built-in Mobile alpha
particles with sRGB textures, replace each mainTexture with UnitySrgbTexture.get
at initialization and restore it on disposal. Do not decode alpha. Gamma source
projects and shaders already decoding their textures need a different contract.

The trail/material convenience bindings were measured for the AOE material
names; do not assume they apply to arbitrary shaders. The shared low-level target
and texture classes document GPU support/fallback behavior. Validate live import
and source camera/color state before making a fidelity claim.

Electricity evidence: 15 effects, 180 image/state pairs across landscape and
portrait. Minimum foreground IoU .9552479 and RGB similarity .9944959 under the
controlled Built-in Linear camera. This is no blanket certificate for other packs.
