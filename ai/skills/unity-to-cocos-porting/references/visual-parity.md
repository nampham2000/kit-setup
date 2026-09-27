# Evidence to check before adjusting a Unity port

- **Native reference capture:** use `unity.intel.reference.capture` with the
  original source pipeline, camera, materials and actual imported texture sizes.
  Editor batch mode must retain graphics; its capture hook runs after particle
  jobs in PostLateUpdate because WaitForEndOfFrame never fires in batch mode.
  Refresh changed package C# and wait for compilation before capture. Require
  every requested PNG, camera and exact viewport; `complete=true` with zero or
  missing frames is invalid evidence. Inspect images and per-frame particle
  counts/spatial bins before measuring Cocos against them.

- **Particle alignment and gradient boundaries:** Unity `RenderAlignment=2`
  means emitter Local, while Cocos `2` means View. Cocos CPU alignment World
  (`0`) reads the full emitter world rotation; Local (`1`) reads only its local
  rotation. A Unity local mesh must include its ancestors; local billboards
  additionally need a vertex adapter because builtin Cocos billboard axes stay
  camera-facing. Check a source 90-degree parent with opposite particle rotation.
  Unity gradients clamp outside authored key times; Cocos fades toward black/zero
  outside them. Add constant 0/1 endpoints, separately for RGB and alpha. A first
  alpha key at 0.8 must not make a looping hint fade in for 80% of its lifetime.
  Renderer None must not become a visible billboard. Standard Particles uses
  `_Color`, including values above one, whereas legacy particle shaders use
  `_TintColor`; never apply the legacy rule to every builtin shader file ID.

- **Particle UV uniforms:** serialize material `mainTiling_Offset` as
  `{"__type__":"cc.Vec4","x":1,"y":0.99,"z":0,"w":0}`, using source values.
  A plain number array is treated as a uniform array by Cocos and can upload
  NaN to a single FLOAT4, turning a feathered mask into a solid rectangle.
  Check the loaded material and GPU uniform block after a fresh Preview load;
  preserve particle size and mesh geometry when the fault is UV serialization.

- **Texture import size:** compare Unity TextureImporter default and active
  platform overrides with the actual Cocos native image, not only source file
  sizes. An original 6000 px PNG may render at 2048 px in Unity. Scope verified
  texture-only limits through `custom.assetImport.textureMaxSizes`; preserve alpha,
  UVs and UUIDs. Never shrink sliced/UI sprite source images without remapping
  their pixel rects/logical dimensions. See the playable-optimization startup guide.

- **Sprite FTUE:** inspect `m_PPtrCurves`, not only transform/float curves. Keys
  can start with `- time:`. UI Image sprite changes need an ObjectTrack bound to
  `cc.Sprite.spriteFrame`, including authored times and null frames. The porter
  handles whole-image sprites; unresolved/sliced references must report high.
  An imported clip with zero tracks proves nothing. Sample frames over time in
  every tutorial phase, including re-entry; start animation after attaching and
  activating the node.
- **Nested HUD:** follow source prefab, controller prefab, and outer instance
  overrides. `m_IsActive` targets a GameObject fileID, not its Transform. Preserve
  child overrides and never use the first child's override as the root default
  just because the root has no explicit override. Check the rendered avatar's
  cap and torso bounds throughout idle/happy poses before changing scale again.
- **Logo pose:** entrance clips may start with base/text scales 3/2 and settle
  at 1. A frozen first pose can overlap otherwise correct letters. For a static
  HUD logo sample the settled pose; compensate overall size in config. Check
  the same logo in end popups after changing how its pose is selected.
- **Handedness:** reflect collider center Z alongside transforms. Check face
  direction, normals, and depth, not only screen XY or texture alignment. FBX
  importer axis conversion and selecting a raw mesh instead of its model node
  can add another transform; do not generalize a game-specific mesh mirror to
  every FBX. Also port world-position assignments performed by runtime scripts:
  a Unity marker intentionally moved from a camera at Z -10 to world Z -9 must
  move to Z +9 when the Cocos camera is reflected to +10. A correctly converted
  prefab transform does not cover this later script mutation. Verify overlap by
  placing the marker on already rendered geometry, not only empty background.
  Builtin Cocos physics cannot instantiate MeshCollider; choose an
  appropriate backend or explicit sphere/box picking for the game's mechanics.
- **Particle simulation:** Unity serializes `ParticleSystemSimulationSpace` in
  `moveWithTransform`: Local 0, World 1, Custom 2. Cocos World 0 and Local 1 are
  reversed. Treat this field as an enum, not a boolean. A world trail ported as
  local follows its emitter and piles up into a bright blob. Verify separated
  particle positions while the emitter moves. Custom space also needs a bound
  transform, not just an enum value.
- **Particle textures:** distinguish UV Grid from Sprites mode. Sprite lists
  ignore stale `tilesX/tilesY`; one whole-image sprite can use a scoped material
  texture override. Multiple/sliced sprites require atlas work and a high
  diagnostic until implemented. Preserve shared materials used by other VFX.
- **UI trails:** inspect the calling utility and any UIParticle component.
  Render size can depend on UI particle mesh scale rather than gameplay camera
  zoom. Convert the start point from world to screen to UI coordinates. Preserve
  curve, easing, travel time, impact pulse, delayed audio and final-target rule.
  Scale rate-over-distance inversely when moving simulation into UI units.
  Keep source-disabled glow children disabled; do not enable all child emitters.
- **Hierarchy scale:** an effect created at world root loses ancestor scale and
  offset. Account for the full authored hierarchy and particle scaling mode
  before tuning startSize or doubling/halving all particles. A converter fix
  does not update prefabs that were generated earlier; regenerate the affected
  VFX and reopen the output before judging runtime parity. If the authored
  hierarchy is correct but a focus ring still clips on supported viewports, use
  a game-config scale multiplier and compare its screen bounds at the narrowest
  target width instead of changing particle startSize.

For material parity, read Unity ColorSpace, shader formula, blend factors, alpha
source, UV orientation, and import settings together. See the shader conversion
skill for the shader-specific checks. Avoid changing geometry to hide a material
or importer error.

When opaque geometry appears black, capture the source ambient mode, all 27 SH
coefficients, directional-light direction/color/intensity and default reflection
texture with its HDR decode values and mip chain. A Unity camera using SolidColor
can still use a procedural skybox for ambient/reflection; preserve that distinction.
Reflect lighting vectors and SH odd-Z terms along with world coordinates. Compare
an effect-free wall/floor frame with matching camera and viewport before changing
particle brightness. Legacy Additive/Alpha particles can be unlit even when their
distortion capture includes lit geometry. Material.GetColor/API values alone do
not prove GPU uniform values: Color and HDR properties have different conversion
rules. Probe the original shader-bound values in linear floating-point render
targets when uncertain; do not gamma-decode every color property blindly.

Creator 3.8.8 camera culling requires `(visibility & node.layer) === node.layer`.
A node with DEFAULT|CAPTURE is excluded from a camera seeing only CAPTURE. Use
exclusive capture layers and preserve original layers across cached selections;
validate intended inclusions and exclusions with
`tools/shader-compiler/capture-visibility-contract.cjs` using actual Preview masks.
For GrabPass, prove the preceding transparent objects are captured, the refracting
surface is excluded, and its actual material instance receives the capture texture.
Use `verify-runtime --viewport-size WxH --preview-device WebpageFullScreen` and
check canvasSize; Chrome window dimensions include browser chrome and are not a
reference viewport. These gates establish specific contracts, not a 95% score.

Verify Scene/Prefab view separately when the user reports Editor-only darkness.
Runtime-created native GPU textures do not populate serialized material samplers:
bind imported Texture2D subasset UUIDs for the Editor and preserve source sampler
wrap/filter settings. Serialize source light/SH defaults too. Keep the Editor
color-output path separate from a custom linear HDR target whose presentation
camera already encodes sRGB. An unbound distortion capture must skip its pass.
Rerun the measured Preview comparison after adding Editor defaults; they must
not introduce a second decode/encode or replace the native runtime mip chain.

Run `node --test playable-shared-kit/tools/unity-cocos-port/porting-regressions.test.cjs`
for the shared regressions. Integration fixtures must use temporary Unity/Cocos
roots **and an explicit temporary report path**. Open actual generated output;
assertions against isolated mapping helpers do not prove the CLI wires them.

Verify/lint/import checks establish static validity. Browser preview plus actual
input is needed for gameplay. Use the user's existing preview when builds are
excluded. Record which flows ran and which audio checks only inspected events;
do not turn passing static checks or user approval into a measured 95% score.

Primary enum/serialization references:
[Unity InitialModuleUI](https://github.com/Unity-Technologies/UnityCsReference/blob/master/Modules/ParticleSystemEditor/ParticleSystemModules/InitialModuleUI.cs),
[Unity particle enums](https://github.com/Unity-Technologies/UnityCsReference/blob/master/Modules/ParticleSystem/Managed/ParticleSystemEnums.cs).
