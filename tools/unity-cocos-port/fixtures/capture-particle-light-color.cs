using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEngine;
using UnityEditor;
public class Script{
    public static string Main(){
        if(QualitySettings.activeColorSpace!=ColorSpace.Linear)throw new InvalidOperationException("Particle light color oracle requires Linear project color space");
        var path="Assets/Editor/CodexProbes/ParticleLightColor.shader";Directory.CreateDirectory("Assets/Editor/CodexProbes");
        File.WriteAllText(path,@"Shader ""Hidden/Codex/ParticleLightColor"" { SubShader { Tags { ""RenderType""=""Opaque"" } Pass { Tags { ""LightMode""=""ForwardBase"" } CGPROGRAM
#pragma vertex vert
#pragma fragment frag
#pragma multi_compile_fwdbase
#include ""UnityCG.cginc""
#include ""Lighting.cginc""
struct V{float4 pos:SV_POSITION;float4 light:TEXCOORD0;};
V vert(float4 p:POSITION){V o;o.pos=UnityObjectToClipPos(p);o.light=0;
#ifdef VERTEXLIGHT_ON
o.light=float4(unity_LightColor[0].rgb,unity_4LightAtten0.x);
#endif
return o;} float4 frag(V input):SV_Target{
#ifdef POINT
return _LightColor0;
#elif defined(VERTEXLIGHT_ON)
return input.light;
#else
return 0;
#endif
}
ENDCG } Pass { Tags { ""LightMode""=""ForwardAdd"" } Blend One One ZWrite Off CGPROGRAM
#pragma vertex vert
#pragma fragment frag
#pragma multi_compile_fwdadd
#include ""UnityCG.cginc""
#include ""Lighting.cginc""
float4 vert(float4 p:POSITION):SV_POSITION{return UnityObjectToClipPos(p);} float4 frag():SV_Target{
#ifdef POINT
return _LightColor0;
#else
return 0;
#endif
}
ENDCG } } }");
        AssetDatabase.ImportAsset(path,ImportAssetOptions.ForceSynchronousImport);var shader=AssetDatabase.LoadAssetAtPath<Shader>(path);var errors=ShaderUtil.GetShaderMessages(shader).Where(m=>m.severity==UnityEditor.Rendering.ShaderCompilerMessageSeverity.Error).ToArray();if(errors.Length>0)throw new Exception(string.Join(";",errors.Select(m=>m.message)));
        var plane=GameObject.CreatePrimitive(PrimitiveType.Plane);plane.transform.position=new Vector3(1000,0,0);var material=new Material(shader);plane.GetComponent<MeshRenderer>().sharedMaterial=material;
        var lightGo=new GameObject("particle light template");lightGo.SetActive(false);var light=lightGo.AddComponent<Light>();light.type=LightType.Point;light.range=10;light.intensity=1;light.color=Color.white;light.renderMode=LightRenderMode.ForcePixel;
        var cameraGo=new GameObject("Native particle light camera");var camera=cameraGo.AddComponent<Camera>();camera.transform.position=new Vector3(1000,10,0);camera.transform.eulerAngles=new Vector3(90,0,0);camera.orthographic=true;camera.orthographicSize=5;camera.renderingPath=RenderingPath.Forward;camera.clearFlags=CameraClearFlags.SolidColor;camera.backgroundColor=Color.black;camera.allowHDR=true;camera.enabled=false;
        var rt=new RenderTexture(16,16,24,RenderTextureFormat.ARGBFloat,RenderTextureReadWrite.Linear);rt.Create();var texture=new Texture2D(16,16,TextureFormat.RGBAFloat,false,true);var previous=RenderTexture.active;var rows=new List<object>();var previousLinear=UnityEngine.Rendering.GraphicsSettings.lightsUseLinearIntensity;
        try{
            UnityEngine.Rendering.GraphicsSettings.lightsUseLinearIntensity=true;
            foreach(var templateColor in new[]{Color.white,new Color(.696551323f,0,1),new Color(0,.83448267f,1)})foreach(var mode in new[]{LightRenderMode.ForcePixel,LightRenderMode.ForceVertex})foreach(var color in new[]{new Color32(255,255,255,255),new Color32(128,64,255,255),new Color32(128,64,255,128)})foreach(var alphaAffects in new[]{false,true})foreach(var useColor in new[]{false,true}){
                light.renderMode=mode;light.color=templateColor;
                var go=new GameObject("native particle light");go.transform.position=new Vector3(1000,1,0);
                try{
                    var ps=go.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);var main=ps.main;main.playOnAwake=false;main.startLifetime=2;main.startSpeed=0;main.simulationSpace=ParticleSystemSimulationSpace.World;
                    var emission=ps.emission;emission.enabled=false;var shape=ps.shape;shape.enabled=false;var renderer=go.GetComponent<ParticleSystemRenderer>();renderer.renderMode=ParticleSystemRenderMode.None;
                    var m=ps.lights;m.enabled=true;m.light=light;m.ratio=1;m.maxLights=20;m.useParticleColor=useColor;m.alphaAffectsIntensity=alphaAffects;m.sizeAffectsRange=false;m.intensityMultiplier=.5f;
                    ps.Play();ps.Pause();ps.Emit(1);var particles=new ParticleSystem.Particle[1];ps.GetParticles(particles);particles[0].position=go.transform.position;particles[0].startColor=color;ps.SetParticles(particles,1);ps.Simulate(1f/60,false,false,false);
                    camera.targetTexture=rt;var async=ShaderUtil.allowAsyncCompilation;ShaderUtil.allowAsyncCompilation=false;try{camera.Render();}finally{ShaderUtil.allowAsyncCompilation=async;}RenderTexture.active=rt;texture.ReadPixels(new Rect(0,0,16,16),0,0);texture.Apply();var result=texture.GetPixel(8,8);
                    rows.Add(new{templateColor=new[]{templateColor.r,templateColor.g,templateColor.b},mode=(int)mode,color=new[]{(int)color.r,(int)color.g,(int)color.b,(int)color.a},alphaAffects,useColor,linearLightColor=new[]{result.r,result.g,result.b},vertexAttenuation=mode==LightRenderMode.ForceVertex?result.a:0});
                }finally{UnityEngine.Object.DestroyImmediate(go);}
            }
            File.WriteAllText("OUTPUT_FILE",System.Text.Json.JsonSerializer.Serialize(new{unityVersion=Application.unityVersion,colorSpace=QualitySettings.activeColorSpace.ToString(),lightsUseLinearIntensity=UnityEngine.Rendering.GraphicsSettings.lightsUseLinearIntensity,isPlaying=Application.isPlaying,scope="Native POINT shader _LightColor0 from one generated particle light",rows}));return "Native particle light color cases="+rows.Count;
        }finally{UnityEngine.Rendering.GraphicsSettings.lightsUseLinearIntensity=previousLinear;RenderTexture.active=previous;UnityEngine.Object.DestroyImmediate(texture);rt.Release();UnityEngine.Object.DestroyImmediate(rt);UnityEngine.Object.DestroyImmediate(plane);UnityEngine.Object.DestroyImmediate(material);UnityEngine.Object.DestroyImmediate(lightGo);UnityEngine.Object.DestroyImmediate(cameraGo);}
    }
}
