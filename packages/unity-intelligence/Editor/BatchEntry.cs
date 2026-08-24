#nullable enable
using System;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json;
using UnityEditor;
using UnityEngine;

namespace CcPlayable.UnityIntelligence
{
    /// <summary>
    /// Unity -executeMethod entry point. The caller treats a freshly written, valid JSON marker
    /// as success and never relies on Unity's process exit code alone.
    /// </summary>
    public static class BatchEntry
    {
        private const string OutputEnvironmentVariable = "CC_PLAYABLE_UNITY_SCAN_OUTPUT";
        private const string FingerprintEnvironmentVariable = "CC_PLAYABLE_UNITY_PROJECT_FINGERPRINT";

        public static void Scan()
        {
            string? temporaryPath = null;
            try
            {
                var outputValue = Environment.GetEnvironmentVariable(OutputEnvironmentVariable);
                var expectedFingerprint = Environment.GetEnvironmentVariable(FingerprintEnvironmentVariable);
                if (string.IsNullOrWhiteSpace(outputValue))
                    throw new InvalidOperationException("scan_output_missing");
                if (string.IsNullOrWhiteSpace(expectedFingerprint))
                    throw new InvalidOperationException("project_fingerprint_missing");

                var outputPath = Path.GetFullPath(outputValue);
                var outputDirectory = Path.GetDirectoryName(outputPath);
                if (string.IsNullOrEmpty(outputDirectory))
                    throw new InvalidOperationException("scan_output_directory_invalid");

                // A stale file must never be mistaken for a successful batch scan.
                if (File.Exists(outputPath))
                    File.Delete(outputPath);

                var snapshot = UnityIntelligenceScanner.Execute(
                    action: "scan",
                    expectedFingerprint: expectedFingerprint,
                    cursor: 0,
                    pageSize: 256,
                    maxPrefabs: 96);
                var json = JsonSerializer.Serialize(snapshot, new JsonSerializerOptions
                {
                    WriteIndented = false,
                });

                Directory.CreateDirectory(outputDirectory);
                temporaryPath = outputPath + ".tmp-" + Guid.NewGuid().ToString("N");
                using (var stream = new FileStream(
                           temporaryPath,
                           FileMode.CreateNew,
                           FileAccess.Write,
                           FileShare.None,
                           4096,
                           FileOptions.WriteThrough))
                using (var writer = new StreamWriter(stream, new UTF8Encoding(false)))
                {
                    writer.Write(json);
                    writer.Flush();
                    stream.Flush(true);
                }

                File.Move(temporaryPath, outputPath);
                temporaryPath = null;
                Debug.Log("[CCPlayable Unity Intelligence] Batch scan marker written.");
                EditorApplication.Exit(0);
            }
            catch (Exception error)
            {
                if (!string.IsNullOrEmpty(temporaryPath) && File.Exists(temporaryPath))
                {
                    try
                    {
                        File.Delete(temporaryPath);
                    }
                    catch
                    {
                        // Best-effort cleanup; no response marker is written on failure.
                    }
                }

                Debug.LogError(string.Format(
                    CultureInfo.InvariantCulture,
                    "[CCPlayable Unity Intelligence] Batch scan failed ({0}).",
                    error.GetType().Name));
                EditorApplication.Exit(1);
            }
        }
    }
}
