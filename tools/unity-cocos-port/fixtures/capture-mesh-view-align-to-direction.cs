using System.Collections.Generic;
using Newtonsoft.Json;
using UnityEditor;
using UnityEngine;

// Regenerates fixtures/mesh-view-align-to-direction-native.json through the shared Unity-MCP.
// Read-only probe: does Unity's Mesh render mode with Render Alignment View use the camera frame?
// Temporary HideAndDontSave objects only; nothing in the project is modified.
public class Script {
  static float[] V(Vector3 v) { return new[] { v.x, v.y, v.z }; }

  static object Bake(string name, ParticleSystemRenderSpace alignment, Vector3 cameraEuler, bool alignToDirection) {
    var cameraObject = new GameObject("c") { hideFlags = HideFlags.HideAndDontSave };
    var parent = new GameObject("p") { hideFlags = HideFlags.HideAndDontSave };
    var go = new GameObject("s") { hideFlags = HideFlags.HideAndDontSave };
    var baked = new Mesh();
    try {
      var camera = cameraObject.AddComponent<Camera>(); camera.enabled = false;
      cameraObject.transform.rotation = Quaternion.Euler(cameraEuler); cameraObject.transform.position = new Vector3(0, 3, -6);
      parent.transform.rotation = Quaternion.Euler(-90, 0, 0); go.transform.SetParent(parent.transform, false);
      var ps = go.AddComponent<ParticleSystem>(); var r = go.GetComponent<ParticleSystemRenderer>();
      ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
      var main = ps.main; main.playOnAwake = false; main.startSpeed = 1; main.startLifetime = 100; main.startSize = 1;
      main.simulationSpace = ParticleSystemSimulationSpace.Local; main.maxParticles = 8;
      var em = ps.emission; em.enabled = false;
      var sh = ps.shape; sh.enabled = true; sh.shapeType = ParticleSystemShapeType.Circle; sh.radius = 1; sh.radiusThickness = 0;
      sh.arcMode = ParticleSystemShapeMultiModeValue.BurstSpread; sh.arc = 360; sh.alignToDirection = alignToDirection;
      r.renderMode = ParticleSystemRenderMode.Mesh; r.alignment = alignment; r.mesh = Resources.GetBuiltinResource<Mesh>("Quad.fbx");
      r.maxParticleSize = 100;
      ps.useAutoRandomSeed = false; ps.randomSeed = 1; ps.Emit(4); ps.Simulate(0, true, false, false);
      var buffer = new ParticleSystem.Particle[4]; var n = ps.GetParticles(buffer);
      var particles = new List<object>();
      for (var i = 0; i < n; i++) particles.Add(new { position = V(buffer[i].position), velocity = V(buffer[i].velocity), rotation3D = V(buffer[i].rotation3D) });
      r.BakeMesh(baked, camera, true);
      var vertices = new List<float[]>(); foreach (var v in baked.vertices) vertices.Add(V(v));
      return new { name, alignment = (int)alignment, cameraEuler = V(cameraEuler), alignToDirection, parentEuler = new[] { -90f, 0f, 0f }, particles, vertices };
    } finally { Object.DestroyImmediate(baked); Object.DestroyImmediate(go); Object.DestroyImmediate(parent); Object.DestroyImmediate(cameraObject); }
  }

  public static string Main() {
    var rows = new List<object> {
      Bake("view-cam-identity", ParticleSystemRenderSpace.View, Vector3.zero, true),
      Bake("view-cam-rotated", ParticleSystemRenderSpace.View, new Vector3(30, 45, 0), true),
      Bake("view-cam-rotated-noalign", ParticleSystemRenderSpace.View, new Vector3(30, 45, 0), false),
      Bake("local-cam-rotated", ParticleSystemRenderSpace.Local, new Vector3(30, 45, 0), true),
      Bake("world-cam-rotated", ParticleSystemRenderSpace.World, new Vector3(30, 45, 0), true),
    };
    System.IO.File.WriteAllText("OUTPUT_FILE", JsonConvert.SerializeObject(new { unityVersion = Application.unityVersion, cases = rows }));
    return "cases=" + rows.Count;
  }
}
