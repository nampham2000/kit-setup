Shader "Custom/MultiPassGolden" {
  Properties {
    _Color ("Main Color", Color) = (1, 1, 1, 1)
    _MainTex ("Base Texture", 2D) = "white" {}
  }
  SubShader {
    Tags { "RenderType"="Opaque" "Queue"="Geometry" }

    Pass {
      Name "ForwardBase"
      Tags { "LightMode"="ForwardBase" }
      CGPROGRAM
      #pragma vertex vert
      #pragma fragment frag
      #include "UnityCG.cginc"

      struct appdata {
        float4 vertex : POSITION;
        float2 uv : TEXCOORD0;
      };

      struct v2f {
        float4 pos : SV_POSITION;
        float2 uv : TEXCOORD0;
      };

      sampler2D _MainTex;
      fixed4 _Color;

      v2f vert(appdata v) {
        v2f o;
        o.pos = UnityObjectToClipPos(v.vertex);
        o.uv = v.uv;
        return o;
      }

      fixed4 frag(v2f i) : SV_Target {
        return tex2D(_MainTex, i.uv) * _Color;
      }
      ENDCG
    }

    Pass {
      Name "ShadowCaster"
      Tags { "LightMode"="ShadowCaster" }
      CGPROGRAM
      #pragma vertex vert
      #pragma fragment frag
      #include "UnityCG.cginc"

      struct appdata {
        float4 vertex : POSITION;
      };

      struct v2f {
        float4 pos : SV_POSITION;
      };

      v2f vert(appdata v) {
        v2f o;
        o.pos = UnityObjectToClipPos(v.vertex);
        return o;
      }

      fixed4 frag(v2f i) : SV_Target {
        return fixed4(0, 0, 0, 1);
      }
      ENDCG
    }
  }
}
