using UnityEngine;
using System.Collections.Generic;
using Newtonsoft.Json;

// Substitute OUTPUT_FILE. Native ShapeModule.alignToDirection: per particle, the birth
// direction (velocity / startSpeed, shape-local) and the resulting rotation3D (degrees),
// for several shapes and start rotations, mesh render mode, local simulation space.
public class Script
{
    public static string Main()
    {
        var specs = new (string name, ParticleSystemShapeType shape, Vector3 shapeRotation, Vector3 startRotation, bool rotation3D)[] {
            ("circle", ParticleSystemShapeType.Circle, Vector3.zero, Vector3.zero, false),
            ("circle-rotZ90", ParticleSystemShapeType.Circle, Vector3.zero, new Vector3(0, 0, 90), false),
            ("circle-rot3d", ParticleSystemShapeType.Circle, Vector3.zero, new Vector3(30, 45, 60), true),
            ("circle-shape-x90", ParticleSystemShapeType.Circle, new Vector3(90, 0, 0), Vector3.zero, false),
            ("cone", ParticleSystemShapeType.Cone, Vector3.zero, Vector3.zero, false),
            ("sphere", ParticleSystemShapeType.Sphere, Vector3.zero, Vector3.zero, false),
        };
        var results = new List<object>();
        var go = new GameObject("align to direction oracle") { hideFlags = HideFlags.DontSave };
        try
        {
            var ps = go.AddComponent<ParticleSystem>();
            var renderer = go.GetComponent<ParticleSystemRenderer>();
            renderer.renderMode = ParticleSystemRenderMode.Mesh;
            foreach (var s in specs)
            {
                ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
                var main = ps.main;
                main.loop = false; main.playOnAwake = false; main.duration = 5;
                main.startLifetime = 100f; main.startSpeed = 2f; main.startSize = 1f; main.maxParticles = 1000;
                main.simulationSpace = ParticleSystemSimulationSpace.Local; main.gravityModifier = 0;
                main.startRotation3D = s.rotation3D;
                main.startRotationX = s.startRotation.x * Mathf.Deg2Rad;
                main.startRotationY = s.startRotation.y * Mathf.Deg2Rad;
                main.startRotationZ = s.startRotation.z * Mathf.Deg2Rad;
                main.startRotation = s.startRotation.z * Mathf.Deg2Rad;
                var emission = ps.emission; emission.enabled = false;
                var shape = ps.shape; shape.enabled = true; shape.shapeType = s.shape; shape.radius = 1; shape.radiusThickness = 1;
                shape.angle = 25; shape.arc = 360; shape.rotation = s.shapeRotation; shape.alignToDirection = true;
                shape.randomDirectionAmount = 0; shape.sphericalDirectionAmount = 0;
                ps.Simulate(0f, true, true, false);
                ps.Emit(24);
                var particles = new ParticleSystem.Particle[ps.particleCount];
                ps.GetParticles(particles);
                var rows = new List<object>();
                foreach (var p in particles)
                {
                    var dir = p.velocity.normalized;
                    rows.Add(new { position = new[] { p.position.x, p.position.y, p.position.z }, direction = new[] { dir.x, dir.y, dir.z },
                        rotation3D = new[] { p.rotation3D.x, p.rotation3D.y, p.rotation3D.z } });
                }
                results.Add(new { s.name, shape = s.shape.ToString(), shapeRotation = new[] { s.shapeRotation.x, s.shapeRotation.y, s.shapeRotation.z },
                    startRotation = new[] { s.startRotation.x, s.startRotation.y, s.startRotation.z }, s.rotation3D, particles = rows });
            }
        }
        finally { Object.DestroyImmediate(go); }
        System.IO.File.WriteAllText("OUTPUT_FILE", JsonConvert.SerializeObject(results));
        return "ok " + results.Count;
    }
}
