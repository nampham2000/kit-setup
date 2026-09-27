using System.Collections.Generic;
using Newtonsoft.Json;
using UnityEditor;
using UnityEngine;

// Regenerates fixtures/particle-noise-prefabs-native.json through the shared Unity-MCP:
//   node playable-shared-kit/tools/unity-intel/unity-mcp-script.cjs --project <Unity> --script <this file> --out <fixture.json>
// Read-only: prefabs are opened with PrefabUtility.LoadPrefabContents (isolated preview
// scene) and unloaded without saving. The authored Noise/Limit modules stay as serialized;
// modules whose per-particle random draws cannot be matched (velocity over lifetime,
// rotation over lifetime, gravity) are switched off in memory so the matched-birth replay
// isolates Noise position/rotation and its composition with Limit Velocity.
// Also records one separate-axes Noise rotation probe.
public class Script {
  static float[] V(Vector3 v) { return new[] { v.x, v.y, v.z }; }

  static object Capture(string path, string node, uint seed, int count, int steps, int[] frames) {
    var root = PrefabUtility.LoadPrefabContents(path);
    try {
      Transform target = null;
      foreach (var t in root.GetComponentsInChildren<Transform>(true)) if (t.name == node) { target = t; break; }
      var ps = target.GetComponent<ParticleSystem>();
      ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
      var emission = ps.emission; emission.enabled = false;
      var velocity = ps.velocityOverLifetime; velocity.enabled = false;
      var rotation = ps.rotationOverLifetime; rotation.enabled = false;
      var main = ps.main; main.gravityModifier = 0;
      ps.useAutoRandomSeed = false; ps.randomSeed = seed;
      ps.Simulate(0, false, true, false);
      ps.Emit(count);
      var buffer = new ParticleSystem.Particle[count];
      int n = ps.GetParticles(buffer);
      var births = new List<object>();
      for (int i = 0; i < n; i++) {
        var p = buffer[i];
        births.Add(new { seed = p.randomSeed, position = V(p.position), velocity = V(p.velocity), rotation3D = V(p.rotation3D), startLifetime = p.startLifetime, remainingLifetime = p.remainingLifetime });
      }
      var rows = new List<object>();
      for (int step = 1; step <= steps; step++) {
        ps.Simulate(1f / 60f, false, false, false);
        if (System.Array.IndexOf(frames, step) < 0) continue;
        int alive = ps.GetParticles(buffer);
        var particles = new List<object>();
        for (int i = 0; i < alive; i++) {
          var p = buffer[i];
          particles.Add(new { seed = p.randomSeed, position = V(p.position), velocity = V(p.velocity), totalVelocity = V(p.totalVelocity), rotation3D = V(p.rotation3D), remainingLifetime = p.remainingLifetime });
        }
        rows.Add(new { step, particles });
      }
      return new { path, node, seed, delta = 1f / 60f, rotation3D = main.startRotation3D, simulationSpace = (int)main.simulationSpace, births, rows };
    } finally { PrefabUtility.UnloadPrefabContents(root); }
  }

  static object SeparateAxesRotation() {
    var go = new GameObject("noise-rotation-separate") { hideFlags = HideFlags.HideAndDontSave };
    try {
      var ps = go.AddComponent<ParticleSystem>(); ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
      var main = ps.main; main.simulationSpace = ParticleSystemSimulationSpace.World; main.startSpeed = 0; main.startLifetime = 10; main.startRotation3D = true;
      var shape = ps.shape; shape.enabled = false; var emission = ps.emission; emission.enabled = false;
      var noise = ps.noise; noise.enabled = true; noise.separateAxes = true;
      noise.strengthX = 1; noise.strengthY = 2; noise.strengthZ = 3; noise.frequency = 1; noise.damping = false; noise.octaveCount = 1;
      noise.quality = ParticleSystemNoiseQuality.Medium; noise.scrollSpeed = 0; noise.positionAmount = 1; noise.rotationAmount = 10;
      ps.useAutoRandomSeed = false; ps.randomSeed = 1; ps.Simulate(0, true, true, false);
      var buffer = new[] { new ParticleSystem.Particle { position = new Vector3(0.3f, -0.7f, 1.1f), rotation3D = new Vector3(10, 20, 30), startLifetime = 10, remainingLifetime = 10, startSize = 1, startColor = Color.white, randomSeed = 1 } };
      ps.SetParticles(buffer, 1); ps.Simulate(1f / 60f, true, false, false); ps.GetParticles(buffer, 1);
      return new { position = new[] { 0.3f, -0.7f, 1.1f }, startRotation = new[] { 10f, 20f, 30f }, strength = new[] { 1f, 2f, 3f }, rotationAmount = 10f, dt = 1f / 60f,
        rotation3D = V(buffer[0].rotation3D), positionAfter = V(buffer[0].position) };
    } finally { Object.DestroyImmediate(go); }
  }

  public static string Main() {
    var frames = new[] { 1, 2, 6, 12, 24, 36, 48 };
    var result = new List<object> {
      Capture("Assets/ARPG Effects/Prefabs/Environment/Weather/BlowingLeaves.prefab", "BlowingLeaves", 2024, 24, 48, frames),
      Capture("Assets/ARPG Effects/Prefabs/Interactive/Actions/LevelUp.prefab", "Spikes", 5150, 24, 36, frames),
    };
    System.IO.File.WriteAllText("OUTPUT_FILE", JsonConvert.SerializeObject(new { unityVersion = Application.unityVersion, prefabs = result, separateAxesRotation = SeparateAxesRotation() }, Formatting.Indented));
    return "prefabs=" + result.Count;
  }
}
