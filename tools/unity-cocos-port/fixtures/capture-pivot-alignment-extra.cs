using System.Collections.Generic;
using Newtonsoft.Json;
using UnityEditor;
using UnityEngine;

// Regenerates fixtures/particle-pivot-alignment-extra-native.json through the shared Unity-MCP.
// Read-only: temporary HideAndDontSave objects; source prefabs opened with LoadPrefabContents
// only to read the renderer mesh and unloaded without saving. BakeMesh(useTransform=true):
// World simulation throughout so baked vertices are world space.
public class Script {
  static float[] V(Vector3 v) { return new[] { v.x, v.y, v.z }; }

  static object Bake(string name, Mesh source, ParticleSystemRenderMode mode, ParticleSystemRenderSpace alignment, Vector3 pivot, Vector3 size, bool size3D,
      Vector3 rotation3D, Vector3 velocity, Vector3 parentEuler, Vector3 animatedLinear, float step) {
    var cameraObject = new GameObject("c") { hideFlags = HideFlags.HideAndDontSave };
    var parent = new GameObject("p") { hideFlags = HideFlags.HideAndDontSave };
    var go = new GameObject("s") { hideFlags = HideFlags.HideAndDontSave };
    var baked = new Mesh();
    try {
      var camera = cameraObject.AddComponent<Camera>(); camera.enabled = false; camera.fieldOfView = 40;
      parent.transform.rotation = Quaternion.Euler(parentEuler); go.transform.SetParent(parent.transform, false);
      var ps = go.AddComponent<ParticleSystem>(); var r = go.GetComponent<ParticleSystemRenderer>();
      ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
      var main = ps.main; main.playOnAwake = false; main.startSpeed = 0; main.startLifetime = 100; main.simulationSpace = ParticleSystemSimulationSpace.World;
      main.startSize3D = size3D; main.startRotation3D = mode == ParticleSystemRenderMode.Mesh;
      var em = ps.emission; em.enabled = false; var sh = ps.shape; sh.enabled = false;
      if (animatedLinear != Vector3.zero) {
        var vel = ps.velocityOverLifetime; vel.enabled = true; vel.space = ParticleSystemSimulationSpace.World;
        vel.x = animatedLinear.x; vel.y = animatedLinear.y; vel.z = animatedLinear.z;
      }
      r.renderMode = mode; r.alignment = alignment; r.pivot = pivot; r.maxParticleSize = 100; r.minParticleSize = 0;
      if (source != null) r.mesh = source;
      ps.useAutoRandomSeed = false; ps.randomSeed = 1; ps.Simulate(0, true, true, false); ps.Play(true);
      var particle = new ParticleSystem.Particle { position = new Vector3(1, 0.5f, 5), velocity = velocity, startLifetime = 100, remainingLifetime = 100, startColor = Color.white };
      if (size3D) particle.startSize3D = size; else particle.startSize = size.x;
      if (mode == ParticleSystemRenderMode.Mesh) particle.rotation3D = rotation3D;
      ps.SetParticles(new[] { particle }, 1);
      if (step > 0) ps.Simulate(step, true, false, false);
      var buffer = new ParticleSystem.Particle[1]; ps.GetParticles(buffer);
      r.BakeMesh(baked, camera, true);
      var vertices = new List<float[]>(); foreach (var v in baked.vertices) vertices.Add(V(v));
      var uv = new List<float[]>(); foreach (var v in baked.uv) uv.Add(new[] { v.x, v.y });
      return new { name, mode = (int)mode, alignment = (int)alignment, pivot = V(pivot), size = V(size), size3D, rotation3D = V(rotation3D), velocity = V(velocity), parentEuler = V(parentEuler),
        animatedLinear = V(animatedLinear), step, position = V(buffer[0].position), particleVelocity = V(buffer[0].velocity), totalVelocity = V(buffer[0].totalVelocity),
        cameraRotation = new[] { 0f, 0f, 0f, 1f }, vertices, uv };
    } finally { Object.DestroyImmediate(baked); Object.DestroyImmediate(go); Object.DestroyImmediate(parent); Object.DestroyImmediate(cameraObject); }
  }

  static object MeshInfo(Mesh mesh) {
    var vs = new List<float[]>(); foreach (var v in mesh.vertices) vs.Add(V(v));
    return new { name = mesh.name, bounds = new { center = V(mesh.bounds.center), size = V(mesh.bounds.size), min = V(mesh.bounds.min), max = V(mesh.bounds.max) }, vertexCount = mesh.vertexCount, vertices = vs };
  }

  public static string Main() {
    var second = new Mesh();
    second.vertices = new[] { new Vector3(-1, 0.1f, -2), new Vector3(0.25f, 0.4f, 0.5f), new Vector3(0.1f, 0.25f, -0.7f), new Vector3(-0.5f, 0.3f, 0.2f) };
    second.triangles = new[] { 0, 1, 2, 0, 2, 3 }; second.RecalculateBounds();
    var quad = Resources.GetBuiltinResource<Mesh>("Quad.fbx");
    Mesh arrow = null; var root = PrefabUtility.LoadPrefabContents("Assets/ARPG Effects/Prefabs/Interactive/Actions/ClickMoveArrows.prefab");
    object arrowInfo;
    try {
      foreach (var r in root.GetComponentsInChildren<ParticleSystemRenderer>(true)) if (r.name == "Arrows") arrow = r.mesh;
      arrowInfo = arrow != null ? MeshInfo(arrow) : null;
      var rows = new List<object> {
        Bake("billboard-pivot-z-size1x2", null, ParticleSystemRenderMode.Billboard, ParticleSystemRenderSpace.View, new Vector3(0, 0, 0.5f), new Vector3(1, 2, 3), true, Vector3.zero, Vector3.zero, Vector3.zero, Vector3.zero, 0),
        Bake("billboard-pivot-z-size3x2", null, ParticleSystemRenderMode.Billboard, ParticleSystemRenderSpace.View, new Vector3(0.1f, 0.2f, 0.5f), new Vector3(3, 2, 0.5f), true, Vector3.zero, Vector3.zero, Vector3.zero, Vector3.zero, 0),
        Bake("mesh-second-bounds", second, ParticleSystemRenderMode.Mesh, ParticleSystemRenderSpace.Local, new Vector3(0.3f, -0.2f, 0.5f), new Vector3(1.5f, 0.7f, 1.2f), true, new Vector3(30, 40, 50), Vector3.zero, new Vector3(20, 35, 10), Vector3.zero, 0),
        Bake("mesh-second-zero", second, ParticleSystemRenderMode.Mesh, ParticleSystemRenderSpace.Local, Vector3.zero, new Vector3(1.5f, 0.7f, 1.2f), true, new Vector3(30, 40, 50), Vector3.zero, new Vector3(20, 35, 10), Vector3.zero, 0),
        Bake("mesh-quad-chest", quad, ParticleSystemRenderMode.Mesh, ParticleSystemRenderSpace.Local, new Vector3(0, 0.5f, 0), new Vector3(1.175f, 1.7f, 2.35f), true, new Vector3(123, -90, 90), Vector3.zero, new Vector3(-90, 0, 0), Vector3.zero, 0),
        Bake("mesh-quad-ripple-world", quad, ParticleSystemRenderMode.Mesh, ParticleSystemRenderSpace.World, Vector3.zero, new Vector3(0.3f, 0.3f, 0.3f), false, new Vector3(90, 0, 200), Vector3.zero, new Vector3(-90, 30, 0), Vector3.zero, 0),
        Bake("mesh-arrow-velocity", arrow, ParticleSystemRenderMode.Mesh, ParticleSystemRenderSpace.Velocity, new Vector3(0, 0.1f, -2), new Vector3(0.5f, 1.4f, 0.75f), true, new Vector3(-80, 0, 0), new Vector3(0.06f, 0, -0.08f), new Vector3(90, 0, 0), Vector3.zero, 0),
        Bake("mesh-velocity-animated", second, ParticleSystemRenderMode.Mesh, ParticleSystemRenderSpace.Velocity, Vector3.zero, new Vector3(1, 1, 1), true, Vector3.zero, new Vector3(1, 0, 0), Vector3.zero, new Vector3(0, 3, 0), 1f / 60f),
      };
      System.IO.File.WriteAllText("OUTPUT_FILE", JsonConvert.SerializeObject(new { unityVersion = Application.unityVersion, second = MeshInfo(second), quad = MeshInfo(quad), arrow = arrowInfo, cases = rows }));
      return "cases=" + rows.Count + " arrow=" + (arrow != null ? arrow.name : "null");
    } finally { PrefabUtility.UnloadPrefabContents(root); Object.DestroyImmediate(second); }
  }
}
