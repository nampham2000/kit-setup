using System;using System.IO;using System.Collections.Generic;using UnityEngine;
public class Script {
 public static string Main(){
  var rows=new List<object>();
  foreach(var targetSpace in new[]{ParticleSystemSimulationSpace.World,ParticleSystemSimulationSpace.Local})foreach(float delay in new[]{0f,.25f,1f,7f}){
   var root=new GameObject("delay-source");var targetGo=new GameObject("delay-target");targetGo.transform.SetParent(root.transform,false);
   try{
    var source=root.AddComponent<ParticleSystem>();var target=targetGo.AddComponent<ParticleSystem>();
    foreach(var ps in new[]{source,target}){ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);var main=ps.main;main.playOnAwake=false;main.startLifetime=2;main.startSpeed=0;main.startSize=1;main.maxParticles=1000;main.cullingMode=ParticleSystemCullingMode.AlwaysSimulate;var shape=ps.shape;shape.enabled=false;var em=ps.emission;em.rateOverTime=0;em.rateOverDistance=0;ps.useAutoRandomSeed=false;ps.randomSeed=123;}
    var sm=source.main;sm.simulationSpace=ParticleSystemSimulationSpace.World;var tm=target.main;tm.simulationSpace=targetSpace;tm.startDelay=delay;var te=target.emission;te.rateOverDistance=20;
    var sub=source.subEmitters;sub.enabled=true;sub.AddSubEmitter(target,ParticleSystemSubEmitterType.Birth,ParticleSystemSubEmitterProperties.InheritNothing,1);
    source.Play(true);source.Pause(true);source.Emit(new ParticleSystem.EmitParams{position=Vector3.zero,velocity=new Vector3(0,0,3),startLifetime=2,randomSeed=321,applyShapeToPosition=false},1);
    var frames=new List<object>();
    for(int frame=0;frame<=600;frame++){
     if(frame>0)source.Simulate(1f/60f,true,false,false);
     var particles=new ParticleSystem.Particle[target.particleCount];target.GetParticles(particles);var children=new List<object>();foreach(var p in particles){var world=targetSpace==ParticleSystemSimulationSpace.World?p.position:targetGo.transform.TransformPoint(p.position);children.Add(new{position=new[]{world.x,world.y,world.z},remaining=p.remainingLifetime,lifetime=p.startLifetime});}
     frames.Add(new{frame,count=target.particleCount,simulationTime=target.time,children});
    }
    rows.Add(new{targetSpace=(int)targetSpace,delay,frames});
   }finally{UnityEngine.Object.DestroyImmediate(root);}
  }
  File.WriteAllText("OUTPUT_FILE",System.Text.Json.JsonSerializer.Serialize(new{unityVersion=Application.unityVersion,deltaTime=1f/60f,speed=3,sourceLifetime=2,rows}));return "Native delay cases="+rows.Count;
 }
}
