using System;
using System.Reflection;
using UnityEditor;
using UnityEngine;

namespace CcPlayable.UnityIntelligence
{
    // This assembly deliberately has no MCP/NuGet dependency gates. On a fresh
    // project those gates are closed until the resolver gets an Editor update.
    [InitializeOnLoad]
    public static class BootstrapEntry
    {
        private static bool invoking;

        static BootstrapEntry()
        {
            // Environment survives the resolver's domain reload. Re-arm after
            // compilation without relying on another executeMethod invocation.
            if (IsScanProcess()) EditorApplication.update += Pump;
        }

        private static bool IsScanProcess()
        {
            return Application.isBatchMode &&
                !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("CC_PLAYABLE_UNITY_SCAN_OUTPUT")) &&
                !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("CC_PLAYABLE_UNITY_PROJECT_FINGERPRINT"));
        }

        public static void Scan()
        {
            if (!IsScanProcess())
            {
                Debug.LogError("[CCPlayable Unity Intelligence] Missing batch scan identity.");
                EditorApplication.Exit(1);
                return;
            }
            EditorApplication.update -= Pump;
            EditorApplication.update += Pump;
        }

        private static void Pump()
        {
            if (invoking || EditorApplication.isCompiling || EditorApplication.isUpdating) return;
            var scanner = Type.GetType("CcPlayable.UnityIntelligence.BatchEntry, CcPlayable.UnityIntelligence.Editor", false);
            var scan = scanner == null ? null : scanner.GetMethod("Scan", BindingFlags.Public | BindingFlags.Static);
            if (scan == null) return;
            invoking = true;
            EditorApplication.update -= Pump;
            try
            {
                // BatchEntry still owns validation and atomic marker writing.
                scan.Invoke(null, null);
            }
            catch (Exception error)
            {
                Debug.LogError("[CCPlayable Unity Intelligence] Scanner invocation failed: " + error.GetType().Name);
                EditorApplication.Exit(1);
            }
        }
    }
}
