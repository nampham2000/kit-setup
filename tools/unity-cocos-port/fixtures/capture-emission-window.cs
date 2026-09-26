using System;using System.IO;using System.Collections.Generic;using UnityEngine;
public class Script{
 public static string Main(){var rows=new List<object>();foreach(float step in new[]{1f/60,.03f})foreach(float duration in new[]{.09f,.1f,.11f})foreach(float delay in new[]{0f,.05f,7f})foreach(float rate in new[]{200f,250f,5000f}){
  var go=new GameObject("native emission window");try{var ps=go.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);var main=ps.main;main.playOnAwake=false;main.loop=false;main.duration=duration;main.startDelay=delay;main.startLifetime=2;main.startSpeed=0;main.gravityModifier=0;main.maxParticles=2000;main.cullingMode=ParticleSystemCullingMode.AlwaysSimulate;var shape=ps.shape;shape.enabled=false;var em=ps.emission;em.rateOverTime=rate;em.rateOverDistance=0;ps.useAutoRandomSeed=false;ps.randomSeed=123;ps.Play();ps.Pause();var frames=new List<object>();
   for(int frame=0;frame<480;frame++){ps.Simulate(step,false,false,false);frames.Add(new{frame,count=ps.particleCount,time=ps.time,playing=ps.isPlaying,emitting=ps.isEmitting});}
   rows.Add(new{delay,rate,duration,step,frames});
  }finally{UnityEngine.Object.DestroyImmediate(go);}}
  File.WriteAllText("OUTPUT_FILE",System.Text.Json.JsonSerializer.Serialize(new{unityVersion=Application.unityVersion,deltaTime=1f/60,rows}));return "Native emission window cases="+rows.Count;
 }
}
