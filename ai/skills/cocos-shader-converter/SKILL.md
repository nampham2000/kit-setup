---
name: cocos-shader-converter
description: "Use when converting Unity HLSL / ShaderLab shaders into Cocos Creator 3.8.8+ .effect shader files, fixing uniform blocks, blend states, and render queues."
argument-hint: "Unity shader file or Cocos effect to convert/fix"
---

# Cocos Creator Shader & Effect Conversion Skill

This skill provides guidelines for converting Unity ShaderLab / HLSL / URP shaders into Cocos Creator 3.8.8+ `.effect` (Cocos Shading Language) files.

## 1. Automated CLI Tool

Always start by generating the base effect skeleton with the converter tool:
```bash
node playable-shared-kit/tools/unity-hlsl-to-cocos-effect.cjs <source_shader.shader> <output_effect.effect> [--transparent | --alpha-clip | --opaque]
```

---

## 2. Cocos 3.8 Effect File Structure (`.effect`)

A Cocos Effect is composed of two main blocks:
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
      properties: &props
        mainTexture:    { value: white }
        mainColor:      { value: [1, 1, 1, 1], editor: { type: color } }
        speed:          { value: 1.0, editor: { range: [0, 10, 0.1] } }
}%

CCProgram custom-vs %{
  precision highp float;
  #include <legacy/input-standard>
  #include <builtin/uniforms/cc-global>
  #include <legacy/local-batch>

  out vec2 v_uv;

  vec4 vert () {
    StandardVertInput In;
    CCVertInput(In);

    mat4 matWorld, matWorldIT;
    CCGetWorldMatrixFull(matWorld, matWorldIT);

    vec4 pos = matWorld * In.position;
    v_uv = a_texCoord;
    return cc_matProj * (cc_matView * pos);
  }
}%

CCProgram custom-fs %{
  precision highp float;
  #include <builtin/uniforms/cc-global>

  in vec2 v_uv;

  uniform sampler2D mainTexture;

  uniform Constants {
    vec4 mainColor;
    float speed;
  };

  vec4 frag () {
    vec4 col = texture(mainTexture, v_uv) * mainColor;
    return col;
  }
}%
```

---

## 3. Critical Rules for Cocos 3.8 Shaders

1. **Uniform Blocks**:
   - In Cocos 3.8 (WebGPU / Vulkan / Metal compatible), all non-sampler uniforms MUST be declared inside a named `uniform BlockName { ... };`.
   - Never declare loose `uniform vec4 myColor;` outside a block.
   - Group uniforms into 16-byte aligned blocks (`vec4` or float multiples of 4).
2. **Built-in Uniforms**:
   - Time: `cc_time.x` (current game time in seconds).
   - Matrices: `cc_matView`, `cc_matProj`, `cc_matViewProj`.
3. **Blending States in YAML**:
   - Transparent:
     ```yaml
     blendState:
       targets:
       - blend: true
         blendSrc: src_alpha
         blendDst: one_minus_src_alpha
         blendSrcAlpha: src_alpha
         blendDstAlpha: one_minus_src_alpha
     rasterizerState:
       cullMode: none
     depthStencilState:
       depthWrite: false
     ```
