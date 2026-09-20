'use strict';
// Hovl GrabPass contract: power is pixels, distance is vertex-interpolated,
// vertex alpha/soft depth affect displacement, normal XY owns coverage.
const contractVersion=1;
function assertSource(source) {
 for(const token of ['_GrabTexture_TexelSize.xy','_Distortionpower','UnpackNormal','distance(_WorldSpaceCameraPos','abs(tex2DNode14.g) * 30'])
  if(!source.replace(/\s+/g,'').includes(token.replace(/\s+/g,''))) throw new Error('Unsupported distortion source: '+token);
}
const glsl = `vec4 clip=cc_matViewProj*vec4(aoeWorld,1.0);
      vec2 screenUV=clip.xy/clip.w*0.5+0.5;
      vec2 normal=texture(normalTexture,uv*normalST.xy+normalST.zw).xy*2.0-1.0;
      vec2 pixelSize=1.0/vec2(textureSize(opaqueTexture,0));
      float cameraAttenuation=aoeDistortionProjection.x/aoeDistortionProjection.y;
      vec2 displacement=normal*pixelSize*normalParameters.x*vertexColor.a*groundDepthFade()*cameraAttenuation;
      vec4 scene=texture(opaqueTexture,screenUV+displacement);
      float coverage=clamp(scene.a*(abs(normal.x)+abs(normal.y)*30.0-0.03),0.0,1.0);
      return vec4(scene.rgb,coverage);`;
function patchCocosVertex(source) {
 if(source.includes('out vec2 aoeDistortionProjection;'))return source;
 if(!source.includes('  pos = cc_matViewProj * pos;'))throw new Error('Particle vertex ABI changed');
 return source.replace('out vec3 aoeWorld;', '#pragma define-meta AOE_VARIANT range([0, 11])\n#if AOE_VARIANT == 8\n out vec2 aoeDistortionProjection;\n#endif\nout vec3 aoeWorld;')
 .replace('  pos = cc_matViewProj * pos;', '  pos = cc_matViewProj * pos;\n#if AOE_VARIANT == 8\n  aoeDistortionProjection=vec2(pos.w/distance(cc_cameraPos.xyz,aoeWorld),pos.w);\n#endif');
}
function patchUrp(source) {
 if(source.includes('// HOVL_PIXEL_DISTORTION_V1')){
  for(const token of ['UnpackNormal(SAMPLE_TEXTURE2D','rcp(_ScaledScreenParams.xy)','i.distortionProjection.x / i.distortionProjection.y','abs(normal.y) * 30 - 0.03','p.positionCS.w / distance(_WorldSpaceCameraPos, p.positionWS)'])
   if(!source.includes(token))throw new Error('URP distortion contract drift: '+token);
  return source;
 }
 const old=/    float2 uv = GetNormalizedScreenSpaceUV\(i.positionCS\);[\s\S]*?    return half4\(scene, i.color.a \* fade\);/;
 const start=source.indexOf('#if defined(HOVL_DISTORTION)',source.indexOf('half4 HovlFrag'));
 if(start<0||!old.test(source.slice(start)))throw new Error('URP distortion branch not recognized');
 source=source.slice(0,start)+source.slice(start).replace(old,`    // HOVL_PIXEL_DISTORTION_V1
    float2 uv = GetNormalizedScreenSpaceUV(i.positionCS);
    float2 normalUV = i.uv.xy * _NormalMap_ST.xy + _NormalMap_ST.zw;
    float2 normal = UnpackNormal(SAMPLE_TEXTURE2D(_NormalMap, sampler_NormalMap, normalUV)).xy;
    float fade = saturate(_InvFade * (LinearEyeDepth(SampleSceneDepth(uv), _ZBufferParams) - i.eyeDepth));
    float2 displacement = normal * rcp(_ScaledScreenParams.xy) * _Distortionpower * i.color.a * fade;
    displacement *= i.distortionProjection.x / i.distortionProjection.y;
    half3 scene = SampleSceneColor(uv + displacement);
    return half4(scene, saturate(abs(normal.x) + abs(normal.y) * 30 - 0.03));`);
 return source.replace('    float eyeDepth : TEXCOORD2;','    float eyeDepth : TEXCOORD2;\n#if defined(HOVL_DISTORTION)\n    float2 distortionProjection : TEXCOORD3;\n#endif')
 .replace('    o.positionWS = p.positionWS;', '    o.positionWS = p.positionWS;\n#if defined(HOVL_DISTORTION)\n    o.distortionProjection = float2(p.positionCS.w / distance(_WorldSpaceCameraPos, p.positionWS), p.positionCS.w);\n#endif');
}
module.exports={contractVersion,assertSource,glsl,patchCocosVertex,patchUrp};
