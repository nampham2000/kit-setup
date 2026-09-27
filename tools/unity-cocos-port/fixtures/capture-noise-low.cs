using System.Collections.Generic;
using System.Reflection;
using Newtonsoft.Json;
using UnityEngine;

// Regenerates fixtures/particle-noise-low-native.json through the shared Unity-MCP:
//   node playable-shared-kit/tools/unity-intel/unity-mcp-script.cjs --project <Unity> --script <this file> --out <fixture.json>
// Read-only: HideAndDontSave systems, destroyed after each probe. The noise velocity is the
// one-step displacement / dt of a particle with zero stored velocity (World simulation).
//  - lattice: 256 lattice points per output axis (seed 1, frequency 1, no scroll) sampled
//    at x + phase = k + 0.5 midpoints and at k + 0.25 (both depend on two lattice slopes);
//  - holdouts: random 3D positions across seeds, frequency, scroll offset, octaves and damping.
public class Script {
  static float[] V(Vector3 v) { return new[] { v.x, v.y, v.z }; }

  static ParticleSystem Make(GameObject go, uint seed, float frequency, bool damping, int octaves, float multiplier, float scale, int count) {
    var ps = go.AddComponent<ParticleSystem>(); ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
    var main = ps.main; main.simulationSpace = ParticleSystemSimulationSpace.World; main.startSpeed = 0; main.startLifetime = 10; main.maxParticles = count;
    var shape = ps.shape; shape.enabled = false; var emission = ps.emission; emission.enabled = false;
    var noise = ps.noise; noise.enabled = true; noise.strength = 1; noise.frequency = frequency; noise.damping = damping;
    noise.octaveCount = octaves; noise.octaveMultiplier = multiplier; noise.octaveScale = scale;
    noise.quality = ParticleSystemNoiseQuality.Low; noise.scrollSpeed = 0; noise.positionAmount = 1;
    ps.useAutoRandomSeed = false; ps.randomSeed = seed; ps.Simulate(0, true, true, false);
    return ps;
  }

  static void SetScroll(ParticleSystem ps, float scroll) {
    object state = ps.GetPlaybackState();
    var nf = state.GetType().GetField("m_Noise", BindingFlags.Instance | BindingFlags.NonPublic);
    object ns = nf.GetValue(state);
    ns.GetType().GetField("m_ScrollOffset", BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public).SetValue(ns, scroll);
    nf.SetValue(state, ns); ps.SetPlaybackState((ParticleSystem.PlaybackState)state);
  }

  static List<float[]> Field(ParticleSystem ps, Vector3[] positions) {
    var p = new ParticleSystem.Particle[positions.Length];
    for (int i = 0; i < p.Length; i++) { p[i].position = positions[i]; p[i].startLifetime = 10; p[i].remainingLifetime = 10; p[i].randomSeed = (uint)(i + 1); p[i].startSize = 1; }
    ps.SetParticles(p, p.Length); ps.Simulate(1f / 60f, true, false, false);
    if (ps.GetParticles(p) != positions.Length) throw new System.Exception("count");
    var result = new List<float[]>(); for (int i = 0; i < p.Length; i++) result.Add(V(p[i].totalVelocity)); return result;
  }

  public static string Main() {
    Vector3 phase; var old = Random.state;
    try { Random.InitState(1); phase = new Vector3(100 + Random.value * 100, Random.value * 100, Random.value * 100); } finally { Random.state = old; }
    var lattice = new List<object>();
    foreach (float fraction in new[] { 0f, 0.25f, 0.5f }) {
      var go = new GameObject("noise-low-lattice") { hideFlags = HideFlags.HideAndDontSave };
      try {
        var ps = Make(go, 1, 1, false, 1, 0.5f, 2, 768);
        var positions = new Vector3[768];
        for (int k = 0; k < 256; k++) {
          // out.z samples x, out.x samples y, out.y samples z (line sweeps); keep the other coordinates fixed.
          positions[k] = new Vector3(k + fraction - phase.x + 256, 0.61f, 0.23f);
          positions[256 + k] = new Vector3(0.37f, k + fraction - phase.y + 256, 0.23f);
          positions[512 + k] = new Vector3(0.37f, 0.61f, k + fraction - phase.z + 256);
        }
        var field = Field(ps, positions);
        var rows = new List<object>();
        for (int i = 0; i < positions.Length; i++) rows.Add(new { position = V(positions[i]), field = field[i] });
        lattice.Add(new { fraction, rows });
      } finally { Object.DestroyImmediate(go); }
    }
    var holdouts = new List<object>();
    var random = new System.Random(90210);
    var configs = new List<object[]> {
      new object[] { 1u, 1f, false, 1, 0f }, new object[] { 1u, 2.4f, false, 1, 0.37f }, new object[] { 1234u, 1f, false, 1, 0f },
      new object[] { 1234u, 1.7f, true, 1, 2.5f }, new object[] { 99u, 0.8f, false, 2, 0f }, new object[] { 99u, 1.3f, true, 3, 1.1f },
    };
    foreach (var cfg in configs) {
      var go = new GameObject("noise-low-holdouts") { hideFlags = HideFlags.HideAndDontSave };
      try {
        uint seed = (uint)cfg[0]; float frequency = (float)cfg[1]; bool damping = (bool)cfg[2]; int octaves = (int)cfg[3]; float scroll = (float)cfg[4];
        var ps = Make(go, seed, frequency, damping, octaves, 0.5f, 2, 64);
        if (scroll != 0) SetScroll(ps, scroll);
        var positions = new Vector3[64];
        for (int i = 0; i < 64; i++) positions[i] = new Vector3((float)random.NextDouble() * 20 - 10, (float)random.NextDouble() * 20 - 10, (float)random.NextDouble() * 20 - 10);
        var field = Field(ps, positions);
        var rows = new List<object>();
        for (int i = 0; i < 64; i++) rows.Add(new { position = V(positions[i]), field = field[i] });
        holdouts.Add(new { seed, frequency, damping, octaves, octaveMultiplier = 0.5f, octaveScale = 2f, scroll, rows });
      } finally { Object.DestroyImmediate(go); }
    }
    System.IO.File.WriteAllText("OUTPUT_FILE", JsonConvert.SerializeObject(new { unityVersion = Application.unityVersion, quality = 0, seed1Phase = V(phase), lattice, holdouts }));
    return "lattice=" + lattice.Count + " holdouts=" + holdouts.Count;
  }
}
