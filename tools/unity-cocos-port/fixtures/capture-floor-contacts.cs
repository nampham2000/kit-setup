using System;using System.IO;using System.Collections.Generic;using UnityEngine;using UnityEngine.SceneManagement;using UnityEditor.SceneManagement;
public class Script {
 public static string Main(){var rows=new List<object>();float[] meshPositions=null;int[] meshIndices=null;
 var scene=SceneManager.CreateScene("floor contact probe "+Guid.NewGuid(),new CreateSceneParameters(LocalPhysicsMode.Physics3D));
 try{foreach(float scale in new[]{1f,2.5f,3f})foreach(float z in new[]{0f,1e-9f,-1e-9f,3e-8f,-3e-8f,1e-7f,-1e-7f,2.5e-7f,-2.5e-7f,1e-6f,-1e-6f,.01f})foreach(bool frozen in new[]{true,false})foreach(bool translate in new[]{false,true}){
 try{var plane=GameObject.CreatePrimitive(PrimitiveType.Plane);SceneManager.MoveGameObjectToScene(plane,scene);plane.transform.localScale=Vector3.one*scale;
 if(meshPositions==null){var mesh=plane.GetComponent<MeshFilter>().sharedMesh;var vertices=mesh.vertices;meshPositions=new float[vertices.Length*3];for(int j=0;j<vertices.Length;j++){meshPositions[j*3]=vertices[j].x;meshPositions[j*3+1]=vertices[j].y;meshPositions[j*3+2]=vertices[j].z;}meshIndices=mesh.triangles;}
 var sphere=new GameObject("frozen projectile");SceneManager.MoveGameObjectToScene(sphere,scene);sphere.AddComponent<SphereCollider>().radius=.5f;var body=sphere.AddComponent<Rigidbody>();body.useGravity=false;body.constraints=frozen?RigidbodyConstraints.FreezeAll:RigidbodyConstraints.None;
 var observerType=Type.GetType("FloorContactObserver, Assembly-CSharp");if(observerType==null)throw new Exception("Import Assets/FloorContactObserver.cs before running");var observer=sphere.AddComponent(observerType);var eventList=(List<object>)observerType.GetField("events").GetValue(observer);var samples=new List<object>();var physics=scene.GetPhysicsScene();
 sphere.transform.position=new Vector3(0,0,z);sphere.transform.rotation=Quaternion.Euler(0,90,0);
 for(int i=0;i<20;i++){observerType.GetField("step").SetValue(observer,i);if(translate){if(i>0)sphere.transform.Translate(0,0,-.4f);}else sphere.transform.position=new Vector3(-.4f*i,0,z);Physics.SyncTransforms();physics.Simulate(.02f);samples.Add(new{step=i,position=new[]{sphere.transform.position.x,sphere.transform.position.y,sphere.transform.position.z}});}
 rows.Add(new{scale,z,frozen,translate,events=eventList,samples});
 }finally{foreach(var go in scene.GetRootGameObjects())UnityEngine.Object.DestroyImmediate(go);}}}
 finally{SceneManager.UnloadSceneAsync(scene);}
 File.WriteAllText("OUTPUT_FILE",System.Text.Json.JsonSerializer.Serialize(new{unityVersion=Application.unityVersion,playing=Application.isPlaying,meshPositions,meshIndices,rows}));return "floor contact rows="+rows.Count;}
}



