Shader "Universal Render Pipeline/UnlitGolden" {
  Properties {
    _BaseMap ("Texture", 2D) = "white" {}
    _BaseColor ("Color", Color) = (1, 1, 1, 1)
  }
  SubShader {
    Tags { "RenderPipeline"="UniversalPipeline" "RenderType"="Opaque" }

    Pass {
      HLSLPROGRAM
      #pragma vertex vert
      #pragma fragment frag
      #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

      struct Attributes {
        float4 positionOS : POSITION;
        float2 uv : TEXCOORD0;
      };

      struct Varyings {
        float4 positionCS : SV_POSITION;
        float2 uv : TEXCOORD0;
      };

      TEXTURE2D(_BaseMap);
      SAMPLER(sampler_BaseMap);
      float4 _BaseColor;

      Varyings vert(Attributes input) {
        Varyings output;
        output.positionCS = TransformObjectToHClip(input.positionOS.xyz);
        output.uv = input.uv;
        return output;
      }

      float4 frag(Varyings input) : SV_Target {
        return SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, input.uv) * _BaseColor;
      }
      ENDHLSL
    }
  }
}
