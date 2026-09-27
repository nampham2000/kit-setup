using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEngine;
using UnityEditor;
public class Script{
    public static string Main(){
        var source="Assets/Editor/CodexProbes/ParticleLightColor.shader";if(!File.Exists(source))throw new Exception("Run capture-particle-light-color.cs first");
        var path="Assets/Editor/CodexProbes/ParticleLightRange.shader";File.WriteAllText(path,File.ReadAllText(source).Replace("Hidden/Codex/ParticleLightColor","Hidden/Codex/ParticleLightRange").Replace("#include \"Lighting.cginc\"","#include \"Lighting.cginc\"\n#include \"AutoLight.cginc\"").Replace("return _LightColor0;","return float4(_LightColor0.rgb,1.0/unity_WorldToLight[0][0]);"));
        AssetDatabase.ImportAsset(path,ImportAssetOptions.ForceSynchronousImport);var shader=AssetDatabase.LoadAssetAtPath<Shader>(path);var errors=ShaderUtil.GetShaderMessages(shader).Where(m=>m.severity==UnityEditor.Rendering.ShaderCompilerMessageSeverity.Error).ToArray();if(errors.Length>0)throw new Exception(string.Join(";",errors.Select(m=>m.message)));
        var plane=GameObject.CreatePrimitive(PrimitiveType.Plane);plane.transform.position=new Vector3(1000,0,0);var material=new Material(shader);plane.GetComponent<MeshRenderer>().sharedMaterial=material;
        var lightGo=new GameObject("particle light template");lightGo.SetActive(false);var light=lightGo.AddComponent<Light>();light.type=LightType.Point;light.range=10;light.intensity=1;light.renderMode=LightRenderMode.ForcePixel;
        var cameraGo=new GameObject("Native particle light range camera");var camera=cameraGo.AddComponent<Camera>();camera.transform.position=new Vector3(1000,10,0);camera.transform.eulerAngles=new Vector3(90,0,0);camera.orthographic=true;camera.orthographicSize=5;camera.renderingPath=RenderingPath.Forward;camera.clearFlags=CameraClearFlags.SolidColor;camera.backgroundColor=Color.black;camera.allowHDR=true;camera.enabled=false;
        var rt=new RenderTexture(16,16,24,RenderTextureFormat.ARGBFloat,RenderTextureReadWrite.Linear);rt.Create();var texture=new Texture2D(16,16,TextureFormat.RGBAFloat,false,true);var previous=RenderTexture.active;var rows=new List<object>();
        try{
            foreach(var scale in new[]{1f,1.3f})foreach(var size in new[]{new Vector3(2,2,2),new Vector3(2,3,4)})foreach(var sizeAffects in new[]{false,true}){
                var go=new GameObject("native particle light");go.transform.position=new Vector3(1000,1,0);go.transform.localScale=Vector3.one*scale;
                try{
                    var ps=go.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);var main=ps.main;main.playOnAwake=false;main.startLifetime=2;main.startSpeed=0;main.simulationSpace=ParticleSystemSimulationSpace.World;main.startSize3D=true;
                    var emission=ps.emission;emission.enabled=false;var shape=ps.shape;shape.enabled=false;go.GetComponent<ParticleSystemRenderer>().renderMode=ParticleSystemRenderMode.None;
                    var m=ps.lights;m.enabled=true;m.light=light;m.ratio=1;m.maxLights=20;m.sizeAffectsRange=sizeAffects;m.rangeMultiplier=1.2f;
                    ps.Play();ps.Pause();ps.Emit(1);var particles=new ParticleSystem.Particle[1];ps.GetParticles(particles);particles[0].position=go.transform.position;particles[0].startSize3D=size;ps.SetParticles(particles,1);ps.Simulate(1f/60,false,false,false);
                    camera.targetTexture=rt;var async=ShaderUtil.allowAsyncCompilation;ShaderUtil.allowAsyncCompilation=false;try{camera.Render();}finally{ShaderUtil.allowAsyncCompilation=async;}RenderTexture.active=rt;texture.ReadPixels(new Rect(0,0,16,16),0,0);texture.Apply();var result=texture.GetPixel(8,8);
                    rows.Add(new{scale,size=new[]{size.x,size.y,size.z},sizeAffects,range=result.a});
                }finally{UnityEngine.Object.DestroyImmediate(go);}
            }
            File.WriteAllText("OUTPUT_FILE",System.Text.Json.JsonSerializer.Serialize(new{unityVersion=Application.unityVersion,scope="Native POINT unity_WorldToLight range; source color probe is a prerequisite",rows}));return "Native particle light range cases="+rows.Count;
        }finally{RenderTexture.active=previous;UnityEngine.Object.DestroyImmediate(texture);rt.Release();UnityEngine.Object.DestroyImmediate(rt);UnityEngine.Object.DestroyImmediate(plane);UnityEngine.Object.DestroyImmediate(material);UnityEngine.Object.DestroyImmediate(lightGo);UnityEngine.Object.DestroyImmediate(cameraGo);}
    }
}
