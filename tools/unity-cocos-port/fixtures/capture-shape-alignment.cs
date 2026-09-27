using System;using System.IO;using System.Collections.Generic;using UnityEngine;
public class Script {
 static float[] V(Vector3 v){return new[]{v.x,v.y,v.z};}
 public static string Main(){var rows=new List<object>();
 foreach(var initial in new[]{Vector3.zero,new Vector3(180,0,0),new Vector3(23,47,71)}) foreach(bool align in new[]{false,true}) {
 var go=new GameObject("temporary-shape-alignment-oracle"){hideFlags=HideFlags.HideAndDontSave};
 try{var ps=go.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);
 var m=ps.main;m.playOnAwake=false;m.startLifetime=10;m.startSpeed=1;m.startRotation3D=true;m.startRotationX=initial.x*Mathf.Deg2Rad;m.startRotationY=initial.y*Mathf.Deg2Rad;m.startRotationZ=initial.z*Mathf.Deg2Rad;
 var em=ps.emission;em.enabled=false;var sh=ps.shape;sh.enabled=true;sh.shapeType=ParticleSystemShapeType.Sphere;sh.radius=.11f;sh.alignToDirection=align;sh.randomDirectionAmount=.06f;sh.randomPositionAmount=.03f;
 ps.useAutoRandomSeed=false;ps.randomSeed=12345;ps.Simulate(0,true,true,false);ps.Emit(16);
 var particles=new ParticleSystem.Particle[16];var n=ps.GetParticles(particles);
 for(int i=0;i<n;i++){var p=particles[i];var look=Quaternion.LookRotation(p.velocity);var q=Quaternion.Euler(p.rotation3D);rows.Add(new{initial=V(initial),align,seed=p.randomSeed,position=V(p.position),velocity=V(p.velocity),rotation=V(p.rotation3D),look=V(look.eulerAngles),post=Quaternion.Angle(q,look*Quaternion.Euler(initial)),pre=Quaternion.Angle(q,Quaternion.Euler(initial)*look)});}
 }finally{UnityEngine.Object.DestroyImmediate(go);}}
 File.WriteAllText("OUTPUT_FILE",System.Text.Json.JsonSerializer.Serialize(new{unityVersion=Application.unityVersion,isPlaying=Application.isPlaying,rows}));return "Captured "+rows.Count;
 }
}
