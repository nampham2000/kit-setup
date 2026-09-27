using System;using System.IO;using System.Collections.Generic;using UnityEngine;
public class Script{
 public static string Main(){if(!Application.isPlaying)throw new Exception("Start rotation requires Play Mode");var rows=new List<object>();
 foreach(var systemSeed in new uint[]{17,12345})foreach(var size3D in new[]{false,true})foreach(var threeD in new[]{false,true})foreach(var shapeEnabled in new[]{false,true})foreach(var randomValues in new[]{false,true})foreach(var randomColor in new[]{false,true})foreach(var emitStyle in new[]{0,1,2}){
  var go=new GameObject("start-rotation-options"){hideFlags=HideFlags.HideAndDontSave};try{
   var ps=go.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);var main=ps.main;main.playOnAwake=false;main.startLifetime=randomValues?new ParticleSystem.MinMaxCurve(1,2):new ParticleSystem.MinMaxCurve(10);main.startSpeed=randomValues?new ParticleSystem.MinMaxCurve(1,2):new ParticleSystem.MinMaxCurve(0);main.startSizeX=randomValues?new ParticleSystem.MinMaxCurve(1,2):new ParticleSystem.MinMaxCurve(1);main.startSizeY=main.startSizeX;main.startSizeZ=main.startSizeX;main.startSize3D=size3D;main.startColor=randomColor?new ParticleSystem.MinMaxGradient(Color.red,Color.green):new ParticleSystem.MinMaxGradient(Color.white);
   main.startRotation3D=threeD;main.startRotationX=new ParticleSystem.MinMaxCurve(0,Mathf.PI*2);main.startRotationY=new ParticleSystem.MinMaxCurve(0,Mathf.PI*2);main.startRotationZ=new ParticleSystem.MinMaxCurve(0,Mathf.PI*2);var em=ps.emission;em.enabled=false;var shape=ps.shape;shape.enabled=shapeEnabled;ps.useAutoRandomSeed=false;ps.randomSeed=systemSeed;ps.Play();ps.Pause();for(int batch=0;batch<2;batch++){if(emitStyle==0)ps.Emit(5);else if(emitStyle==1)ps.Emit(new ParticleSystem.EmitParams{randomSeed=77},5);else ps.Emit(new ParticleSystem.EmitParams{position=Vector3.zero,velocity=Vector3.zero,randomSeed=77,applyShapeToPosition=false},5);}
   var particles=new ParticleSystem.Particle[10];ps.GetParticles(particles);var results=new List<object>();foreach(var p in particles)results.Add(new{particleSeed=p.randomSeed,rotation=new[]{p.rotation3D.x,p.rotation3D.y,p.rotation3D.z}});rows.Add(new{systemSeed,size3D,threeD,shapeEnabled,randomValues,randomColor,emitStyle,particles=results});
  }finally{UnityEngine.Object.DestroyImmediate(go);}
 }
 File.WriteAllText("OUTPUT_FILE",System.Text.Json.JsonSerializer.Serialize(new{isPlaying=Application.isPlaying,unityVersion=Application.unityVersion,rows}));return "Start rotation option cases="+rows.Count;
 }
}
