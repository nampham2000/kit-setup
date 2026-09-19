using UnityEngine;
using Newtonsoft.Json;
using System.Collections.Generic;
using System.Security.Cryptography;
public class Script {
    public static string Main(){
        const int size=256,batch=4096;
        var oldRandom=Random.state;Vector3 phase;
        try{Random.InitState(1);phase=new Vector3(100+Random.value*100,Random.value*100,Random.value*100);}finally{Random.state=oldRandom;}
        var go=new GameObject("AOE native Noise lattice");go.hideFlags=HideFlags.HideAndDontSave;
        try {
            var ps=go.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);
            var main=ps.main;main.simulationSpace=ParticleSystemSimulationSpace.World;main.startSpeed=0;main.startLifetime=10;main.maxParticles=batch;
            var shape=ps.shape;shape.enabled=false;var emission=ps.emission;emission.enabled=false;
            var noise=ps.noise;noise.enabled=true;noise.strength=1;noise.frequency=1;noise.damping=false;noise.octaveCount=1;
            noise.quality=ParticleSystemNoiseQuality.Medium;noise.scrollSpeed=0;ps.useAutoRandomSeed=false;ps.randomSeed=1;
            var particles=new ParticleSystem.Particle[batch];var fx=new float[size*size];var fy=new float[size*size];
            var meanX=new double[size];var meanY=new double[size];
            for(int start=0;start<size*size;start+=batch){
                ps.Simulate(0,false,true,false);
                for(int i=0;i<batch;i++){
                    particles[i]=new ParticleSystem.Particle();particles[i].position=new Vector3((start+i)%size,(start+i)/size,0)-phase;
                    particles[i].startLifetime=10;particles[i].remainingLifetime=10;particles[i].randomSeed=1;
                }
                ps.SetParticles(particles,batch);ps.Simulate(1f/60f,false,false,false);
                if(ps.GetParticles(particles)!=batch)throw new System.Exception("Lattice count mismatch");
                for(int i=0;i<batch;i++){
                    int at=start+i;var velocity=particles[i].totalVelocity;
                    fx[at]=velocity.x;fy[at]=velocity.y;meanX[at%size]+=velocity.x/size;meanY[at/size]+=velocity.y/size;
                }
            }
            var codes=new byte[size*size];var samples=new List<object>();double maxResidual=0;
            for(int i=0;i<codes.Length;i++){
                double x=-fy[i]+meanY[i/size],y=fx[i]-meanX[i%size];
                int code=((int)System.Math.Round(System.Math.Atan2(y,x)/(System.Math.PI/4)))&7;codes[i]=(byte)code;
                double angle=code*System.Math.PI/4,ex=System.Math.Cos(angle)*System.Math.Sqrt(2),ey=System.Math.Sin(angle)*System.Math.Sqrt(2);
                maxResidual=System.Math.Max(maxResidual,System.Math.Sqrt((x-ex)*(x-ex)+(y-ey)*(y-ey)));
                if(i<16)samples.Add(new{index=i,gradient=new[]{x,y},code});
            }
            string digest;using(var sha=SHA256.Create())digest=System.BitConverter.ToString(sha.ComputeHash(codes)).Replace("-","").ToLowerInvariant();
            System.IO.File.WriteAllText("OUTPUT_FILE",JsonConvert.SerializeObject(new{unityVersion=Application.unityVersion,seed=1,phase=new[]{phase.x,phase.y,phase.z},count=codes.Length,digest,maxResidual,samples},Formatting.Indented));
            return "Captured native lattice "+digest;
        }finally{Object.DestroyImmediate(go);}
    }
}
