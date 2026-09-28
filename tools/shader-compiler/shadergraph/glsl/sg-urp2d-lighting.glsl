// URP 2D lighting inputs for ShaderGraph Sprite Lit / Mesh2D Lit / Light Texture nodes.
// The project's 2D light system renders the light batch textures and binds per frame:
//   sgLightTexture0..3  - URP _ShapeLightTexture0..3 (blend styles 0..3 of the Renderer2D asset)
//   sgLightUse.i        - USE_SHAPE_LIGHT_TYPE_i keyword of the batch (blend style i is used this frame)
//   sgLightSample.i     - 1 when light texture i holds rendered lights, 0 when it is only the clear colour
//   sgLightConst0..3    - the clear/global light colour of style i (linear), used when sgLightSample.i == 0
// Defaults (style 0 used, constant white) reproduce an unlit sprite, so the effect renders before the light
// system exists. Blend styles follow the URP default Renderer2D: 0 Multiply, 1 Additive, 2 Multiply + mask R,
// 3 Additive + mask R.

vec4 sgShapeLight0 (vec2 uv) { return sgLightSample.x > 0.5 ? texture(sgLightTexture0, uv) : sgLightConst0; }
vec4 sgShapeLight1 (vec2 uv) { return sgLightSample.y > 0.5 ? texture(sgLightTexture1, uv) : sgLightConst1; }
vec4 sgShapeLight2 (vec2 uv) { return sgLightSample.z > 0.5 ? texture(sgLightTexture2, uv) : sgLightConst2; }
vec4 sgShapeLight3 (vec2 uv) { return sgLightSample.w > 0.5 ? texture(sgLightTexture3, uv) : sgLightConst3; }

// ShaderGraph "Light Texture" node (Unity_GetLightTextureN): the batch texture when the style is used, else white.
vec4 sgLightSample0 (vec2 uv) { return sgLightUse.x > 0.5 ? sgShapeLight0(uv) : vec4(1.0); }
vec4 sgLightSample1 (vec2 uv) { return sgLightUse.y > 0.5 ? sgShapeLight1(uv) : vec4(1.0); }
vec4 sgLightSample2 (vec2 uv) { return sgLightUse.z > 0.5 ? sgShapeLight2(uv) : vec4(1.0); }
vec4 sgLightSample3 (vec2 uv) { return sgLightUse.w > 0.5 ? sgShapeLight3(uv) : vec4(1.0); }

// URP CombinedShapeLightShared (HDR emulation scale 1)
vec4 sgCombinedShapeLight (vec4 color, vec4 mask, vec2 uv) {
  if (color.a == 0.0) discard;
  if (dot(sgLightUse, vec4(1.0)) < 0.5) return color;
  vec4 modulate = vec4(0.0);
  vec4 additive = vec4(0.0);
  if (sgLightUse.x > 0.5) modulate += sgShapeLight0(uv);
  if (sgLightUse.y > 0.5) additive += sgShapeLight1(uv);
  if (sgLightUse.z > 0.5) modulate += sgShapeLight2(uv) * mask.r;
  if (sgLightUse.w > 0.5) additive += sgShapeLight3(uv) * mask.r;
  vec4 outc = color * modulate + additive;
  outc.a = color.a;
  return max(vec4(0.0), outc);
}
