#nullable enable
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using UnityEditor;
using UnityEditor.Compilation;
using UnityEditor.PackageManager;
using UnityEngine;

namespace CcPlayable.UnityIntelligence
{
    /// <summary>
    /// Read-only, bounded Unity-side facts for the Unity-to-Cocos port planner.
    /// It never opens a scene, enters play mode, or serializes component fields/source files.
    /// </summary>
    public static class UnityIntelligenceScanner
    {
        public const string PackageVersion = "0.2.0";
        public const int ProtocolVersion = 1;

        private const int MaxReachableAssets = 12000;
        private const int MaxEntryPrefabs = 256;
        private const int MaxEvidencePageSize = 512;
        private const int MaxPackages = 512;
        private const int MaxAssemblies = 512;

        private static readonly HashSet<string> AllowedActions = new HashSet<string>(StringComparer.Ordinal)
        {
            "probe",
            "scan",
            "evidence",
        };

        public static UnityLiveSnapshot Execute(
            string action = "scan",
            string? expectedFingerprint = null,
            int cursor = 0,
            int pageSize = 128,
            int maxPrefabs = 96)
        {
            action = (action ?? string.Empty).Trim().ToLowerInvariant();
            if (!AllowedActions.Contains(action))
                throw new ArgumentException("action must be probe, scan, or evidence.", nameof(action));
            if (cursor < 0)
                throw new ArgumentOutOfRangeException(nameof(cursor), "cursor must be zero or greater.");
            if (pageSize <= 0 || pageSize > MaxEvidencePageSize)
                throw new ArgumentOutOfRangeException(nameof(pageSize), "pageSize is outside the supported range.");
            if (maxPrefabs < 0 || maxPrefabs > MaxEntryPrefabs)
                throw new ArgumentOutOfRangeException(nameof(maxPrefabs), "maxPrefabs is outside the supported range.");
            if (!string.IsNullOrEmpty(expectedFingerprint) && !IsSha256(expectedFingerprint))
                throw new ArgumentException("expectedFingerprint must be a SHA-256 hex string.", nameof(expectedFingerprint));

            var timer = Stopwatch.StartNew();
            var generatedAt = DateTime.UtcNow;
            var projectName = GetProjectDirectoryName();
            var buildScenes = CollectBuildScenes();
            var fingerprint = ComputeProjectFingerprint(projectName, Application.unityVersion, buildScenes);

            if (!string.IsNullOrEmpty(expectedFingerprint) &&
                !string.Equals(expectedFingerprint, fingerprint, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("project_fingerprint_mismatch");
            }

            var snapshot = new UnityLiveSnapshot
            {
                protocolVersion = ProtocolVersion,
                packageVersion = PackageVersion,
                generatedAt = generatedAt.ToString("O", CultureInfo.InvariantCulture),
                projectFingerprint = fingerprint,
                scanId = BuildScanId(fingerprint, generatedAt),
                playModeCapture = false,
                project = new UnityProjectIdentity
                {
                    name = projectName,
                    unityVersion = Application.unityVersion,
                },
                buildScenes = buildScenes,
            };
            snapshot.facts.action = action;

            if (!buildScenes.Any(scene => scene.enabled))
            {
                snapshot.diagnostics.Add(Diagnostic(
                    "UNITY_NO_ENABLED_BUILD_SCENE",
                    "medium",
                    "No enabled scene is present in Unity EditorBuildSettings.",
                    "Select the gameplay entry scene before porting."));
            }

            if (!string.Equals(action, "probe", StringComparison.Ordinal))
            {
                CollectPackages(snapshot);
                CollectCompiledAssemblies(snapshot);
                CollectReachableFacts(snapshot, action, cursor, pageSize, maxPrefabs);
                InferFeatures(snapshot);
            }
            timer.Stop();
            snapshot.facts.metrics.durationMs = timer.ElapsedMilliseconds;
            snapshot.facts.metrics.packageCount = snapshot.facts.packages.Count;
            snapshot.facts.metrics.assemblyCount = snapshot.facts.compiledAssemblies.Count;
            snapshot.facts.metrics.guidResolutionsReturned = snapshot.assets.records.Count;
            return snapshot;
        }

        private static string GetProjectDirectoryName()
        {
            var projectDirectory = Directory.GetParent(Application.dataPath);
            return projectDirectory == null ? string.Empty : projectDirectory.Name;
        }

        private static List<UnityBuildSceneFact> CollectBuildScenes()
        {
            var result = new List<UnityBuildSceneFact>();
            var scenes = EditorBuildSettings.scenes ?? Array.Empty<EditorBuildSettingsScene>();
            for (var index = 0; index < scenes.Length; index++)
            {
                var path = NormalizeAssetPath(scenes[index].path);
                var guid = string.IsNullOrEmpty(path)
                    ? string.Empty
                    : (AssetDatabase.AssetPathToGUID(path) ?? string.Empty).ToLowerInvariant();
                var scope = ClassifyScope(path);
                result.Add(new UnityBuildSceneFact
                {
                    index = index,
                    path = path,
                    guid = guid,
                    enabled = scenes[index].enabled,
                    indexed = !string.IsNullOrEmpty(guid),
                    scope = scope,
                    guidMatches = !string.IsNullOrEmpty(guid),
                    gameplayCandidate = scenes[index].enabled && string.Equals(scope, "runtime", StringComparison.Ordinal),
                });
            }

            return result;
        }

        private static string ComputeProjectFingerprint(
            string projectName,
            string unityVersion,
            IEnumerable<UnityBuildSceneFact> scenes)
        {
            var fields = new List<string>
            {
                "unity-intel-project-v1",
                projectName ?? string.Empty,
                unityVersion ?? string.Empty,
            };
            foreach (var scene in scenes
                         .Where(item => item.enabled)
                         .OrderBy(item => item.path, StringComparer.Ordinal)
                         .ThenBy(item => item.guid, StringComparer.Ordinal))
            {
                fields.Add(NormalizeAssetPath(scene.path));
                fields.Add((scene.guid ?? string.Empty).ToLowerInvariant());
            }

            using (var sha256 = SHA256.Create())
            {
                var bytes = Encoding.UTF8.GetBytes(string.Join("\0", fields));
                var digest = sha256.ComputeHash(bytes);
                var builder = new StringBuilder(digest.Length * 2);
                foreach (var value in digest)
                    builder.Append(value.ToString("x2", CultureInfo.InvariantCulture));
                return builder.ToString();
            }
        }

        private static string BuildScanId(string fingerprint, DateTime generatedAt)
        {
            return "unity-mcp-" + fingerprint.Substring(0, 16) + "-" +
                   generatedAt.ToString("yyyyMMddHHmmssfff", CultureInfo.InvariantCulture);
        }

        private static void CollectPackages(UnityLiveSnapshot snapshot)
        {
            PackageInfo[] packages;
            try
            {
                packages = PackageInfo.GetAllRegisteredPackages() ?? Array.Empty<PackageInfo>();
            }
            catch
            {
                snapshot.diagnostics.Add(Diagnostic(
                    "UNITY_LIVE_PACKAGE_CENSUS_FAILED",
                    "low",
                    "Unity Package Manager did not return the registered package census.",
                    "Retry after package resolution completes."));
                return;
            }

            foreach (var package in packages
                         .Where(item => item != null)
                         .OrderBy(item => item.name, StringComparer.Ordinal)
                         .Take(MaxPackages))
            {
                snapshot.facts.packages.Add(new UnityPackageFact
                {
                    name = package.name ?? string.Empty,
                    version = package.version ?? string.Empty,
                    source = package.source.ToString(),
                });
            }

            if (packages.Length > MaxPackages)
            {
                snapshot.diagnostics.Add(Diagnostic(
                    "UNITY_LIVE_PACKAGE_CENSUS_TRUNCATED",
                    "low",
                    "The package census reached its compact-output limit.",
                    "Use Unity Package Manager when the omitted package list is required.",
                    packages.Length - MaxPackages));
            }
        }

        private static void CollectCompiledAssemblies(UnityLiveSnapshot snapshot)
        {
            UnityEditor.Compilation.Assembly[] assemblies;
            try
            {
                assemblies = CompilationPipeline.GetAssemblies(AssembliesType.Editor) ??
                             Array.Empty<UnityEditor.Compilation.Assembly>();
            }
            catch
            {
                snapshot.diagnostics.Add(Diagnostic(
                    "UNITY_LIVE_ASSEMBLY_CENSUS_FAILED",
                    "low",
                    "Unity compilation pipeline did not return compiled assembly metadata.",
                    "Retry after script compilation completes."));
                return;
            }

            foreach (var assembly in assemblies
                         .Where(item => item != null)
                         .OrderBy(item => item.name, StringComparer.Ordinal)
                         .Take(MaxAssemblies))
            {
                snapshot.facts.compiledAssemblies.Add(new UnityAssemblyFact
                {
                    name = assembly.name ?? string.Empty,
                    scriptCount = assembly.sourceFiles == null ? 0 : assembly.sourceFiles.Length,
                    flags = assembly.flags.ToString(),
                });
            }

            if (assemblies.Length > MaxAssemblies)
            {
                snapshot.diagnostics.Add(Diagnostic(
                    "UNITY_LIVE_ASSEMBLY_CENSUS_TRUNCATED",
                    "low",
                    "The compiled assembly census reached its compact-output limit.",
                    "Inspect the Unity compilation pipeline only if omitted assemblies are relevant.",
                    assemblies.Length - MaxAssemblies));
            }
        }

        private static void CollectReachableFacts(
            UnityLiveSnapshot snapshot,
            string action,
            int cursor,
            int pageSize,
            int maxPrefabs)
        {
            var enabledScenePaths = snapshot.buildScenes
                .Where(scene => scene.enabled && scene.indexed && !string.IsNullOrEmpty(scene.path))
                .Select(scene => scene.path)
                .ToArray();
            var allReachable = enabledScenePaths.Length == 0
                ? Array.Empty<string>()
                : AssetDatabase.GetDependencies(enabledScenePaths, true);
            var normalized = allReachable
                .Select(NormalizeAssetPath)
                .Where(IsSafeAssetPath)
                .Distinct(StringComparer.Ordinal)
                .OrderBy(path => path, StringComparer.Ordinal)
                .ToArray();
            var reachable = normalized.Take(MaxReachableAssets).ToArray();
            var wasTruncated = normalized.Length > reachable.Length;
            var typeCounts = new Dictionary<string, int>(StringComparer.Ordinal);

            foreach (var path in reachable)
            {
                var type = GetAssetType(path);
                typeCounts[type] = typeCounts.TryGetValue(type, out var count) ? count + 1 : 1;
            }

            snapshot.facts.typeCounts = typeCounts
                .Select(pair => new UnityCountFact { type = pair.Key, count = pair.Value })
                .OrderByDescending(item => item.count)
                .ThenBy(item => item.type, StringComparer.Ordinal)
                .ToList();
            snapshot.facts.reachable = BuildReachableSummary(reachable, wasTruncated);
            snapshot.facts.metrics.reachableAssetsConsidered = reachable.Length;

            if (wasTruncated)
            {
                snapshot.diagnostics.Add(Diagnostic(
                    "UNITY_LIVE_REACHABLE_TRUNCATED",
                    "low",
                    "The build-scene dependency closure reached its bounded scan limit.",
                    "Use action=evidence with paging or narrow the Unity entry scenes.",
                    normalized.Length - reachable.Length));
            }

            var prefabPaths = reachable
                .Where(path => path.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase))
                .ToArray();
            var returnedPrefabCount = Math.Min(prefabPaths.Length, MaxEntryPrefabs);
            for (var index = 0; index < returnedPrefabCount; index++)
            {
                var path = prefabPaths[index];
                snapshot.facts.entryPrefabs.Add(new UnityEntryPrefabFact
                {
                    path = path,
                    guid = (AssetDatabase.AssetPathToGUID(path) ?? string.Empty).ToLowerInvariant(),
                });
            }
            snapshot.facts.metrics.prefabsConsidered = prefabPaths.Length;

            if (prefabPaths.Length > MaxEntryPrefabs)
            {
                snapshot.diagnostics.Add(Diagnostic(
                    "UNITY_LIVE_ENTRY_PREFABS_TRUNCATED",
                    "low",
                    "The reachable prefab list reached its compact-output limit.",
                    "Use action=evidence to page GUID evidence; raise the prefab census only when needed.",
                    prefabPaths.Length - MaxEntryPrefabs));
            }

            if (string.Equals(action, "scan", StringComparison.Ordinal) && maxPrefabs > 0)
                CollectComponentCensus(snapshot, Math.Min(maxPrefabs, snapshot.facts.entryPrefabs.Count));

            var effectiveCursor = string.Equals(action, "evidence", StringComparison.Ordinal) ? cursor : 0;
            var effectivePageSize = string.Equals(action, "evidence", StringComparison.Ordinal)
                ? pageSize
                : Math.Min(pageSize, 256);
            CollectGuidEvidence(snapshot, reachable, effectiveCursor, effectivePageSize);
        }

        private static UnityReachableSummary BuildReachableSummary(string[] reachable, bool truncated)
        {
            return new UnityReachableSummary
            {
                scanned = true,
                assetCount = reachable.Length,
                sceneCount = CountExtension(reachable, ".unity"),
                prefabCount = CountExtension(reachable, ".prefab"),
                scriptCount = CountExtension(reachable, ".cs"),
                materialCount = CountExtension(reachable, ".mat"),
                shaderCount = reachable.Count(path =>
                    path.EndsWith(".shader", StringComparison.OrdinalIgnoreCase) ||
                    path.EndsWith(".shadergraph", StringComparison.OrdinalIgnoreCase)),
                textureCount = reachable.Count(IsTexturePath),
                truncated = truncated,
            };
        }

        private static void CollectComponentCensus(UnityLiveSnapshot snapshot, int prefabLimit)
        {
            var counts = new Dictionary<string, int>(StringComparer.Ordinal);
            var failedPaths = new List<string>();
            var failedCount = 0;
            var totalComponents = 0;
            var scanned = 0;

            for (var index = 0; index < prefabLimit; index++)
            {
                var prefab = snapshot.facts.entryPrefabs[index];
                try
                {
                    var root = AssetDatabase.LoadAssetAtPath<GameObject>(prefab.path);
                    if (root == null)
                        throw new InvalidOperationException("prefab_asset_unavailable");
                    var components = root.GetComponentsInChildren<Component>(true);
                    prefab.componentCount = components.Length;
                    prefab.componentScanComplete = true;
                    totalComponents += components.Length;
                    scanned++;
                    foreach (var component in components)
                    {
                        var type = component == null
                            ? "<missing-script>"
                            : (component.GetType().FullName ?? component.GetType().Name);
                        counts[type] = counts.TryGetValue(type, out var count) ? count + 1 : 1;
                    }
                }
                catch
                {
                    prefab.componentScanComplete = false;
                    failedCount++;
                    if (failedPaths.Count < 5)
                        failedPaths.Add(prefab.path);
                }
            }

            snapshot.facts.componentCensus = counts
                .Select(pair => new UnityCountFact { type = pair.Key, count = pair.Value })
                .OrderByDescending(item => item.count)
                .ThenBy(item => item.type, StringComparer.Ordinal)
                .ToList();
            snapshot.facts.metrics.prefabsScanned = scanned;
            snapshot.facts.metrics.componentsObserved = totalComponents;

            if (prefabLimit < snapshot.facts.entryPrefabs.Count)
            {
                snapshot.diagnostics.Add(Diagnostic(
                    "UNITY_LIVE_COMPONENT_CENSUS_TRUNCATED",
                    "low",
                    "The component census sampled a bounded subset of reachable prefabs.",
                    "Increase maxPrefabs only when the compact census is insufficient.",
                    snapshot.facts.entryPrefabs.Count - prefabLimit));
            }
            if (failedCount > 0)
            {
                snapshot.diagnostics.Add(Diagnostic(
                    "UNITY_LIVE_PREFAB_INSPECTION_FAILED",
                    "medium",
                    "Unity could not inspect one or more reachable prefab contents.",
                    "Open the listed prefab assets in Unity and resolve importer or missing-script errors.",
                    failedCount,
                    failedPaths));
            }
        }

        private static void CollectGuidEvidence(
            UnityLiveSnapshot snapshot,
            string[] reachable,
            int cursor,
            int pageSize)
        {
            var safeCursor = Math.Min(cursor, reachable.Length);
            var remaining = reachable.Length - safeCursor;
            var count = Math.Min(pageSize, remaining);
            for (var offset = 0; offset < count; offset++)
            {
                var path = reachable[safeCursor + offset];
                var guid = (AssetDatabase.AssetPathToGUID(path) ?? string.Empty).ToLowerInvariant();
                if (string.IsNullOrEmpty(guid))
                    continue;
                snapshot.assets.records.Add(new UnityGuidResolution
                {
                    assetPath = path,
                    guid = guid,
                    type = GetAssetType(path),
                });
            }

            snapshot.assets.cursor = safeCursor;
            snapshot.assets.totalCount = reachable.Length;
            snapshot.assets.nextCursor = safeCursor + count < reachable.Length
                ? safeCursor + count
                : (int?)null;
            snapshot.assets.truncated = snapshot.assets.nextCursor.HasValue;
        }

        private static void InferFeatures(UnityLiveSnapshot snapshot)
        {
            var packages = new HashSet<string>(
                snapshot.facts.packages.Select(package => package.name),
                StringComparer.OrdinalIgnoreCase);
            var components = new HashSet<string>(
                snapshot.facts.componentCensus.Select(item => item.type),
                StringComparer.Ordinal);

            snapshot.features["usesUrp"] = packages.Contains("com.unity.render-pipelines.universal");
            snapshot.features["usesAddressables"] = packages.Contains("com.unity.addressables");
            snapshot.features["usesInputSystem"] = packages.Contains("com.unity.inputsystem");
            snapshot.features["hasAnimator"] = components.Contains("UnityEngine.Animator");
            snapshot.features["hasParticles"] = components.Contains("UnityEngine.ParticleSystem");
            snapshot.features["hasPhysics2D"] = components.Any(type => type.StartsWith("UnityEngine.", StringComparison.Ordinal) &&
                                                               type.EndsWith("2D", StringComparison.Ordinal));
            snapshot.features["hasPhysics3D"] = components.Contains("UnityEngine.Rigidbody") ||
                                                  components.Contains("UnityEngine.Collider");
            snapshot.features["componentCensusAvailable"] = snapshot.facts.metrics.prefabsScanned > 0;
        }

        private static UnityScanDiagnostic Diagnostic(
            string code,
            string severity,
            string message,
            string action,
            int count = 1,
            List<string>? evidence = null)
        {
            return new UnityScanDiagnostic
            {
                code = code,
                severity = severity,
                message = message,
                action = action,
                count = Math.Max(1, count),
                evidence = evidence ?? new List<string>(),
            };
        }

        private static int CountExtension(IEnumerable<string> paths, string extension)
        {
            return paths.Count(path => path.EndsWith(extension, StringComparison.OrdinalIgnoreCase));
        }

        private static bool IsTexturePath(string path)
        {
            return path.EndsWith(".png", StringComparison.OrdinalIgnoreCase) ||
                   path.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase) ||
                   path.EndsWith(".jpeg", StringComparison.OrdinalIgnoreCase) ||
                   path.EndsWith(".tga", StringComparison.OrdinalIgnoreCase) ||
                   path.EndsWith(".psd", StringComparison.OrdinalIgnoreCase) ||
                   path.EndsWith(".exr", StringComparison.OrdinalIgnoreCase) ||
                   path.EndsWith(".hdr", StringComparison.OrdinalIgnoreCase);
        }

        private static string GetAssetType(string path)
        {
            try
            {
                var type = AssetDatabase.GetMainAssetTypeAtPath(path);
                return type == null ? "Unknown" : (type.FullName ?? type.Name);
            }
            catch
            {
                return "Unknown";
            }
        }

        private static string NormalizeAssetPath(string? path)
        {
            return (path ?? string.Empty).Replace('\\', '/');
        }

        private static bool IsSafeAssetPath(string path)
        {
            if (string.IsNullOrEmpty(path) || Path.IsPathRooted(path))
                return false;
            return path.StartsWith("Assets/", StringComparison.Ordinal) ||
                   path.StartsWith("Packages/", StringComparison.Ordinal);
        }

        private static string ClassifyScope(string path)
        {
            if (path.StartsWith("Packages/", StringComparison.Ordinal))
                return "package";
            if (path.IndexOf("/Editor/", StringComparison.OrdinalIgnoreCase) >= 0)
                return "editor";
            if (path.IndexOf("/Samples/", StringComparison.OrdinalIgnoreCase) >= 0 ||
                path.IndexOf("/Examples/", StringComparison.OrdinalIgnoreCase) >= 0)
                return "sample";
            return "runtime";
        }

        private static bool IsSha256(string value)
        {
            if (value.Length != 64)
                return false;
            foreach (var character in value)
            {
                var isDigit = character >= '0' && character <= '9';
                var isLower = character >= 'a' && character <= 'f';
                var isUpper = character >= 'A' && character <= 'F';
                if (!isDigit && !isLower && !isUpper)
                    return false;
            }
            return true;
        }
    }
}
