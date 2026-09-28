using UnityEngine; using UnityEditor; using UnityEngine.Rendering.Universal; using System.Text; using System.Globalization; using System.Linq; using System.Collections.Generic;
// Particle material oracle (edit mode, hidden objects only): renders one camera-facing billboard particle with a known
// vertex colour per material over known backgrounds, with the source camera orientation, and reads the centre pixel
// back from an sRGB RT (same encoding as the game capture). Records the active lights/ambient so a Cocos port can
// replay the exact material math (vertex-colour linearization, blend factors, lighting) instead of tuning screenshots.
// Run through the shared kit Unity-MCP runner:
//   node playable-shared-kit/tools/unity-intel/unity-mcp-script.cjs --project <UnityProjectRoot>
//     --script playable-shared-kit/tools/unity-cocos-port/unity-particle-material-oracle.cs --out <oracle.json>
//     --set "MATERIALS=Default-ParticleSystem;Assets/.../X.mat" --set CAMERA_EULER=40,60,0 --set LAYER=0
public class Script {
  static string N(float v){ return v.ToString("0.#####", CultureInfo.InvariantCulture); }
  static string V(params float[] v){ return "[" + string.Join(",", v.Select(N)) + "]"; }
  static string Q(string s){ return "\"" + s.Replace("\\", "/").Replace("\"", "'") + "\""; }
  public static string Main() {
    var materials = "MATERIALS".Split(new[]{";"}, System.StringSplitOptions.RemoveEmptyEntries);
    var euler = "CAMERA_EULER".Split(",").Select(v => float.Parse(v, CultureInfo.InvariantCulture)).ToArray();
    int layer = int.Parse("LAYER", CultureInfo.InvariantCulture);
    var scene = UnityEngine.SceneManagement.SceneManager.GetActiveScene(); bool dirty0 = scene.isDirty; var hf = HideFlags.HideAndDontSave;
    var camGO = new GameObject("ParityCam"){hideFlags=hf}; var cam = camGO.AddComponent<Camera>();
    cam.orthographic = true; cam.orthographicSize = 1; cam.clearFlags = CameraClearFlags.SolidColor; cam.cullingMask = 1 << layer;
    cam.nearClipPlane = 0.01f; cam.farClipPlane = 20; cam.allowMSAA = false; cam.allowHDR = false;
    camGO.transform.position = new Vector3(1000, 1000, 1000); camGO.transform.rotation = Quaternion.Euler(euler[0], euler[1], euler[2]);
    var ucd = camGO.AddComponent<UniversalAdditionalCameraData>(); ucd.renderPostProcessing = false; ucd.antialiasing = AntialiasingMode.None; ucd.renderShadows = false;
    var psGO = new GameObject("ParityPS"){hideFlags=hf}; psGO.layer = layer; psGO.transform.position = camGO.transform.position + camGO.transform.forward * 5;
    var ps = psGO.AddComponent<ParticleSystem>(); ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
    var main = ps.main; main.playOnAwake = false; main.loop = false; main.simulationSpace = ParticleSystemSimulationSpace.World; main.maxParticles = 1; main.startSpeed = 0;
    var em = ps.emission; em.enabled = false; var sh = ps.shape; sh.enabled = false;
    var r = psGO.GetComponent<ParticleSystemRenderer>(); r.renderMode = ParticleSystemRenderMode.Billboard; r.maxParticleSize = 10;
    var rt = new RenderTexture(64, 64, 24, RenderTextureFormat.ARGB32); var tex = new Texture2D(64, 64, TextureFormat.RGBA32, false);
    var bgs = new[]{ new Color(0,0,0,1), new Color(0.5f,0.5f,0.5f,1), new Color(0.2f,0.4f,0.8f,1) };
    var vcs = new[]{ new Color(1,1,1,1), new Color(0.5f,0.5f,0.5f,1), new Color(1,1,1,0.5f), new Color(1,0.5f,0.25f,0.75f) };
    var sb = new StringBuilder("{");
    sb.Append("\"unityVersion\":" + Q(Application.unityVersion) + ",\"colorSpace\":" + Q(QualitySettings.activeColorSpace.ToString()) + ",\"layer\":" + layer + ",\"cameraEuler\":" + V(euler) + ",\"lights\":[");
    sb.Append(string.Join(",", Object.FindObjectsByType<Light>(FindObjectsSortMode.InstanceID).Where(l => l.isActiveAndEnabled).Select(l => "{\"name\":" + Q(l.name) + ",\"type\":" + Q(l.type.ToString()) + ",\"color\":" + V(l.color.r, l.color.g, l.color.b) + ",\"intensity\":" + N(l.intensity) + ",\"cullingMask\":" + l.cullingMask + ",\"forward\":" + V(l.transform.forward.x, l.transform.forward.y, l.transform.forward.z) + "}")));
    var amb = RenderSettings.ambientLight; var sky = RenderSettings.ambientSkyColor; var eq = RenderSettings.ambientEquatorColor; var gr = RenderSettings.ambientGroundColor;
    sb.Append("],\"ambient\":{\"mode\":" + Q(RenderSettings.ambientMode.ToString()) + ",\"color\":" + V(amb.r, amb.g, amb.b) + ",\"sky\":" + V(sky.r, sky.g, sky.b) + ",\"equator\":" + V(eq.r, eq.g, eq.b) + ",\"ground\":" + V(gr.r, gr.g, gr.b) + ",\"intensity\":" + N(RenderSettings.ambientIntensity) + "},\"materials\":[");
    bool firstMat = true;
    foreach (var mn in materials) {
      Material src = null; string srcPath = mn;
      if (mn.StartsWith("Default-")) { src = AssetDatabase.GetBuiltinExtraResource<Material>(mn + ".mat"); srcPath = "builtin:" + mn; }
      else if (mn.EndsWith(".mat")) src = AssetDatabase.LoadAssetAtPath<Material>(mn);
      if (!src) { sb.Append((firstMat ? "" : ",") + "{\"name\":" + Q(mn) + ",\"missing\":true}"); firstMat = false; continue; }
      sb.Append((firstMat ? "" : ",") + "{\"name\":" + Q(src.name) + ",\"path\":" + Q(srcPath) + ",\"shader\":" + Q(src.shader.name) + ",\"keywords\":[" + string.Join(",", src.shaderKeywords.Select(Q)) + "],\"samples\":[");
      firstMat = false; bool firstSample = true;
      foreach (var texMode in new[]{"white","own"}) {
        var mat = new Material(src){hideFlags=hf};
        if (texMode == "white") { foreach (var tp in new[]{"_MainTex","_BaseMap"}) if (mat.HasProperty(tp)) mat.SetTexture(tp, Texture2D.whiteTexture); }
        r.sharedMaterial = mat;
        foreach (var bg in bgs) foreach (var vc in vcs) {
          cam.backgroundColor = bg;
          var p = new ParticleSystem.Particle{ position = psGO.transform.position, startSize = 1.0f, startColor = vc, remainingLifetime = 50, startLifetime = 100 };
          ps.Play(); ps.SetParticles(new[]{ p }, 1); ps.Simulate(0.0001f, false, false, false); ps.SetParticles(new[]{ p }, 1);
          cam.targetTexture = rt; cam.Render(); cam.targetTexture = null;
          RenderTexture.active = rt; tex.ReadPixels(new Rect(0,0,64,64),0,0); tex.Apply(); RenderTexture.active = null;
          var c = tex.GetPixel(32, 32);
          sb.Append((firstSample ? "" : ",") + "{\"tex\":" + Q(texMode) + ",\"bg\":" + V(bg.r, bg.g, bg.b) + ",\"vc\":" + V(vc.r, vc.g, vc.b, vc.a) + ",\"out\":[" + Mathf.RoundToInt(c.r*255) + "," + Mathf.RoundToInt(c.g*255) + "," + Mathf.RoundToInt(c.b*255) + "],\"n\":" + ps.particleCount + "}");
          firstSample = false;
        }
        Object.DestroyImmediate(mat);
      }
      sb.Append("]}");
    }
    sb.Append("]}");
    Object.DestroyImmediate(psGO); Object.DestroyImmediate(camGO); rt.Release(); Object.DestroyImmediate(tex);
    var outPath = "OUTPUT_FILE"; System.IO.File.WriteAllText(outPath, sb.ToString());
    return "wrote " + outPath + " dirtyBefore=" + dirty0 + " dirtyAfter=" + scene.isDirty;
  } }
