using System;using System.IO;using System.Collections.Generic;using UnityEngine;
public class Script {
 public static string Main(){var cases=new List<object>();
 foreach(uint seed in new uint[]{1,65,131,367,1024,12345,65535,65536,1000003,123456789,306581307,2147483647,2147483648,3988385988,3988385989,4294967294})foreach(int count in new[]{1,2,17})foreach(bool stagger in new[]{false,true}){
 if(stagger&&count!=2)continue;var go=new GameObject("fixed force source");try{
 var ps=go.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);var main=ps.main;main.playOnAwake=false;main.startSpeed=0;main.startLifetime=10;main.simulationSpace=ParticleSystemSimulationSpace.World;main.gravityModifier=0;
 var shape=ps.shape;shape.enabled=false;var emission=ps.emission;emission.enabled=false;var force=ps.forceOverLifetime;force.enabled=true;force.space=ParticleSystemSimulationSpace.World;force.x=new ParticleSystem.MinMaxCurve(-3,7);force.y=new ParticleSystem.MinMaxCurve(-5,11);force.z=new ParticleSystem.MinMaxCurve(-13,2);force.randomized=false;
 ps.useAutoRandomSeed=false;ps.randomSeed=991;ps.Play();ps.Pause();for(int i=0;i<(stagger?1:count);i++)ps.Emit(new ParticleSystem.EmitParams{position=Vector3.zero,velocity=Vector3.zero,startLifetime=10,randomSeed=unchecked(seed+(uint)i),applyShapeToPosition=false},1);
 var particles=new ParticleSystem.Particle[count];var frames=new List<object>();for(int frame=1;frame<=12;frame++){
 if(stagger&&frame==4)ps.Emit(new ParticleSystem.EmitParams{position=Vector3.zero,velocity=Vector3.zero,startLifetime=10,randomSeed=unchecked(seed+1),applyShapeToPosition=false},1);
 ps.Simulate(1f/60,false,false,false);var alive=ps.GetParticles(particles);var all=new List<object>();for(int i=0;i<alive;i++){var p=particles[i];all.Add(new{seed=p.randomSeed,position=new[]{p.position.x,p.position.y,p.position.z},velocity=new[]{p.velocity.x,p.velocity.y,p.velocity.z}});}frames.Add(new{frame,particles=all});}
 cases.Add(new{seed,count,stagger,frames});
 }finally{UnityEngine.Object.DestroyImmediate(go);}}
 File.WriteAllText("OUTPUT_FILE",System.Text.Json.JsonSerializer.Serialize(new{unityVersion=Application.unityVersion,dt=1f/60,ranges=new[]{new[]{-3f,7f},new[]{-5f,11f},new[]{-13f,2f}},cases}));return "fixed force cases="+cases.Count;}
}
