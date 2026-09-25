using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;
using System.Collections;

namespace CcPlayable.UnityIntelligence.Capture
{
    /// <summary>
    /// Deterministic-time reference frames for Unity -> Cocos visual acceptance.
    /// Enters Play Mode, loads one scene, locks Time.captureFramerate and renders
    /// the chosen camera into a fixed-size RenderTexture at the requested frame
    /// numbers (frame N = N fixed steps after the scene's first Update). Writes
    /// PNGs plus a manifest, then leaves Play Mode. Edit-mode scenes are never
    /// saved or modified; Unity restores them when Play Mode ends.
    /// </summary>
    [InitializeOnLoad]
    public static class ReferenceCapture
    {
        const string PendingKey = "CcPlayable.ReferenceCapture.Request";

        [Serializable]
        public sealed class Request
        {
            public string scenePath = "";
            public string outputDir = "";
            public string cameraPath = "";
            public int width = 1280;
            public int height = 720;
            public int frameRate = 60;
            public int[] frames = Array.Empty<int>();
            public int randomSeed = 12345;
            public bool includeOverlayUi = false;
            /// <summary>Face size of an optional skybox-only panorama (0 = off).</summary>
            public int skyboxFaceSize = 0;
        }

        [Serializable]
        internal sealed class FrameRecord { public int frame; public float time; public string file = ""; public int activeParticles; public bool shaderCompiling; }

        [Serializable]
        internal sealed class Manifest
        {
            public string scenePath = "";
            public string camera = "";
            public int width;
            public int height;
            public int frameRate;
            public string unityVersion = "";
            public string colorSpace = "";
            public List<FrameRecord> frames = new List<FrameRecord>();
            public string error = "";
            public bool complete;
        }

        static ReferenceCapture()
        {
            EditorApplication.playModeStateChanged += OnPlayModeChanged;
        }

        /// <summary>Queue a capture and enter Play Mode. Returns immediately.</summary>
        public static string Begin(string requestJson)
        {
            var request = JsonUtility.FromJson<Request>(requestJson);
            if (request == null || string.IsNullOrEmpty(request.scenePath) || string.IsNullOrEmpty(request.outputDir))
                return "invalid request";
            if (EditorApplication.isPlayingOrWillChangePlaymode) return "editor is already in play mode";
            if (request.frames == null || request.frames.Length == 0) return "no frames requested";
            Directory.CreateDirectory(request.outputDir);
            File.Delete(Path.Combine(request.outputDir, "manifest.json"));
            SessionState.SetString(PendingKey, JsonUtility.ToJson(request));
            EditorApplication.EnterPlaymode();
            return "capture queued";
        }

        static void OnPlayModeChanged(PlayModeStateChange change)
        {
            if (change != PlayModeStateChange.EnteredPlayMode) return;
            var json = SessionState.GetString(PendingKey, "");
            if (string.IsNullOrEmpty(json)) return;
            SessionState.EraseString(PendingKey);
            var request = JsonUtility.FromJson<Request>(json);
            Time.captureFramerate = Math.Max(1, request.frameRate);
            UnityEngine.Random.InitState(request.randomSeed);
            var runner = new GameObject("CcPlayable Reference Capture") { hideFlags = HideFlags.HideAndDontSave };
            UnityEngine.Object.DontDestroyOnLoad(runner);
            runner.AddComponent<ReferenceCaptureRunner>().Configure(request);
            EditorSceneManager.LoadSceneInPlayMode(request.scenePath, new LoadSceneParameters(LoadSceneMode.Single));
        }

        internal static void Finish(Request request, Manifest manifest)
        {
            manifest.complete = string.IsNullOrEmpty(manifest.error);
            File.WriteAllText(Path.Combine(request.outputDir, "manifest.json"), JsonUtility.ToJson(manifest, true));
            Time.captureFramerate = 0;
            EditorApplication.ExitPlaymode();
        }

        internal static Manifest NewManifest(Request request) => new Manifest
        {
            scenePath = request.scenePath,
            width = request.width,
            height = request.height,
            frameRate = request.frameRate,
            unityVersion = Application.unityVersion,
            colorSpace = QualitySettings.activeColorSpace.ToString(),
        };

        internal static void Record(Manifest manifest, int frame, float time, string file, int particles, string camera, bool shaderCompiling)
        {
            manifest.camera = camera;
            manifest.frames.Add(new FrameRecord { frame = frame, time = time, file = file, activeParticles = particles, shaderCompiling = shaderCompiling });
        }

        internal static void Fail(Request request, Manifest manifest, string error)
        {
            manifest.error = error;
            Finish(request, manifest);
        }
    }

    [AddComponentMenu("")]
    public sealed class ReferenceCaptureRunner : MonoBehaviour
    {
        ReferenceCapture.Request request = new ReferenceCapture.Request();
        ReferenceCapture.Manifest manifest = null;
        readonly HashSet<int> pending = new HashSet<int>();
        int frame = -1;
        int lastFrame;
        bool sceneReady;
        bool skyboxDone;
        Camera captureCamera = null;
        RenderTexture target = null;

        internal void Configure(ReferenceCapture.Request value)
        {
            request = value;
            manifest = ReferenceCapture.NewManifest(value);
            foreach (var f in value.frames) { pending.Add(f); lastFrame = Math.Max(lastFrame, f); }
            SceneManager.sceneLoaded += OnSceneLoaded;
        }

        void OnSceneLoaded(Scene scene, LoadSceneMode mode)
        {
            if (scene.path != request.scenePath) return;
            SceneManager.sceneLoaded -= OnSceneLoaded;
            captureCamera = FindCamera(scene);
            if (captureCamera == null) { ReferenceCapture.Fail(request, manifest, "camera not found"); return; }
            target = new RenderTexture(request.width, request.height, 24, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB) { antiAliasing = 1 };
            sceneReady = true;
            frame = -1;
        }

        Camera FindCamera(Scene scene)
        {
            if (!string.IsNullOrEmpty(request.cameraPath))
            {
                foreach (var root in scene.GetRootGameObjects())
                {
                    var t = root.name == request.cameraPath ? root.transform : root.transform.Find(request.cameraPath.Substring(request.cameraPath.IndexOf('/') + 1));
                    if (t != null && t.GetComponent<Camera>()) return t.GetComponent<Camera>();
                }
            }
            if (Camera.main != null) return Camera.main;
            foreach (var root in scene.GetRootGameObjects())
            {
                var camera = root.GetComponentInChildren<Camera>();
                if (camera != null) return camera;
            }
            return null;
        }

        void Update()
        {
            if (!sceneReady) return;
            frame++;
            if (pending.Remove(frame)) StartCoroutine(CaptureAtEndOfFrame(frame));
            else if (frame > lastFrame) Done();
        }

        // Particle jobs finish in PostLateUpdate; end of frame is the state Unity displays.
        IEnumerator CaptureAtEndOfFrame(int captured)
        {
            yield return new WaitForEndOfFrame();
            if (!sceneReady) yield break;
            try
            {
                var file = $"frame-{captured:D5}.png";
                var shaderCompiling = ShaderUtil.anythingCompiling;
                Capture(Path.Combine(request.outputDir, file));
                var particles = 0;
                foreach (var system in FindObjectsByType<ParticleSystem>(FindObjectsSortMode.None)) particles += system.particleCount;
                ReferenceCapture.Record(manifest, captured, Time.time, file, particles, captureCamera.name, shaderCompiling);
                if (request.skyboxFaceSize > 0 && !skyboxDone) { skyboxDone = true; CaptureSkyboxPanorama(); }
            }
            catch (Exception exception)
            {
                sceneReady = false;
                ReferenceCapture.Fail(request, manifest, exception.Message);
                yield break;
            }
            if (pending.Count == 0) Done();
        }

        void CaptureSkyboxPanorama()
        {
            // Six 90-degree faces rendered with an empty culling mask show only
            // the camera clear (skybox) of this scene; they are reprojected into
            // an equirectangular image in Unity world space (+Z forward, +Y up).
            var size = request.skyboxFaceSize;
            var go = new GameObject("CcPlayable Skybox Capture") { hideFlags = HideFlags.HideAndDontSave };
            var camera = go.AddComponent<Camera>();
            camera.CopyFrom(captureCamera);
            camera.cullingMask = 0;
            camera.fieldOfView = 90;
            camera.aspect = 1;
            camera.rect = new Rect(0, 0, 1, 1);
            go.transform.position = captureCamera.transform.position;
            var faceTarget = new RenderTexture(size, size, 24, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
            var forwards = new[] { Vector3.right, Vector3.left, Vector3.up, Vector3.down, Vector3.forward, Vector3.back };
            var ups = new[] { Vector3.up, Vector3.up, Vector3.back, Vector3.forward, Vector3.up, Vector3.up };
            var faces = new Color[6][];
            try
            {
                for (var f = 0; f < 6; f++)
                {
                    go.transform.rotation = Quaternion.LookRotation(forwards[f], ups[f]);
                    RenderInto(camera, faceTarget);
                    var previous = RenderTexture.active;
                    RenderTexture.active = faceTarget;
                    var texture = new Texture2D(size, size, TextureFormat.RGB24, false);
                    texture.ReadPixels(new Rect(0, 0, size, size), 0, 0);
                    texture.Apply();
                    RenderTexture.active = previous;
                    faces[f] = texture.GetPixels();
                    Destroy(texture);
                }
                int width = size * 4, height = size * 2;
                var panorama = new Texture2D(width, height, TextureFormat.RGB24, false);
                var pixels = new Color[width * height];
                for (var y = 0; y < height; y++)
                {
                    var latitude = ((y + 0.5f) / height - 0.5f) * Mathf.PI;
                    for (var x = 0; x < width; x++)
                    {
                        var longitude = ((x + 0.5f) / width) * 2 * Mathf.PI - Mathf.PI;
                        var d = new Vector3(Mathf.Sin(longitude) * Mathf.Cos(latitude), Mathf.Sin(latitude), Mathf.Cos(longitude) * Mathf.Cos(latitude));
                        pixels[y * width + x] = SampleFaces(faces, forwards, ups, size, d);
                    }
                }
                panorama.SetPixels(pixels);
                panorama.Apply();
                File.WriteAllBytes(Path.Combine(request.outputDir, "skybox-equirect.png"), panorama.EncodeToPNG());
                Destroy(panorama);
            }
            finally
            {
                faceTarget.Release();
                Destroy(go);
            }
        }

        static Color SampleFaces(Color[][] faces, Vector3[] forwards, Vector3[] ups, int size, Vector3 d)
        {
            var best = 0;
            var bestDot = float.NegativeInfinity;
            for (var f = 0; f < 6; f++)
            {
                var dot = Vector3.Dot(d, forwards[f]);
                if (dot > bestDot) { bestDot = dot; best = f; }
            }
            var forward = forwards[best];
            var up = ups[best];
            var right = Vector3.Cross(up, forward);
            var u = Vector3.Dot(d, right) / bestDot;
            var v = Vector3.Dot(d, up) / bestDot;
            var px = Mathf.Clamp(Mathf.FloorToInt((u * 0.5f + 0.5f) * size), 0, size - 1);
            var py = Mathf.Clamp(Mathf.FloorToInt((v * 0.5f + 0.5f) * size), 0, size - 1);
            return faces[best][py * size + px];
        }

        static void RenderInto(Camera camera, RenderTexture destination)
        {
            var standard = new RenderPipeline.StandardRequest();
            if (RenderPipeline.SupportsRenderRequest(camera, standard))
            {
                standard.destination = destination;
                RenderPipeline.SubmitRenderRequest(camera, standard);
                return;
            }
            var previous = camera.targetTexture;
            camera.targetTexture = destination;
            camera.Render();
            camera.targetTexture = previous;
        }

        void Capture(string file)
        {
            var previous = captureCamera.targetTexture;
            var previousActive = RenderTexture.active;
            // The Editor draws variants that are still compiling with a flat cyan
            // placeholder; a reference frame must show the real shader.
            var previousAsync = ShaderUtil.allowAsyncCompilation;
            ShaderUtil.allowAsyncCompilation = false;
            try
            {
                var standard = new RenderPipeline.StandardRequest();
                if (RenderPipeline.SupportsRenderRequest(captureCamera, standard))
                {
                    standard.destination = target;
                    RenderPipeline.SubmitRenderRequest(captureCamera, standard);
                }
                else
                {
                    captureCamera.targetTexture = target;
                    captureCamera.Render();
                }
                RenderTexture.active = target;
                var texture = new Texture2D(request.width, request.height, TextureFormat.RGB24, false);
                texture.ReadPixels(new Rect(0, 0, request.width, request.height), 0, 0);
                texture.Apply();
                File.WriteAllBytes(file, texture.EncodeToPNG());
                Destroy(texture);
            }
            finally
            {
                ShaderUtil.allowAsyncCompilation = previousAsync;
                captureCamera.targetTexture = previous;
                RenderTexture.active = previousActive;
            }
        }

        void Done()
        {
            if (!sceneReady) return;
            sceneReady = false;
            ReferenceCapture.Finish(request, manifest);
        }

        void OnDestroy()
        {
            if (target != null) target.Release();
        }
    }
}
