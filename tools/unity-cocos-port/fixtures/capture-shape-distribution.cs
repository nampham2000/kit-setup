using UnityEngine;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json;

// Substitute OUTPUT_FILE. Native birth-position radius distribution of Circle, Cone
// (Base/Volume), Sphere and Hemisphere shapes, as quantiles of r / radius, with
// radiusThickness < 1 cases. Cone also records the direction slope against the base
// radius, and Cone Volume the height quantiles.
public class Script
{
    static float Q(List<float> sorted, float q) { return sorted[Mathf.Clamp(Mathf.RoundToInt(q * (sorted.Count - 1)), 0, sorted.Count - 1)]; }

    public static string Main()
    {
        var qs = new[] { 0.05f, 0.1f, 0.25f, 0.5f, 0.75f, 0.9f, 0.95f };
        var cases = new List<object>();
        var go = new GameObject("shape distribution oracle");
        try
        {
            var ps = go.AddComponent<ParticleSystem>();
            ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            var main = ps.main; main.simulationSpace = ParticleSystemSimulationSpace.Local; main.maxParticles = 20000;
            main.startSpeed = 1; main.startLifetime = 100; main.gravityModifier = 0;
            var emission = ps.emission; emission.enabled = false;
            var shape = ps.shape; shape.enabled = true;
            var specs = new (string name, ParticleSystemShapeType type, float thickness, float angle, float length, ParticleSystemShapeType volumeType)[] {
                ("circle-1", ParticleSystemShapeType.Circle, 1f, 0f, 0f, ParticleSystemShapeType.Circle),
                ("circle-0.5", ParticleSystemShapeType.Circle, 0.5f, 0f, 0f, ParticleSystemShapeType.Circle),
                ("cone-base-1", ParticleSystemShapeType.Cone, 1f, 0f, 0f, ParticleSystemShapeType.Cone),
                ("cone-base-0.4-angle25", ParticleSystemShapeType.Cone, 0.4f, 25f, 0f, ParticleSystemShapeType.Cone),
                ("cone-base-0.4-angle0", ParticleSystemShapeType.Cone, 0.4f, 0f, 0f, ParticleSystemShapeType.Cone),
                ("cone-base-0.75-angle0", ParticleSystemShapeType.Cone, 0.75f, 0f, 0f, ParticleSystemShapeType.Cone),
                ("circle-0.25", ParticleSystemShapeType.Circle, 0.25f, 0f, 0f, ParticleSystemShapeType.Circle),
                ("cone-volume-0.5-angle20", ParticleSystemShapeType.ConeVolume, 0.5f, 20f, 3f, ParticleSystemShapeType.ConeVolume),
                ("cone-volume-1-angle20", ParticleSystemShapeType.ConeVolume, 1f, 20f, 3f, ParticleSystemShapeType.ConeVolume),
                ("sphere-1", ParticleSystemShapeType.Sphere, 1f, 0f, 0f, ParticleSystemShapeType.Sphere),
                ("sphere-0.5", ParticleSystemShapeType.Sphere, 0.5f, 0f, 0f, ParticleSystemShapeType.Sphere),
                ("hemisphere-1", ParticleSystemShapeType.Hemisphere, 1f, 0f, 0f, ParticleSystemShapeType.Hemisphere),
            };
            const float radius = 2f;
            const int count = 8000;
            foreach (var spec in specs)
            {
                ps.Clear();
                shape.shapeType = spec.type; shape.radius = radius; shape.radiusThickness = spec.thickness;
                shape.angle = spec.angle; shape.length = spec.length; shape.arc = 360;
                shape.arcMode = ParticleSystemShapeMultiModeValue.Random;
                shape.position = Vector3.zero; shape.rotation = Vector3.zero; shape.scale = Vector3.one;
                ps.Emit(count);
                var particles = new ParticleSystem.Particle[count];
                var n = ps.GetParticles(particles);
                var planar = spec.type == ParticleSystemShapeType.Circle || spec.type == ParticleSystemShapeType.Cone || spec.type == ParticleSystemShapeType.ConeVolume;
                var radii = new List<float>();
                var heights = new List<float>();
                var slopes = new List<float>();
                for (var i = 0; i < n; i++)
                {
                    var p = particles[i].position;
                    var v = particles[i].velocity.normalized;
                    if (spec.type == ParticleSystemShapeType.ConeVolume)
                    {
                        // Walk back along the birth direction to the base disk (z = 0).
                        var s = v.z > 1e-5f ? p.z / v.z : 0f;
                        var b = p - v * s;
                        radii.Add(new Vector2(b.x, b.y).magnitude / radius);
                        heights.Add(p.z / spec.length);
                    }
                    else radii.Add((planar ? new Vector2(p.x, p.y).magnitude : p.magnitude) / radius);
                    if (spec.type == ParticleSystemShapeType.Cone && radii[radii.Count - 1] > 0.05f)
                        slopes.Add(new Vector2(v.x, v.y).magnitude / Mathf.Max(1e-5f, v.z) / radii[radii.Count - 1]);
                }
                radii.Sort(); heights.Sort(); slopes.Sort();
                cases.Add(new
                {
                    name = spec.name, shape = spec.type.ToString(), radius, spec.thickness, spec.angle, spec.length, count = n,
                    radiusQuantiles = qs.Select(q => Q(radii, q)).ToArray(),
                    heightQuantiles = heights.Count > 0 ? qs.Select(q => Q(heights, q)).ToArray() : null,
                    slopePerRadius = slopes.Count > 0 ? (float?)Q(slopes, 0.5f) : null,
                });
            }
        }
        finally { Object.DestroyImmediate(go); }
        System.IO.File.WriteAllText("OUTPUT_FILE", JsonConvert.SerializeObject(new { unity = Application.unityVersion, quantiles = qs, cases }, Formatting.Indented));
        return "Captured " + cases.Count + " native shape distributions";
    }
}
