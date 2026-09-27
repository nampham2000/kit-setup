using UnityEngine;using Newtonsoft.Json;using System.Collections.Generic;
public class Script {public static string Main(){
 if(!Application.dataPath.Replace('\\','/').EndsWith("/.ai/combat-magic/unity-reference/Assets"))throw new System.Exception("Owned reference only");
 var go=new GameObject("Native burst count diagnostic");var ps=go.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);go.GetComponent<ParticleSystemRenderer>().enabled=false;var main=ps.main;main.playOnAwake=false;main.duration=1;main.loop=true;main.startLifetime=.1f;main.startSpeed=0;main.maxParticles=1200;var shape=ps.shape;shape.enabled=false;var em=ps.emission;em.rateOverTime=0;em.rateOverDistance=0;em.SetBursts(new[]{new ParticleSystem.Burst(0,new ParticleSystem.MinMaxCurve(1,1000))});var rows=new List<object>();
 try{foreach(uint seed in new uint[]{1,17,12345,4115188711,1430824084,971192727,4294967295,4294967280,123,42,54321,918273}){
 ps.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);ps.useAutoRandomSeed=false;ps.randomSeed=seed;ps.Simulate(0,false,true,false);ps.Play(false);var counts=new List<int>();
 for(int f=0;f<=180;f++){ps.Simulate(1f/60,false,false,false);if(f%60==0)counts.Add(ps.particleCount);}rows.Add(new{seed,counts});
 }}finally{Object.DestroyImmediate(go);}System.IO.File.WriteAllText("OUTPUT_FILE",JsonConvert.SerializeObject(new{unityVersion=Application.unityVersion,min=1,max=1000,rows}));return "Captured native random burst counts";
}}
