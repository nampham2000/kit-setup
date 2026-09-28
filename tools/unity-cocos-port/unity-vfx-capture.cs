using UnityEngine; using UnityEditor; using UnityEngine.Rendering.Universal; using System.Globalization; using System.Linq; using System.Text;
// VFX reference capture for Unity -> Cocos particle parity (run in Play Mode on a frozen gameplay frame, e.g. paused
// at round start). For every effect, seed and time it instantiates the effect prefab at a world position with the
// prefab's own rotation, seeds every ParticleSystem (useAutoRandomSeed = false), simulates to the time in explicit
// 1/60 s Simulate calls (the Cocos harness steps the same way), renders Camera.main plus overlays and writes a PNG.
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
    // Scene-placed effects are stopped and cleared first so the background holds none of their particles.
    foreach (var spec in "EFFECTS".Split(new[]{';'}, System.StringSplitOptions.RemoveEmptyEntries)) {
      var source = spec.Split('|')[1];
      var placed = source.StartsWith("scene:") ? GameObject.Find(source.Substring(6)) : null;
      if (placed) foreach (var ps in placed.GetComponentsInChildren<ParticleSystem>(true)) ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
    }
    Save(Render(cam, w, h), w, h, System.IO.Path.Combine(dir, "background.png"));
    float fixedDt = Time.fixedDeltaTime; Time.fixedDeltaTime = 1f / 60f; bool first = true;
    try {
      foreach (var spec in "EFFECTS".Split(new[]{';'}, System.StringSplitOptions.RemoveEmptyEntries)) {
        var parts = spec.Split('|'); var name = parts[0];
        // "scene:<GameObject name>" restarts an effect already placed in the scene (e.g. an ambient emitter) in place.
        bool fromScene = parts[1].StartsWith("scene:");
        var prefab = fromScene ? GameObject.Find(parts[1].Substring(6)) : AssetDatabase.LoadAssetAtPath<GameObject>(parts[1]);
        if (!prefab) return "missing " + parts[1];
        var p = parts[2].Split(',').Select(v => float.Parse(v, CultureInfo.InvariantCulture)).ToArray();
        var times = parts[3].Split(',').Select(v => float.Parse(v, CultureInfo.InvariantCulture)).ToArray(); int seeds = int.Parse(parts[4]);
        // Optional parts[5] "ex,ey,ez": world Euler rotation instead of the prefab rotation; parts[6] "vx,vy,vz": the
        // emitter moves at this world velocity between the 1/60 s steps (drives Rate over Distance, e.g. dust trails).
        var euler = parts.Length > 5 && parts[5].Length > 0 ? parts[5].Split(',').Select(v => float.Parse(v, CultureInfo.InvariantCulture)).ToArray() : null;
        var velocity = parts.Length > 6 && parts[6].Length > 0 ? parts[6].Split(',').Select(v => float.Parse(v, CultureInfo.InvariantCulture)).ToArray() : new float[]{0, 0, 0};
        var step = new Vector3(velocity[0], velocity[1], velocity[2]) / 60f;
        for (int seed = 1; seed <= seeds; seed++) foreach (var t in times) {
          var go = fromScene ? prefab : Object.Instantiate(prefab, new Vector3(p[0], p[1], p[2]), euler != null ? Quaternion.Euler(euler[0], euler[1], euler[2]) : prefab.transform.rotation);
          if (!fromScene) go.hideFlags = HideFlags.DontSave;
          var systems = go.GetComponentsInChildren<ParticleSystem>(true); int index = 0;
          foreach (var ps in systems) { ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear); ps.useAutoRandomSeed = false; ps.randomSeed = (uint)(seed * 7919 + index++ * 104729); }
          var root = go.GetComponent<ParticleSystem>() ?? systems.FirstOrDefault();
          // One explicit 1/60 s Simulate per frame: Simulate(t, fixedTimeStep: true) drops a float-rounded remainder
          // step for some t (0.05 s left the particles at age 0.033 s), so ages would not equal t.
          int steps = Mathf.Max(1, Mathf.RoundToInt(t * 60f));
          root.Simulate(1f / 60f, true, true, false);
          for (int i = 1; i < steps; i++) { go.transform.position += step; root.Simulate(1f / 60f, true, false, false); }
          int alive = systems.Sum(ps => ps.particleCount);
          var file = name + "-s" + seed + "-t" + N(t) + ".png";
          Save(Render(cam, w, h), w, h, System.IO.Path.Combine(dir, file));
          json.Append((first ? "" : ",") + "{\"effect\":\"" + name + "\",\"prefab\":\"" + parts[1] + "\",\"seed\":" + seed + ",\"time\":" + N(t) + ",\"position\":[" + N(p[0]) + "," + N(p[1]) + "," + N(p[2]) + "],\"particles\":" + alive + ",\"file\":\"" + file + "\"}");
          first = false; if (!fromScene) Object.DestroyImmediate(go);
        }
      }
    } finally { Time.fixedDeltaTime = fixedDt; }
    json.Append("]}"); System.IO.File.WriteAllText(outFile, json.ToString());
    return "captured to " + dir;
  }
}
