#ifndef HOVL_URP_COMMON_INCLUDED
#define HOVL_URP_COMMON_INCLUDED
#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareDepthTexture.hlsl"
#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareOpaqueTexture.hlsl"

TEXTURE2D(_MainTex); SAMPLER(sampler_MainTex);
TEXTURE2D(_MainTexture); SAMPLER(sampler_MainTexture);
TEXTURE2D(_Noise); SAMPLER(sampler_Noise);
TEXTURE2D(_Flow); SAMPLER(sampler_Flow);
#if !defined(HOVL_TRAIL)
TEXTURE2D(_Mask); SAMPLER(sampler_Mask);
#endif
TEXTURE2D(_NormalMap); SAMPLER(sampler_NormalMap);
float4 _MainTex_ST, _MainTexture_ST, _Noise_ST, _Flow_ST, _Mask_ST, _NormalMap_ST;
float4 _Color, _SpeedMainTexUVNoiseZW, _DistortionSpeedXYPowerZ, _StartColor, _EndColor;
float _Emission, _Opacity, _Usecenterglow, _Usecustomrandom, _Usedepth, _Depthpower;
float _Colorpower, _Colorrange, _Usedark, _Maskpower, _Distortionpower, _InvFade;
#if defined(HOVL_TRAIL)
float _Mask;
#endif
float _LightFalloff, _LightRange, _LightEmission;

struct HovlAttributes
{
    float4 positionOS : POSITION;
    float4 color : COLOR;
    float4 uv : TEXCOORD0;
};
struct HovlVaryings
{
    float4 positionCS : SV_POSITION;
    float4 color : COLOR;
    float4 uv : TEXCOORD0;
    float3 positionWS : TEXCOORD1;
    float eyeDepth : TEXCOORD2;
};
HovlVaryings HovlVert(HovlAttributes input)
{
    HovlVaryings o;
    VertexPositionInputs p = GetVertexPositionInputs(input.positionOS.xyz);
    o.positionCS = p.positionCS;
    o.positionWS = p.positionWS;
    o.eyeDepth = -TransformWorldToView(p.positionWS).z;
    o.color = input.color;
    o.uv = input.uv;
    return o;
}
float HovlDepthFade(HovlVaryings i)
{
    if (_Usedepth < 0.5) return 1;
    float2 uv = GetNormalizedScreenSpaceUV(i.positionCS);
    float rawDepth = SampleSceneDepth(uv);
    float sceneDepth = LinearEyeDepth(rawDepth, _ZBufferParams);
    return saturate((sceneDepth - i.eyeDepth) / max(_Depthpower, 0.0001));
}
half4 HovlFrag(HovlVaryings i) : SV_Target
{
#if defined(HOVL_DISTORTION)
    float2 uv = GetNormalizedScreenSpaceUV(i.positionCS);
    float2 normalUV = i.uv.xy * _NormalMap_ST.xy + _NormalMap_ST.zw;
    float2 displacement = SAMPLE_TEXTURE2D(_NormalMap, sampler_NormalMap, normalUV).xy * 2 - 1;
    float fade = saturate(_InvFade * (LinearEyeDepth(SampleSceneDepth(uv), _ZBufferParams) - i.eyeDepth));
    half3 scene = SampleSceneColor(uv + displacement * _Distortionpower * i.color.a);
    return half4(scene, i.color.a * fade);
#elif defined(HOVL_LIT)
    float2 uv = i.uv.xy * _MainTex_ST.xy + _MainTex_ST.zw;
    half4 c = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, uv) * _Color * i.color;
    return half4(c.rgb * (1 + _Emission), 1);
#elif defined(HOVL_TRAIL)
    float2 uv = i.uv.xy * _MainTexture_ST.xy + _MainTexture_ST.zw + i.uv.z;
    uv += _SpeedMainTexUVNoiseZW.xy * _Time.y;
    half4 main = SAMPLE_TEXTURE2D(_MainTexture, sampler_MainTexture, uv);
    float2 noiseUV = i.uv.xy * _Noise_ST.xy + _Noise_ST.zw + _SpeedMainTexUVNoiseZW.zw * _Time.y;
    half4 noise = SAMPLE_TEXTURE2D(_Noise, sampler_Noise, noiseUV);
    float dissolve = saturate(noise.r + clamp(pow(saturate(1 - i.uv.x), 0.8), 0.2, 0.6) - i.uv.x);
    float shape = saturate((1 - i.uv.x) * (1 - i.uv.y) * i.uv.y * 6 * lerp(1, i.uv.x * _Maskpower, _Mask));
    float alpha = i.color.a * main.a * dissolve * shape * HovlDepthFade(i);
    half3 rgb = lerp(_StartColor.rgb, _EndColor.rgb, saturate(pow(saturate(i.uv.x * _Colorrange), max(_Colorpower, 0.0001))));
    rgb *= i.color.rgb * _Emission * lerp(1, alpha, _Usedark);
    return half4(rgb, alpha);
#else
    float2 uv = i.uv.xy * _MainTex_ST.xy + _MainTex_ST.zw + _SpeedMainTexUVNoiseZW.xy * _Time.y;
    float2 flowUV = i.uv.xy * _Flow_ST.xy + _Flow_ST.zw + _DistortionSpeedXYPowerZ.xy * _Time.y;
    half4 mask = SAMPLE_TEXTURE2D(_Mask, sampler_Mask, i.uv.xy * _Mask_ST.xy + _Mask_ST.zw);
#if !defined(HOVL_LIGHTGLOW)
    uv -= SAMPLE_TEXTURE2D(_Flow, sampler_Flow, flowUV).xy * mask.xy * _DistortionSpeedXYPowerZ.z;
#endif
    half4 main = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, uv);
    float2 noiseUV = i.uv.xy * _Noise_ST.xy + _Noise_ST.zw + _SpeedMainTexUVNoiseZW.zw * _Time.y;
#if defined(HOVL_ADD)
    noiseUV += i.uv.w * _Usecustomrandom;
#endif
    half4 noise = SAMPLE_TEXTURE2D(_Noise, sampler_Noise, noiseUV);
    half4 c = main * noise * _Color * i.color;
#if defined(HOVL_LIGHTGLOW)
    return half4(c.rgb * _Emission, c.a * _Opacity * HovlDepthFade(i));
#else
    float glow = lerp(1, saturate(mask.r * saturate(mask.r - (1 - i.uv.z))), _Usecenterglow);
#if defined(HOVL_ADD)
    c *= c.a * _Emission * glow * HovlDepthFade(i);
#else
    c.rgb *= _Emission * glow;
    c.a *= _Opacity * HovlDepthFade(i);
#endif
    return c;
#endif
#endif
}
#endif
