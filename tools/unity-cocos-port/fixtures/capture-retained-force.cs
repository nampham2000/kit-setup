using System;using System.IO;using System.Collections.Generic;using UnityEngine;
public class Script {
 public static string Main(){if(!Application.isPlaying)throw new InvalidOperationException("Retained Force oracle requires Play Mode");var cases=new List<object>();
 foreach(var trails in new[]{false,true})foreach(var count in new[]{2,5,9})foreach(var seed in new uint[]{17,987654321}){
  var go=new GameObject("force-retained-probe"){hideFlags=HideFlags.HideAndDontSave};try{
   var ps=go.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);var main=ps.main;main.playOnAwake=false;main.startSpeed=0;main.startLifetime=10;main.simulationSpace=ParticleSystemSimulationSpace.World;main.gravityModifier=0;
   var shape=ps.shape;shape.enabled=false;var emission=ps.emission;emission.enabled=false;var force=ps.forceOverLifetime;force.enabled=true;force.space=ParticleSystemSimulationSpace.World;force.x=new ParticleSystem.MinMaxCurve(-10,10);force.y=new ParticleSystem.MinMaxCurve(-10,10);force.z=new ParticleSystem.MinMaxCurve(-10,10);force.randomized=true;
   var trail=ps.trails;trail.enabled=trails;trail.ratio=1;trail.lifetime=.15f;trail.dieWithParticles=false;trail.minVertexDistance=0;
   ps.useAutoRandomSeed=false;ps.randomSeed=seed;ps.Play();ps.Pause();for(int i=0;i<count;i++)ps.Emit(new ParticleSystem.EmitParams{position=Vector3.zero,velocity=new Vector3(1,0,0),startLifetime=i%3==0?.05f:10,randomSeed=(uint)i+1,applyShapeToPosition=false},1);
   var particles=new ParticleSystem.Particle[64];var frames=new List<object>();for(int frame=1;frame<=24;frame++){
    if(frame==7)ps.Emit(new ParticleSystem.EmitParams{position=Vector3.zero,velocity=new Vector3(1,0,0),startLifetime=10,randomSeed=55,applyShapeToPosition=false},1);
    ps.Simulate(1f/60,false,false,false);var total=ps.GetParticles(particles);var all=new List<object>();for(int i=0;i<total;i++){var p=particles[i];all.Add(new{position=new[]{p.position.x,p.position.y,p.position.z},velocity=new[]{p.velocity.x,p.velocity.y,p.velocity.z},seed=p.randomSeed,remaining=p.remainingLifetime});}frames.Add(new{frame,particles=all});
   }
   cases.Add(new{trails,count,systemSeed=seed,frames});
  }finally{UnityEngine.Object.DestroyImmediate(go);}
 }
 File.WriteAllText("OUTPUT_FILE",System.Text.Json.JsonSerializer.Serialize(new{unityVersion=Application.unityVersion,isPlaying=Application.isPlaying,dt=1f/60,cases}));return "Retained force cases="+cases.Count;
 }
}
