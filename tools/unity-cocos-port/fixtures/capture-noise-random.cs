using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEngine;
public class Script {
 static float[] V(Vector3 v){return new[]{v.x,v.y,v.z};}
 public static string Main(){
  var rows=new List<object>();
  var camGo=new GameObject("noise-random-camera"){hideFlags=HideFlags.HideAndDontSave};var cam=camGo.AddComponent<Camera>();cam.enabled=false;cam.transform.position=new Vector3(0,0,-10);var mesh=new Mesh();
  try{
   foreach(var seed in new uint[]{0,1,2,3,77,12345,4294967295,17,987654321,2147483648,3240314220,3240314221,4294967294})
   foreach(var separateAxes in new[]{false,true})foreach(var quality in new[]{0,1,2})foreach(var authored in new[]{false,true})foreach(var threeD in new[]{false,true}){
    var go=new GameObject("native-noise-random"){hideFlags=HideFlags.HideAndDontSave};
    try{
     var ps=go.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);ps.useAutoRandomSeed=false;ps.randomSeed=12345;
     var main=ps.main;main.playOnAwake=false;main.startLifetime=10;main.startSpeed=0;main.startSize3D=threeD;
     var em=ps.emission;em.enabled=false;var sh=ps.shape;sh.enabled=false;
     var ranges=authored?new[]{new[]{.7f,.8f},new[]{-.3f,.9f},new[]{.2f,.6f}}:new[]{new[]{0f,1f},new[]{0f,1f},new[]{0f,1f}};
     var noise=ps.noise;noise.enabled=true;noise.quality=(ParticleSystemNoiseQuality)quality;noise.frequency=authored?2:1;noise.damping=authored;noise.octaveCount=1;noise.separateAxes=separateAxes;noise.strength=new ParticleSystem.MinMaxCurve(ranges[0][0],ranges[0][1]);noise.strengthY=new ParticleSystem.MinMaxCurve(ranges[1][0],ranges[1][1]);noise.strengthZ=new ParticleSystem.MinMaxCurve(ranges[2][0],ranges[2][1]);noise.scrollSpeed=0;noise.positionAmount=1;noise.rotationAmount=authored?1:0;noise.sizeAmount=authored?1:0;
     var p=new ParticleSystem.Particle{position=new Vector3(3,2,-1),velocity=Vector3.zero,startSize=1,startLifetime=10,remainingLifetime=10,startColor=Color.white,randomSeed=seed};
     if(threeD)p.startSize3D=Vector3.one;
     ps.Play();ps.Pause();ps.SetParticles(new[]{p},1);var samples=new List<object>();var renderer=ps.GetComponent<ParticleSystemRenderer>();renderer.maxParticleSize=5;
     for(var i=0;i<3;i++){
      ps.Simulate(1f/60,false,false,false);var particles=new ParticleSystem.Particle[1];if(ps.GetParticles(particles)!=1)throw new Exception("Noise particle lost");
      mesh.Clear();renderer.BakeMesh(mesh,cam,true);var vertices=mesh.vertices;
      samples.Add(new{position=V(particles[0].position),seed=particles[0].randomSeed,rotation=particles[0].rotation,vertices=vertices.Select(V).ToArray()});
     }
     rows.Add(new{particleSeed=seed,separateAxes,quality,authored,threeD,ranges,frequency=noise.frequency,damping=noise.damping,systemSeed=12345,dt=1f/60,initialPosition=V(p.position),samples});
    }finally{UnityEngine.Object.DestroyImmediate(go);}
   }
   File.WriteAllText("OUTPUT_FILE",System.Text.Json.JsonSerializer.Serialize(new{unityVersion=Application.unityVersion,cases=rows}));return "Native noise random cases="+rows.Count;
  }finally{UnityEngine.Object.DestroyImmediate(mesh);UnityEngine.Object.DestroyImmediate(camGo);}
 }
}
