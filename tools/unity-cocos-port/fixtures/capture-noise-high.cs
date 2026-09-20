using UnityEngine;
using Newtonsoft.Json;
using System.Collections.Generic;
using System.Reflection;
public class Script {
    static float[] V(Vector3 v){return new[]{v.x,v.y,v.z};}
    public static string Main(){
        var rows=new List<object>();
        foreach(uint seed in new uint[]{1,1234,987654}) foreach(int octaves in new[]{1,3}) foreach(bool damping in new[]{false,true}) foreach(float frequency in new[]{.5f,1.2f}) foreach(float scroll in new[]{0f,.17f}) {
            var go=new GameObject("AOE noise field holdouts");go.hideFlags=HideFlags.HideAndDontSave;
            try{
                var ps=go.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);
                var main=ps.main;main.simulationSpace=ParticleSystemSimulationSpace.World;main.startSpeed=0;main.startLifetime=10;
                var shape=ps.shape;shape.enabled=false;var emission=ps.emission;emission.enabled=false;
                var noise=ps.noise;noise.enabled=true;noise.strength=1;noise.frequency=frequency;noise.damping=damping;noise.octaveCount=octaves;noise.octaveMultiplier=.5f;noise.octaveScale=2;
                noise.quality=ParticleSystemNoiseQuality.High;noise.scrollSpeed=0;ps.useAutoRandomSeed=false;ps.randomSeed=seed;ps.Simulate(0,false,true,false);
                object state=ps.GetPlaybackState();var nf=state.GetType().GetField("m_Noise",BindingFlags.Instance|BindingFlags.NonPublic);
                object ns=nf.GetValue(state);ns.GetType().GetField("m_ScrollOffset",BindingFlags.Instance|BindingFlags.NonPublic|BindingFlags.Public).SetValue(ns,scroll);
                nf.SetValue(state,ns);ps.SetPlaybackState((ParticleSystem.PlaybackState)state);
                var random=new System.Random(71682);var p=new ParticleSystem.Particle[16];var positions=new Vector3[16];
                for(int i=0;i<p.Length;i++){
                    positions[i]=new Vector3((float)random.NextDouble()*20-10,(float)random.NextDouble()*20-10,(float)random.NextDouble()*20-10);
                    p[i].position=positions[i];p[i].startLifetime=10;p[i].remainingLifetime=10;p[i].randomSeed=(uint)(i+1);
                }
                ps.SetParticles(p,p.Length);ps.Simulate(1f/60f,false,false,false);ps.GetParticles(p);
                for(int i=0;i<p.Length;i++)rows.Add(new{seed,octaves,damping,frequency,scroll,position=V(positions[i]),field=V(p[i].totalVelocity)});
            }finally{Object.DestroyImmediate(go);}
        }
        System.IO.File.WriteAllText("OUTPUT_FILE",JsonConvert.SerializeObject(rows,Formatting.Indented));return "Captured native High field holdouts";
    }
}
