using System;using System.IO;using System.Collections.Generic;using UnityEngine;
public class Script {
 public static string Main(){
  var cases=new List<object>();
  foreach(var randomize in new[]{false,true})foreach(var count in new[]{1,2,17})foreach(var stagger in new[]{false,true})for(uint seed=1;seed<=64;seed++){
   if(stagger&&count!=2||count==17&&seed>4)continue;
   var go=new GameObject("force-source");try{
    var ps=go.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);var main=ps.main;main.playOnAwake=false;main.startSpeed=0;main.startLifetime=10;main.simulationSpace=ParticleSystemSimulationSpace.World;main.gravityModifier=0;
    var shape=ps.shape;shape.enabled=false;var emission=ps.emission;emission.enabled=false;var force=ps.forceOverLifetime;force.enabled=true;force.space=ParticleSystemSimulationSpace.World;force.x=new ParticleSystem.MinMaxCurve(-10,10);force.y=new ParticleSystem.MinMaxCurve(-10,10);force.z=new ParticleSystem.MinMaxCurve(-10,10);force.randomized=randomize;
    ps.useAutoRandomSeed=false;ps.randomSeed=123+seed;ps.Play();ps.Pause();for(int i=0;i<(stagger?1:count);i++)ps.Emit(new ParticleSystem.EmitParams{position=Vector3.zero,velocity=Vector3.zero,startLifetime=10,randomSeed=seed+(uint)i,applyShapeToPosition=false},1);
    var particles=new ParticleSystem.Particle[count];var frames=new List<object>();for(int frame=1;frame<=12;frame++){
     if(stagger&&frame==4)ps.Emit(new ParticleSystem.EmitParams{position=Vector3.zero,velocity=Vector3.zero,startLifetime=10,randomSeed=seed+1,applyShapeToPosition=false},1);
     ps.Simulate(1f/60,false,false,false);var alive=ps.GetParticles(particles);var p=particles[0];var all=new List<object>();for(int i=0;i<alive;i++){var q=particles[i];all.Add(new{position=new[]{q.position.x,q.position.y,q.position.z},velocity=new[]{q.velocity.x,q.velocity.y,q.velocity.z},seed=q.randomSeed});}frames.Add(new{frame,position=new[]{p.position.x,p.position.y,p.position.z},velocity=new[]{p.velocity.x,p.velocity.y,p.velocity.z},seed=p.randomSeed,particles=all});}
    cases.Add(new{randomize,seed,systemSeed=123+seed,count,stagger,frames});
   }finally{UnityEngine.Object.DestroyImmediate(go);}
  }
  File.WriteAllText("OUTPUT_FILE",System.Text.Json.JsonSerializer.Serialize(new{unityVersion=Application.unityVersion,dt=1f/60,min=-10,max=10,cases}));return "Native random force cases="+cases.Count;
 }
}
