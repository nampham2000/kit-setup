Shader "Hidden/SharedKit/ImportedMip" { Properties {_MainTex("Texture",2D)="white"{}} SubShader{Pass{ZTest Always Cull Off ZWrite Off CGPROGRAM
#pragma vertex vert_img
#pragma fragment frag
#include "UnityCG.cginc"
sampler2D _MainTex;float _Mip;float4 frag(v2f_img i):SV_Target{return tex2Dlod(_MainTex,float4(i.uv,0,_Mip));}
ENDCG }}}