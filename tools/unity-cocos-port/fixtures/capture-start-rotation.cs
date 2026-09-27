using System;using System.IO;using System.Collections.Generic;using UnityEngine;
public class Script{
 public static string Main(){if(!Application.isPlaying)throw new Exception("Start rotation requires Play Mode");var rows=new List<object>();
 foreach(var systemSeed in new uint[]{17,12345,987654321,4294967295})foreach(var count in new[]{1,5,17})foreach(var batched in new[]{false,true})foreach(var threeD in new[]{false,true})foreach(var mask in new[]{0,1,2,4,7}){
  var go=new GameObject("start-rotation-probe"){hideFlags=HideFlags.HideAndDontSave};try{
   var ps=go.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);var main=ps.main;main.playOnAwake=false;main.startLifetime=10;main.startSpeed=0;main.startRotation3D=threeD;main.startRotationX=(mask&1)!=0?new ParticleSystem.MinMaxCurve(0,Mathf.PI*2):new ParticleSystem.MinMaxCurve(.3f);main.startRotationY=(mask&2)!=0?new ParticleSystem.MinMaxCurve(0,Mathf.PI*2):new ParticleSystem.MinMaxCurve(.5f);main.startRotationZ=(mask&4)!=0?new ParticleSystem.MinMaxCurve(0,Mathf.PI*2):new ParticleSystem.MinMaxCurve(.7f);var em=ps.emission;em.enabled=false;var shape=ps.shape;shape.enabled=false;ps.useAutoRandomSeed=false;ps.randomSeed=systemSeed;ps.Play();ps.Pause();var emit=new ParticleSystem.EmitParams{position=Vector3.zero,velocity=Vector3.zero,randomSeed=77,applyShapeToPosition=false};if(batched)ps.Emit(count);else for(int i=0;i<count;i++)ps.Emit(1);var particles=new ParticleSystem.Particle[count];ps.GetParticles(particles);var results=new List<object>();foreach(var p in particles)results.Add(new{particleSeed=p.randomSeed,rotation=new[]{p.rotation3D.x,p.rotation3D.y,p.rotation3D.z}});rows.Add(new{systemSeed,count,batched,threeD,mask,particles=results});
  }finally{UnityEngine.Object.DestroyImmediate(go);}
 }
 File.WriteAllText("OUTPUT_FILE",System.Text.Json.JsonSerializer.Serialize(new{isPlaying=Application.isPlaying,unityVersion=Application.unityVersion,rows}));return "Start rotation cases="+rows.Count;
 }
}
