using System;using System.IO;using System.Linq;using System.Collections.Generic;using UnityEngine;using UnityEditor;
public class Script {
 public static string Main(){var shaderPath="Assets/Editor/CodexProbes/ForwardLightBudget.shader";Directory.CreateDirectory(Path.GetDirectoryName(shaderPath));
 File.WriteAllText(shaderPath,@"Shader ""Hidden/Codex/ForwardLightBudget"" { SubShader { Pass { Tags { ""LightMode""=""ForwardBase"" } CGPROGRAM
#pragma vertex vert
#pragma fragment frag
#pragma multi_compile_fwdbase
#pragma target 3.0
#include ""UnityCG.cginc""
#include ""UnityLightingCommon.cginc""
float4 vert(float4 p:POSITION):SV_POSITION{return UnityObjectToClipPos(p);}float4 frag():SV_Target{return float4(0,unity_LightColor[0].r+unity_LightColor[1].r+unity_LightColor[2].r+unity_LightColor[3].r,0,_LightColor0.r);}
ENDCG } Pass { Tags { ""LightMode""=""ForwardAdd"" } Blend One One ZWrite Off CGPROGRAM
#pragma vertex vert
#pragma fragment frag
#pragma multi_compile_fwdadd
#pragma target 3.0
#include ""UnityCG.cginc""
#include ""UnityLightingCommon.cginc""
float4 vert(float4 p:POSITION):SV_POSITION{return UnityObjectToClipPos(p);}float4 frag():SV_Target{return float4(_LightColor0.r,0,1,0);}
ENDCG } } }");AssetDatabase.ImportAsset(shaderPath,ImportAssetOptions.ForceSynchronousImport);var shader=AssetDatabase.LoadAssetAtPath<Shader>(shaderPath);
 var errors=ShaderUtil.GetShaderMessages(shader).Where(m=>m.severity==UnityEditor.Rendering.ShaderCompilerMessageSeverity.Error);if(errors.Any())throw new Exception(string.Join(";",errors.Select(m=>m.message)));
 var plane=GameObject.CreatePrimitive(PrimitiveType.Plane);plane.transform.position=new Vector3(1000,0,0);var material=new Material(shader);plane.GetComponent<MeshRenderer>().sharedMaterial=material;
 var directional=new GameObject("budget directional");var dir=directional.AddComponent<Light>();dir.type=LightType.Directional;dir.intensity=2;dir.renderMode=LightRenderMode.ForcePixel;
 var cameraGo=new GameObject("budget camera");var camera=cameraGo.AddComponent<Camera>();camera.transform.position=new Vector3(1000,10,0);camera.transform.eulerAngles=new Vector3(90,0,0);camera.orthographic=true;camera.orthographicSize=5;camera.renderingPath=RenderingPath.Forward;camera.clearFlags=CameraClearFlags.SolidColor;camera.backgroundColor=Color.black;camera.allowHDR=true;camera.enabled=false;
 var rt=new RenderTexture(16,16,24,RenderTextureFormat.ARGBFloat,RenderTextureReadWrite.Linear);rt.Create();camera.targetTexture=rt;var texture=new Texture2D(16,16,TextureFormat.RGBAFloat,false,true);var previous=RenderTexture.active;var rows=new List<object>();var oldQuality=QualitySettings.pixelLightCount;var oldAsync=ShaderUtil.allowAsyncCompilation;var oldLinear=UnityEngine.Rendering.GraphicsSettings.lightsUseLinearIntensity;
 try{UnityEngine.Rendering.GraphicsSettings.lightsUseLinearIntensity=true;ShaderUtil.allowAsyncCompilation=false;foreach(var directionalMode in new[]{LightRenderMode.Auto,LightRenderMode.ForcePixel})foreach(string kind in new[]{"regular","particle"})foreach(int pixelCount in new[]{150})foreach(var mode in new[]{LightRenderMode.Auto})foreach(int count in new[]{1,4,8,20,149,150,151,160}){
 QualitySettings.pixelLightCount=pixelCount;dir.renderMode=directionalMode;var objects=new List<GameObject>();try{
 if(kind=="regular")for(int i=0;i<count;i++){var go=new GameObject("budget point");objects.Add(go);go.transform.position=new Vector3(1000+(i%4)*.1f,1,(i/4)*.1f);var light=go.AddComponent<Light>();light.type=LightType.Point;light.range=20;light.color=new Color(.5f,.25f,1);light.intensity=.5f;light.renderMode=mode;}
 else{var sourceGo=new GameObject("budget source");objects.Add(sourceGo);var light=sourceGo.AddComponent<Light>();light.type=LightType.Point;light.range=20;light.color=new Color(.5f,.25f,1);light.intensity=.5f;light.renderMode=mode;sourceGo.SetActive(false);
 var go=new GameObject("budget particle");objects.Add(go);go.transform.position=new Vector3(1000,1,0);var ps=go.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);var main=ps.main;main.playOnAwake=false;main.startLifetime=10;main.startSpeed=0;main.simulationSpace=ParticleSystemSimulationSpace.World;var em=ps.emission;em.enabled=false;var shape=ps.shape;shape.enabled=false;ps.GetComponent<ParticleSystemRenderer>().renderMode=ParticleSystemRenderMode.None;
 var lights=ps.lights;lights.enabled=true;lights.light=light;lights.ratio=1;lights.maxLights=200;lights.useParticleColor=false;lights.alphaAffectsIntensity=false;lights.sizeAffectsRange=false;ps.Play();ps.Pause();for(int i=0;i<count;i++)ps.Emit(new ParticleSystem.EmitParams{position=new Vector3(1000+(i%4)*.1f,1,(i/4)*.1f),velocity=Vector3.zero,startLifetime=10,applyShapeToPosition=false},1);ps.Simulate(1f/60,false,false,false);ps.Pause();}
 camera.Render();RenderTexture.active=rt;texture.ReadPixels(new Rect(0,0,16,16),0,0);texture.Apply();var color=texture.GetPixel(8,8);rows.Add(new{directionalMode=(int)directionalMode,kind,pixelCount,mode=(int)mode,count,pixelPasses=color.b,vertexRed=color.g,pixelRed=color.r,mainRed=color.a});
 }finally{foreach(var go in objects)UnityEngine.Object.DestroyImmediate(go);}}
 File.WriteAllText("OUTPUT_FILE",System.Text.Json.JsonSerializer.Serialize(new{unityVersion=Application.unityVersion,colorSpace=QualitySettings.activeColorSpace.ToString(),lightsUseLinearIntensity=UnityEngine.Rendering.GraphicsSettings.lightsUseLinearIntensity,rows}));return "Forward light budget rows="+rows.Count;
 }finally{UnityEngine.Rendering.GraphicsSettings.lightsUseLinearIntensity=oldLinear;QualitySettings.pixelLightCount=oldQuality;ShaderUtil.allowAsyncCompilation=oldAsync;RenderTexture.active=previous;UnityEngine.Object.DestroyImmediate(texture);rt.Release();UnityEngine.Object.DestroyImmediate(rt);UnityEngine.Object.DestroyImmediate(plane);UnityEngine.Object.DestroyImmediate(material);UnityEngine.Object.DestroyImmediate(directional);UnityEngine.Object.DestroyImmediate(cameraGo);}
 }
}
