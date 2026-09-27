using UnityEngine;using UnityEditor;using Newtonsoft.Json;using Newtonsoft.Json.Linq;using System.Linq;
public class Script {public static string Main(){
 if(!Application.dataPath.Replace('\\','/').EndsWith("/.ai/combat-magic/unity-reference/Assets"))throw new System.Exception("Owned reference only");
 var m=JObject.Parse(System.IO.File.ReadAllText(System.IO.Path.GetFullPath(Application.dataPath+"/../../../../tools/electro/oracles/reference-repaired/Ef_FieldSphere_01/1280x720/manifest.json")));
 var root=Object.Instantiate(AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Electro_Particles/Prefabs/Ef_FieldSphere_01.prefab"));root.transform.position=Vector3.zero;
 try{var systems=root.GetComponentsInChildren<ParticleSystem>();for(int i=0;i<systems.Length;i++){var s=systems[i];s.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);s.useAutoRandomSeed=false;s.randomSeed=(uint)m["frames"][0]["systems"][i]["randomSeed"];s.Simulate(0,false,true,false);s.Play(false);}
 var axes=new System.Collections.Generic.List<object>();var seen=new System.Collections.Generic.HashSet<uint>();
 for(int f=0;f<=120;f++){foreach(var system in systems)system.Simulate(1f/60,false,false,false);var samples=new ParticleSystem.Particle[systems[1].particleCount];systems[1].GetParticles(samples);foreach(var x in samples)if(seen.Add(x.randomSeed))axes.Add(new{seed=x.randomSeed,position=new[]{x.position.x,x.position.y,x.position.z},axis=new[]{x.axisOfRotation.x,x.axisOfRotation.y,x.axisOfRotation.z}});}
 var cr=new GameObject("Axis probe camera");var camera=cr.AddComponent<Camera>();camera.enabled=false;camera.transform.position=new Vector3(0,0,-20);camera.orthographic=true;var mesh=new Mesh();systems[1].GetComponent<ParticleSystemRenderer>().BakeMesh(mesh,camera,true);
 var vertices=mesh.vertices.Select(v=>new[]{v.x,v.y,v.z}).ToArray();Object.DestroyImmediate(mesh);Object.DestroyImmediate(cr);
 var rows=systems.Select(s=>{var p=new ParticleSystem.Particle[s.particleCount];s.GetParticles(p);return new{name=s.name,particles=p.Select(x=>new{seed=x.randomSeed,position=new[]{x.position.x,x.position.y,x.position.z},axis=new[]{x.axisOfRotation.x,x.axisOfRotation.y,x.axisOfRotation.z},rotation=new[]{x.rotation3D.x,x.rotation3D.y,x.rotation3D.z},life=x.remainingLifetime})};}).ToArray();
 System.IO.File.WriteAllText("OUTPUT_FILE",JsonConvert.SerializeObject(new{unityVersion=Application.unityVersion,rows,vertices,axes}));return "Captured particle axes";
 }finally{Object.DestroyImmediate(root);}
}}
