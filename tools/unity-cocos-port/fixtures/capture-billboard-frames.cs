using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEngine;

// Native diagnostic: identical one-particle births, camera/emitter rotation and
// all renderer alignment enums. Temporary objects only; source assets untouched.
public class Script {
  static float[] V(Vector3 v) { return new[]{v.x,v.y,v.z}; }
  public static string Main() {
    var output=new List<object>();
    var cameraObject=new GameObject("diagnostic-camera"){hideFlags=HideFlags.HideAndDontSave};
    var systemObject=new GameObject("diagnostic-particle"){hideFlags=HideFlags.HideAndDontSave};
    var target=new RenderTexture(1280,720,24);var mesh=new Mesh();
    try {
      var camera=cameraObject.AddComponent<Camera>();camera.enabled=false;camera.fieldOfView=60;camera.targetTexture=target;
      var ps=systemObject.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);
      var main=ps.main;main.playOnAwake=false;main.simulationSpace=ParticleSystemSimulationSpace.World;main.startSize3D=true;main.startRotation3D=true;
      var emission=ps.emission;emission.enabled=false;var shape=ps.shape;shape.enabled=false;
      var renderer=ps.GetComponent<ParticleSystemRenderer>();renderer.maxParticleSize=5;
      systemObject.transform.rotation=Quaternion.Euler(20,40,10);
      foreach(var mode in new[]{ParticleSystemRenderMode.Billboard,ParticleSystemRenderMode.HorizontalBillboard,ParticleSystemRenderMode.VerticalBillboard})
      foreach(var alignment in new[]{ParticleSystemRenderSpace.View,ParticleSystemRenderSpace.World,ParticleSystemRenderSpace.Local,ParticleSystemRenderSpace.Facing,ParticleSystemRenderSpace.Velocity})
      foreach(var cameraAngles in new[]{Vector3.zero,new Vector3(15,25,0)}) {
        camera.transform.rotation=Quaternion.Euler(cameraAngles);renderer.renderMode=mode;renderer.alignment=alignment;
        ps.Simulate(0,true,true,false);ps.Play();
        var p=new ParticleSystem.Particle{position=new Vector3(0,0,10),velocity=new Vector3(1,2,3),startSize3D=new Vector3(2,3,4),rotation3D=new Vector3(15,35,70),startLifetime=100,remainingLifetime=100,startColor=Color.white};
        ps.SetParticles(new[]{p},1);mesh.Clear();renderer.BakeMesh(mesh,camera,ParticleSystemBakeMeshOptions.Default);
        output.Add(new{mode=(int)mode,alignment=(int)alignment,camera=V(cameraAngles),emitter=new[]{20,40,10},position=V(p.position),size=V(p.startSize3D),rotation=V(p.rotation3D),vertices=mesh.vertices.Select(V).ToArray(),uv=mesh.uv.Select(v=>new[]{v.x,v.y}).ToArray()});
      }
      File.WriteAllText("OUTPUT_FILE",System.Text.Json.JsonSerializer.Serialize(new{unityVersion=Application.unityVersion,scope="one particle native BakeMesh; no random matching assumption",cases=output}));
      return "billboard frame cases="+output.Count;
    }finally{UnityEngine.Object.DestroyImmediate(mesh);target.Release();UnityEngine.Object.DestroyImmediate(target);UnityEngine.Object.DestroyImmediate(systemObject);UnityEngine.Object.DestroyImmediate(cameraObject);}
  }
}
