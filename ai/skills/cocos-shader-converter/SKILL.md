---
name: cocos-shader-converter
description: "Use when converting Unity HLSL / ShaderLab / ShaderGraph shaders into Cocos Creator 3.8.8+ .effect shader files and materials, with 90-95% accuracy and zero std140 UBO alignment errors."
argument-hint: "Unity shader (.shader/.hlsl) or ShaderGraph (.shadergraph) file to convert"
---

# Cocos Creator Shader & ShaderGraph Conversion Skill

This skill provides comprehensive capabilities for transpiling Unity ShaderLab, HLSL, and ShaderGraph (`.shadergraph`) assets into Cocos Creator 3.8.8+ `.effect` (Cocos Shading Language) and `.mtl` material files with 90-95% visual accuracy.

## 1. Automated CLI Tool

### Convert Single Shader or ShaderGraph:
```bash
node playable-shared-kit/tools/unity-hlsl-to-cocos-effect.cjs convert --src <source_shader.shader|.shadergraph> --out <output_effect.effect> [-m] [--shading-model <auto|unlit|lit|toon|matcap|dissolve>] [--transparent | --alpha-clip | --opaque]
```

### Batch Convert Directory of Shaders:
```bash
node playable-shared-kit/tools/unity-hlsl-to-cocos-effect.cjs batch --dir "Assets/Shaders" --out-dir "assets/effects" -m
```

---

## 2. Supported Shading Paradigms & Features

1. **Unity ShaderGraph (`.shadergraph`)**:
   - Parses Unity ShaderGraph JSON (both modern Context/Block styles and classic MasterNode styles).
   - Topologically sorts node dependency graph.
   - Generates GLSL 300 ES code for math, trigonometry, UV transforms (Tiling/Offset, Rotate, Polar, Twirl, Spherize, Flipbook), procedural noise (Simple, Voronoi, Gradient), color blend modes (Burn, Dodge, Overlay, Screen, LinearLight, etc.), and texture sampling.
2. **PBR / URP Lit**:
   - Cook-Torrance GGX specular distribution, Smith geometry shadowing, Schlick Fresnel approximation.
   - Direct directional lighting, hemispheric sky/ground ambient, and shadow map + planar shadow receiver support.
3. **Stylized Toon / Cel-Shading**:
   - Half-Lambert diffuse, smoothstep ramp threshold/smoothing, highlight and shadow color tints.
   - Rim lighting with light mask support and stylized specular highlights.
4. **MatCap (Spherical Environment Mapping)**:
   - Real-time view-space normal UV mapping for high-performance stylized metallic and glossy reflections.
5. **Dissolve / Cutoff FX**:
   - Procedural or texture-driven dissolve with glowing edge burn ramp.
6. **std140 UBO Alignment Packing**:
   - Automatic 16-byte packing and GLSL alias generation ensuring 100% WebGPU / Vulkan / Metal compatibility with zero memory waste.

---

## 3. Cocos 3.8 Effect Architecture (`.effect`)

A Cocos Effect is composed of:
1. `CCEffect %{ ... }`: YAML header defining techniques, passes, properties, and render states.
2. `CCProgram <name>-vs %{ ... }`: Vertex shader in GLSL 300 ES style.
3. `CCProgram <name>-fs %{ ... }`: Fragment shader in GLSL 300 ES style.

Example:
```yaml
CCEffect %{
  techniques:
  - name: opaque
    passes:
    - vert: custom-vs:vert
      frag: custom-fs:frag
      rasterizerState:
        cullMode: back
      depthStencilState:
        depthTest: true
        depthWrite: true
      properties: &props
        mainTexture:    { value: white }
        mainColor:      { value: [1, 1, 1, 1], editor: { type: color } }
        speed:          { value: 1.0, target: u_params0.x }
}%

CCProgram custom-vs %{
  precision highp float;
  #include <legacy/input-standard>
  #include <builtin/uniforms/cc-global>
  #include <legacy/local-batch>

  out vec2 v_uv;
  out vec3 v_worldPosition;
  out mediump vec3 v_worldNormal;

  vec4 vert () {
    StandardVertInput In;
    CCVertInput(In);

    mat4 matWorld, matWorldIT;
    CCGetWorldMatrixFull(matWorld, matWorldIT);

    vec4 pos = matWorld * In.position;
    v_worldPosition = pos.xyz;
    v_worldNormal = normalize((matWorldIT * vec4(In.normal, 0.0)).xyz);
    v_uv = a_texCoord;
    return cc_matProj * cc_matView * pos;
  }
}%

CCProgram custom-fs %{
  precision highp float;
  #include <builtin/uniforms/cc-global>
  #include <legacy/output-standard>
  #include <common/color/gamma>

  in vec2 v_uv;
  in vec3 v_worldPosition;
  in mediump vec3 v_worldNormal;

  uniform sampler2D mainTexture;

  uniform CustomParams {
    vec4 u_params0;
  };

  vec4 frag () {
    float speed = u_params0.x;
    vec4 col = texture(mainTexture, v_uv);
    col.rgb = SRGBToLinear(col.rgb);
    return CCFragOutput(col);
  }
}%
```
