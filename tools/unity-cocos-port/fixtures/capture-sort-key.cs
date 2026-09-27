using UnityEngine;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine.SceneManagement;
using System.Collections.Generic;
using Newtonsoft.Json;

// Read-only native oracle for URP transparent sorting of ParticleSystemRenderers.
// Two half-transparent particle systems (A red, B green) overlap at the image
// center; the sortingFudge on A where the top color flips is found by bisection.
// Everything lives in an isolated editor preview scene (PreviewRenderUtility
// pattern) and is destroyed; no open scene, active scene or asset is touched.
// Substitute OUTPUT_FILE.
public class Script {
    static Scene preview;
    static readonly List<Object> owned = new List<Object>();
    static Camera cam; static RenderTexture rt; static Texture2D tex; static Material mat, mat3001; static Mesh offsetMesh;
    static readonly Color Red = new Color(1, 0, 0, 0.5f), Green = new Color(0, 1, 0, 0.5f);
    static float[] V(Vector3 v) { return new[] { v.x, v.y, v.z }; }

    static GameObject Go(string name) {
        var go = EditorUtility.CreateGameObjectWithHideFlags(name, HideFlags.HideAndDontSave);
        SceneManager.MoveGameObjectToScene(go, preview); owned.Add(go); return go;
    }
    static ParticleSystem Make(string name, bool world) {
        var p = Go(name).AddComponent<ParticleSystem>();
        var main = p.main; main.simulationSpace = world ? ParticleSystemSimulationSpace.World : ParticleSystemSimulationSpace.Local;
        main.startLifetime = 100; main.startSpeed = 0; main.maxParticles = 16; main.scalingMode = ParticleSystemScalingMode.Hierarchy;
        var em = p.emission; em.enabled = false; var sh = p.shape; sh.enabled = false;
        var r = p.GetComponent<ParticleSystemRenderer>(); r.sharedMaterial = mat; r.maxParticleSize = 100;
        r.renderMode = ParticleSystemRenderMode.Billboard; r.alignment = ParticleSystemRenderSpace.View;
        p.Play(); p.Pause(); // a stopped system in a preview scene discards SetParticles
        return p;
    }
    static ParticleSystem.Particle P(Vector3 pos, float size, Color color, float remaining = 100) {
        return new ParticleSystem.Particle { position = pos, startSize = size, startSize3D = Vector3.one * size, startLifetime = 100, remainingLifetime = remaining, startColor = color };
    }
    static Color Center() {
        cam.Render();
        var active = RenderTexture.active; RenderTexture.active = rt;
        tex.ReadPixels(new Rect(0, 0, 16, 16), 0, 0); tex.Apply(); RenderTexture.active = active;
        return tex.GetPixel(8, 8);
    }
    static bool AOnTop() { var c = Center(); return c.r > c.g; }
    static object Flip(ParticleSystemRenderer a, float range) {
        float lo = -range, hi = range; a.sortingFudge = 0; bool zero = AOnTop();
        a.sortingFudge = lo; bool aLo = AOnTop(); a.sortingFudge = hi; bool aHi = AOnTop();
        if (aLo == aHi) { a.sortingFudge = 0; return new { flip = (float?)null, aOnTopEverywhere = aLo, aOnTopAtZero = zero }; }
        for (int i = 0; i < 20; i++) { float mid = 0.5f * (lo + hi); a.sortingFudge = mid; if (AOnTop() == aLo) lo = mid; else hi = mid; }
        a.sortingFudge = 0;
        return new { flip = (float?)(0.5f * (lo + hi)), aOnTopBelowFlip = aLo, aOnTopAtZero = zero };
    }

    public static string Main() {
        preview = EditorSceneManager.NewPreviewScene();
        var rows = new List<object>(); string error = null;
        try {
            mat = new Material(Shader.Find("LegacyPreview/URP Effect")); mat.hideFlags = HideFlags.HideAndDontSave; mat.SetColor("_TintColor", Color.white);
            mat3001 = new Material(mat); mat3001.hideFlags = HideFlags.HideAndDontSave; mat3001.renderQueue = 3001;
            rt = new RenderTexture(16, 16, 24, RenderTextureFormat.ARGB32, RenderTextureReadWrite.Linear); rt.hideFlags = HideFlags.HideAndDontSave;
            tex = new Texture2D(16, 16, TextureFormat.RGBA32, false, true); tex.hideFlags = HideFlags.HideAndDontSave;
            offsetMesh = new Mesh(); offsetMesh.hideFlags = HideFlags.HideAndDontSave;
            offsetMesh.vertices = new[] { new Vector3(-20, -20, 3), new Vector3(20, -20, 3), new Vector3(20, 20, 3), new Vector3(-20, 20, 3) };
            offsetMesh.triangles = new[] { 0, 1, 2, 0, 2, 3, 2, 1, 0, 3, 2, 0 }; offsetMesh.RecalculateBounds();
            cam = Go("sort oracle camera").AddComponent<Camera>(); cam.scene = preview;
            cam.transform.position = Vector3.zero; cam.transform.rotation = Quaternion.identity; cam.orthographicSize = 10;
            cam.clearFlags = CameraClearFlags.SolidColor; cam.backgroundColor = Color.black; cam.nearClipPlane = 0.1f; cam.farClipPlane = 1000; cam.fieldOfView = 60; cam.targetTexture = rt;
            var b = Make("B green", true); var rb = b.GetComponent<ParticleSystemRenderer>();
            System.Action<string, ParticleSystem, ParticleSystem.Particle[], Vector3, float, float> run = (name, a, aParticles, bPos, bSize, range) => {
                a.SetParticles(aParticles, aParticles.Length);
                b.transform.position = bPos; b.SetParticles(new[] { P(bPos, bSize, Green) }, 1);
                Center(); // renderer bounds are refreshed by culling
                var ra = a.GetComponent<ParticleSystemRenderer>();
                var t = Flip(ra, range);
                rows.Add(new { name, orthographic = cam.orthographic, camera = V(cam.transform.position), aPivot = V(a.transform.position),
                    aParticles = System.Array.ConvertAll(aParticles, p => V(p.position)), aSizes = System.Array.ConvertAll(aParticles, p => p.startSize),
                    aSimulationSpace = a.main.simulationSpace.ToString(), aRenderMode = ra.renderMode.ToString(), aSortMode = ra.sortMode.ToString(),
                    aSortingOrder = ra.sortingOrder, aQueue = ra.sharedMaterial.renderQueue, aLengthScale = ra.lengthScale, aVelocityScale = ra.velocityScale,
                    aVelocities = System.Array.ConvertAll(aParticles, p => V(p.velocity)),
                    aBoundsCenter = V(ra.bounds.center), bBoundsCenter = V(rb.bounds.center), result = t });
            };
            System.Func<string, ParticleSystem> fresh = name => { var a = Make(name, true); return a; };
            // Warm-up: the first render of a new preview scene can precede particle data.
            var warm = fresh("warm"); warm.SetParticles(new[] { P(new Vector3(0, 0, 10), 20, Red) }, 1); Center(); Center(); Object.DestroyImmediate(warm.gameObject);

            ParticleSystem A;
            A = fresh("A"); A.transform.position = new Vector3(0, 0, 10); run("axis-near", A, new[] { P(new Vector3(0, 0, 10), 20, Red) }, new Vector3(0, 0, 12), 20, 60); Object.DestroyImmediate(A.gameObject);
            A = fresh("A"); A.transform.position = new Vector3(0, 0, 40); run("axis-far", A, new[] { P(new Vector3(0, 0, 40), 80, Red) }, new Vector3(0, 0, 42), 80, 300); Object.DestroyImmediate(A.gameObject);
            A = fresh("A"); A.transform.position = new Vector3(6, 0, 10); run("offaxis-x", A, new[] { P(new Vector3(6, 0, 10), 30, Red) }, new Vector3(0, 0, 12), 30, 60); Object.DestroyImmediate(A.gameObject);
            A = fresh("A"); A.transform.position = new Vector3(0, 5, 10); run("offaxis-y", A, new[] { P(new Vector3(0, 5, 10), 30, Red) }, new Vector3(0, 0, 11.5f), 30, 60); Object.DestroyImmediate(A.gameObject);
            cam.orthographic = true;
            A = fresh("A"); A.transform.position = new Vector3(6, 0, 10); run("ortho-offaxis-x", A, new[] { P(new Vector3(6, 0, 10), 30, Red) }, new Vector3(0, 0, 12), 30, 60); Object.DestroyImmediate(A.gameObject);
            cam.orthographic = false;
            A = fresh("A"); A.transform.position = new Vector3(0, 0, 30); run("pivot-far-particle-near", A, new[] { P(new Vector3(0, 0, 10), 20, Red) }, new Vector3(0, 0, 12), 20, 60); Object.DestroyImmediate(A.gameObject);
            A = fresh("A"); A.transform.position = new Vector3(0, 0, 1); run("pivot-near-particle-far", A, new[] { P(new Vector3(0, 0, 14), 30, Red) }, new Vector3(0, 0, 12), 30, 60); Object.DestroyImmediate(A.gameObject);
            A = fresh("A"); A.transform.position = new Vector3(0, 0, 10); run("two-particles-extent", A, new[] { P(new Vector3(0, 0, 10), 20, Red), P(new Vector3(0, 0, 14), 26, Red) }, new Vector3(0, 0, 13), 20, 60); Object.DestroyImmediate(A.gameObject);
            // Local simulation under a rotated, scaled parent: sort point = localToWorld * local AABB center.
            var parent = Go("parent"); parent.transform.position = new Vector3(3, 0, 6); parent.transform.rotation = Quaternion.Euler(0, 90, 0); parent.transform.localScale = new Vector3(2, 2, 2);
            A = Make("A local", false); A.transform.SetParent(parent.transform, false);
            run("local-space-rotated-scaled-parent", A, new[] { P(new Vector3(1.5f, 0, 0), 15, Red) }, new Vector3(0, 0, 12), 30, 60); Object.DestroyImmediate(A.gameObject);
            // Mesh particle whose mesh is offset +3 on its local Z: the mesh offset is not part of the sort point.
            A = fresh("A mesh"); A.transform.position = new Vector3(0, 0, 10);
            { var ra = A.GetComponent<ParticleSystemRenderer>(); ra.renderMode = ParticleSystemRenderMode.Mesh; ra.alignment = ParticleSystemRenderSpace.World; ra.mesh = offsetMesh; }
            run("mesh-offset-plus3", A, new[] { P(new Vector3(0, 0, 10), 1, Red) }, new Vector3(0, 0, 12), 20, 60); Object.DestroyImmediate(A.gameObject);
            // Stretched billboard: head at y=-45 moving -Y, tail extends lengthScale*size = 90 up to y=+45.
            A = fresh("A stretched"); A.transform.position = new Vector3(0, -45, 10);
            { var ra = A.GetComponent<ParticleSystemRenderer>(); ra.renderMode = ParticleSystemRenderMode.Stretch; ra.lengthScale = 3; ra.velocityScale = 0; }
            { var sp = P(new Vector3(0, -45, 10), 30, Red); sp.velocity = new Vector3(0, -4, 0); run("stretched-tail", A, new[] { sp }, new Vector3(0, 0, 12), 30, 60); }
            Object.DestroyImmediate(A.gameObject);
            // Sort mode on A does not change the renderer-level key.
            foreach (var mode in new[] { ParticleSystemSortMode.YoungestInFront, ParticleSystemSortMode.Distance }) {
                A = fresh("A sorted"); A.transform.position = new Vector3(0, 0, 10); A.GetComponent<ParticleSystemRenderer>().sortMode = mode;
                run("sortmode-" + mode + "-on-A", A, new[] { P(new Vector3(0, 0, 10), 20, Red) }, new Vector3(0, 0, 12), 20, 60); Object.DestroyImmediate(A.gameObject);
            }
            // Precedence: sortingOrder, then render queue, then distance + fudge.
            System.Action<string, Vector3, int, Material> precedence = (name, pos, order, material) => {
                A = fresh("A precedence"); A.transform.position = pos; var ra = A.GetComponent<ParticleSystemRenderer>(); ra.sortingOrder = order; ra.sharedMaterial = material;
                run(name, A, new[] { P(pos, 20, Red) }, new Vector3(0, 0, 12), 20, 60); Object.DestroyImmediate(A.gameObject);
            };
            precedence("order-minus1-nearer", new Vector3(0, 0, 10), -1, mat);
            precedence("order-plus1-farther", new Vector3(0, 0, 14), 1, mat);
            precedence("queue3001-farther", new Vector3(0, 0, 14), 0, mat3001);
            precedence("queue3001-nearer", new Vector3(0, 0, 10), 0, mat3001);
            precedence("order-minus1-queue3001-nearer", new Vector3(0, 0, 10), -1, mat3001);
            // Intra-renderer order: one system, red older+nearer, green younger+farther, both buffer orders.
            b.Clear(); b.transform.position = new Vector3(0, 0, 500);
            var intra = new List<object>();
            foreach (ParticleSystemSortMode mode in new[] { ParticleSystemSortMode.None, ParticleSystemSortMode.OldestInFront, ParticleSystemSortMode.YoungestInFront, ParticleSystemSortMode.Distance, ParticleSystemSortMode.Depth }) {
                A = fresh("A intra"); A.transform.position = new Vector3(0, 0, 10); A.GetComponent<ParticleSystemRenderer>().sortMode = mode;
                A.SetParticles(new[] { P(new Vector3(0, 0, 10), 20, Red, 50), P(new Vector3(0, 0, 10.5f), 20, Green, 99) }, 2); var c1 = Center();
                A.SetParticles(new[] { P(new Vector3(0, 0, 10.5f), 20, Green, 99), P(new Vector3(0, 0, 10), 20, Red, 50) }, 2); var c2 = Center();
                intra.Add(new { mode = mode.ToString(), redOnTopWhenBufferRedFirst = c1.r > c1.g, redOnTopWhenBufferGreenFirst = c2.r > c2.g });
                Object.DestroyImmediate(A.gameObject);
            }
            rows.Add(new { name = "intra-renderer", note = "red: age 50 s at z=10; green: age 1 s at z=10.5", intra });
        } catch (System.Exception e) { error = e.ToString(); }
        finally {
            if (cam) cam.targetTexture = null;
            for (int i = owned.Count - 1; i >= 0; i--) if (owned[i]) Object.DestroyImmediate(owned[i]);
            foreach (var o in new Object[] { rt, tex, mat, mat3001, offsetMesh }) if (o) Object.DestroyImmediate(o);
            EditorSceneManager.ClosePreviewScene(preview);
        }
        var json = JsonConvert.SerializeObject(new { unity = Application.unityVersion,
            pipeline = UnityEngine.Rendering.GraphicsSettings.currentRenderPipeline == null ? null : UnityEngine.Rendering.GraphicsSettings.currentRenderPipeline.GetType().Name,
            transparencySortMode = UnityEngine.Rendering.GraphicsSettings.transparencySortMode.ToString(),
            commonTransparent = (int)UnityEngine.Rendering.SortingCriteria.CommonTransparent, error, rows }, Formatting.Indented);
        System.IO.File.WriteAllText("OUTPUT_FILE", json);
        return error == null ? "ok " + rows.Count : "error " + error;
    }
}
