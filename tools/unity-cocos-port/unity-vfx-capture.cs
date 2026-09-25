using UnityEngine; using UnityEditor; using UnityEngine.Rendering.Universal; using System.Globalization; using System.Linq; using System.Text;
// VFX reference capture for Unity -> Cocos particle parity (run in Play Mode on a frozen gameplay frame, e.g. paused
// at round start). For every effect, seed and time it instantiates the effect prefab at a world position with the
// prefab's own rotation, seeds every ParticleSystem (useAutoRandomSeed = false), simulates to the time with a fixed
// 1/60 s step (the Cocos harness steps the same way), renders Camera.main plus its overlay stack and writes a PNG.
// Particle randomness differs between engines, so parity is asserted on ROI metric ranges across seeds rather than
// on one frame. Run through the shared kit Unity-MCP runner:
//   node playable-shared-kit/tools/unity-intel/unity-mcp-script.cjs --project <UnityProjectRoot>
//     --script playable-shared-kit/tools/unity-cocos-port/unity-vfx-capture.cs --out <dir>/capture.json
//     --set "EFFECTS=shell|Assets/.../Explosion.prefab|x,y,z|0.05,0.15|6;..." --set WIDTH=1280 --set HEIGHT=720
public class Script {
  static string N(float v){ return v.ToString("0.#####", CultureInfo.InvariantCulture); }
  static Texture2D Grab(RenderTexture rt,int w,int h){ RenderTexture.active = rt; var t = new Texture2D(w,h,TextureFormat.RGBA32,false); t.ReadPixels(new Rect(0,0,w,h),0,0); t.Apply(); RenderTexture.active = null; return t; }
  static Color32[] Render(Camera cam, int w, int h) {
    var rt = new RenderTexture(w,h,24, RenderTextureFormat.ARGB32);
    var data = cam.GetUniversalAdditionalCameraData();
    var stack = data != null ? new System.Collections.Generic.List<Camera>(data.cameraStack) : new System.Collections.Generic.List<Camera>();
    var prev = cam.targetTexture; cam.targetTexture = rt; cam.Render(); cam.targetTexture = prev;
    var world = Grab(rt,w,h); var px = world.GetPixels32(); Object.DestroyImmediate(world); rt.Release();
    foreach (var oc in stack) { if (!oc || !oc.isActiveAndEnabled) continue; var od = oc.GetUniversalAdditionalCameraData(); var rtType = od.renderType; var cf = oc.clearFlags; var bg = oc.backgroundColor; var pt = oc.targetTexture;
      var rt2 = new RenderTexture(w,h,24, RenderTextureFormat.ARGB32);
      data.cameraStack.Remove(oc); od.renderType = CameraRenderType.Base; oc.clearFlags = CameraClearFlags.SolidColor; oc.backgroundColor = new Color(0,0,0,0); oc.targetTexture = rt2; oc.Render();
      oc.targetTexture = pt; oc.clearFlags = cf; oc.backgroundColor = bg; od.renderType = rtType; data.cameraStack.Add(oc);
      var tex = Grab(rt2,w,h); var ui = tex.GetPixels32(); Object.DestroyImmediate(tex); rt2.Release();
      for (int i=0;i<px.Length;i++){ float a = ui[i].a/255f; if (a<=0) continue; px[i].r=(byte)(ui[i].r*a+px[i].r*(1-a)); px[i].g=(byte)(ui[i].g*a+px[i].g*(1-a)); px[i].b=(byte)(ui[i].b*a+px[i].b*(1-a)); } }
    return px;
  }
  static void Save(Color32[] px, int w, int h, string file){ var t = new Texture2D(w,h,TextureFormat.RGBA32,false); t.SetPixels32(px); t.Apply(); System.IO.File.WriteAllBytes(file, t.EncodeToPNG()); Object.DestroyImmediate(t); }
  public static string Main() {
    var cam = Camera.main; if (!cam) return "no Camera.main";
    int w = int.Parse("WIDTH"), h = int.Parse("HEIGHT"); cam.aspect = (float)w / h;
    var outFile = "OUTPUT_FILE"; var dir = System.IO.Path.GetDirectoryName(outFile); System.IO.Directory.CreateDirectory(dir);
    var json = new StringBuilder("{\"unityVersion\":\"" + Application.unityVersion + "\",\"width\":" + w + ",\"height\":" + h
      + ",\"camera\":{\"position\":[" + N(cam.transform.position.x) + "," + N(cam.transform.position.y) + "," + N(cam.transform.position.z) + "],\"euler\":[" + N(cam.transform.eulerAngles.x) + "," + N(cam.transform.eulerAngles.y) + "," + N(cam.transform.eulerAngles.z) + "],\"orthographicSize\":" + N(cam.orthographicSize) + "},\"captures\":[");
    Save(Render(cam, w, h), w, h, System.IO.Path.Combine(dir, "background.png"));
    float fixedDt = Time.fixedDeltaTime; Time.fixedDeltaTime = 1f / 60f; bool first = true;
    try {
      foreach (var spec in "EFFECTS".Split(new[]{';'}, System.StringSplitOptions.RemoveEmptyEntries)) {
        var parts = spec.Split('|'); var name = parts[0]; var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(parts[1]);
        if (!prefab) return "missing prefab " + parts[1];
        var p = parts[2].Split(',').Select(v => float.Parse(v, CultureInfo.InvariantCulture)).ToArray();
        var times = parts[3].Split(',').Select(v => float.Parse(v, CultureInfo.InvariantCulture)).ToArray(); int seeds = int.Parse(parts[4]);
        for (int seed = 1; seed <= seeds; seed++) foreach (var t in times) {
          var go = Object.Instantiate(prefab, new Vector3(p[0], p[1], p[2]), prefab.transform.rotation); go.hideFlags = HideFlags.DontSave;
          var systems = go.GetComponentsInChildren<ParticleSystem>(true); int index = 0;
          foreach (var ps in systems) { ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear); ps.useAutoRandomSeed = false; ps.randomSeed = (uint)(seed * 7919 + index++ * 104729); }
          var root = go.GetComponent<ParticleSystem>() ?? systems.FirstOrDefault();
          root.Simulate(t, true, true, true);
          int alive = systems.Sum(ps => ps.particleCount);
          var file = name + "-s" + seed + "-t" + N(t) + ".png";
          Save(Render(cam, w, h), w, h, System.IO.Path.Combine(dir, file));
          json.Append((first ? "" : ",") + "{\"effect\":\"" + name + "\",\"prefab\":\"" + parts[1] + "\",\"seed\":" + seed + ",\"time\":" + N(t) + ",\"position\":[" + N(p[0]) + "," + N(p[1]) + "," + N(p[2]) + "],\"particles\":" + alive + ",\"file\":\"" + file + "\"}");
          first = false; Object.DestroyImmediate(go);
        }
      }
    } finally { Time.fixedDeltaTime = fixedDt; }
    json.Append("]}"); System.IO.File.WriteAllText(outFile, json.ToString());
    return "captured to " + dir;
  }
}
