using System.Collections.Generic;
using System.Globalization;
using System.Text;
using UnityEngine;

// Regenerates fixtures/axial-billboard-native.json through the shared Unity-MCP:
//   node playable-shared-kit/tools/unity-intel/unity-mcp-script.cjs --project <Unity> --script <this file> --out <fixture.json>
// Read-only: every object is HideAndDontSave and destroyed; no asset or scene is touched.
// One unclamped particle (Max Particle Size 5) per case is baked with BakeMesh against a
// camera at the origin looking +Z (fov 40, 1280x720).
public class Script {
  static string F(float v) { return v.ToString("0.#####", CultureInfo.InvariantCulture); }

  struct Case {
    public string name; public ParticleSystemRenderMode mode; public Vector2 size; public float rotation; public Vector3 position, velocity; public int[] axes;
    public Case(string name, ParticleSystemRenderMode mode, Vector2 size, float rotation, Vector3 position, Vector3 velocity, int[] axes) {
      this.name = name; this.mode = mode; this.size = size; this.rotation = rotation; this.position = position; this.velocity = velocity; this.axes = axes;
    }
  }

  public static string Main() {
    var ground = new Vector3(0, -2, 8); var front = new Vector3(0, 0, 5);
    var cases = new List<Case> {
      new Case("billboard-rotation30", ParticleSystemRenderMode.Billboard, new Vector2(10, 10), 30, front, Vector3.zero, new[] { 0, 1 }),
      new Case("horizontal", ParticleSystemRenderMode.HorizontalBillboard, new Vector2(10, 10), 0, ground, Vector3.zero, new[] { 0, 2 }),
      new Case("horizontal-rotation30", ParticleSystemRenderMode.HorizontalBillboard, new Vector2(10, 10), 30, ground, Vector3.zero, new[] { 0, 2 }),
      new Case("horizontal-size3d-6x2", ParticleSystemRenderMode.HorizontalBillboard, new Vector2(6, 2), 0, ground, Vector3.zero, new[] { 0, 2 }),
      new Case("vertical", ParticleSystemRenderMode.VerticalBillboard, new Vector2(10, 10), 0, front, Vector3.zero, new[] { 0, 1 }),
      new Case("vertical-size3d-6x2", ParticleSystemRenderMode.VerticalBillboard, new Vector2(6, 2), 0, front, Vector3.zero, new[] { 0, 1 }),
      new Case("stretched-zero-velocity", ParticleSystemRenderMode.Stretch, new Vector2(1, 1), 0, front, Vector3.zero, new[] { 1, 0 }),
    };
    var json = new StringBuilder("[");
    foreach (var c in cases) {
      var cameraObject = new GameObject("axial-billboard-camera") { hideFlags = HideFlags.HideAndDontSave };
      var systemObject = new GameObject("axial-billboard-particle") { hideFlags = HideFlags.HideAndDontSave };
      var target = new RenderTexture(1280, 720, 24);
      var mesh = new Mesh();
      try {
        var camera = cameraObject.AddComponent<Camera>();
        camera.enabled = false; camera.fieldOfView = 40; camera.nearClipPlane = 0.3f; camera.farClipPlane = 1000; camera.targetTexture = target;
        var system = systemObject.AddComponent<ParticleSystem>();
        var renderer = systemObject.GetComponent<ParticleSystemRenderer>();
        system.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
        var main = system.main; main.playOnAwake = false; main.simulationSpace = ParticleSystemSimulationSpace.World;
        main.startLifetime = 100; main.startSpeed = 0; main.maxParticles = 4; main.startSize3D = c.size.x != c.size.y;
        var emission = system.emission; emission.enabled = false;
        var shape = system.shape; shape.enabled = false;
        renderer.renderMode = c.mode; renderer.minParticleSize = 0; renderer.maxParticleSize = 5;
        renderer.lengthScale = 2; renderer.velocityScale = 0; renderer.cameraVelocityScale = 0;
        renderer.alignment = ParticleSystemRenderSpace.View;
        system.Simulate(0, true, true, false);
        system.Play(true);
        var particle = new ParticleSystem.Particle {
          position = c.position, velocity = c.velocity, startLifetime = 100, remainingLifetime = 100, startColor = Color.white, rotation = c.rotation,
        };
        if (main.startSize3D) particle.startSize3D = new Vector3(c.size.x, c.size.y, 1); else particle.startSize = c.size.x;
        system.SetParticles(new[] { particle }, 1);
        renderer.BakeMesh(mesh, camera, ParticleSystemBakeMeshOptions.Default);
        if (json.Length > 1) json.Append(',');
        json.Append("{\"case\":\"").Append(c.name).Append("\",\"mode\":").Append((int)c.mode)
          .Append(",\"size\":[").Append(F(c.size.x)).Append(',').Append(F(c.size.y)).Append("],\"rotation\":").Append(F(c.rotation))
          .Append(",\"position\":[").Append(F(c.position.x)).Append(',').Append(F(c.position.y)).Append(',').Append(F(c.position.z))
          .Append("],\"axes\":[").Append(c.axes[0]).Append(',').Append(c.axes[1]).Append("],\"vertices\":[");
        var vertices = mesh.vertices;
        for (int i = 0; i < vertices.Length; i++) json.Append(i > 0 ? "," : "").Append('[').Append(F(vertices[i].x)).Append(',').Append(F(vertices[i].y)).Append(',').Append(F(vertices[i].z)).Append(']');
        json.Append("]}");
      } finally {
        Object.DestroyImmediate(mesh); target.Release(); Object.DestroyImmediate(target);
        Object.DestroyImmediate(systemObject); Object.DestroyImmediate(cameraObject);
      }
    }
    System.IO.File.WriteAllText("OUTPUT_FILE", json.Append(']').ToString());
    return "cases=" + cases.Count;
  }
}
