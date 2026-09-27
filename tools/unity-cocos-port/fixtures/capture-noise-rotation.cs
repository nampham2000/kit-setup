using System.Collections.Generic;
using Newtonsoft.Json;
using UnityEngine;

// Regenerates fixtures/particle-noise-rotation-native.json through the shared Unity-MCP:
//   node playable-shared-kit/tools/unity-intel/unity-mcp-script.cjs --project <Unity> --script <this file> --out <fixture.json>
// Read-only: HideAndDontSave systems, destroyed after each case. One particle per case,
// stepped with Simulate(1/60); rotation, rotation3D, position and totalVelocity are read
// back so rotation can be compared with the Noise field at the start-of-step position.
public class Script {
  static float[] V(Vector3 v) { return new[] { v.x, v.y, v.z }; }

  class Case {
    public string name; public bool rotation3D = true; public float strength = 1, frequency = 1, positionAmount = 0;
    public bool damping; public int quality = 1; public AnimationCurve rotationCurve; public float rotationAmount = 10;
    public Vector3 angularOverLifetime; public Vector3 startRotation = new Vector3(10, 20, 30);
    public Vector3 position = new Vector3(0.3f, -0.7f, 1.1f); public int steps = 4; public float lifetime = 10, remaining = 10;
    public float sizeAmount;
  }

  static object Run(Case c) {
    var go = new GameObject("noise-rotation-oracle") { hideFlags = HideFlags.HideAndDontSave };
    try {
      var ps = go.AddComponent<ParticleSystem>(); ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
      var main = ps.main; main.simulationSpace = ParticleSystemSimulationSpace.World; main.startSpeed = 0; main.startLifetime = c.lifetime; main.maxParticles = 4;
      main.startRotation3D = c.rotation3D;
      var shape = ps.shape; shape.enabled = false; var emission = ps.emission; emission.enabled = false;
      var noise = ps.noise; noise.enabled = true; noise.strength = c.strength; noise.frequency = c.frequency; noise.damping = c.damping;
      noise.octaveCount = 1; noise.quality = (ParticleSystemNoiseQuality)c.quality; noise.scrollSpeed = 0;
      noise.positionAmount = c.positionAmount; noise.sizeAmount = c.sizeAmount;
      noise.rotationAmount = c.rotationCurve != null ? new ParticleSystem.MinMaxCurve(c.rotationAmount, c.rotationCurve) : new ParticleSystem.MinMaxCurve(c.rotationAmount);
      if (c.angularOverLifetime != Vector3.zero) {
        var rot = ps.rotationOverLifetime; rot.enabled = true; rot.separateAxes = true;
        rot.x = new ParticleSystem.MinMaxCurve(c.angularOverLifetime.x * Mathf.Deg2Rad);
        rot.y = new ParticleSystem.MinMaxCurve(c.angularOverLifetime.y * Mathf.Deg2Rad);
        rot.z = new ParticleSystem.MinMaxCurve(c.angularOverLifetime.z * Mathf.Deg2Rad);
      }
      ps.useAutoRandomSeed = false; ps.randomSeed = 1; ps.Simulate(0, true, true, false);
      var particle = new ParticleSystem.Particle { position = c.position, startLifetime = c.lifetime, remainingLifetime = c.remaining, startSize = 1, startColor = Color.white, randomSeed = 1 };
      if (c.rotation3D) particle.rotation3D = c.startRotation; else particle.rotation = c.startRotation.z;
      var buffer = new[] { particle };
      ps.SetParticles(buffer, 1);
      var rows = new List<object>();
      for (int i = 0; i < c.steps; i++) {
        ps.Simulate(1f / 60f, true, false, false); ps.GetParticles(buffer, 1); var p = buffer[0];
        rows.Add(new { rotation = p.rotation, rotation3D = V(p.rotation3D), angularVelocity3D = V(p.angularVelocity3D), position = V(p.position), totalVelocity = V(p.totalVelocity), size = p.GetCurrentSize(ps), remaining = p.remainingLifetime });
      }
      return new { c.name, c.rotation3D, c.strength, c.frequency, c.damping, c.quality, c.positionAmount, c.rotationAmount, rotationCurve = c.rotationCurve != null,
        angularOverLifetime = V(c.angularOverLifetime), startRotation = V(c.startRotation), position = V(c.position), c.lifetime, c.remaining, c.sizeAmount, dt = 1f / 60f, rows };
    } finally { Object.DestroyImmediate(go); }
  }

  public static string Main() {
    var ramp = AnimationCurve.Linear(0, 0, 1, 1);
    var cases = new List<Case> {
      new Case { name = "2d-rotation" , rotation3D = false },
      new Case { name = "3d-rotation" },
      new Case { name = "3d-strength2", strength = 2 },
      new Case { name = "3d-position-amount", positionAmount = 1 },
      new Case { name = "3d-damping-frequency2", damping = true, frequency = 2 },
      new Case { name = "3d-high", quality = 2 },
      new Case { name = "3d-low", quality = 0 },
      new Case { name = "3d-with-rotation-over-lifetime", angularOverLifetime = new Vector3(60, 90, 120) },
      new Case { name = "3d-rotation-curve", rotationCurve = ramp, rotationAmount = 20, lifetime = 1, remaining = 0.5f },
      new Case { name = "3d-negative-start", startRotation = new Vector3(-80, 200, 5), position = new Vector3(-2.1f, 0.4f, 0.9f) },
      new Case { name = "3d-size-amount", sizeAmount = 1 },
    };
    var rows = new List<object>(); foreach (var c in cases) rows.Add(Run(c));
    System.IO.File.WriteAllText("OUTPUT_FILE", JsonConvert.SerializeObject(new { unityVersion = Application.unityVersion, seed = 1, cases = rows }, Formatting.Indented));
    return "cases=" + rows.Count;
  }
}
