using UnityEngine;
using UnityEditor;
using Newtonsoft.Json;
using System.Collections.Generic;
using System.Linq;

public class Script
{
    static string Hash(string path)
    {
        return HashBytes(System.IO.File.ReadAllBytes(path));
    }

    static string HashBytes(byte[] bytes)
    {
        using (var sha = System.Security.Cryptography.SHA256.Create())
            return System.BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
    }

    public static string Main()
    {
        if (!Application.dataPath.Replace('\\', '/').Equals("UNITY_ASSETS_PATH"))
            throw new System.Exception("Owned reference only");

        var output = "OUTPUT_FILE";
        var requestId = "REQUEST_ID";
        if (System.IO.File.Exists(output)
            && Newtonsoft.Json.Linq.JObject.Parse(System.IO.File.ReadAllText(output))["requestId"]?.ToString() == requestId)
            return "Existing atomic capture for this request";
        if (QualitySettings.activeColorSpace != ColorSpace.Linear)
            throw new System.Exception("Linear reference required");

        AssetDatabase.ImportAsset("SHADER_ASSET_PATH", ImportAssetOptions.ForceSynchronousImport);
        var shader = AssetDatabase.LoadAssetAtPath<Shader>("SHADER_ASSET_PATH");
        if (!shader || !shader.isSupported)
            throw new System.Exception("Native mip shader not ready");

        var material = new Material(shader);
        var textures = new List<object>();
        var previous = RenderTexture.active;
        var previousWrite = GL.sRGBWrite;
        try
        {
            foreach (var sourcePath in Newtonsoft.Json.JsonConvert.DeserializeObject<string[]>(
                System.Text.Encoding.UTF8.GetString(System.Convert.FromBase64String("ASSET_PATHS_BASE64"))))
            {
                var path = sourcePath;
                var sourceHash = Hash(path);
                var importerHash = Hash(path + ".meta");
                var texture = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
                if (!texture || !UnityEngine.Experimental.Rendering.GraphicsFormatUtility.IsSRGBFormat(texture.graphicsFormat))
                    throw new System.Exception("Native sRGB Texture2D required " + path);

                var nativeSamplingSupported = SystemInfo.SupportsTextureFormat(texture.format);
                var astcGpuReadbackFallback = !nativeSamplingSupported
                    && texture.format.ToString().StartsWith("ASTC_", System.StringComparison.Ordinal);
                if (!nativeSamplingSupported && !astcGpuReadbackFallback)
                    throw new System.Exception("Native GPU sampling unsupported for " + texture.format
                        + "; validated decoder or matching reference device required");

                var mips = new List<object>();
                for (var mip = 0; mip < texture.mipmapCount; mip++)
                {
                    var width = Mathf.Max(1, texture.width >> mip);
                    var height = Mathf.Max(1, texture.height >> mip);
                    var target = new RenderTexture(width, height, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
                    target.Create();
                    var image = new Texture2D(width, height, TextureFormat.RGBA32, false, false);
                    try
                    {
                        material.SetFloat("_Mip", mip);
                        GL.sRGBWrite = true;
                        Graphics.Blit(texture, target, material);
                        RenderTexture.active = target;
                        image.ReadPixels(new Rect(0, 0, width, height), 0, 0, false);
                        image.Apply(false, false);
                        var rgba = image.GetRawTextureData<byte>().ToArray();
                        mips.Add(new
                        {
                            width,
                            height,
                            rgba = System.Convert.ToBase64String(rgba),
                        });
                    }
                    finally
                    {
                        Object.DestroyImmediate(image);
                        Object.DestroyImmediate(target);
                    }
                }

                if (sourceHash != Hash(path) || importerHash != Hash(path + ".meta"))
                    throw new System.Exception("Source changed during capture");

                textures.Add(new
                {
                    schemaVersion = 1,
                    path,
                    sourceTextureSha256 = sourceHash,
                    sourceImporterSha256 = importerHash,
                    guid = AssetDatabase.AssetPathToGUID(path),
                    unityVersion = Application.unityVersion,
                    format = texture.graphicsFormat.ToString(),
                    textureFormat = texture.format.ToString(),
                    activeBuildTarget = EditorUserBuildSettings.activeBuildTarget.ToString(),
                    graphicsDevice = SystemInfo.graphicsDeviceType.ToString(),
                    nativeSamplingSupported,
                    astcGpuReadbackFallback,
                    sampler = new
                    {
                        filterMode = texture.filterMode.ToString(),
                        wrapU = texture.wrapModeU.ToString(),
                        wrapV = texture.wrapModeV.ToString(),
                        wrapW = texture.wrapModeW.ToString(),
                        anisoLevel = texture.anisoLevel,
                        mipMapBias = texture.mipMapBias,
                    },
                    srgb = true,
                    mips,
                });
            }
        }
        finally
        {
            RenderTexture.active = previous;
            GL.sRGBWrite = previousWrite;
            Object.DestroyImmediate(material);
        }

        System.IO.File.WriteAllText(output + ".tmp", JsonConvert.SerializeObject(new
        {
            schemaVersion = 1,
            requestId,
            textures,
        }));
        if (System.IO.File.Exists(output))
            System.IO.File.Replace(output + ".tmp", output, null);
        else
            System.IO.File.Move(output + ".tmp", output);
        return "Captured " + textures.Count + " imported texture mip chains";
    }
}
