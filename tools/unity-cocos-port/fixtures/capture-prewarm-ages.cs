using System.Text;
using UnityEditor;
using UnityEngine;

// Read-only: loads prefab contents into an isolated preview scene (never saved)
// and reports the ages of prewarmed particles after the first 1/60 s frame.
public class Script
{
    public static string Main()
    {
        var sb = new StringBuilder();
        foreach (var name in new[] { "DarkOrb", "WaterOrb", "GoldOrb" })
        {
            var go = PrefabUtility.LoadPrefabContents("Assets/ARPG Effects/Prefabs/Loot/Orbs/" + name + ".prefab");
            try
            {
                foreach (var ps in go.GetComponentsInChildren<ParticleSystem>(true))
                {
                    var main = ps.main;
                    if (!main.prewarm) continue;
                    foreach (var step in new[] { 0f, 1f / 60f })
                    {
                        ps.Simulate(0f, false, true, false);
                        if (step > 0) ps.Simulate(step, false, false, false);
                        var particles = new ParticleSystem.Particle[ps.particleCount];
                        ps.GetParticles(particles);
                        sb.Append(name).Append('/').Append(ps.name)
                          .Append(" duration=").Append(main.duration)
                          .Append(" life=").Append(main.startLifetime.constant)
                          .Append(" step=").Append(step)
                          .Append(" time=").Append(ps.time)
                          .Append(" ages=");
                        foreach (var p in particles) sb.Append((p.startLifetime - p.remainingLifetime).ToString("F4")).Append(',');
                        sb.Append('\n');
                    }
                }
            }
            finally
            {
                PrefabUtility.UnloadPrefabContents(go);
            }
        }
        return sb.ToString();
    }
}
