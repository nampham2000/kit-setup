---
name: cocos-shader-converter
description: "Use when converting Unity ShaderLab/HLSL/ShaderGraph or generated .tcp2shader rendering dependencies into Cocos Creator 3.8.8+ effects and materials, with source-closure, live-import, runtime, and measured visual acceptance gates."
argument-hint: "Unity prefab/material/shader source plus Unity project root and Cocos project root"
---

# Cocos Shader Conversion

Convert rendering behavior, not an isolated text file. A syntactically valid `.effect` can still use the wrong material, keyword, color space, renderer slot, light rig, camera exposure, or runtime variant. The requested 90–95% visual target is an **acceptance target**. Never infer it from Grade A, a static score, a clean TypeScript build, or a contact sheet.

## Mandatory workflow

1. Run Unity port preflight before reading raw Unity source or writing output:

   ```bash
   npm run ai:port:preflight -- --project <UnityProjectRoot>
   ```

2. Check both live bridges. `canAttach` only means the Unity Editor is open and attachable. Require `canUseLiveMcp=true` before treating Unity MCP as source evidence:

   ```bash
   npm run unity:intel:doctor -- --project <UnityProjectRoot> --timeout-ms 3000
   ```

   If the result is `UNITY_MCP_TOOL_UNRESPONSIVE`, static preflight may support bounded analysis but cannot support a 90–95% visual claim. Fix/reload the Unity MCP scanner first. Confirm Cocos MCP is connected to the exact target project before any reimport.

3. Resolve the full rendering dependency closure from the owner prefab or ScriptableObject:

   ```bash
   node playable-shared-kit/tools/shader-compiler/unity-shader-compiler.cjs chain \
     --src <UnityPrefabOrAsset> \
     --unity-root <UnityProjectRoot>/Assets \
     --no-cache
   ```

   The chain must be complete and include nested prefabs/assets, FBX external-material remaps, Assets, selected package roots, `.shader`, and generated `.tcp2shader` sources. An isolated `.mat` or screenshot is not a rendering closure.

4. Capture the source oracle through Unity MCP. For every visible renderer record:

   - effective material per renderer slot and submesh;
   - shader source identity, render queue/pass, keywords and feature toggles;
   - active scalar/vector/color/texture properties and texture importer color-space role;
   - camera projection, FOV/orthographic size, near/far, HDR, AA and post processing;
   - lights, transforms, culling masks, intensity/color/shadows;
   - ambient/reflection/render settings and any runtime material swap.

   Bind the oracle to the Unity source fingerprint/hash. Do not recreate these values by sampling one screenshot.

5. Convert only after the closure and oracle are known:

   ```bash
   node playable-shared-kit/tools/shader-compiler/unity-shader-compiler.cjs convert \
     --src <UnityShader.shader|GeneratedShader.tcp2shader> \
     --out assets/effects/<Name>.effect \
     --unity-project <UnityProjectRoot> \
     --mode auto --report
   ```

   Use `surface-pbr` for supported URP/legacy surface intent and `unlit` only when source semantics are unlit. Treat unsupported engine inputs, tangent-space normal mapping, Unity shadow attenuation, internal URP/TCP2 structs, and extra passes as explicit obligations. Do not silently replace them with a tint multiplier.

6. Convert materials with the exact generated effect and imported UUID:

   ```bash
   node playable-shared-kit/tools/shader-compiler/unity-shader-compiler.cjs convert-mat \
     --src <UnityMaterial.mat> \
     --out assets/materials/<Name>.mtl \
     --effect assets/effects/<Name>.effect \
     --effect-uuid <CocosEffectUuid> \
     --unity-project <UnityProjectRoot>
   ```

   Preserve material-slot ownership. Normal/mask/metallic/roughness textures stay raw. Albedo/base/emission textures follow the source semantic color space. Unity `Color` and `[HDR] Color` do not share one gamma rule.

7. Run the static analyzer, while keeping its scope explicit:

   ```bash
   node playable-shared-kit/tools/shader-compiler/unity-shader-compiler.cjs validate assets/effects/<Name>.effect
   ```

   `PASS` proves only the implemented text/ABI heuristics. Report score/grade is `staticConfidenceScore`; `cocosImporter`, `runtimeVariant`, and `unityVisualParity` remain `unverified`.

8. Reimport every changed `.effect` and `.mtl` through Cocos MCP. Confirm the returned types are `cc.EffectAsset` and `cc.Material`, then inspect project logs for effect/shader/GLSL/EFX errors. Run `npm run ai:verify:assets` after the Editor has scanned them. A checked-in `.meta` or `imported: true` from an earlier generation is stale evidence after changing shader text.

9. Run preview/runtime verification so the engine creates the used shader variants:

   ```bash
   npm run ai:verify:runtime -- --url http://127.0.0.1:7456/
   ```

   Exercise each visible material state, including hold/peek, enabled/disabled, close/open and runtime swaps. Recheck console/project logs after the state was rendered.

10. Measure visual parity with an aligned Unity reference:

    ```bash
    npm run ai:verify:visual -- --config <matrix.json>
    ```

    Material/shader cases must declare `referenceImage`, a tight `screenshotRegion`, optional `referenceRegion`, and `requiredReferenceMetrics`. For isolated objects on a flat background, enable `referenceMetricOptions.autoTrimForeground` and require `foregroundRgbSimilarity >= 0.90`, `foregroundLuminanceSimilarity >= 0.90`, and a bounded `foregroundIou`; target 0.95 when Unity/Cocos viewport and geometry are sufficiently aligned. Also bound `foregroundMeanLuminanceDelta` and semantic runtime metrics. Open the generated candidate/reference contact sheet even when metrics pass.

11. Finish with the standard gates and store the reusable finding in Work Memory:

    ```bash
    npm run ai:verify
    npm run ai:lint
    node playable-shared-kit/tools/work-memory.cjs remember --scope global --category porting-note --title "..." --content "..." --tags "shader,unity,cocos"
    ```

## Hard prohibitions

- Do not claim “90–95%” from static confidence or from a screenshot viewed by eye.
- Do not add arbitrary output color scales, metallic, smoothness, emission, rim, or fake highlights before source camera/light/material evidence is complete.
- Do not port only the first material found in prefab YAML; model importer remaps and nested prefabs often own the visible material.
- Do not accept an endpoint ping as Unity MCP readiness. The `playable-port-scan` tool probe must complete.
- Do not treat runtime-clean as visual parity without a reference metric contract.

## Effect ABI reminders

- A Cocos effect contains `CCEffect` pass/property YAML and one or more `CCProgram` blocks.
- Keep sampler declarations outside UBOs. Pack scalar/vector uniforms for std140 alignment and bind property targets explicitly.
- Match source cull, depth test/write, blend, alpha clip and queue behavior before tuning color.
- `--unity-uv` changes texture sampling convention for Unity-authored mesh UVs; never compensate by globally flipping mesh UVs when procedural shader code also reads `uv.y`.
