using System.Collections.Generic;
using System.Globalization;
using System.Text;
using UnityEngine;

// Regenerates fixtures/orbit-velocity-space-native.json through the shared Unity-MCP:
//   npm run unity:script -- --project <Unity> --script <this file> --set OUTPUT_FILE=<json>
// Read-only: every object is HideAndDontSave and destroyed; no asset or scene is touched.
// Velocity over Lifetime `space` (inWorldSpace) with orbital/radial motion: one particle per case,
// Local and World simulation, the emitter under a rotated + non-uniformly scaled parent, velocity
// space Local vs World, radial-only / orbital+radial / linear-only / linear+radial, simulation speed.
// Positions and stored velocities are read back after every Simulate step (simulation-space values).
public class Script {
  static string F(float v) { return v.ToString("0.#######", CultureInfo.InvariantCulture); }
  static string V(Vector3 v) { return "[" + F(v.x) + "," + F(v.y) + "," + F(v.z) + "]"; }
  static string M(Matrix4x4 m) { var sb = new StringBuilder("["); for (int i = 0; i < 16; i++) sb.Append(i > 0 ? "," : "").Append(F(m[i])); return sb.Append("]").ToString(); }

  static string Run(string name, ParticleSystemSimulationSpace sim, bool worldVelocity, Vector3 orbital, float radial, Vector3 linear,
      float simSpeed, ParticleSystemScalingMode scaling, int steps, float dt) {
    var parent = new GameObject("orbit-space-parent") { hideFlags = HideFlags.HideAndDontSave };
    var go = new GameObject("orbit-space-emitter") { hideFlags = HideFlags.HideAndDontSave };
    try {
      parent.transform.position = new Vector3(1, 2, 3);
      parent.transform.rotation = Quaternion.Euler(-67, 0, 0);
      parent.transform.localScale = new Vector3(1.5f, 0.8f, 2f);
      go.transform.SetParent(parent.transform, false);
      go.transform.localPosition = new Vector3(0.5f, -0.25f, 0.4f);
      go.transform.localRotation = Quaternion.Euler(15, 30, -20);
      var ps = go.AddComponent<ParticleSystem>();
      ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
      var main = ps.main; main.playOnAwake = false; main.simulationSpace = sim; main.scalingMode = scaling;
      main.startLifetime = 10; main.startSpeed = 0; main.maxParticles = 4; main.simulationSpeed = simSpeed;
      var em = ps.emission; em.enabled = false;
      var sh = ps.shape; sh.enabled = false;
      var v = ps.velocityOverLifetime; v.enabled = true;
      v.space = worldVelocity ? ParticleSystemSimulationSpace.World : ParticleSystemSimulationSpace.Local;
      v.x = linear.x; v.y = linear.y; v.z = linear.z;
      v.orbitalX = orbital.x; v.orbitalY = orbital.y; v.orbitalZ = orbital.z; v.radial = radial;
      ps.Simulate(0, true, true, false);
      ps.Play(true);
      var local = new Vector3(0.9f, 0.3f, -0.6f);
      var start = sim == ParticleSystemSimulationSpace.World ? go.transform.TransformPoint(local) : local;
      var buf = new[] { new ParticleSystem.Particle { position = start, velocity = new Vector3(0.2f, -0.1f, 0.3f), startLifetime = 10, remainingLifetime = 10, startSize = 1, startColor = Color.white, randomSeed = 7 } };
      ps.SetParticles(buf, 1);
      var pos = new StringBuilder(); var vel = new StringBuilder();
      for (int i = 0; i < steps; i++) {
        ps.Simulate(dt, true, false, false);
        ps.GetParticles(buf, 1);
        pos.Append(i > 0 ? "," : "").Append(V(buf[0].position));
        vel.Append(i > 0 ? "," : "").Append(V(buf[0].velocity));
      }
      return "{\"case\":\"" + name + "\",\"simulationSpace\":\"" + sim + "\",\"velocitySpace\":\"" + (worldVelocity ? "World" : "Local") + "\",\"scalingMode\":\"" + scaling + "\"" +
        ",\"orbital\":" + V(orbital) + ",\"radial\":" + F(radial) + ",\"linear\":" + V(linear) + ",\"simulationSpeed\":" + F(simSpeed) + ",\"dt\":" + F(dt) +
        ",\"startPosition\":" + V(start) + ",\"startVelocity\":[0.2,-0.1,0.3]" +
        ",\"localToWorld\":" + M(go.transform.localToWorldMatrix) + ",\"worldToLocal\":" + M(go.transform.worldToLocalMatrix) +
        ",\"position\":[" + pos + "],\"velocity\":[" + vel + "]}";
    } finally {
      Object.DestroyImmediate(go); Object.DestroyImmediate(parent);
    }
  }

  public static string Main() {
    var rows = new List<string>();
    var dt = 1f / 60f;
    foreach (var sim in new[] { ParticleSystemSimulationSpace.Local, ParticleSystemSimulationSpace.World })
      foreach (var world in new[] { false, true }) {
        var tag = (sim == ParticleSystemSimulationSpace.Local ? "local" : "world") + "-sim-" + (world ? "world" : "local") + "-velocity";
        rows.Add(Run(tag + "-radial", sim, world, Vector3.zero, -2.67f, Vector3.zero, 1f, ParticleSystemScalingMode.Hierarchy, 12, dt));
        rows.Add(Run(tag + "-radial-simspeed5", sim, world, Vector3.zero, -2.67f, Vector3.zero, 5f, ParticleSystemScalingMode.Hierarchy, 12, dt));
        rows.Add(Run(tag + "-orbital-radial", sim, world, new Vector3(1.5f, -2f, 3f), 0.7f, Vector3.zero, 1f, ParticleSystemScalingMode.Hierarchy, 12, dt));
        rows.Add(Run(tag + "-linear", sim, world, Vector3.zero, 0f, new Vector3(0.4f, -0.7f, 0.9f), 1f, ParticleSystemScalingMode.Hierarchy, 12, dt));
        rows.Add(Run(tag + "-linear-radial", sim, world, Vector3.zero, -1.2f, new Vector3(0.4f, -0.7f, 0.9f), 1f, ParticleSystemScalingMode.Hierarchy, 12, dt));
        rows.Add(Run(tag + "-radial-local-scaling", sim, world, Vector3.zero, -2.67f, Vector3.zero, 1f, ParticleSystemScalingMode.Local, 12, dt));
      }
    System.IO.File.WriteAllText("OUTPUT_FILE", "[" + string.Join(",\n", rows) + "]");
    return "cases=" + rows.Count;
  }
}
