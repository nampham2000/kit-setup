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
            /// <summary>
            /// Prefabs instantiated during the Update of a given frame, for demos that only
            /// spawn effects on user input (click/keys). Keeps the prefab's own rotation
            /// unless useRotation is set.
            /// </summary>
            public Spawn[] spawns = Array.Empty<Spawn>();
            /// <summary>Disable demo cyclers in Play Mode before Start when isolating a spawned source prefab.</summary>
            public string[] disableComponents = Array.Empty<string>();
            /// <summary>
            /// Field values set by reflection on every component of the named type once the
            /// scene has loaded (after Awake/OnEnable, before Start), e.g. the effect index of
            /// a demo cycler. Supports int, float, bool and string fields (public or private).
            /// </summary>
            public FieldOverride[] fields = Array.Empty<FieldOverride>();
        }

        [Serializable]
        public sealed class FieldOverride
        {
            public string component = "";
            public string field = "";
            public string value = "";
        }

        [Serializable]
        public sealed class Spawn
        {
            public string prefab = "";
            public int frame;
            public Vector3 position;
            public bool useRotation;
            public Vector3 eulerAngles;
        }

        [Serializable]
        internal sealed class FrameRecord { public int frame; public float time; public string file = ""; public int activeParticles; public bool shaderCompiling; public List<SystemRecord> systems = new List<SystemRecord>(); public List<TrailRecord> trails = new List<TrailRecord>(); public List<CollisionRecord> collisions = new List<CollisionRecord>(); public List<LightRecord> lights = new List<LightRecord>(); }

        [Serializable]
        internal sealed class TrailRecord { public string path; public float time; public float width; public float[] position; public float[] positions; public float[] vertices; public float[] uv; public float[] color; public int[] indices; }
        [Serializable]
        internal sealed class CollisionRecord { public string actor; public string collider; public float time; public float fixedTime; public float[] position; public float[] velocity; public int contacts; public bool sleeping; }
        [Serializable]
        internal sealed class LightRecord { public string path; public int type; public float[] position; public float[] color; public float intensity; public float range; public int renderMode; }

        internal static List<LightRecord> Lights() {
            var records = new List<LightRecord>();
            foreach (var light in UnityEngine.Object.FindObjectsOfType<Light>()) {
                if (!light.enabled || !light.gameObject.activeInHierarchy) continue;
                var c = light.color;
                records.Add(new LightRecord { path=HierarchyPath(light.transform),type=(int)light.type,position=VectorValues(light.transform.position),color=new[]{c.r,c.g,c.b,c.a},intensity=light.intensity,range=light.range,renderMode=(int)light.renderMode });
            }
            return records;
        }

        /// <summary>
        /// Per-system particle oracle: live count plus a histogram of particle depth along
        /// the capture camera's forward axis (bins split at DepthBins), so a port can tell
        /// where particles are, not only how many exist.
        /// </summary>
        [Serializable]
        internal sealed class ParticlePose {
            public float[] position; public float[] velocity; public float[] size;
            public float[] color; public float[] rotation; public float remainingLifetime; public float startLifetime;
        }
        [Serializable]
        internal sealed class SystemRecord {
            public string path = ""; public int count; public int alive; public float simulationTime; public float simulationSpeed;
            public int[] depth = Array.Empty<int>(); public int[] inView = Array.Empty<int>();
            public float[] position; public float[] rotation; public float[] scale; public float[] matrix;
            public float[] meanWorldPosition; public float[] meanSize; public float[] meanColor;
            public List<ParticlePose> particles = new List<ParticlePose>();
        }

        internal static float[] VectorValues(Vector3 vector) { return new[] { vector.x, vector.y, vector.z }; }

        internal static readonly float[] DepthBins = { 0.3f, 1f, 2f, 4f, 8f, 16f };

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

        internal static void Record(Manifest manifest, int frame, float time, string file, List<SystemRecord> systems, string camera, bool shaderCompiling)
        {
            manifest.camera = camera;
            var particles = 0;
            foreach (var system in systems) particles += system.count;
            manifest.frames.Add(new FrameRecord { frame = frame, time = time, file = file, activeParticles = particles, shaderCompiling = shaderCompiling, systems = systems });
        }

        internal static string HierarchyPath(Transform t) => t.parent == null ? t.name : HierarchyPath(t.parent) + "/" + t.name;

        internal static List<SystemRecord> ParticleSystems(Camera camera)
        {
            var records = new List<SystemRecord>();
            var buffer = Array.Empty<ParticleSystem.Particle>();
            var eye = camera.transform.position;
            var forward = camera.transform.forward;
            foreach (var system in UnityEngine.Object.FindObjectsByType<ParticleSystem>(FindObjectsSortMode.None))
            {
                var record = new SystemRecord { path = HierarchyPath(system.transform), count = system.particleCount, depth = new int[DepthBins.Length + 1], inView = new int[DepthBins.Length + 1] };
                var transform = system.transform; var quaternion = transform.rotation; var matrix = transform.localToWorldMatrix;
                record.position = VectorValues(transform.position); record.rotation = new[] { quaternion.x, quaternion.y, quaternion.z, quaternion.w };
                record.scale = VectorValues(transform.lossyScale); record.matrix = new float[16];
                for (var index = 0; index < 16; index++) record.matrix[index] = matrix[index];
                if (buffer.Length < system.particleCount) buffer = new ParticleSystem.Particle[system.particleCount];
                var n = system.GetParticles(buffer);
                var main = system.main;
                record.simulationTime=system.time;record.simulationSpeed=main.simulationSpeed;
                var toWorld = main.simulationSpace == ParticleSystemSimulationSpace.World ? Matrix4x4.identity
                    : main.simulationSpace == ParticleSystemSimulationSpace.Custom && main.customSimulationSpace != null ? main.customSimulationSpace.localToWorldMatrix
                    : system.transform.localToWorldMatrix;
                var meanPosition = Vector3.zero; var meanSize = Vector3.zero; var meanColor = Color.clear;
                for (var i = 0; i < n; i++)
                {
                    if(buffer[i].remainingLifetime>0)record.alive++;
                    var world = toWorld.MultiplyPoint3x4(buffer[i].position);
                    var size = buffer[i].GetCurrentSize3D(system); Color color = buffer[i].GetCurrentColor(system);
                    meanPosition += world; meanSize += size; meanColor += color;
                    if (i < 8) record.particles.Add(new ParticlePose {
                        position = VectorValues(buffer[i].position), velocity = VectorValues(buffer[i].velocity), size = VectorValues(size),
                        color = new[] { color.r, color.g, color.b, color.a }, rotation = VectorValues(buffer[i].rotation3D),
                        remainingLifetime = buffer[i].remainingLifetime, startLifetime = buffer[i].startLifetime,
                    });
                    var d = Vector3.Dot(world - eye, forward);
                    var bin = 0;
                    while (bin < DepthBins.Length && d >= DepthBins[bin]) bin++;
                    record.depth[bin]++;
                    // Particle centre inside the capture viewport, in front of the near plane.
                    var v = camera.WorldToViewportPoint(world);
                    if (v.z >= camera.nearClipPlane && v.x >= 0f && v.x <= 1f && v.y >= 0f && v.y <= 1f) record.inView[bin]++;
                }
                record.meanWorldPosition = VectorValues(n > 0 ? meanPosition / n : meanPosition);
                record.meanSize = VectorValues(n > 0 ? meanSize / n : meanSize);
                if (n > 0) meanColor /= n;
                record.meanColor = new[] { meanColor.r, meanColor.g, meanColor.b, meanColor.a };
                records.Add(record);
            }
            records.Sort((a, b) => string.CompareOrdinal(a.path, b.path));
            return records;
        }

        internal static float[] Flatten(Vector3[] values) {
            var flat = new float[values.Length * 3]; for(var i=0;i<values.Length;i++) { flat[i*3]=values[i].x;flat[i*3+1]=values[i].y;flat[i*3+2]=values[i].z; } return flat;
        }
        internal static List<TrailRecord> Trails(Camera camera) {
            var records = new List<TrailRecord>();
            foreach(var trail in UnityEngine.Object.FindObjectsByType<TrailRenderer>(FindObjectsSortMode.None)) {
                var mesh=new Mesh();
                try {
                    trail.BakeMesh(mesh,camera,true);var positions=new Vector3[trail.positionCount];trail.GetPositions(positions);
                    var uv=mesh.uv;var colors=mesh.colors;var flatUV=new float[uv.Length*2];var flatColor=new float[colors.Length*4];
                    for(var i=0;i<uv.Length;i++){flatUV[i*2]=uv[i].x;flatUV[i*2+1]=uv[i].y;}
                    for(var i=0;i<colors.Length;i++){flatColor[i*4]=colors[i].r;flatColor[i*4+1]=colors[i].g;flatColor[i*4+2]=colors[i].b;flatColor[i*4+3]=colors[i].a;}
                    records.Add(new TrailRecord{path=HierarchyPath(trail.transform),time=trail.time,width=trail.widthMultiplier,position=VectorValues(trail.transform.position),positions=Flatten(positions),vertices=Flatten(mesh.vertices),uv=flatUV,color=flatColor,indices=mesh.triangles});
                }finally{UnityEngine.Object.DestroyImmediate(mesh);}
            }
            records.Sort((a,b)=>string.CompareOrdinal(a.path,b.path));return records;
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
        readonly List<ReferenceCapture.CollisionRecord> collisionEvents = new List<ReferenceCapture.CollisionRecord>();
        RenderTexture target = null;
        int batchCaptureFrame = -1;
        static ReferenceCaptureRunner batchOwner;
        sealed class BatchFrameHook { }

        // WaitForEndOfFrame is not invoked in Editor batch mode. Capture after
        // PostLateUpdate (including particle jobs) rather than earlier LateUpdate.
        static void SetBatchHook(bool install)
        {
            var loop = UnityEngine.LowLevel.PlayerLoop.GetCurrentPlayerLoop();
            for (var i = 0; i < loop.subSystemList.Length; i++)
            {
                if (loop.subSystemList[i].type != typeof(UnityEngine.PlayerLoop.PostLateUpdate)) continue;
                var phase = loop.subSystemList[i];
                var children = new List<UnityEngine.LowLevel.PlayerLoopSystem>(phase.subSystemList ?? Array.Empty<UnityEngine.LowLevel.PlayerLoopSystem>());
                children.RemoveAll(child => child.type == typeof(BatchFrameHook));
                if (install) children.Add(new UnityEngine.LowLevel.PlayerLoopSystem { type = typeof(BatchFrameHook), updateDelegate = BatchTick });
                phase.subSystemList = children.ToArray();
                loop.subSystemList[i] = phase;
                UnityEngine.LowLevel.PlayerLoop.SetPlayerLoop(loop);
                return;
            }
            throw new InvalidOperationException("PostLateUpdate missing from active PlayerLoop");
        }

        static void BatchTick()
        {
            var owner = batchOwner;
            if (owner == null || owner.batchCaptureFrame < 0) return;
            var captured = owner.batchCaptureFrame;
            owner.batchCaptureFrame = -1;
            owner.CaptureFrame(captured);
        }

        internal void Configure(ReferenceCapture.Request value)
        {
            request = value;
            manifest = ReferenceCapture.NewManifest(value);
            foreach (var f in value.frames) { pending.Add(f); lastFrame = Math.Max(lastFrame, f); }
            SceneManager.sceneLoaded += OnSceneLoaded;
            if (Application.isBatchMode) { batchOwner = this; SetBatchHook(true); }
        }

        void OnSceneLoaded(Scene scene, LoadSceneMode mode)
        {
            if (scene.path != request.scenePath) return;
            SceneManager.sceneLoaded -= OnSceneLoaded;
            foreach (var type in request.disableComponents ?? Array.Empty<string>())
            {
                var found = false;
                foreach (var root in scene.GetRootGameObjects())
                    foreach (var component in root.GetComponentsInChildren<MonoBehaviour>(true))
                        if (component != null && component.GetType().Name == type) { component.enabled = false; found = true; }
                if (!found) { ReferenceCapture.Fail(request, manifest, "no component to disable: " + type); return; }
            }
            foreach (var entry in request.fields ?? Array.Empty<ReferenceCapture.FieldOverride>())
            {
                var applied = 0;
                foreach (var root in scene.GetRootGameObjects())
                    foreach (var component in root.GetComponentsInChildren<MonoBehaviour>(true))
                    {
                        if (component == null || component.GetType().Name != entry.component) continue;
                        var field = component.GetType().GetField(entry.field, System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic);
                        if (field == null) continue;
                        var type = field.FieldType;
                        object value = type == typeof(int) ? int.Parse(entry.value, System.Globalization.CultureInfo.InvariantCulture)
                            : type == typeof(float) ? float.Parse(entry.value, System.Globalization.CultureInfo.InvariantCulture)
                            : type == typeof(bool) ? (object)bool.Parse(entry.value)
                            : type == typeof(string) ? entry.value : null;
                        if (value == null) { ReferenceCapture.Fail(request, manifest, $"unsupported field type {type.Name} for {entry.component}.{entry.field}"); return; }
                        field.SetValue(component, value);
                        applied++;
                    }
                if (applied == 0) { ReferenceCapture.Fail(request, manifest, $"no {entry.component}.{entry.field} in scene"); return; }
            }
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
            foreach (var spawn in request.spawns ?? Array.Empty<ReferenceCapture.Spawn>())
            {
                if (spawn.frame != frame) continue;
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(spawn.prefab);
                if (prefab == null) { ReferenceCapture.Fail(request, manifest, "spawn prefab not found: " + spawn.prefab); return; }
                var instance = Instantiate(prefab);
                instance.transform.position = spawn.position;
                if (spawn.useRotation) instance.transform.eulerAngles = spawn.eulerAngles;
                foreach(var body in instance.GetComponentsInChildren<Rigidbody>()) {
                    var observer=body.GetComponent<ReferenceCollisionObserver>() ?? body.gameObject.AddComponent<ReferenceCollisionObserver>();observer.owner=this;
                }
            }
            if (pending.Remove(frame))
            {
                if (Application.isBatchMode) batchCaptureFrame = frame;
                else StartCoroutine(CaptureAtEndOfFrame(frame));
            }
            else if (frame > lastFrame) Done();
        }

        // Particle jobs finish in PostLateUpdate; end of frame is the state Unity displays.
        IEnumerator CaptureAtEndOfFrame(int captured)
        {
            yield return new WaitForEndOfFrame();
            CaptureFrame(captured);
        }

        void CaptureFrame(int captured)
        {
            if (!sceneReady) return;
            try
            {
                var file = $"frame-{captured:D5}.png";
                var shaderCompiling = ShaderUtil.anythingCompiling;
                Capture(Path.Combine(request.outputDir, file));
                ReferenceCapture.Record(manifest, captured, Time.time, file, ReferenceCapture.ParticleSystems(captureCamera), captureCamera.name, shaderCompiling);
                var record=manifest.frames[manifest.frames.Count-1];record.trails=ReferenceCapture.Trails(captureCamera);record.collisions=new List<ReferenceCapture.CollisionRecord>(collisionEvents);record.lights=ReferenceCapture.Lights();
                if (request.skyboxFaceSize > 0 && !skyboxDone) { skyboxDone = true; CaptureSkyboxPanorama(); }
            }
            catch (Exception exception)
            {
                sceneReady = false;
                ReferenceCapture.Fail(request, manifest, exception.Message);
                return;
            }
            if (pending.Count == 0) Done();
        }

        internal void ObserveCollision(Transform actor, Collision collision) {
            var body=actor.GetComponent<Rigidbody>();var position=actor.position;var velocity=body!=null?body.velocity:Vector3.zero;
            collisionEvents.Add(new ReferenceCapture.CollisionRecord {actor=ReferenceCapture.HierarchyPath(actor),collider=ReferenceCapture.HierarchyPath(collision.collider.transform),time=Time.time,fixedTime=Time.fixedTime,position=ReferenceCapture.VectorValues(position),velocity=ReferenceCapture.VectorValues(velocity),contacts=collision.contactCount,sleeping=body!=null&&body.IsSleeping()});
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
            var expected = new HashSet<int>(request.frames).Count;
            if (manifest.frames.Count != expected)
            {
                ReferenceCapture.Fail(request, manifest, $"incomplete frame capture: expected {expected}, received {manifest.frames.Count}");
                return;
            }
            ReferenceCapture.Finish(request, manifest);
        }

        void OnDestroy()
        {
            SceneManager.sceneLoaded -= OnSceneLoaded;
            if (batchOwner == this) { batchOwner = null; SetBatchHook(false); }
            if (target != null) target.Release();
        }
    }

    public sealed class ReferenceCollisionObserver : MonoBehaviour {
        internal ReferenceCaptureRunner owner;
        void OnCollisionEnter(Collision collision) { if(owner!=null)owner.ObserveCollision(transform,collision); }
    }
}
