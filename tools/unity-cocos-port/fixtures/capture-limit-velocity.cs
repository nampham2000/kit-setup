using System.Globalization;
using System.Text;
using UnityEngine;

// Regenerates fixtures/limit-velocity-native.json through the shared Unity-MCP:
//   node playable-shared-kit/tools/unity-intel/unity-mcp-script.cjs --project <Unity> --script <this file> --out <fixture.json>
// Read-only: every object is HideAndDontSave and destroyed; no asset or scene is touched.
// One particle per case is stepped with ParticleSystem.Simulate and read back after each step.
public class Script {
  static string F(float v) { return v.ToString("0.######", CultureInfo.InvariantCulture); }
  static string V(Vector3 v) { return "[" + F(v.x) + "," + F(v.y) + "," + F(v.z) + "]"; }

  static string Run(string name, bool separate, Vector3 limit, float dampen, Vector3 v0, float dt, int steps) {
    var go = new GameObject("limit-velocity-particle") { hideFlags = HideFlags.HideAndDontSave };
    try {
      var system = go.AddComponent<ParticleSystem>();
      system.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
      var main = system.main; main.playOnAwake = false; main.simulationSpace = ParticleSystemSimulationSpace.World;
      main.startLifetime = 100; main.startSpeed = 0; main.maxParticles = 4;
      var emission = system.emission; emission.enabled = false;
      var shape = system.shape; shape.enabled = false;
      var limitModule = system.limitVelocityOverLifetime;
      limitModule.enabled = true; limitModule.separateAxes = separate; limitModule.dampen = dampen; limitModule.drag = 0;
      if (separate) {
        limitModule.space = ParticleSystemSimulationSpace.World;
        limitModule.limitX = new ParticleSystem.MinMaxCurve(limit.x);
        limitModule.limitY = new ParticleSystem.MinMaxCurve(limit.y);
        limitModule.limitZ = new ParticleSystem.MinMaxCurve(limit.z);
      } else limitModule.limit = new ParticleSystem.MinMaxCurve(limit.x);
      system.Simulate(0, true, true, false);
      system.Play(true);
      var buffer = new[] { new ParticleSystem.Particle {
        position = Vector3.zero, velocity = v0, startLifetime = 100, remainingLifetime = 100, startSize = 1, startColor = Color.white,
      } };
      system.SetParticles(buffer, 1);
      var json = new StringBuilder();
      json.Append("{\"case\":\"").Append(name).Append("\",\"separateAxes\":").Append(separate ? "true" : "false")
        .Append(",\"limit\":").Append(V(limit)).Append(",\"dampen\":").Append(F(dampen)).Append(",\"dt\":").Append(F(dt))
        .Append(",\"startVelocity\":").Append(V(v0)).Append(",\"velocity\":[");
      for (int i = 0; i < steps; i++) {
        system.Simulate(dt, true, false, false);
        system.GetParticles(buffer, 1);
        json.Append(i > 0 ? "," : "").Append(V(buffer[0].velocity));
      }
      return json.Append("],\"position\":").Append(V(buffer[0].position)).Append('}').ToString();
    } finally {
      Object.DestroyImmediate(go);
    }
  }

  public static string Main() {
    var rows = new[] {
      Run("spikes-magnitude-60fps", false, new Vector3(0.5f, 0, 0), 0.15f, new Vector3(10, 0, 0), 1f / 60f, 12),
      Run("spikes-magnitude-30fps", false, new Vector3(0.5f, 0, 0), 0.15f, new Vector3(10, 0, 0), 1f / 30f, 6),
      Run("oblique-magnitude-60fps", false, new Vector3(0.5f, 0, 0), 0.15f, new Vector3(6, 8, 0), 1f / 60f, 6),
      Run("dustring-zero-limit-60fps", false, Vector3.zero, 0.1f, new Vector3(-8, 0, 0), 1f / 60f, 12),
      Run("dustring-zero-limit-30fps", false, Vector3.zero, 0.1f, new Vector3(-8, 0, 0), 1f / 30f, 6),
      Run("hard-clamp", false, new Vector3(0.5f, 0, 0), 1f, new Vector3(10, 0, 0), 1f / 60f, 2),
      Run("no-dampen", false, new Vector3(0.5f, 0, 0), 0f, new Vector3(10, 0, 0), 1f / 60f, 2),
      Run("below-limit", false, new Vector3(20, 0, 0), 0.15f, new Vector3(10, 0, 0), 1f / 60f, 2),
      Run("separate-axes-60fps", true, new Vector3(0.5f, 2, 1), 0.15f, new Vector3(10, 5, -3), 1f / 60f, 6),
      Run("separate-axes-30fps", true, new Vector3(0.5f, 2, 1), 0.15f, new Vector3(10, 5, -3), 1f / 30f, 3),
    };
    System.IO.File.WriteAllText("OUTPUT_FILE", "[" + string.Join(",", rows) + "]");
    return "cases=" + rows.Length;
  }
}
