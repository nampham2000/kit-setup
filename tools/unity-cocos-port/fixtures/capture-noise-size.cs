using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEngine;
public class Script {
    static float[] V(Vector3 v){return new[]{v.x,v.y,v.z};}
    public static string Main(){
        var rows=new List<object>();
        var cameraObject=new GameObject("noise-size-camera"){hideFlags=HideFlags.HideAndDontSave};var camera=cameraObject.AddComponent<Camera>();camera.enabled=false;camera.transform.position=new Vector3(0,0,-10);
        var mesh=new Mesh();var cube=GameObject.CreatePrimitive(PrimitiveType.Cube);cube.hideFlags=HideFlags.HideAndDontSave;var cubeMesh=cube.GetComponent<MeshFilter>().sharedMesh;cube.SetActive(false);
        try {
        foreach(var sizeAmount in new[]{0f,1f})foreach(var steps in new[]{1,2,20})foreach(var threeD in new[]{false,true})foreach(var meshMode in new[]{false,true})foreach(var sizeOverLife in new[]{false,true}){
            var go=new GameObject("native-noise-size"){hideFlags=HideFlags.HideAndDontSave};
            try{
                var ps=go.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);ps.useAutoRandomSeed=false;ps.randomSeed=12345;
                var main=ps.main;main.playOnAwake=false;main.startSize3D=threeD;main.startLifetime=10;main.startSpeed=0;
                var em=ps.emission;em.enabled=false;var sh=ps.shape;sh.enabled=false;
                var size=ps.sizeOverLifetime;size.enabled=sizeOverLife;size.size=new ParticleSystem.MinMaxCurve(1,AnimationCurve.Linear(0,1,1,2));
                var noise=ps.noise;noise.enabled=true;noise.quality=ParticleSystemNoiseQuality.High;noise.frequency=1;noise.damping=false;noise.octaveCount=1;noise.strength=.2f;noise.scrollSpeed=0;noise.positionAmount=1;noise.rotationAmount=0;noise.sizeAmount=sizeAmount;
                var p=new ParticleSystem.Particle{position=new Vector3(3,2,-1),velocity=Vector3.zero,startSize3D=new Vector3(1,2,3),startLifetime=10,remainingLifetime=10,startColor=Color.white,randomSeed=77};if(!threeD)p.startSize=2;
                ps.Play();ps.Pause();ps.SetParticles(new[]{p},1);for(var i=0;i<steps;i++)ps.Simulate(1f/60,false,false,false);
                var particles=new ParticleSystem.Particle[1];if(ps.GetParticles(particles)!=1)throw new Exception("Noise particle lost");var result=particles[0];
                mesh.Clear();var renderer=ps.GetComponent<ParticleSystemRenderer>();renderer.maxParticleSize=5;if(meshMode){renderer.renderMode=ParticleSystemRenderMode.Mesh;renderer.mesh=cubeMesh;}renderer.BakeMesh(mesh,camera,true);
                rows.Add(new{sizeAmount,steps,threeD,meshMode,sizeOverLife,seed=12345,particleSeed=77,dt=1f/60,strength=.2f,frequency=1,initialPosition=V(p.position),initialSize=V(p.startSize3D),position=V(result.position),velocity=V(result.velocity),startSize=V(result.startSize3D),size=V(result.GetCurrentSize3D(ps)),vertices=mesh.vertices.Select(V).ToArray(),result.remainingLifetime});
            }finally{UnityEngine.Object.DestroyImmediate(go);}
        }
        File.WriteAllText("OUTPUT_FILE",System.Text.Json.JsonSerializer.Serialize(new{unityVersion=Application.unityVersion,cases=rows}));return "Native noise size cases="+rows.Count;
        }finally{UnityEngine.Object.DestroyImmediate(mesh);UnityEngine.Object.DestroyImmediate(cube);UnityEngine.Object.DestroyImmediate(cameraObject);}
    }
}
