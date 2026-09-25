using System.Collections.Generic;
using Newtonsoft.Json;
using UnityEditor;
using UnityEngine;

// Regenerates the native part of fixtures/limit-composition-prefabs-native.json through the shared Unity-MCP:
//   node playable-shared-kit/tools/unity-intel/unity-mcp-script.cjs --project <Unity> --script <this file> --out <fixture.json>
// Read-only: each prefab is opened with PrefabUtility.LoadPrefabContents in an isolated
// preview scene and unloaded without saving. Emission is replaced by Emit(count) so the
// authored shape/start modules produce the births; every particle is then stepped with
// Simulate(1/60) and read back (matched births by randomSeed).
public class Script {
  static float[] V(Vector3 v) { return new[] { v.x, v.y, v.z }; }

  static object Capture(string path, string node, uint seed, int count, int steps, int[] frames) {
    var root = PrefabUtility.LoadPrefabContents(path);
    try {
      Transform target = null;
      foreach (var t in root.GetComponentsInChildren<Transform>(true)) if (t.name == node) { target = t; break; }
      if (target == null) throw new System.Exception(node + " not found in " + path);
      var ps = target.GetComponent<ParticleSystem>();
      ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
      var emission = ps.emission; emission.enabled = false;
      ps.useAutoRandomSeed = false; ps.randomSeed = seed;
      ps.Simulate(0, false, true, false);
      ps.Emit(count);
      var buffer = new ParticleSystem.Particle[count];
      int n = ps.GetParticles(buffer);
      var births = new List<object>();
      for (int i = 0; i < n; i++) {
        var p = buffer[i];
        births.Add(new { seed = p.randomSeed, position = V(p.position), velocity = V(p.velocity), startLifetime = p.startLifetime, remainingLifetime = p.remainingLifetime });
      }
      var rows = new List<object>();
      for (int step = 1; step <= steps; step++) {
        ps.Simulate(1f / 60f, false, false, false);
        if (System.Array.IndexOf(frames, step) < 0) continue;
        int alive = ps.GetParticles(buffer);
        var particles = new List<object>();
        for (int i = 0; i < alive; i++) {
          var p = buffer[i];
          particles.Add(new { seed = p.randomSeed, position = V(p.position), velocity = V(p.velocity), animatedVelocity = V(p.animatedVelocity), totalVelocity = V(p.totalVelocity), remainingLifetime = p.remainingLifetime });
        }
        rows.Add(new { step, particles });
      }
      var main = ps.main; var t2 = target;
      return new {
        path, node, seed, delta = 1f / 60f, simulationSpace = (int)main.simulationSpace,
        localRotation = new[] { t2.localRotation.x, t2.localRotation.y, t2.localRotation.z, t2.localRotation.w }, localScale = V(t2.localScale),
        births, rows,
      };
    } finally { PrefabUtility.UnloadPrefabContents(root); }
  }

  public static string Main() {
    var frames = new[] { 1, 2, 6, 12, 24, 36, 48 };
    var result = new List<object> {
      Capture("Assets/ARPG Effects/Prefabs/Loot/Orb Consume/BlueOrbConsume.prefab", "Particles", 1234, 24, 48, frames),
      Capture("Assets/ARPG Effects/Prefabs/Interactive/Actions/IdentifyChannel.prefab", "ChannelDust", 4321, 24, 48, frames),
      Capture("Assets/ARPG Effects/Prefabs/Interactive/Portals/Blue/PortalBlueOpen.prefab", "Dots", 777, 24, 48, frames),
    };
    System.IO.File.WriteAllText("OUTPUT_FILE", JsonConvert.SerializeObject(new { unityVersion = Application.unityVersion, prefabs = result }, Formatting.Indented));
    return "prefabs=" + result.Count;
  }
}
