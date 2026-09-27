using System;using System.IO;using System.Collections.Generic;using UnityEngine;using UnityEngine.LowLevel;
public class Script {
 static PlayerLoopSystem previousLoop;static float previousCapture;static List<ParticleSystem> systems;static List<List<object>> rows;static int frame=-1;static string output;
 sealed class ForceGameplayHook{}
 public static string Main(){
  if(!Application.isPlaying)throw new InvalidOperationException("Requires Play Mode");
  output="OUTPUT_FILE";previousLoop=PlayerLoop.GetCurrentPlayerLoop();previousCapture=Time.captureDeltaTime;Time.captureDeltaTime=1f/60;systems=new List<ParticleSystem>();rows=new List<List<object>>();
  var loop=PlayerLoop.GetCurrentPlayerLoop();bool installed=false;for(int i=0;i<loop.subSystemList.Length;i++)if(loop.subSystemList[i].type==typeof(UnityEngine.PlayerLoop.PostLateUpdate)){var phase=loop.subSystemList[i];var list=new List<PlayerLoopSystem>(phase.subSystemList);list.Add(new PlayerLoopSystem{type=typeof(ForceGameplayHook),updateDelegate=Tick});phase.subSystemList=list.ToArray();loop.subSystemList[i]=phase;installed=true;break;}
  if(!installed)throw new Exception("Missing PostLateUpdate");File.WriteAllText(output,"{\"pending\":true}");PlayerLoop.SetPlayerLoop(loop);return "Automatic native Force capture started";
 }
 static void Tick(){try{
  if(frame<0){foreach(var count in new[]{1,5}){
   var go=new GameObject("automatic-force-probe"){hideFlags=HideFlags.HideAndDontSave};var ps=go.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);var main=ps.main;main.playOnAwake=false;main.startLifetime=10;main.startSpeed=0;main.cullingMode=ParticleSystemCullingMode.AlwaysSimulate;var em=ps.emission;em.enabled=false;var sh=ps.shape;sh.enabled=false;var force=ps.forceOverLifetime;force.enabled=true;force.space=ParticleSystemSimulationSpace.World;force.randomized=true;force.x=new ParticleSystem.MinMaxCurve(-10,10);force.y=new ParticleSystem.MinMaxCurve(-10,10);force.z=new ParticleSystem.MinMaxCurve(-10,10);ps.useAutoRandomSeed=false;ps.randomSeed=17;ps.Play();for(int i=0;i<count;i++)ps.Emit(new ParticleSystem.EmitParams{position=Vector3.zero,velocity=Vector3.zero,startLifetime=10,randomSeed=(uint)i+1,applyShapeToPosition=false},1);systems.Add(ps);rows.Add(new List<object>());
  }frame=0;return;}
  for(int i=0;i<systems.Count;i++){var particles=new ParticleSystem.Particle[10];var count=systems[i].GetParticles(particles);var values=new List<object>();for(int j=0;j<count;j++){var p=particles[j];values.Add(new{seed=p.randomSeed,position=new[]{p.position.x,p.position.y,p.position.z},velocity=new[]{p.velocity.x,p.velocity.y,p.velocity.z}});}rows[i].Add(new{frame,time=systems[i].time,dt=Time.deltaTime,particles=values});}
  if(++frame>=12){File.WriteAllText(output,System.Text.Json.JsonSerializer.Serialize(new{isPlaying=Application.isPlaying,unityVersion=Application.unityVersion,driver="PostLateUpdate, automatic particle update, no Simulate",systemSeed=17,rows}));Cleanup();}
 }catch(Exception e){File.WriteAllText(output,System.Text.Json.JsonSerializer.Serialize(new{error=e.ToString()}));Cleanup();}}
 static void Cleanup(){PlayerLoop.SetPlayerLoop(previousLoop);Time.captureDeltaTime=previousCapture;foreach(var ps in systems)if(ps!=null)UnityEngine.Object.DestroyImmediate(ps.gameObject);}
}
