using System.Collections.Generic;
using System.Globalization;
using System.Text;
using UnityEngine;

// Regenerates fixtures/particle-size-clamp-native.json through the shared Unity-MCP:
//   node playable-shared-kit/tools/unity-intel/unity-mcp-script.cjs --project <Unity> --script <this file> --out <fixture.json>
// Read-only: every object is HideAndDontSave and destroyed; no asset or scene is touched.
// One particle per case is baked with ParticleSystemRenderer.BakeMesh against a camera at
// the origin looking +Z (fov 40, target 1280x720 unless the case says otherwise).
public class Script {
  static string F(float v) { return v.ToString("0.#####", CultureInfo.InvariantCulture); }

  struct Case {
    public string name; public ParticleSystemRenderMode mode; public float min, max, lengthScale;
    public Vector3 position, velocity; public Vector2 size; public int width, height; public bool ortho; public int[] axes;
    public Case(string name, ParticleSystemRenderMode mode, float min, float max, Vector2 size, Vector3 position, Vector3 velocity, int[] axes, float lengthScale = 2, int width = 1280, int height = 720, bool ortho = false) {
      this.name = name; this.mode = mode; this.min = min; this.max = max; this.size = size; this.position = position; this.velocity = velocity;
      this.axes = axes; this.lengthScale = lengthScale; this.width = width; this.height = height; this.ortho = ortho;
    }
  }

  public static string Main() {
    var z5 = new Vector3(0, 0, 5); var x = new Vector3(1, 0, 0); var none = Vector3.zero;
    var billboard = new[] { 0, 1 }; var stretchedX = new[] { 1, 0 };
    var cases = new List<Case> {
      new Case("billboard-unclamped", ParticleSystemRenderMode.Billboard, 0, 5, new Vector2(10, 10), z5, none, billboard),
      new Case("billboard-landscape", ParticleSystemRenderMode.Billboard, 0, 0.5f, new Vector2(10, 10), z5, none, billboard),
      new Case("billboard-portrait", ParticleSystemRenderMode.Billboard, 0, 0.5f, new Vector2(10, 10), z5, none, billboard, 2, 720, 1280),
      new Case("billboard-depth20", ParticleSystemRenderMode.Billboard, 0, 0.5f, new Vector2(10, 10), new Vector3(0, 0, 20), none, billboard),
      new Case("billboard-offaxis-x3", ParticleSystemRenderMode.Billboard, 0, 0.5f, new Vector2(10, 10), new Vector3(3, 0, 5), none, billboard),
      new Case("billboard-max0.25", ParticleSystemRenderMode.Billboard, 0, 0.25f, new Vector2(10, 10), z5, none, billboard),
      new Case("billboard-size3d-10x2", ParticleSystemRenderMode.Billboard, 0, 0.5f, new Vector2(10, 2), z5, none, billboard),
      new Case("billboard-size3d-2x10", ParticleSystemRenderMode.Billboard, 0, 0.5f, new Vector2(2, 10), z5, none, billboard),
      new Case("billboard-min0.1", ParticleSystemRenderMode.Billboard, 0.1f, 5, new Vector2(0.001f, 0.001f), z5, none, billboard),
      new Case("billboard-min0.3-max0.5", ParticleSystemRenderMode.Billboard, 0.3f, 0.5f, new Vector2(0.01f, 0.01f), z5, none, billboard),
      new Case("billboard-ortho-size5", ParticleSystemRenderMode.Billboard, 0, 0.5f, new Vector2(10, 10), z5, none, billboard, 2, 1280, 720, true),
      new Case("stretched-max0.5", ParticleSystemRenderMode.Stretch, 0, 0.5f, new Vector2(10, 10), z5, x, stretchedX),
      new Case("stretched-unclamped", ParticleSystemRenderMode.Stretch, 0, 5, new Vector2(10, 10), z5, x, stretchedX),
      new Case("stretched-size3d-1x2", ParticleSystemRenderMode.Stretch, 0, 0.5f, new Vector2(1, 2), z5, x, stretchedX, 1),
      new Case("stretched-size3d-10x1", ParticleSystemRenderMode.Stretch, 0, 0.5f, new Vector2(10, 1), z5, x, stretchedX, 1),
      new Case("stretched-size3d-1x10", ParticleSystemRenderMode.Stretch, 0, 0.5f, new Vector2(1, 10), z5, x, stretchedX, 1),
      new Case("stretched-depth20-velY", ParticleSystemRenderMode.Stretch, 0, 0.5f, new Vector2(10, 10), new Vector3(0, 0, 20), new Vector3(0, 1, 0), billboard),
      new Case("horizontal-max0.5-depth8", ParticleSystemRenderMode.HorizontalBillboard, 0, 0.5f, new Vector2(10, 10), new Vector3(0, -2, 8), none, new[] { 0, 2 }),
      new Case("vertical-max0.5", ParticleSystemRenderMode.VerticalBillboard, 0, 0.5f, new Vector2(10, 10), z5, none, billboard),
      new Case("mesh-max0.5", ParticleSystemRenderMode.Mesh, 0, 0.5f, new Vector2(10, 10), z5, none, billboard),
    };
    var json = new StringBuilder("[");
    var quad = Resources.GetBuiltinResource<Mesh>("Quad.fbx");
    {
      foreach (var c in cases) {
        var cameraObject = new GameObject("size-clamp-camera") { hideFlags = HideFlags.HideAndDontSave };
        var systemObject = new GameObject("size-clamp-particle") { hideFlags = HideFlags.HideAndDontSave };
        var target = new RenderTexture(c.width, c.height, 24);
        var mesh = new Mesh();
        try {
          var camera = cameraObject.AddComponent<Camera>();
          camera.enabled = false; camera.fieldOfView = 40; camera.nearClipPlane = 0.3f; camera.farClipPlane = 1000;
          camera.orthographic = c.ortho; camera.orthographicSize = 5; camera.targetTexture = target;
          var system = systemObject.AddComponent<ParticleSystem>();
          var renderer = systemObject.GetComponent<ParticleSystemRenderer>();
          system.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
          var main = system.main; main.playOnAwake = false; main.simulationSpace = ParticleSystemSimulationSpace.World;
          main.startLifetime = 100; main.startSpeed = 0; main.maxParticles = 4; main.startSize3D = c.size.x != c.size.y;
          var emission = system.emission; emission.enabled = false;
          var shape = system.shape; shape.enabled = false;
          renderer.renderMode = c.mode; renderer.minParticleSize = c.min; renderer.maxParticleSize = c.max;
          renderer.lengthScale = c.lengthScale; renderer.velocityScale = 0; renderer.cameraVelocityScale = 0;
          renderer.alignment = ParticleSystemRenderSpace.View;
          if (c.mode == ParticleSystemRenderMode.Mesh) renderer.mesh = quad;
          system.Simulate(0, true, true, false);
          system.Play(true);
          var particle = new ParticleSystem.Particle {
            position = c.position, velocity = c.velocity, startLifetime = 100, remainingLifetime = 100, startColor = Color.white, rotation = 0,
          };
          if (main.startSize3D) particle.startSize3D = new Vector3(c.size.x, c.size.y, 1); else particle.startSize = c.size.x;
          system.SetParticles(new[] { particle }, 1);
          renderer.BakeMesh(mesh, camera, ParticleSystemBakeMeshOptions.Default);
          var depth = Mathf.Abs(camera.worldToCameraMatrix.MultiplyPoint3x4(c.position).z);
          var viewportWidth = (c.ortho ? 2 * camera.orthographicSize : 2 * depth * Mathf.Tan(camera.fieldOfView * 0.5f * Mathf.Deg2Rad)) * camera.aspect;
          if (json.Length > 1) json.Append(',');
          json.Append("{\"case\":\"").Append(c.name).Append("\",\"mode\":").Append((int)c.mode)
            .Append(",\"min\":").Append(F(c.min)).Append(",\"max\":").Append(F(c.max))
            .Append(",\"size\":[").Append(F(c.size.x)).Append(',').Append(F(c.size.y)).Append("],\"viewportWidth\":").Append(F(viewportWidth))
            .Append(",\"axes\":[").Append(c.axes[0]).Append(',').Append(c.axes[1]).Append(']');
          if (c.mode == ParticleSystemRenderMode.Stretch) json.Append(",\"lengthScale\":").Append(F(c.lengthScale));
          json.Append(",\"vertices\":[");
          var vertices = mesh.vertices;
          for (int i = 0; i < vertices.Length; i++) json.Append(i > 0 ? "," : "").Append('[').Append(F(vertices[i].x)).Append(',').Append(F(vertices[i].y)).Append(',').Append(F(vertices[i].z)).Append(']');
          json.Append("]}");
        } finally {
          Object.DestroyImmediate(mesh); target.Release(); Object.DestroyImmediate(target);
          Object.DestroyImmediate(systemObject); Object.DestroyImmediate(cameraObject);
        }
      }
    }
    System.IO.File.WriteAllText("OUTPUT_FILE", json.Append(']').ToString());
    return "cases=" + cases.Count;
  }
}
