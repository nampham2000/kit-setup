using UnityEngine;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine.SceneManagement;
using System.Collections.Generic;
using Newtonsoft.Json;

// Read-only native oracle: Unity rotation-over-lifetime integration and the final
// orientation of Mesh and Local-billboard particles (BakeMesh). Synthetic
// asymmetric mesh; everything lives in an isolated preview scene and is destroyed.
// No open scene, active scene or asset is touched. Substitute OUTPUT_FILE.
public class Script {
    static Scene preview;
    static readonly List<Object> owned = new List<Object>();
    static Camera cam; static Mesh mesh;
    static float[] V(Vector3 v) { return new[] { v.x, v.y, v.z }; }
    const float D = Mathf.Deg2Rad;

    static GameObject Go(string name) {
        var go = EditorUtility.CreateGameObjectWithHideFlags(name, HideFlags.HideAndDontSave);
        SceneManager.MoveGameObjectToScene(go, preview); owned.Add(go); return go;
    }
    static ParticleSystem Make(bool meshMode) {
        var go = Go(meshMode ? "rot oracle mesh" : "rot oracle local billboard");
        var p = go.AddComponent<ParticleSystem>();
        p.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
        var main = p.main; main.simulationSpace = ParticleSystemSimulationSpace.Local; main.startLifetime = 10; main.startSpeed = 0; main.maxParticles = 64;
        var em = p.emission; em.enabled = false; var sh = p.shape; sh.enabled = false;
        var r = go.GetComponent<ParticleSystemRenderer>();
        r.renderMode = meshMode ? ParticleSystemRenderMode.Mesh : ParticleSystemRenderMode.Billboard;
        r.alignment = ParticleSystemRenderSpace.Local;
        if (meshMode) r.mesh = mesh;
        return p;
    }
    static ParticleSystem.MinMaxCurve C(float degPerSecond) { return new ParticleSystem.MinMaxCurve(degPerSecond * D); }

    static object Run(string name, bool meshMode, Vector3 start, bool separate, ParticleSystem.MinMaxCurve x, ParticleSystem.MinMaxCurve y, ParticleSystem.MinMaxCurve z,
                      float lifetime, int steps, float dt) {
        var p = Make(meshMode);
        try {
            var rot = p.rotationOverLifetime; rot.enabled = true; rot.separateAxes = separate;
            if (separate) { rot.x = x; rot.y = y; rot.z = z; } else rot.z = z;
            var particle = new ParticleSystem.Particle { position = Vector3.zero, startSize3D = Vector3.one, startSize = 1, rotation3D = start,
                startLifetime = lifetime, remainingLifetime = lifetime, startColor = Color.white, randomSeed = 12345 };
            // A stopped system in a preview scene discards SetParticles; make it alive first.
            p.Play(); p.Pause();
            p.SetParticles(new[] { particle }, 1);
            var trace = new List<float[]>();
            var buffer = new ParticleSystem.Particle[1];
            int before = p.GetParticles(buffer);
            if (before != 1) return new { name, error = "SetParticles produced " + before + " particles" };
            for (int i = 0; i < steps; i++) {
                p.Simulate(dt, false, false, false);
                if (p.GetParticles(buffer) != 1) return new { name, error = "particle lost at step " + i };
                trace.Add(V(buffer[0].rotation3D));
            }
            var baked = new Mesh(); baked.hideFlags = HideFlags.HideAndDontSave;
            p.GetComponent<ParticleSystemRenderer>().BakeMesh(baked, cam, true);
            var verts = new List<float[]>(); foreach (var v in baked.vertices) verts.Add(V(v));
            var uv = new List<float[]>(); foreach (var v in baked.uv) uv.Add(new[] { v.x, v.y });
            Object.DestroyImmediate(baked);
            return new { name, renderMode = meshMode ? "Mesh" : "Billboard", alignment = "Local", start = V(start), separateAxes = separate,
                lifetime, steps, dt, finalRotation3D = trace[trace.Count - 1], trace = steps <= 40 ? trace : null, vertices = verts, uv };
        } finally { Object.DestroyImmediate(p.gameObject); }
    }

    public static string Main() {
        preview = EditorSceneManager.NewPreviewScene();
        var rows = new List<object>(); string error = null;
        try {
            mesh = new Mesh(); mesh.hideFlags = HideFlags.HideAndDontSave;
            mesh.vertices = new[] { Vector3.zero, Vector3.right, Vector3.up, Vector3.forward };
            mesh.triangles = new[] { 0, 1, 2, 0, 2, 3 }; mesh.RecalculateNormals();
            var camGo = Go("rot oracle camera"); cam = camGo.AddComponent<Camera>(); cam.scene = preview;
            cam.transform.position = new Vector3(0, 0, -10); cam.enabled = false;
            var zero = C(0);
            // Integration and composition with the axes used by the flagged ARPG renderers.
            rows.Add(Run("mesh-sep0-z90-start3d", true, new Vector3(30, 40, 20), false, zero, zero, C(90), 10, 20, 0.025f));
            rows.Add(Run("mesh-sep1-xyz", true, new Vector3(-20, 75, 135), true, C(60), C(90), C(120), 10, 10, 0.025f));
            rows.Add(Run("mesh-questzone1-verticalglow", true, new Vector3(270, 0, 360), true, zero, C(60), zero, 10, 20, 0.025f));
            rows.Add(Run("mesh-questzone2-verticalglow", true, new Vector3(270, 90, 180), true, zero, C(180), zero, 10, 20, 0.025f));
            rows.Add(Run("mesh-circleitem-verticalglow", true, new Vector3(270, 0, 144), true, zero, C(60), zero, 10, 20, 0.025f));
            rows.Add(Run("mesh-channelrings", true, new Vector3(0, 60, 120), false, zero, zero, C(45), 10, 20, 0.025f));
            rows.Add(Run("mesh-iconstar-x-only", true, new Vector3(0, -90, 0), true, C(25), zero, zero, 10, 20, 0.025f));
            rows.Add(Run("billboard-local-sep1-xyz", false, new Vector3(30, 40, 50), true, C(60), C(90), C(120), 10, 10, 0.025f));
            rows.Add(Run("billboard-local-sep0-z", false, new Vector3(30, 40, 50), false, zero, zero, C(90), 10, 20, 0.025f));
            // Evaluation point of a lifetime curve: omega_z(age) = 360 deg/s * age, lifetime 1 s.
            var ramp = new ParticleSystem.MinMaxCurve(360 * D, AnimationCurve.Linear(0, 0, 1, 1));
            rows.Add(Run("timing-ramp-40x0.025", true, Vector3.zero, false, zero, zero, ramp, 1, 40, 0.025f));
            rows.Add(Run("timing-ramp-4x0.25", true, Vector3.zero, false, zero, zero, ramp, 1, 4, 0.25f));
            rows.Add(Run("timing-ramp-1x1.0", true, Vector3.zero, false, zero, zero, ramp, 1.0001f, 1, 1.0f));

            // Random-between-two-constants: does Unity share one random value across axes?
            var pr = Make(true);
            try {
                var rot = pr.rotationOverLifetime; rot.enabled = true; rot.separateAxes = true;
                rot.x = new ParticleSystem.MinMaxCurve(0, 360 * D); rot.y = new ParticleSystem.MinMaxCurve(0, 360 * D); rot.z = new ParticleSystem.MinMaxCurve(0, 360 * D);
                var main = pr.main; main.startRotation3D = true; main.startRotationX = 0; main.startRotationY = 0; main.startRotationZ = 0; main.startLifetime = 10;
                pr.Emit(12);
                for (int i = 0; i < 10; i++) pr.Simulate(0.025f, false, false, false);
                var buf = new ParticleSystem.Particle[12]; int n = pr.GetParticles(buf);
                var samples = new List<float[]>(); for (int i = 0; i < n; i++) samples.Add(V(buf[i].rotation3D));
                rows.Add(new { name = "random-two-constants-per-axis", time = 0.25, rangeDegPerSecond = new[] { 0, 360 }, rotation3D = samples });
            } finally { Object.DestroyImmediate(pr.gameObject); }
        } catch (System.Exception e) { error = e.ToString(); }
        finally {
            foreach (var o in owned) if (o) Object.DestroyImmediate(o);
            if (mesh) Object.DestroyImmediate(mesh);
            EditorSceneManager.ClosePreviewScene(preview);
        }
        var json = JsonConvert.SerializeObject(new { unity = Application.unityVersion, maximumParticleDeltaTime = Time.maximumParticleDeltaTime,
            mesh = new[] { new[] { 0f, 0, 0 }, new[] { 1f, 0, 0 }, new[] { 0f, 1, 0 }, new[] { 0f, 0, 1 } }, error, rows }, Formatting.Indented);
        System.IO.File.WriteAllText("OUTPUT_FILE", json);
        return error == null ? "ok " + rows.Count : "error " + error;
    }
}
