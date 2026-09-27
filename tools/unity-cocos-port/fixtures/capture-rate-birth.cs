using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEngine;
public class Script {
    static float[] V(Vector3 v){return new[]{v.x,v.y,v.z};}
    public static string Main(){
        var cases=new List<object>();
        foreach(var rate in new[]{60f,200f,2000f})foreach(var gravity in new[]{0f,1f})foreach(var moving in new[]{false,true}){
            var go=new GameObject("native-rate-birth"){hideFlags=HideFlags.HideAndDontSave};
            try{
                var ps=go.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);ps.useAutoRandomSeed=false;ps.randomSeed=12345;
                var main=ps.main;main.playOnAwake=false;main.startLifetime=2;main.startSpeed=2;main.startSize=3;main.startSize3D=false;main.simulationSpace=ParticleSystemSimulationSpace.World;main.gravityModifier=gravity;
                var emission=ps.emission;emission.rateOverTime=rate;var shape=ps.shape;shape.enabled=false;
                var size=ps.sizeOverLifetime;size.enabled=true;size.size=new ParticleSystem.MinMaxCurve(1,AnimationCurve.Linear(0,1,1,2));
                var color=ps.colorOverLifetime;color.enabled=true;var gradient=new Gradient();gradient.SetKeys(new[]{new GradientColorKey(Color.white,0),new GradientColorKey(Color.white,1)},new[]{new GradientAlphaKey(0,0),new GradientAlphaKey(1,1)});color.color=gradient;
                ps.Play();ps.Pause();var frames=new List<object>();
                for(var frame=0;frame<6;frame++){
                    go.transform.position=new Vector3(moving?frame*.4f:0,0,0);ps.Simulate(1f/60,false,false,false);
                    var particles=new ParticleSystem.Particle[ps.particleCount];ps.GetParticles(particles);
                    frames.Add(new{frame,particles=particles.Select(p=>new{p.startLifetime,p.remainingLifetime,position=V(p.position),velocity=V(p.velocity),size=V(p.GetCurrentSize3D(ps)),alpha=p.GetCurrentColor(ps).a}).ToArray()});
                }
                cases.Add(new{rate,gravity,moving,dt=1f/60,frames});
            }finally{UnityEngine.Object.DestroyImmediate(go);}
        }
        File.WriteAllText("OUTPUT_FILE",System.Text.Json.JsonSerializer.Serialize(new{unityVersion=Application.unityVersion,gravity=V(Physics.gravity),cases}));return "Native rate birth cases="+cases.Count;
    }
}
