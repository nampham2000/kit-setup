using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace CcPlayable.UnityIntelligence.Capture
{
    /// <summary>
    /// Dumps Unity's own generated shader code for ShaderGraph assets (ShaderGraphImporter.GetShaderText, the text
    /// Unity compiles) so the shared kit's ShaderGraph -> Cocos effect generator works from exactly what Unity
    /// renders instead of re-interpreting the graph JSON. Read-only: assets and scenes are never modified.
    /// ShaderGraph is reached through reflection so this package compiles in projects without it.
    /// Output: one "&lt;graph name&gt;.shader.txt" per graph plus "manifest.json" (asset path, GUID, SHA-256 of the
    /// .shadergraph source and of the generated text, Unity version).
    /// </summary>
    public static class ShaderGraphCodeDump
    {
        [Serializable]
        sealed class Entry
        {
            public string assetPath = "";
            public string guid = "";
            public string file = "";
            public string sourceSha256 = "";
            public string generatedSha256 = "";
            public string error = "";
        }

        [Serializable]
        sealed class Manifest
        {
            public string unityVersion = "";
            public string generator = "CcPlayable.UnityIntelligence.Capture.ShaderGraphCodeDump";
            public List<Entry> graphs = new List<Entry>();
        }

        static string Sha256(byte[] bytes)
        {
            using (var sha = SHA256.Create())
                return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
        }

        static MethodInfo FindGetShaderText()
        {
            var importer = AppDomain.CurrentDomain.GetAssemblies()
                .Select(a => a.GetType("UnityEditor.ShaderGraph.ShaderGraphImporter"))
                .FirstOrDefault(t => t != null);
            if (importer == null) return null;
            return importer.GetMethods(BindingFlags.Static | BindingFlags.NonPublic | BindingFlags.Public)
                .Where(m => m.Name == "GetShaderText")
                .OrderByDescending(m => m.GetParameters().Length)
                .FirstOrDefault(m => m.GetParameters().Length >= 1 && m.GetParameters()[0].ParameterType == typeof(string));
        }

        /// <summary>
        /// Dump every .shadergraph under the given Assets/ or Packages/ folders (all of Assets when empty) into
        /// outputDirectory. Returns a one-line summary; per-graph failures are recorded in manifest.json.
        /// </summary>
        public static string Dump(string outputDirectory, string[] searchFolders)
        {
            if (string.IsNullOrEmpty(outputDirectory)) throw new ArgumentException("outputDirectory is required");
            var getShaderText = FindGetShaderText();
            if (getShaderText == null)
                throw new InvalidOperationException("UnityEditor.ShaderGraph.ShaderGraphImporter.GetShaderText not found (is com.unity.shadergraph installed?)");
            Directory.CreateDirectory(outputDirectory);
            var folders = (searchFolders ?? new string[0]).Where(f => !string.IsNullOrWhiteSpace(f)).ToArray();
            if (folders.Length == 0) folders = new[] { "Assets" };
            var manifest = new Manifest { unityVersion = Application.unityVersion };
            var usedNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var guid in AssetDatabase.FindAssets("t:Shader", folders).Distinct())
            {
                var assetPath = AssetDatabase.GUIDToAssetPath(guid);
                if (!assetPath.EndsWith(".shadergraph", StringComparison.OrdinalIgnoreCase)) continue;
                var name = Path.GetFileNameWithoutExtension(assetPath);
                var fileName = name + ".shader.txt";
                for (var i = 2; usedNames.Contains(fileName); i++) fileName = name + " (" + i + ").shader.txt";
                usedNames.Add(fileName);
                var entry = new Entry { assetPath = assetPath, guid = guid, file = fileName };
                try
                {
                    entry.sourceSha256 = Sha256(File.ReadAllBytes(assetPath));
                    var parameters = getShaderText.GetParameters();
                    var args = new object[parameters.Length];
                    args[0] = assetPath;
                    var text = (string)getShaderText.Invoke(null, args);
                    if (string.IsNullOrEmpty(text)) throw new InvalidOperationException("empty generated shader text");
                    var bytes = new UTF8Encoding(false).GetBytes(text);
                    entry.generatedSha256 = Sha256(bytes);
                    File.WriteAllBytes(Path.Combine(outputDirectory, fileName), bytes);
                }
                catch (Exception e)
                {
                    entry.error = (e.InnerException ?? e).Message;
                }
                manifest.graphs.Add(entry);
            }
            manifest.graphs.Sort((a, b) => string.CompareOrdinal(a.assetPath, b.assetPath));
            File.WriteAllText(Path.Combine(outputDirectory, "manifest.json"), JsonUtility.ToJson(manifest, true));
            var failed = manifest.graphs.Count(g => !string.IsNullOrEmpty(g.error));
            return "dumped " + (manifest.graphs.Count - failed) + "/" + manifest.graphs.Count + " ShaderGraph(s) to " + outputDirectory;
        }
    }
}
