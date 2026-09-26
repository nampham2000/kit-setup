using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEngine;
public class Script {
  static float[] V(Vector3 v){return new[]{v.x,v.y,v.z};}
  public static string Main(){
    var rows=new List<object>();
    var go=new GameObject("spin-native"){hideFlags=HideFlags.HideAndDontSave};var camGo=new GameObject("spin-camera"){hideFlags=HideFlags.HideAndDontSave};var mesh=new Mesh();
    try {
      var cam=camGo.AddComponent<Camera>();cam.enabled=false;
      var ps=go.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);
      var main=ps.main;main.playOnAwake=false;main.simulationSpace=ParticleSystemSimulationSpace.World;main.startRotation3D=true;main.startSize3D=true;
      var em=ps.emission;em.enabled=false;var sh=ps.shape;sh.enabled=false;
      var r=go.GetComponent<ParticleSystemRenderer>();r.maxParticleSize=5;
      var rotation=ps.rotationOverLifetime;rotation.enabled=true;rotation.separateAxes=true;rotation.x=60*Mathf.Deg2Rad;rotation.y=90*Mathf.Deg2Rad;rotation.z=120*Mathf.Deg2Rad;
      foreach(var alignment in new[]{ParticleSystemRenderSpace.View,ParticleSystemRenderSpace.World,ParticleSystemRenderSpace.Local})
      foreach(var camera in new[]{Vector3.zero,new Vector3(15,25,0)}){
        cam.transform.rotation=Quaternion.Euler(camera);go.transform.rotation=Quaternion.Euler(20,40,10);r.alignment=alignment;
        ps.Simulate(0,true,true,false);ps.Play();ps.Pause();
        var p=new ParticleSystem.Particle{position=new Vector3(0,0,10),startSize3D=new Vector3(2,3,4),rotation3D=new Vector3(30,40,50),startLifetime=10,remainingLifetime=10,startColor=Color.white,randomSeed=12345};
        ps.SetParticles(new[]{p},1);for(int i=0;i<20;i++)ps.Simulate(1f/60,false,false,false);
        var particles=new ParticleSystem.Particle[1];if(ps.GetParticles(particles)!=1)throw new Exception("Native spin particle lost");
        mesh.Clear();r.BakeMesh(mesh,cam,ParticleSystemBakeMeshOptions.Default);
        rows.Add(new{mode=0,alignment=(int)alignment,camera=V(camera),emitter=new[]{20,40,10},position=V(p.position),size=V(p.startSize3D),startRotation=V(p.rotation3D),rotation=V(particles[0].rotation3D),steps=20,dt=1f/60,angularVelocity=new[]{60,90,120},vertices=mesh.vertices.Select(V).ToArray(),uv=mesh.uv.Select(v=>new[]{v.x,v.y}).ToArray()});
      }
      File.WriteAllText("OUTPUT_FILE",System.Text.Json.JsonSerializer.Serialize(new{unityVersion=Application.unityVersion,cases=rows}));return "native spin cases="+rows.Count;
    }finally{UnityEngine.Object.DestroyImmediate(mesh);UnityEngine.Object.DestroyImmediate(go);UnityEngine.Object.DestroyImmediate(camGo);}
  }
}
