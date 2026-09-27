using UnityEngine;using UnityEditor;using Newtonsoft.Json;using Newtonsoft.Json.Linq;using System.Linq;using System.Collections.Generic;
public class Script {public static string Main(){
 if(!Application.dataPath.Replace('\\','/').EndsWith("/.ai/combat-magic/unity-reference/Assets"))throw new System.Exception("Owned reference only");
 var root=Object.Instantiate(AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Electro_Particles/Prefabs/Ef_FieldSphere_01.prefab"));root.transform.position=Vector3.zero;
 var cr=new GameObject("Mesh diagnostic camera");var cam=cr.AddComponent<Camera>();cam.enabled=false;cam.transform.position=new Vector3(0,0,-20);cam.orthographic=true;cam.orthographicSize=10;
 var rows=new List<object>();try {foreach(var ps in root.GetComponentsInChildren<ParticleSystem>()){
 ps.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);ps.Simulate(0,false,true,false);
 var p=new ParticleSystem.Particle{position=Vector3.zero,startSize3D=Vector3.one*4,startColor=Color.white,startLifetime=1,remainingLifetime=.65f,rotation3D=new Vector3(0,0,-127.533676f)};ps.SetParticles(new[]{p},1);
 var r=ps.GetComponent<ParticleSystemRenderer>();var mesh=new Mesh();r.BakeMesh(mesh,cam,true);
 rows.Add(new{name=ps.name,mode=r.renderMode.ToString(),vertices=mesh.vertices.Select(v=>new[]{v.x,v.y,v.z}).ToArray(),uvs=mesh.uv.Select(v=>new[]{v.x,v.y}).ToArray(),indices=mesh.triangles});Object.DestroyImmediate(mesh);
 }}finally{Object.DestroyImmediate(root);Object.DestroyImmediate(cr);}
 System.IO.File.WriteAllText("OUTPUT_FILE",JsonConvert.SerializeObject(rows));return "Captured field geometry";
}}
