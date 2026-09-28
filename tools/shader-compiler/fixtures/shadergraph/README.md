# ShaderGraph regression corpus

`bunny-blitz/corpus.json.gz` holds Unity's generated shader code for the 69 ShaderGraph assets of the Unity sample
project **Bunny Blitz - 2D & 3D Sample Project** (URP 2D + 3D, Unity 6000.x), as dumped by
`tools/unity-intel/dump-shadergraph-code.cs` (`ShaderGraphImporter.GetShaderText`, the text Unity compiles).
It is the regression input of `tools/shader-compiler/shadergraph-codegen.test.cjs`.

- Trimmed with `build-corpus.cjs`: header (Properties, SubShader tags) plus only the passes the generator reads
  (LightMode Universal2D / UniversalForward / UniversalForwardOnly / NormalsRendering). Generator output is identical
  to the untrimmed text. Source dump SHA-256 of `sha256sum *.shader.txt | sha256sum`:
  `712929a4f00a2b1658ceedebcbc48d62bafb0066402539cf995d32b70a2f2dbf` (Bunny Blitz port, `tools/port/bunny-blitz/export/shadergraphs`).
- `bunny-blitz/unity/Assets/...`: the Custom Function include files the graphs reference (`FunctionsRSUV.hlsl`,
  `HelpersRSUV.hlsl`, TextMesh Pro `SDFFunctions.hlsl`), copied unchanged from the sample project so include
  resolution (`--unity-project`) is exercised.
- `bunny-blitz/overrides.glsl`: the project hook the port supplies for `GetTimer_float` (Unity packs the value into
  `unity_RendererUserValue`, which Cocos has no equivalent for).

Expected dispositions: 64 generated (all pass the effect compile gate), 2 `not-renderer-material` (UI Toolkit
`GlowMaskUI`, Fullscreen `LayerSwitch_Pass`), 3 skipped with an explicit reason (HDRP TMP variants, dormant URP Lit
TMP variant).

Rebuild after a new dump: `node build-corpus.cjs <dumpDir> bunny-blitz/corpus.json.gz`.
