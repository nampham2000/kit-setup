using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEngine;
public class Script {
    public static string Main(){
        var cases=new List<object>();
        foreach(var rate in new[]{30f,50f,59f,60f,61f,100f,200f,1000f,2000f}){
            var go=new GameObject("native-rate-clock"){hideFlags=HideFlags.HideAndDontSave};
            try{
                var ps=go.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);ps.useAutoRandomSeed=false;ps.randomSeed=12345;
                var main=ps.main;main.playOnAwake=false;main.startLifetime=2;main.startSpeed=1;main.maxParticles=5000;main.simulationSpace=ParticleSystemSimulationSpace.World;
                var emission=ps.emission;emission.rateOverTime=rate;var shape=ps.shape;shape.enabled=false;ps.Play();ps.Pause();var frames=new List<object>();
                for(var frame=0;frame<32;frame++){
                    ps.Simulate(1f/60,false,false,false);var particles=new ParticleSystem.Particle[ps.particleCount];ps.GetParticles(particles);
                    frames.Add(new{frame,time=ps.time,count=ps.particleCount,youngest=particles.OrderByDescending(p=>p.remainingLifetime).Take(2).Select(p=>new{p.remainingLifetime,z=p.position.z}).ToArray()});
                }
                cases.Add(new{rate,dt=1f/60,frames});
            }finally{UnityEngine.Object.DestroyImmediate(go);}
        }
        File.WriteAllText("OUTPUT_FILE",System.Text.Json.JsonSerializer.Serialize(new{unityVersion=Application.unityVersion,cases}));return "Native clock cases="+cases.Count;
    }
}
