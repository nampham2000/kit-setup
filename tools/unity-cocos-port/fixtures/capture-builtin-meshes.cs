using UnityEngine;using UnityEditor;using Newtonsoft.Json;using System.Linq;using System.Collections.Generic;
public class Script {public static string Main(){
 if(!Application.dataPath.Replace('\\','/').EndsWith("/.ai/combat-magic/unity-reference/Assets"))throw new System.Exception("Owned reference only");
 var rows=new List<object>();foreach(var type in new[]{PrimitiveType.Sphere,PrimitiveType.Capsule,PrimitiveType.Cylinder,PrimitiveType.Cube,PrimitiveType.Plane,PrimitiveType.Quad}){
  var root=GameObject.CreatePrimitive(type);try{var m=root.GetComponent<MeshFilter>().sharedMesh;string guid;long id;AssetDatabase.TryGetGUIDAndLocalFileIdentifier(m,out guid,out id);
   rows.Add(new{name=type.ToString(),guid,fileID=id,positions=m.vertices.SelectMany(v=>new[]{v.x,v.y,v.z}).ToArray(),normals=m.normals.SelectMany(v=>new[]{v.x,v.y,v.z}).ToArray(),uvs=m.uv.SelectMany(v=>new[]{v.x,v.y}).ToArray(),indices=m.triangles});
  }finally{Object.DestroyImmediate(root);}
 }
 System.IO.File.WriteAllText("OUTPUT_FILE",JsonConvert.SerializeObject(new{unityVersion=Application.unityVersion,meshes=rows}));return "Captured six native primitive meshes and UVs";
}}
