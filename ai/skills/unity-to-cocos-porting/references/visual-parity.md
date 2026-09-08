# Evidence to check before adjusting a Unity port

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
