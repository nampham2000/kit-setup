using System;using System.IO;using System.Collections.Generic;using UnityEngine;using UnityEditor;
public class Script {
 public static string Main(){
  AssetDatabase.ImportAsset("Assets/GlassStainedBumpDistort.shader",ImportAssetOptions.ForceSynchronousImport); var sphere=GameObject.CreatePrimitive(PrimitiveType.Sphere);var sphereMesh=sphere.GetComponent<MeshFilter>().sharedMesh;UnityEngine.Object.DestroyImmediate(sphere); var folder="Assets/Editor/CodexProbes";Directory.CreateDirectory(folder);
  var source=@"Shader ""Hidden/Codex/TieALPHA"" { Properties { _Color(""Color"",Color)=(1,1,1,1) } SubShader { Tags { ""Queue""=""Transparent"" } Pass { Cull Off ZWrite Off Blend SrcAlpha DST CGPROGRAM
#pragma vertex vert
#pragma fragment frag
#include ""UnityCG.cginc""
float4 _Color;float4 vert(float4 p:POSITION):SV_POSITION{return UnityObjectToClipPos(p);}float4 frag():SV_Target{return _Color;}
ENDCG } } }";
  foreach(var kind in new[]{"Alpha","Add"}){var p=folder+"/Tie"+kind+".shader";File.WriteAllText(p,source.Replace("ALPHA",kind).Replace("DST",kind=="Alpha"?"OneMinusSrcAlpha":"One"));AssetDatabase.ImportAsset(p,ImportAssetOptions.ForceSynchronousImport);}
  var cameraGo=new GameObject("tie camera");var camera=cameraGo.AddComponent<Camera>();camera.transform.position=new Vector3(1000,0,-10);camera.orthographic=true;camera.orthographicSize=2;camera.clearFlags=CameraClearFlags.SolidColor;camera.backgroundColor=Color.black;camera.allowHDR=true;camera.enabled=false;
  var rt=new RenderTexture(16,16,24,RenderTextureFormat.ARGBFloat,RenderTextureReadWrite.Linear);rt.Create();camera.targetTexture=rt;var texture=new Texture2D(16,16,TextureFormat.RGBAFloat,false,true);var previous=RenderTexture.active;var rows=new List<object>();
  try{foreach(bool perspective in new[]{false,true})foreach(string particleShader in new[]{"Legacy Shaders/Particles/Additive","Legacy Shaders/Particles/Alpha Blended","Legacy Shaders/Particles/Additive (Soft)","Legacy Shaders/Particles/Alpha Blended Premultiply"})foreach(int additiveOrderOffset in new[]{-1,0,1})foreach(bool reverseCreation in new[]{false,true})foreach(bool reverseMaterials in new[]{false,true})foreach(bool reverseSiblings in new[]{false,true}){
   camera.orthographic=!perspective;var objects=new List<GameObject>();var materials=new Material[2];var systems=new ParticleSystem[2];
   try{
    for(int i=0;i<2;i++){int index=reverseMaterials?1-i:i;materials[index]=new Material(index==0?AssetDatabase.LoadAssetAtPath<Shader>("Assets/GlassStainedBumpDistort.shader"):Shader.Find(particleShader));if(index==0){materials[index].SetTexture("_MainTex",Texture2D.whiteTexture);materials[index].SetFloat("_BumpAmt",0);}else{materials[index].SetColor("_TintColor",new Color(0,1,0,.5f));materials[index].SetTexture("_MainTex",Texture2D.whiteTexture);}}
    for(int i=0;i<2;i++){int index=reverseCreation?1-i:i;var go=new GameObject(index==0?"red alpha":"green additive");objects.Add(go);go.transform.position=new Vector3(1000,0,0);var ps=go.AddComponent<ParticleSystem>();systems[index]=ps;ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);var main=ps.main;main.playOnAwake=false;main.startLifetime=10;main.startSpeed=0;main.startSize=2;main.cullingMode=ParticleSystemCullingMode.AlwaysSimulate;var em=ps.emission;em.enabled=false;var shape=ps.shape;shape.enabled=false;var renderer=ps.GetComponent<ParticleSystemRenderer>();renderer.sharedMaterial=materials[index];if(index==0){renderer.renderMode=ParticleSystemRenderMode.Mesh;renderer.mesh=sphereMesh;}renderer.sortingOrder=1+(index==1?additiveOrderOffset:0);ps.Play();ps.Emit(1);ps.Simulate(.01f,false,false,false);ps.Pause();}
    if(reverseSiblings)objects[0].transform.SetAsLastSibling();
    camera.Render();RenderTexture.active=rt;texture.ReadPixels(new Rect(0,0,16,16),0,0);texture.Apply();var color=texture.GetPixel(8,8);
    rows.Add(new{perspective,particleShader,additiveOrderOffset,reverseCreation,reverseMaterials,reverseSiblings,redRendererId=systems[0].GetComponent<ParticleSystemRenderer>().GetInstanceID(),greenRendererId=systems[1].GetComponent<ParticleSystemRenderer>().GetInstanceID(),rgb=new[]{color.r,color.g,color.b},redBounds=systems[0].GetComponent<ParticleSystemRenderer>().bounds.center.ToString(),greenBounds=systems[1].GetComponent<ParticleSystemRenderer>().bounds.center.ToString()});
   }finally{foreach(var go in objects)UnityEngine.Object.DestroyImmediate(go);foreach(var m in materials)if(m)UnityEngine.Object.DestroyImmediate(m);}
  }}finally{RenderTexture.active=previous;UnityEngine.Object.DestroyImmediate(cameraGo);UnityEngine.Object.DestroyImmediate(rt);UnityEngine.Object.DestroyImmediate(texture);}
  File.WriteAllText("OUTPUT_FILE",System.Text.Json.JsonSerializer.Serialize(new{unityVersion=Application.unityVersion,rows}));return "transparent ties="+rows.Count;
 }
}
