using UnityEngine;
using System.Collections.Generic;
using Newtonsoft.Json;

// Native repeating-burst emission per simulation step: how many cycles a burst emits
// when its repeat interval is shorter than the step, whether the missed cycles are
// delayed or dropped, and what the system duration does to pending cycles.
// Output: [{name, interval, cycles, count, dt, duration, samples:[{time, particles}]}].
public class Script
{
    public static string Main()
    {
        var specs = new (string name, float interval, int cycles, int count, float dt, float duration, float until)[] {
            ("interval0.01-dt60", 0.01f, 400, 5, 1f / 60f, 6f, 8f),
            ("interval0.01-dt30", 0.01f, 400, 5, 1f / 30f, 6f, 8f),
            ("interval0.01-dt120", 0.01f, 400, 5, 1f / 120f, 6f, 8f),
            ("interval0.02-dt60", 0.02f, 190, 3, 1f / 60f, 6f, 5f),
            ("interval0.03-dt0.1", 0.03f, 40, 1, 0.1f, 3f, 2f),
            ("interval0.03-dt0.5", 0.03f, 40, 1, 0.5f, 3f, 2f),
            ("interval0.01-short-duration", 0.01f, 400, 1, 1f / 60f, 2f, 4f),
        };
        var results = new List<object>();
        var go = new GameObject("burst cycle oracle") { hideFlags = HideFlags.DontSave };
        try
        {
            var ps = go.AddComponent<ParticleSystem>();
            ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            foreach (var s in specs)
            {
                ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
                var main = ps.main;
                main.duration = s.duration; main.loop = false; main.playOnAwake = false;
                main.startLifetime = 100f; main.startSpeed = 0f; main.maxParticles = 100000;
                main.simulationSpace = ParticleSystemSimulationSpace.Local;
                var emission = ps.emission; emission.enabled = true; emission.rateOverTime = 0f;
                emission.SetBursts(new[] { new ParticleSystem.Burst(0f, (short)s.count, (short)s.count, s.cycles, s.interval) });
                var shape = ps.shape; shape.enabled = false;
                ps.Simulate(0f, true, true, false);
                var samples = new List<object>();
                float t = 0f;
                samples.Add(new { time = 0f, particles = ps.particleCount });
                while (t < s.until - 1e-5f)
                {
                    ps.Simulate(s.dt, true, false, false);
                    t += s.dt;
                    samples.Add(new { time = t, particles = ps.particleCount });
                }
                results.Add(new { s.name, s.interval, s.cycles, s.count, s.dt, s.duration, samples });
            }
        }
        finally { Object.DestroyImmediate(go); }
        var json = JsonConvert.SerializeObject(results);
        System.IO.File.WriteAllText("OUTPUT_FILE", json);
        return "ok " + results.Count;
    }
}
