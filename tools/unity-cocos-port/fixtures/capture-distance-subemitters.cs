using System;using System.IO;using System.Collections.Generic;using UnityEngine;
// Controlled native Birth sub-emission. No scene, material, or pack mutation.
public class Script {
 public static string Main(){
  var rows=new List<object>();
  foreach(var moving in new[]{false,true})
  foreach(var sourceSpace in new[]{ParticleSystemSimulationSpace.World,ParticleSystemSimulationSpace.Local})
  foreach(var targetSpace in new[]{ParticleSystemSimulationSpace.World,ParticleSystemSimulationSpace.Local})
  foreach(float rate in new[]{2f,6f,20f}){
   var root=new GameObject("distance-source");var targetGo=new GameObject("distance-target");targetGo.transform.SetParent(root.transform,false);targetGo.transform.localPosition=new Vector3(.5f,.3f,0);
   try{
    var source=root.AddComponent<ParticleSystem>();var target=targetGo.AddComponent<ParticleSystem>();
    foreach(var ps in new[]{source,target}){ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);var main=ps.main;main.playOnAwake=false;main.startLifetime=2;main.startSpeed=0;main.startSize=1;main.maxParticles=1000;var shape=ps.shape;shape.enabled=false;var em=ps.emission;em.rateOverTime=0;em.rateOverDistance=0;ps.useAutoRandomSeed=false;ps.randomSeed=123;}
    var sm=source.main;sm.simulationSpace=sourceSpace;var tm=target.main;tm.simulationSpace=targetSpace;var te=target.emission;te.rateOverDistance=rate;
    var sub=source.subEmitters;sub.enabled=true;sub.AddSubEmitter(target,ParticleSystemSubEmitterType.Birth,ParticleSystemSubEmitterProperties.InheritNothing,1);
    source.Play(true);source.Pause(true);var ep=new ParticleSystem.EmitParams{position=Vector3.zero,velocity=new Vector3(0,0,3),startLifetime=2,randomSeed=321,applyShapeToPosition=false};source.Emit(ep,1);
    var frames=new List<object>();
    for(int frame=0;frame<=36;frame++){
     if(frame>0){root.transform.position=new Vector3(moving?frame*.1f:0,0,0);source.Simulate(1f/60f,true,false,false);}
     var particles=new ParticleSystem.Particle[target.particleCount];target.GetParticles(particles);var children=new List<object>();foreach(var p in particles){var world=targetSpace==ParticleSystemSimulationSpace.World?p.position:targetGo.transform.TransformPoint(p.position);children.Add(new{position=new[]{world.x,world.y,world.z},remaining=p.remainingLifetime,lifetime=p.startLifetime});}
     var parents=new ParticleSystem.Particle[source.particleCount];source.GetParticles(parents);var pp=parents.Length>0?parents[0].position:Vector3.zero;if(sourceSpace!=ParticleSystemSimulationSpace.World)pp=root.transform.TransformPoint(pp);
     frames.Add(new{frame,parentPosition=new[]{pp.x,pp.y,pp.z},count=target.particleCount,children});
    }
    rows.Add(new{moving,sourceSpace=(int)sourceSpace,targetSpace=(int)targetSpace,rate,frames});
   }finally{UnityEngine.Object.DestroyImmediate(root);}
  }
  File.WriteAllText("OUTPUT_FILE",System.Text.Json.JsonSerializer.Serialize(new{unityVersion=Application.unityVersion,deltaTime=1f/60f,speed=3,translationPerFrame=.1f,rows}));return "Native distance cases="+rows.Count;
 }
}
