using System.Collections.Generic;
using Newtonsoft.Json;
using UnityEditor;
using UnityEngine;

// Regenerates fixtures/inherit-velocity-native.json through the shared Unity-MCP.
// Read-only: temporary HideAndDontSave objects only. The emitter moves by transform at a
// constant velocity; the system is stepped with Simulate(dt, false, false) so Unity derives
// the emitter velocity from the transform delta exactly as in Play Mode.
public class Script {
  static float[] V(Vector3 v) { return new[] { v.x, v.y, v.z }; }

  static object Run(string name, ParticleSystemInheritVelocityMode mode, ParticleSystem.MinMaxCurve curve,
      ParticleSystemSimulationSpace space, Vector3 emitterVelocity, float rate, int steps) {
    var go = new GameObject("iv") { hideFlags = HideFlags.HideAndDontSave };
    try {
      var ps = go.AddComponent<ParticleSystem>();
      ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
      var main = ps.main; main.playOnAwake = false; main.loop = true; main.duration = 1; main.startSpeed = 0;
      main.startLifetime = 100; main.gravityModifier = 0; main.simulationSpace = space; main.maxParticles = 1000;
      ps.useAutoRandomSeed = false; ps.randomSeed = 7;
      var shape = ps.shape; shape.enabled = false;
      var emission = ps.emission; emission.enabled = true; emission.rateOverTime = rate;
      var iv = ps.inheritVelocity; iv.enabled = true; iv.mode = mode; iv.curve = curve;
      const float dt = 1f / 60f;
      var frames = new List<object>();
      ps.Simulate(0, false, true, false);
      for (var step = 1; step <= steps; step++) {
        go.transform.position += emitterVelocity * dt;
        ps.Simulate(dt, false, false, false);
        var buffer = new ParticleSystem.Particle[ps.particleCount];
        var n = ps.GetParticles(buffer);
        var particles = new List<object>();
        for (var i = 0; i < n; i++)
          particles.Add(new { age = buffer[i].startLifetime - buffer[i].remainingLifetime, position = V(buffer[i].position),
            velocity = V(buffer[i].velocity), animatedVelocity = V(buffer[i].animatedVelocity), totalVelocity = V(buffer[i].totalVelocity) });
        frames.Add(new { step, time = step * dt, emitter = V(go.transform.position), particles });
      }
      return new { name, mode = (int)mode, space = (int)space, emitterVelocity = V(emitterVelocity), rate, dt, frames };
    } finally { Object.DestroyImmediate(go); }
  }

  public static string Main() {
    var ramp = new ParticleSystem.MinMaxCurve(1f, AnimationCurve.Linear(0, 0, 1, 1));
    var v = new Vector3(3, 0, 4);
    var rows = new List<object> {
      Run("initial-constant", ParticleSystemInheritVelocityMode.Initial, new ParticleSystem.MinMaxCurve(0.5f), ParticleSystemSimulationSpace.World, v, 30, 12),
      Run("initial-negative", ParticleSystemInheritVelocityMode.Initial, new ParticleSystem.MinMaxCurve(-0.1f), ParticleSystemSimulationSpace.World, v, 30, 12),
      Run("initial-ramp", ParticleSystemInheritVelocityMode.Initial, ramp, ParticleSystemSimulationSpace.World, v, 30, 45),
      Run("current-constant", ParticleSystemInheritVelocityMode.Current, new ParticleSystem.MinMaxCurve(0.5f), ParticleSystemSimulationSpace.World, v, 30, 12),
      Run("current-ramp", ParticleSystemInheritVelocityMode.Current, ramp, ParticleSystemSimulationSpace.World, v, 30, 45),
      Run("initial-local", ParticleSystemInheritVelocityMode.Initial, new ParticleSystem.MinMaxCurve(0.5f), ParticleSystemSimulationSpace.Local, v, 30, 12),
    };
    System.IO.File.WriteAllText("OUTPUT_FILE", JsonConvert.SerializeObject(new { unityVersion = Application.unityVersion, cases = rows }));
    return "cases=" + rows.Count;
  }
}
