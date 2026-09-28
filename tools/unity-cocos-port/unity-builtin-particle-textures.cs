using UnityEngine; using UnityEditor; using UnityEngine.Experimental.Rendering; using System.Text;
// Exports the Unity built-in particle textures (unity_builtin_extra: Default-Particle, Default-ParticleSystem) that
// ParticleSystemRenderers reference through the built-in materials, so a Cocos port samples the same pixels.
// Run through the shared kit's Unity-MCP:
//   node playable-shared-kit/tools/unity-intel/unity-mcp-script.cjs --project <UnityProjectRoot> \
//     --script playable-shared-kit/tools/unity-cocos-port/unity-builtin-particle-textures.cs \
//     --set OUTPUT_DIR=<CocosProjectRoot>/assets/unity_imported/_builtin
// Each texture is blitted in its own colour space (sRGB textures through an sRGB target) so the PNG holds the
// stored texel values; a JSON manifest records size, format, colour space, wrap and filter modes.
public class Script {
  public static string Main() {
    var dir = "OUTPUT_DIR"; System.IO.Directory.CreateDirectory(dir);
    var manifest = new StringBuilder("{\"textures\":[");
    bool first = true;
    foreach (var materialName in new[] { "Default-Particle", "Default-ParticleSystem" }) {
      var material = AssetDatabase.GetBuiltinExtraResource<Material>(materialName + ".mat");
      var tex = material ? material.mainTexture as Texture2D : null;
      if (!tex) return "missing built-in texture for " + materialName;
      bool srgb = GraphicsFormatUtility.IsSRGBFormat(tex.graphicsFormat);
      var rt = RenderTexture.GetTemporary(tex.width, tex.height, 0, RenderTextureFormat.ARGB32, srgb ? RenderTextureReadWrite.sRGB : RenderTextureReadWrite.Linear);
      var previous = RenderTexture.active;
      Graphics.Blit(tex, rt);
      RenderTexture.active = rt;
      var copy = new Texture2D(tex.width, tex.height, TextureFormat.RGBA32, false, !srgb);
      copy.ReadPixels(new Rect(0, 0, tex.width, tex.height), 0, 0); copy.Apply();
      RenderTexture.active = previous; RenderTexture.ReleaseTemporary(rt);
      System.IO.File.WriteAllBytes(System.IO.Path.Combine(dir, materialName + ".png"), copy.EncodeToPNG());
      Object.DestroyImmediate(copy);
      manifest.Append((first ? "" : ",") + "{\"material\":\"" + materialName + "\",\"texture\":\"" + tex.name + "\",\"width\":" + tex.width + ",\"height\":" + tex.height
        + ",\"graphicsFormat\":\"" + tex.graphicsFormat + "\",\"sRGB\":" + (srgb ? "true" : "false") + ",\"wrapMode\":\"" + tex.wrapMode + "\",\"filterMode\":\"" + tex.filterMode + "\",\"mipmapCount\":" + tex.mipmapCount + "}");
      first = false;
    }
    manifest.Append("],\"unityVersion\":\"" + Application.unityVersion + "\"}");
    System.IO.File.WriteAllText(System.IO.Path.Combine(dir, "unity-builtin-particle-textures.json"), manifest.ToString());
    return "exported built-in particle textures to " + dir;
  }
}
