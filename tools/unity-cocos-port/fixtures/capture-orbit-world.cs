using UnityEngine;
using UnityEditor;
using Newtonsoft.Json;
using System.Collections.Generic;
public class Script {
 static float[] V(Vector3 v){return new[]{v.x,v.y,v.z};}
 static float[] M(Matrix4x4 m){var a=new float[16];for(int i=0;i<16;i++)a[i]=m[i];return a;}
 public static string Main(){
  var rows=new List<object>();
  var path="Assets/Hovl Studio/AOE Magic spells Vol.1/Prefabs/Flower slash.prefab";
  for(int pose=0;pose<3;pose++)for(int mode=0;mode<3;mode++){
   var root=Object.Instantiate(AssetDatabase.LoadAssetAtPath<GameObject>(path));root.hideFlags=HideFlags.HideAndDontSave;
   try{
    root.transform.position=pose==0?Vector3.zero:new Vector3(3,2,-4);
    root.transform.rotation=pose==0?Quaternion.identity:Quaternion.Euler(20,45,10);
    if(pose==2)root.transform.localScale=new Vector3(2,3,4);
    var ps=root.transform.Find("PTrails").GetComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);
    var em=ps.emission;em.enabled=false;
    var omega=mode==2?new Vector3(2,-3,4):new Vector3(0,15,0);
    var linear=mode==0?Vector3.zero:new Vector3(.4f,.5f,.6f);float radial=mode==0?0:.3f;
    var v=ps.velocityOverLifetime;v.orbitalX=omega.x;v.orbitalY=omega.y;v.orbitalZ=omega.z;v.x=linear.x;v.y=linear.y;v.z=linear.z;v.radial=radial;
    ps.Simulate(0,false,true,false);
    var a=new[]{new ParticleSystem.Particle{position=ps.transform.TransformPoint(new Vector3(1,.2f,.5f)),velocity=new Vector3(.1f,-.2f,.3f),startLifetime=10,remainingLifetime=10,startSize=1,randomSeed=123}};
    ps.SetParticles(a,1);var samples=new List<object>();
    for(int step=0;step<=10;step++){if(step>0){ps.Simulate(.02f,false,false,false);ps.GetParticles(a);}samples.Add(new{step,position=V(a[0].position),velocity=V(a[0].velocity)});}
    rows.Add(new{pose,mode,omega=V(omega),linear=V(linear),radial,dt=.02f,rotation=new[]{ps.transform.rotation.x,ps.transform.rotation.y,ps.transform.rotation.z,ps.transform.rotation.w},matrix=M(ps.transform.localToWorldMatrix),inverse=M(ps.transform.worldToLocalMatrix),samples});
   }finally{Object.DestroyImmediate(root);}
  }
  System.IO.File.WriteAllText("OUTPUT",JsonConvert.SerializeObject(rows,Formatting.Indented));return "Captured 9 world-orbit cases";
 }
}
