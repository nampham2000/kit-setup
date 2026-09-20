using UnityEngine;using UnityEditor;using Newtonsoft.Json;using System.Collections.Generic;
public class Script {
 static float[] V(Vector3 v){return new[]{v.x,v.y,v.z};}
 public static string Main(){
 var path="Assets/Hovl Studio/RPG VFX Bundle/Prefabs/Magic buffs and hits/Soft blue buff.prefab";
 var g=Object.Instantiate(AssetDatabase.LoadAssetAtPath<GameObject>(path));g.hideFlags=HideFlags.HideAndDontSave;
 try{var ps=g.transform.Find("Sparks").GetComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);var em=ps.emission;em.enabled=false;ps.useAutoRandomSeed=false;ps.randomSeed=1234;ps.Simulate(0,false,true,false);ps.Emit(64);
 var initial=new ParticleSystem.Particle[64];int n=ps.GetParticles(initial);var state=ps.GetPlaybackState();var noise=ps.noise;noise.enabled=false;ps.Simulate(1f/60f,false,false,false);var p=new ParticleSystem.Particle[64];ps.GetParticles(p);var draws=new List<object>();for(int i=0;i<n;i++)draws.Add(new{seed=p[i].randomSeed,speed=p[i].totalVelocity.magnitude});ps.SetPlaybackState(state);ps.SetParticles(initial,n);noise.enabled=true;
 var rows=new List<object>();for(int frame=0;frame<=60;frame++){if(frame>0)ps.Simulate(1f/60f,false,false,false);if(frame!=0&&frame!=1&&frame!=12&&frame!=30&&frame!=60)continue;int count=ps.GetParticles(p);var values=new List<object>();for(int i=0;i<count;i++){var q=p[i];values.Add(new{seed=q.randomSeed,position=V(q.position),velocity=V(q.velocity),totalVelocity=V(q.totalVelocity),life=q.remainingLifetime,startLife=q.startLifetime});}rows.Add(new{time=frame/60f,particles=values});}
 System.IO.File.WriteAllText("OUTPUT_FILE",JsonConvert.SerializeObject(new{path,node="Sparks",seed=1234,delta=1f/60f,draws,rows},Formatting.Indented));return "Captured authored Soft blue Sparks births, radial draws and trajectories";
 }finally{Object.DestroyImmediate(g);}}
}
