using System.Collections.Generic;
using Newtonsoft.Json;
using UnityEngine;

// Regenerates fixtures/velocity-limit-composition-native.json through the shared Unity-MCP:
//   node playable-shared-kit/tools/unity-intel/unity-mcp-script.cjs --project <Unity> --script <this file> --out <fixture.json>
// Read-only: every object is HideAndDontSave and destroyed; no asset or scene is touched.
// One particle per case (SetParticles), stepped with ParticleSystem.Simulate below
// Time.maximumParticleDeltaTime so Unity does not sub-step. After every step the
// stored velocity, animated velocity, total velocity and position are read back.
public class Script {
  static float[] V(Vector3 v) { return new[] { v.x, v.y, v.z }; }
  static ParticleSystem.MinMaxCurve C(float v) { return new ParticleSystem.MinMaxCurve(v); }

  class Case {
    public string name; public float dt = 1f / 60f; public int steps = 12;
    public Vector3 position, velocity; public float lifetime = 10;
    public bool local; public Vector3 parentEuler; public float parentScale = 1;
    public Vector3 parentPosition; public Vector3 linear, orbital, offset; public float radial, speedModifier = 1; public bool velocityWorld;
    public bool noise; public float noiseStrength = 1, noiseFrequency = 1; public bool noiseDamping = true; public int noiseQuality = 1;
    public bool limit; public float limitValue, dampen; public bool separate; public Vector3 limitAxes; public bool limitWorld;
    public float force; public uint seed = 1;
  }

  static object Run(Case c) {
    var go = new GameObject("velocity-composition-oracle") { hideFlags = HideFlags.HideAndDontSave };
    try {
      go.transform.position = c.parentPosition; go.transform.rotation = Quaternion.Euler(c.parentEuler);
      go.transform.localScale = Vector3.one * c.parentScale;
      var ps = go.AddComponent<ParticleSystem>();
      ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
      var main = ps.main; main.playOnAwake = false; main.startSpeed = 0; main.startLifetime = c.lifetime; main.maxParticles = 4;
      main.simulationSpace = c.local ? ParticleSystemSimulationSpace.Local : ParticleSystemSimulationSpace.World;
      main.scalingMode = ParticleSystemScalingMode.Hierarchy;
      var shape = ps.shape; shape.enabled = false; var emission = ps.emission; emission.enabled = false;
      var vel = ps.velocityOverLifetime;
      vel.enabled = c.linear != Vector3.zero || c.orbital != Vector3.zero || c.radial != 0 || c.speedModifier != 1;
      vel.space = c.velocityWorld ? ParticleSystemSimulationSpace.World : ParticleSystemSimulationSpace.Local;
      vel.x = C(c.linear.x); vel.y = C(c.linear.y); vel.z = C(c.linear.z);
      vel.orbitalX = C(c.orbital.x); vel.orbitalY = C(c.orbital.y); vel.orbitalZ = C(c.orbital.z);
      vel.orbitalOffsetX = C(c.offset.x); vel.orbitalOffsetY = C(c.offset.y); vel.orbitalOffsetZ = C(c.offset.z);
      vel.radial = C(c.radial); vel.speedModifier = C(c.speedModifier);
      var forceModule = ps.forceOverLifetime; forceModule.enabled = c.force != 0; forceModule.y = C(c.force);
      forceModule.space = ParticleSystemSimulationSpace.World;
      var noise = ps.noise; noise.enabled = c.noise;
      if (c.noise) {
        noise.strength = c.noiseStrength; noise.frequency = c.noiseFrequency; noise.damping = c.noiseDamping; noise.octaveCount = 1;
        noise.quality = (ParticleSystemNoiseQuality)c.noiseQuality; noise.scrollSpeed = 0; noise.positionAmount = 1;
        noise.rotationAmount = 0; noise.sizeAmount = 0;
      }
      var lim = ps.limitVelocityOverLifetime; lim.enabled = c.limit;
      if (c.limit) {
        lim.dampen = c.dampen; lim.drag = 0; lim.separateAxes = c.separate;
        lim.space = c.limitWorld ? ParticleSystemSimulationSpace.World : ParticleSystemSimulationSpace.Local;
        if (c.separate) { lim.limitX = C(c.limitAxes.x); lim.limitY = C(c.limitAxes.y); lim.limitZ = C(c.limitAxes.z); }
        else lim.limit = C(c.limitValue);
      }
      ps.useAutoRandomSeed = false; ps.randomSeed = c.seed;
      ps.Simulate(0, true, true, false);
      var buffer = new[] { new ParticleSystem.Particle {
        position = c.position, velocity = c.velocity, startLifetime = c.lifetime, remainingLifetime = c.lifetime,
        startSize = 1, startColor = Color.white, randomSeed = c.seed,
      } };
      ps.SetParticles(buffer, 1);
      var rows = new List<object>();
      for (int i = 0; i < c.steps; i++) {
        ps.Simulate(c.dt, true, false, false);
        if (ps.GetParticles(buffer, 1) != 1) throw new System.Exception(c.name + ": particle lost");
        var p = buffer[0];
        rows.Add(new { position = V(p.position), velocity = V(p.velocity), animatedVelocity = V(p.animatedVelocity), totalVelocity = V(p.totalVelocity), remaining = p.remainingLifetime });
      }
      return new {
        c.name, c.dt, c.steps, position = V(c.position), velocity = V(c.velocity), c.lifetime, c.local, parentEuler = V(c.parentEuler), parentPosition = V(c.parentPosition), c.parentScale,
        linear = V(c.linear), orbital = V(c.orbital), offset = V(c.offset), c.radial, c.speedModifier, c.velocityWorld,
        c.noise, c.noiseStrength, c.noiseFrequency, c.noiseDamping, c.noiseQuality,
        c.limit, c.limitValue, c.dampen, c.separate, limitAxes = V(c.limitAxes), c.limitWorld, c.force, c.seed, rows,
      };
    } finally { Object.DestroyImmediate(go); }
  }

  public static string Main() {
    var cases = new List<Case> {
      // ChannelDust: radial -1 from a 0.5 sphere, limit 0.1, dampen 0.05.
      new Case { name = "radial-limit-60fps", position = new Vector3(0.3f, 0.2f, 0.34641f), radial = -1, limit = true, limitValue = 0.1f, dampen = 0.05f, steps = 24 },
      new Case { name = "radial-limit-40fps", dt = 0.025f, position = new Vector3(0.3f, 0.2f, 0.34641f), radial = -1, limit = true, limitValue = 0.1f, dampen = 0.05f, steps = 16 },
      new Case { name = "radial-only", position = new Vector3(0.3f, 0.2f, 0.34641f), radial = -1, steps = 6 },
      // OrbConsume Particles: start speed along +Z, radial -0.2, limit 0.3, dampen 0.05.
      new Case { name = "radial-speed-limit", position = new Vector3(0.1f, -0.15f, -0.65f), velocity = new Vector3(0, 0, 0.6f), radial = -0.2f, limit = true, limitValue = 0.3f, dampen = 0.05f, steps = 24 },
      // Orbital with a limit: is the orbital displacement itself limited?
      new Case { name = "orbital-limit-hard", position = new Vector3(1, 0, 0.5f), orbital = new Vector3(0, 4, 0), limit = true, limitValue = 0.5f, dampen = 1, steps = 8 },
      new Case { name = "orbital-limit-dampen", position = new Vector3(1, 0, 0.5f), orbital = new Vector3(0, 4, 0), limit = true, limitValue = 0.5f, dampen = 0.15f, steps = 12 },
      new Case { name = "orbital-only", position = new Vector3(1, 0, 0.5f), orbital = new Vector3(0, 4, 0), steps = 6 },
      new Case { name = "mixed-limit", position = new Vector3(0.7f, -0.4f, 0.9f), velocity = new Vector3(1, -2, 0.5f), linear = new Vector3(0.4f, 0.5f, 0.6f), orbital = new Vector3(1, 2, 3), radial = 0.5f, limit = true, limitValue = 1, dampen = 0.3f, steps = 12 },
      new Case { name = "mixed-limit-separate", position = new Vector3(0.7f, -0.4f, 0.9f), velocity = new Vector3(1, -2, 0.5f), linear = new Vector3(0.4f, 0.5f, 0.6f), orbital = new Vector3(1, 2, 3), radial = 0.5f, limit = true, separate = true, limitAxes = new Vector3(0.5f, 1, 2), dampen = 0.2f, steps = 12 },
      new Case { name = "linear-force-limit", velocity = Vector3.zero, linear = new Vector3(0, 9, 0), force = -3, limit = true, limitValue = 0.75f, dampen = 0.2f, steps = 12 },
      // Local simulation under a rotated and scaled transform, magnitude limit in local and world space.
      new Case { name = "local-scaled-radial-limit", local = true, parentEuler = new Vector3(-90, 30, 0), parentScale = 2, position = new Vector3(0.3f, 0.2f, 0.34641f), radial = -1, limit = true, limitValue = 0.1f, dampen = 0.05f, steps = 12 },
      new Case { name = "local-scaled-radial-limit-world", local = true, parentEuler = new Vector3(-90, 30, 0), parentScale = 2, position = new Vector3(0.3f, 0.2f, 0.34641f), radial = -1, limit = true, limitValue = 0.1f, dampen = 0.05f, limitWorld = true, steps = 12 },
      // World simulation: the orbit is evaluated in the moved, rotated and scaled emitter frame, the limit on world velocity.
      new Case { name = "world-transformed-orbit-limit", parentPosition = new Vector3(0.5f, 0, 1), parentEuler = new Vector3(-90, 30, 0), parentScale = 2, position = new Vector3(1.2f, 0.3f, 1.9f), orbital = new Vector3(0, 3, 0), radial = -0.5f, limit = true, limitValue = 0.6f, dampen = 0.2f, steps = 12 },
      // Noise (Medium) composed with the limit.
      new Case { name = "noise-limit-zero", position = new Vector3(0.05f, -0.03f, 0.08f), velocity = new Vector3(1.5f, 0.3f, -0.8f), noise = true, noiseStrength = 0.7f, noiseFrequency = 1.8f, limit = true, limitValue = 0, dampen = 0.1f, steps = 24 },
      new Case { name = "noise-limit-spikes", position = Vector3.zero, velocity = new Vector3(10, 2, 0), noise = true, noiseStrength = 0.25f, noiseFrequency = 1, limit = true, limitValue = 0.5f, dampen = 0.15f, steps = 24 },
      new Case { name = "noise-limit-separate", position = new Vector3(0.2f, 0.1f, -0.3f), velocity = new Vector3(3, -1, 2), noise = true, noiseStrength = 1.5f, noiseFrequency = 1.3f, limit = true, separate = true, limitAxes = new Vector3(0.5f, 1, 0.25f), dampen = 0.25f, steps = 12 },
      new Case { name = "noise-only", position = new Vector3(0.05f, -0.03f, 0.08f), velocity = new Vector3(1.5f, 0.3f, -0.8f), noise = true, noiseStrength = 0.7f, noiseFrequency = 1.8f, steps = 6 },
      new Case { name = "orbital-noise-limit", position = new Vector3(1, 0.2f, 0.5f), velocity = new Vector3(0.2f, 0, 0), orbital = new Vector3(0, 3, 0), radial = -0.3f, noise = true, noiseStrength = 0.6f, noiseFrequency = 1.1f, limit = true, limitValue = 0.4f, dampen = 0.1f, steps = 12 },
      // Speed modifier with a limit (documented, not bound by the porter).
      new Case { name = "speedmodifier-limit", velocity = new Vector3(0, 1, 0), linear = new Vector3(0, 3, 0), speedModifier = 2, limit = true, limitValue = 1, dampen = 0.5f, steps = 6 },
      new Case { name = "speedmodifier-only", velocity = new Vector3(0, 1, 0), linear = new Vector3(0, 3, 0), speedModifier = 2, steps = 3 },
    };
    var rows = new List<object>();
    foreach (var c in cases) rows.Add(Run(c));
    System.IO.File.WriteAllText("OUTPUT_FILE", JsonConvert.SerializeObject(new { unityVersion = Application.unityVersion, maximumParticleDeltaTime = Time.maximumParticleDeltaTime, cases = rows }, Formatting.Indented));
    return "cases=" + rows.Count;
  }
}
