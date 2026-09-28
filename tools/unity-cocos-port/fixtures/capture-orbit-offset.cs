using UnityEngine;
using Newtonsoft.Json;
using System.Collections.Generic;
// Native orbital offset probe (VelocityOverLifetime orbitalOffsetX/Y/Z): one particle in a local-space
// system, stepped with Simulate, for offsets that include Hovl Magic circle 1 (0.3, 0.3, 0.3).
public class Script {
    static float[] V(Vector3 v){return new[]{v.x,v.y,v.z};}
    public static string Main(){
        var rows=new List<object>();
        foreach(var offset in new[]{new Vector3(0.3f,0.3f,0.3f),new Vector3(1f,-0.5f,2f)})
        foreach(var omega in new[]{new Vector3(0,0,-6),new Vector3(1,2,3)})
        foreach(float radial in new[]{0f,1f})
        foreach(float dt in new[]{0.01f,0.033333333f}) {
            var go=new GameObject("Native orbital offset probe");go.hideFlags=HideFlags.HideAndDontSave;
            try {
                var ps=go.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);
                var main=ps.main;main.simulationSpace=ParticleSystemSimulationSpace.Local;main.gravityModifier=0;
                var em=ps.emission;em.enabled=false;
                var vel=ps.velocityOverLifetime;vel.enabled=true;vel.space=ParticleSystemSimulationSpace.Local;
                vel.x=0;vel.y=0;vel.z=0;vel.orbitalX=omega.x;vel.orbitalY=omega.y;vel.orbitalZ=omega.z;vel.radial=radial;
                vel.orbitalOffsetX=offset.x;vel.orbitalOffsetY=offset.y;vel.orbitalOffsetZ=offset.z;
                ps.Simulate(0,false,true,false);
                var p=new ParticleSystem.Particle{position=new Vector3(1,2,3),velocity=new Vector3(.4f,.5f,.6f),startLifetime=10,remainingLifetime=10,startSize=1,randomSeed=1234};
                var particles=new[]{p};ps.SetParticles(particles,1);
                ps.Simulate(dt,false,false,false);ps.GetParticles(particles);p=particles[0];
                rows.Add(new{offset=V(offset),omega=V(omega),radial,dt,position=V(p.position),velocity=V(p.velocity),total=V(p.totalVelocity)});
            }finally{Object.DestroyImmediate(go);}
        }
        return JsonConvert.SerializeObject(rows);
    }
}
