using UnityEngine;
using Newtonsoft.Json;
using System.Collections.Generic;
public class Script {
    static float[] V(Vector3 v){return new[]{v.x,v.y,v.z};}
    public static string Main(){
        var rows=new List<object>();
        foreach(var omega in new[]{new Vector3(0,2,0),new Vector3(1,2,3)})
        foreach(float radial in new[]{0f,1.5f})
        foreach(float dt in new[]{0.01f,0.033333333f}) {
            var go=new GameObject("Native orbital probe");go.hideFlags=HideFlags.HideAndDontSave;
            try {
                var ps=go.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);
                var main=ps.main;main.simulationSpace=ParticleSystemSimulationSpace.Local;main.gravityModifier=0;
                var em=ps.emission;em.enabled=false;
                var vel=ps.velocityOverLifetime;vel.enabled=true;vel.space=ParticleSystemSimulationSpace.Local;
                vel.x=0;vel.y=0;vel.z=0;vel.orbitalX=omega.x;vel.orbitalY=omega.y;vel.orbitalZ=omega.z;vel.radial=radial;
                ps.Simulate(0,false,true,false);
                var p=new ParticleSystem.Particle{position=new Vector3(1,2,3),velocity=new Vector3(.4f,.5f,.6f),startLifetime=10,remainingLifetime=10,startSize=1,randomSeed=1234};
                var particles=new[]{p};ps.SetParticles(particles,1);
                ps.Simulate(dt,false,false,false);ps.GetParticles(particles);p=particles[0];
                rows.Add(new{omega=V(omega),radial,dt,position=V(p.position),velocity=V(p.velocity),total=V(p.totalVelocity)});
            }finally{Object.DestroyImmediate(go);}
        }
        return JsonConvert.SerializeObject(rows);
    }
}
