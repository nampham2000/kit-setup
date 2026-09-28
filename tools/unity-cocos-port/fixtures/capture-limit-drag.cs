using System.Globalization;
using System.Text;
using UnityEngine;

// Regenerates fixtures/limit-drag-native.json through the shared Unity-MCP:
//   npm run unity:script -- --project <Unity> --script <this file>   (writes OUTPUT_FILE)
// Read-only: every object is HideAndDontSave and destroyed; no asset or scene is touched.
// One particle per case is stepped with ParticleSystem.Simulate and its velocity read back after
// each step: Limit Velocity over Lifetime drag, with and without multiplyDragByParticleSize /
// multiplyDragByParticleVelocity, several sizes, speeds, frame rates, a drag curve and a dampened
// limit combined with drag.
public class Script {
  static string F(float v) { return v.ToString("0.#######", CultureInfo.InvariantCulture); }
  static string V(Vector3 v) { return "[" + F(v.x) + "," + F(v.y) + "," + F(v.z) + "]"; }

  static string Run(string name, float drag, bool bySize, bool byVelocity, float size, Vector3 v0, float dt, int steps,
      float limit = 1000f, float dampen = 0f, bool dragCurve = false, bool size3D = false, Vector3 size3 = default(Vector3),
      bool sizeCurve = false, float animatedX = 0f) {
    var go = new GameObject("limit-drag-particle") { hideFlags = HideFlags.HideAndDontSave };
    try {
      var system = go.AddComponent<ParticleSystem>();
      system.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
      var main = system.main; main.playOnAwake = false; main.simulationSpace = ParticleSystemSimulationSpace.World;
      main.startLifetime = 10; main.startSpeed = 0; main.maxParticles = 4; main.startSize3D = size3D;
      var emission = system.emission; emission.enabled = false;
      var shape = system.shape; shape.enabled = false;
      var lm = system.limitVelocityOverLifetime;
      lm.enabled = true; lm.separateAxes = false; lm.dampen = dampen; lm.limit = new ParticleSystem.MinMaxCurve(limit);
      if (dragCurve) lm.drag = new ParticleSystem.MinMaxCurve(drag, AnimationCurve.Linear(0f, 1f, 1f, 0f));
      else lm.drag = new ParticleSystem.MinMaxCurve(drag);
      lm.multiplyDragByParticleSize = bySize; lm.multiplyDragByParticleVelocity = byVelocity;
      if (sizeCurve) { var sol = system.sizeOverLifetime; sol.enabled = true; sol.size = new ParticleSystem.MinMaxCurve(1f, AnimationCurve.Linear(0f, 1f, 1f, 0f)); }
      if (animatedX != 0f) {
        var vol = system.velocityOverLifetime; vol.enabled = true; vol.space = ParticleSystemSimulationSpace.World;
        vol.x = new ParticleSystem.MinMaxCurve(animatedX); vol.y = new ParticleSystem.MinMaxCurve(0f); vol.z = new ParticleSystem.MinMaxCurve(0f);
      }
      system.Simulate(0, true, true, false);
      system.Play(true);
      var p = new ParticleSystem.Particle {
        position = Vector3.zero, velocity = v0, startLifetime = 10, remainingLifetime = 10, startColor = Color.white,
      };
      if (size3D) p.startSize3D = size3; else p.startSize = size;
      var buffer = new[] { p };
      system.SetParticles(buffer, 1);
      var json = new StringBuilder();
      json.Append("{\"case\":\"").Append(name).Append("\",\"drag\":").Append(F(drag)).Append(",\"dragCurve\":").Append(dragCurve ? "\"linear-1-to-0-over-lifetime\"" : "null")
        .Append(",\"multiplyBySize\":").Append(bySize ? "true" : "false").Append(",\"multiplyByVelocity\":").Append(byVelocity ? "true" : "false")
        .Append(",\"size\":").Append(size3D ? V(size3) : F(size)).Append(",\"limit\":").Append(F(limit)).Append(",\"dampen\":").Append(F(dampen))
        .Append(",\"sizeOverLifetime\":").Append(sizeCurve ? "\"linear-1-to-0\"" : "null").Append(",\"animatedVelocityX\":").Append(F(animatedX))
        .Append(",\"startLifetime\":10,\"dt\":").Append(F(dt)).Append(",\"startVelocity\":").Append(V(v0)).Append(",\"velocity\":[");
      var pos = new StringBuilder();
      for (int i = 0; i < steps; i++) {
        system.Simulate(dt, true, false, false);
        system.GetParticles(buffer, 1);
        json.Append(i > 0 ? "," : "").Append(V(buffer[0].velocity));
        pos.Append(i > 0 ? "," : "").Append(V(buffer[0].position));
      }
      return json.Append("],\"position\":[").Append(pos).Append("]}").ToString();
    } finally {
      Object.DestroyImmediate(go);
    }
  }

  public static string Main() {
    var v = new Vector3(3, 4, 0);
    var rows = new[] {
      Run("plain-60fps", 2f, false, false, 1f, v, 1f / 60f, 20),
      Run("plain-30fps", 2f, false, false, 1f, v, 1f / 30f, 10),
      Run("plain-small-speed", 2f, false, false, 1f, new Vector3(0.3f, 0, 0), 1f / 60f, 20),
      Run("by-size-1", 2f, true, false, 1f, v, 1f / 60f, 20),
      Run("by-size-0.5", 2f, true, false, 0.5f, v, 1f / 60f, 20),
      Run("by-size-2", 0.5f, true, false, 2f, v, 1f / 60f, 20),
      Run("by-size-3d", 2f, true, false, 1f, v, 1f / 60f, 20, 1000f, 0f, false, true, new Vector3(0.5f, 1.5f, 0.2f)),
      Run("by-velocity", 0.2f, false, true, 1f, v, 1f / 60f, 20),
      Run("by-velocity-30fps", 0.2f, false, true, 1f, v, 1f / 30f, 10),
      Run("by-velocity-fast", 0.2f, false, true, 1f, new Vector3(20, 0, 0), 1f / 60f, 20),
      Run("by-both-candy-0.45", 4.71f, true, true, 0.45f, new Vector3(0, 1.3f, 0), 1f / 60f, 40),
      Run("by-both-candy-0.3-fast", 4.71f, true, true, 0.3f, new Vector3(0, 2f, 0), 1f / 60f, 40),
      Run("by-both-candy-0.6-slow", 4.71f, true, true, 0.6f, new Vector3(0.6f, 0, 0), 1f / 60f, 40),
      Run("by-both-candy-30fps", 4.71f, true, true, 0.45f, new Vector3(0, 1.3f, 0), 1f / 30f, 20),
      Run("huge-drag", 200f, false, false, 1f, v, 1f / 60f, 6),
      Run("drag-curve", 2f, false, false, 1f, v, 1f / 60f, 30, 1000f, 0f, true),
      Run("drag-with-dampen", 2f, false, false, 1f, v, 1f / 60f, 20, 1f, 0.2f),
      Run("by-size-with-size-curve", 2f, true, false, 1f, v, 1f / 60f, 30, 1000f, 0f, false, false, default(Vector3), true),
      Run("drag-with-animated-velocity", 2f, false, false, 1f, v, 1f / 60f, 20, 1000f, 0f, false, false, default(Vector3), false, 2f),
      Run("by-velocity-with-animated-velocity", 0.2f, false, true, 1f, v, 1f / 60f, 20, 1000f, 0f, false, false, default(Vector3), false, 2f),
    };
    System.IO.File.WriteAllText("OUTPUT_FILE", "[" + string.Join(",\n", rows) + "]");
    return "cases=" + rows.Length;
  }
}
