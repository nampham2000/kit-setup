using System.Collections.Generic;
using Newtonsoft.Json;
using UnityEngine;

// Regenerates fixtures/particle-pivot-alignment-native.json through the shared Unity-MCP:
//   node playable-shared-kit/tools/unity-intel/unity-mcp-script.cjs --project <Unity> --script <this file> --out <fixture.json>
// Read-only: every object and mesh is HideAndDontSave/temporary and destroyed.
// One particle per case is baked with ParticleSystemRenderer.BakeMesh(useTransform=true)
// against a camera at the origin (fov 40, 1280x720) so vertices are world space.
// Mesh cases use a synthetic asymmetric mesh; billboard cases tag corners with UV.
public class Script {
  static float[] V(Vector3 v) { return new[] { v.x, v.y, v.z }; }

  class Case {
    public string name; public ParticleSystemRenderMode mode = ParticleSystemRenderMode.Mesh;
    public ParticleSystemRenderSpace alignment = ParticleSystemRenderSpace.Local;
    public Vector3 pivot, parentEuler, parentPosition, position = new Vector3(1, 0.5f, 5), velocity, rotation3D, size = Vector3.one, parentScale = Vector3.one;
    public bool local = false, size3D = true, rotation3DOn = true; public float rotation2D;
    public Vector3 cameraEuler; public Vector3 cameraPosition;
  }

  static Mesh Asymmetric() {
    var mesh = new Mesh();
    mesh.vertices = new[] { new Vector3(1, 0, 0), new Vector3(0, 2, 0), new Vector3(0, 0, 3), new Vector3(0.5f, -0.25f, 0.75f) };
    mesh.uv = new[] { new Vector2(0, 0), new Vector2(1, 0), new Vector2(0, 1), new Vector2(1, 1) };
    mesh.triangles = new[] { 0, 1, 2, 0, 2, 3 };
    mesh.RecalculateNormals(); mesh.RecalculateBounds();
    return mesh;
  }

  static object Run(Case c, Mesh source) {
    var cameraObject = new GameObject("pivot-camera") { hideFlags = HideFlags.HideAndDontSave };
    var parent = new GameObject("pivot-parent") { hideFlags = HideFlags.HideAndDontSave };
    var systemObject = new GameObject("pivot-system") { hideFlags = HideFlags.HideAndDontSave };
    var target = new RenderTexture(1280, 720, 24); var baked = new Mesh();
    try {
      var camera = cameraObject.AddComponent<Camera>();
      camera.enabled = false; camera.fieldOfView = 40; camera.nearClipPlane = 0.3f; camera.farClipPlane = 1000; camera.targetTexture = target;
      cameraObject.transform.position = c.cameraPosition; cameraObject.transform.rotation = Quaternion.Euler(c.cameraEuler);
      parent.transform.position = c.parentPosition; parent.transform.rotation = Quaternion.Euler(c.parentEuler); parent.transform.localScale = c.parentScale;
      systemObject.transform.SetParent(parent.transform, false);
      var ps = systemObject.AddComponent<ParticleSystem>(); var r = systemObject.GetComponent<ParticleSystemRenderer>();
      ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
      var main = ps.main; main.playOnAwake = false; main.startSpeed = 0; main.startLifetime = 100; main.maxParticles = 4;
      main.simulationSpace = c.local ? ParticleSystemSimulationSpace.Local : ParticleSystemSimulationSpace.World;
      main.scalingMode = ParticleSystemScalingMode.Hierarchy; main.startSize3D = c.size3D; main.startRotation3D = c.rotation3DOn;
      var emission = ps.emission; emission.enabled = false; var shape = ps.shape; shape.enabled = false;
      r.renderMode = c.mode; r.alignment = c.alignment; r.pivot = c.pivot; r.minParticleSize = 0; r.maxParticleSize = 100;
      r.lengthScale = 2; r.velocityScale = 0; r.cameraVelocityScale = 0;
      if (c.mode == ParticleSystemRenderMode.Mesh) r.mesh = source;
      ps.Simulate(0, true, true, false); ps.Play(true);
      var particle = new ParticleSystem.Particle { position = c.position, velocity = c.velocity, startLifetime = 100, remainingLifetime = 100, startColor = Color.white };
      if (c.size3D) particle.startSize3D = c.size; else particle.startSize = c.size.x;
      if (c.rotation3DOn) particle.rotation3D = c.rotation3D; else particle.rotation = c.rotation2D;
      ps.SetParticles(new[] { particle }, 1);
      r.BakeMesh(baked, camera, true);
      var vertices = new List<float[]>(); foreach (var v in baked.vertices) vertices.Add(V(v));
      var uv = new List<float[]>(); foreach (var v in baked.uv) uv.Add(new[] { v.x, v.y });
      return new { c.name, mode = (int)c.mode, alignment = (int)c.alignment, pivot = V(c.pivot), parentEuler = V(c.parentEuler), parentPosition = V(c.parentPosition), parentScale = V(c.parentScale),
        position = V(c.position), velocity = V(c.velocity), rotation3D = V(c.rotation3D), c.rotation3DOn, c.rotation2D, size = V(c.size), c.size3D, c.local,
        cameraEuler = V(c.cameraEuler), cameraPosition = V(c.cameraPosition),
        cameraRotation = new[] { cameraObject.transform.rotation.x, cameraObject.transform.rotation.y, cameraObject.transform.rotation.z, cameraObject.transform.rotation.w },
        systemRotation = new[] { systemObject.transform.rotation.x, systemObject.transform.rotation.y, systemObject.transform.rotation.z, systemObject.transform.rotation.w },
        vertices, uv };
    } finally {
      Object.DestroyImmediate(baked); target.Release(); Object.DestroyImmediate(target);
      Object.DestroyImmediate(systemObject); Object.DestroyImmediate(parent); Object.DestroyImmediate(cameraObject);
    }
  }

  public static string Main() {
    var source = Asymmetric();
    var cases = new List<Case>();
    // Mesh Local alignment: pivot per axis and combined, rotated/scaled parent, size3D, rotation3D.
    foreach (var pivot in new[] { Vector3.zero, new Vector3(0, 0.5f, 0), new Vector3(0.3f, 0, 0), new Vector3(0, 0, 0.4f), new Vector3(0.2f, -0.3f, 0.5f) })
      foreach (var parentEuler in new[] { Vector3.zero, new Vector3(-90, 0, 0), new Vector3(20, 35, 10) })
        cases.Add(new Case { name = "mesh-local", alignment = ParticleSystemRenderSpace.Local, pivot = pivot, parentEuler = parentEuler, rotation3D = new Vector3(30, 40, 50), size = new Vector3(1.175f, 1.7f, 2.35f) });
    cases.Add(new Case { name = "mesh-local-scaled-parent", alignment = ParticleSystemRenderSpace.Local, pivot = new Vector3(0.2f, -0.3f, 0.5f), parentEuler = new Vector3(20, 35, 10), parentScale = new Vector3(2, 0.5f, 1.5f), rotation3D = new Vector3(30, 40, 50), size = new Vector3(1.175f, 1.7f, 2.35f), local = true, position = new Vector3(0.3f, 0.2f, 0.1f), parentPosition = new Vector3(0, 0, 6) });
    cases.Add(new Case { name = "mesh-local-chest", alignment = ParticleSystemRenderSpace.Local, pivot = new Vector3(0, 0.5f, 0), parentEuler = new Vector3(-90, 0, 0), rotation3D = new Vector3(123, -90, 90), size = new Vector3(1.175f, 1.7f, 2.35f), local = true, position = Vector3.zero, parentPosition = new Vector3(0, -1, 6) });
    // Mesh World alignment under rotated parents (Rain/DrippingWater ripple: X 90).
    foreach (var parentEuler in new[] { Vector3.zero, new Vector3(-90, 0, 0), new Vector3(20, 35, 10) }) {
      cases.Add(new Case { name = "mesh-world", alignment = ParticleSystemRenderSpace.World, parentEuler = parentEuler, rotation3D = new Vector3(90, 0, 200), size = new Vector3(0.3f, 0.3f, 0.3f), size3D = false, local = true, position = new Vector3(0.1f, 0.2f, 0.3f), parentPosition = new Vector3(0, 0, 6) });
      cases.Add(new Case { name = "mesh-world-pivot", alignment = ParticleSystemRenderSpace.World, pivot = new Vector3(0.2f, -0.3f, 0.5f), parentEuler = parentEuler, rotation3D = new Vector3(30, 40, 50), size = new Vector3(1.175f, 1.7f, 2.35f), local = true, position = new Vector3(0.1f, 0.2f, 0.3f), parentPosition = new Vector3(0, 0, 6) });
    }
    cases.Add(new Case { name = "mesh-world-scaled", alignment = ParticleSystemRenderSpace.World, parentEuler = new Vector3(20, 35, 10), parentScale = new Vector3(2, 0.5f, 1.5f), rotation3D = new Vector3(30, 40, 50), size = new Vector3(1.175f, 1.7f, 2.35f), local = true, position = new Vector3(0.1f, 0.2f, 0.3f), parentPosition = new Vector3(0, 0, 6) });
    // Mesh Velocity alignment (ClickMoveArrows: parent X +90, rotation X -80, pivot (0,0.1,-2), size3D 0.5/1.4/0.75).
    foreach (var velocity in new[] { new Vector3(1, 0, 0), new Vector3(0, 0, -1), new Vector3(0.3f, -0.5f, 0.8f), new Vector3(0, 1, 0), new Vector3(0, -0.1f, 0), new Vector3(-0.2f, 0.9f, -0.1f) })
      foreach (var rotation in new[] { Vector3.zero, new Vector3(10, 20, 30) })
        cases.Add(new Case { name = "mesh-velocity", alignment = ParticleSystemRenderSpace.Velocity, velocity = velocity, rotation3D = rotation, size = new Vector3(0.5f, 1.4f, 0.75f) });
    foreach (var parentEuler in new[] { new Vector3(90, 0, 0), new Vector3(20, 35, 10) })
      foreach (var local in new[] { true, false })
        cases.Add(new Case { name = "mesh-velocity-parent", alignment = ParticleSystemRenderSpace.Velocity, velocity = new Vector3(0.3f, -0.5f, 0.8f), rotation3D = new Vector3(-80, 0, 0), pivot = new Vector3(0, 0.1f, -2), size = new Vector3(0.5f, 1.4f, 0.75f), parentEuler = parentEuler, local = local, position = new Vector3(0.1f, 0.2f, 0.3f), parentPosition = new Vector3(0, 0, 6) });
    cases.Add(new Case { name = "mesh-velocity-pivot", alignment = ParticleSystemRenderSpace.Velocity, velocity = new Vector3(0.3f, -0.5f, 0.8f), rotation3D = new Vector3(10, 20, 30), pivot = new Vector3(0.2f, -0.3f, 0.5f), size = new Vector3(0.5f, 1.4f, 0.75f) });
    cases.Add(new Case { name = "mesh-velocity-zero", alignment = ParticleSystemRenderSpace.Velocity, velocity = Vector3.zero, rotation3D = new Vector3(10, 20, 30), size = new Vector3(0.5f, 1.4f, 0.75f), parentEuler = new Vector3(20, 35, 10) });
    // Billboard (View) pivot: camera-plane units of size, rotated camera and particle rotation.
    foreach (var pivot in new[] { new Vector3(0.15f, 0, 0), new Vector3(0, 0.3f, 0), new Vector3(0, 0, 0.5f), new Vector3(0.2f, -0.1f, 0.4f) })
      foreach (var rotation in new[] { 0f, 30f })
        foreach (var cameraEuler in new[] { Vector3.zero, new Vector3(25, -15, 0) })
          cases.Add(new Case { name = "billboard-view", mode = ParticleSystemRenderMode.Billboard, alignment = ParticleSystemRenderSpace.View, pivot = pivot, rotation3DOn = false, rotation2D = rotation, size = new Vector3(2, 1, 1), cameraEuler = cameraEuler });
    cases.Add(new Case { name = "billboard-view-uniform", mode = ParticleSystemRenderMode.Billboard, alignment = ParticleSystemRenderSpace.View, pivot = new Vector3(0.15f, 0, 0), rotation3DOn = false, size = new Vector3(0.05f, 0.05f, 0.05f), size3D = false });
    cases.Add(new Case { name = "billboard-view-offaxis", mode = ParticleSystemRenderMode.Billboard, alignment = ParticleSystemRenderSpace.View, pivot = new Vector3(0.2f, -0.1f, 0.4f), rotation3DOn = false, size = new Vector3(2, 1, 1), position = new Vector3(3, -2, 6), cameraEuler = new Vector3(25, -15, 0), cameraPosition = new Vector3(0.5f, 1, -1) });
    var rows = new List<object>();
    try { foreach (var c in cases) rows.Add(Run(c, source)); } finally { Object.DestroyImmediate(source); }
    System.IO.File.WriteAllText("OUTPUT_FILE", JsonConvert.SerializeObject(new { unityVersion = Application.unityVersion, sourceMesh = new[] { new[] { 1f, 0, 0 }, new[] { 0f, 2, 0 }, new[] { 0f, 0, 3 }, new[] { 0.5f, -0.25f, 0.75f } }, cases = rows }));
    return "cases=" + rows.Count;
  }
}
