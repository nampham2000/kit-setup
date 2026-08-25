#nullable enable
using System.Collections.Generic;

namespace CcPlayable.UnityIntelligence
{
    /// <summary>
    /// Compact live patch consumed by playable-shared-kit's Unity intelligence merger.
    /// Property names intentionally match the JSON contract without serializer-specific attributes.
    /// </summary>
    public sealed class UnityLiveSnapshot
    {
        public int protocolVersion { get; set; } = 1;
        public string packageVersion { get; set; } = UnityIntelligenceScanner.PackageVersion;
        public string kind { get; set; } = "unity-live-patch";
        public int schemaVersion { get; set; } = 1;
        public int snapshotSchemaVersion { get; set; } = 1;
        public string provider { get; set; } = "unity-mcp";
        public string generatedAt { get; set; } = string.Empty;
        public string projectFingerprint { get; set; } = string.Empty;
        public string scanId { get; set; } = string.Empty;
        public bool playModeCapture { get; set; }
        public UnityProjectIdentity project { get; set; } = new UnityProjectIdentity();
        public List<UnityBuildSceneFact> buildScenes { get; set; } = new List<UnityBuildSceneFact>();
        public UnityAssetFacts assets { get; set; } = new UnityAssetFacts();
        public UnityDependencyFacts dependencies { get; set; } = new UnityDependencyFacts();
        public UnityScanFacts facts { get; set; } = new UnityScanFacts();
        public Dictionary<string, object> features { get; set; } = new Dictionary<string, object>();
        public List<UnityScanDiagnostic> diagnostics { get; set; } = new List<UnityScanDiagnostic>();
        public List<string> resolvesDiagnosticKeys { get; set; } = new List<string>();
        public List<string> resolvesUnresolvedGuids { get; set; } = new List<string>();
        public List<UnityCandidateDisposition> candidateDispositions { get; set; } = new List<UnityCandidateDisposition>();
        public UnityScanCapabilities capabilities { get; set; } = new UnityScanCapabilities();
    }

    public sealed class UnityProjectIdentity
    {
        public string name { get; set; } = string.Empty;
        public string unityVersion { get; set; } = string.Empty;
    }

    public sealed class UnityBuildSceneFact
    {
        public int index { get; set; }
        public string path { get; set; } = string.Empty;
        public string guid { get; set; } = string.Empty;
        public bool enabled { get; set; }
        public bool indexed { get; set; }
        public string scope { get; set; } = "runtime";
        public bool guidMatches { get; set; }
        public bool gameplayCandidate { get; set; }
    }

    public sealed class UnityAssetFacts
    {
        public List<UnityGuidResolution> records { get; set; } = new List<UnityGuidResolution>();
        public int cursor { get; set; }
        public int? nextCursor { get; set; }
        public int totalCount { get; set; }
        public bool truncated { get; set; }
    }

    public sealed class UnityGuidResolution
    {
        public string assetPath { get; set; } = string.Empty;
        public string guid { get; set; } = string.Empty;
        public string type { get; set; } = "Unknown";
        public string resolution { get; set; } = "exact";
        public string provider { get; set; } = "unity-mcp";
    }

    public sealed class UnityDependencyFacts
    {
        public List<object> edges { get; set; } = new List<object>();
        public List<object> unresolved { get; set; } = new List<object>();
    }

    public sealed class UnityScanFacts
    {
        public string action { get; set; } = "scan";
        public string packageVersion { get; set; } = UnityIntelligenceScanner.PackageVersion;
        public UnityReachableSummary reachable { get; set; } = new UnityReachableSummary();
        public List<UnityEntryPrefabFact> entryPrefabs { get; set; } = new List<UnityEntryPrefabFact>();
        public List<UnityCountFact> typeCounts { get; set; } = new List<UnityCountFact>();
        public List<UnityCountFact> componentCensus { get; set; } = new List<UnityCountFact>();
        public List<UnityPackageFact> packages { get; set; } = new List<UnityPackageFact>();
        public List<UnityAssemblyFact> compiledAssemblies { get; set; } = new List<UnityAssemblyFact>();
        public UnityScanMetrics metrics { get; set; } = new UnityScanMetrics();
    }

    public sealed class UnityReachableSummary
    {
        public bool scanned { get; set; }
        public int assetCount { get; set; }
        public int sceneCount { get; set; }
        public int prefabCount { get; set; }
        public int scriptCount { get; set; }
        public int materialCount { get; set; }
        public int shaderCount { get; set; }
        public int textureCount { get; set; }
        public bool truncated { get; set; }
    }

    public sealed class UnityEntryPrefabFact
    {
        public string path { get; set; } = string.Empty;
        public string guid { get; set; } = string.Empty;
        public int componentCount { get; set; }
        public bool componentScanComplete { get; set; }
    }

    public sealed class UnityCountFact
    {
        public string type { get; set; } = string.Empty;
        public int count { get; set; }
    }

    public sealed class UnityPackageFact
    {
        public string name { get; set; } = string.Empty;
        public string version { get; set; } = string.Empty;
        public string source { get; set; } = string.Empty;
    }

    public sealed class UnityAssemblyFact
    {
        public string name { get; set; } = string.Empty;
        public int scriptCount { get; set; }
        public string flags { get; set; } = string.Empty;
    }

    public sealed class UnityScanMetrics
    {
        public long durationMs { get; set; }
        public int reachableAssetsConsidered { get; set; }
        public int prefabsConsidered { get; set; }
        public int prefabsScanned { get; set; }
        public int componentsObserved { get; set; }
        public int guidResolutionsReturned { get; set; }
        public int packageCount { get; set; }
        public int assemblyCount { get; set; }
    }

    public sealed class UnityScanDiagnostic
    {
        public string code { get; set; } = string.Empty;
        public string severity { get; set; } = "low";
        public string message { get; set; } = string.Empty;
        public string action { get; set; } = string.Empty;
        public string source { get; set; } = "unity-mcp";
        public int count { get; set; } = 1;
        public List<string> evidence { get; set; } = new List<string>();
    }

    public sealed class UnityScanCapabilities
    {
        public bool playModeCapture { get; set; }
        public bool candidateDisposition { get; set; } = true;
    }

    public sealed class UnityCandidateDisposition
    {
        public string kind { get; set; } = string.Empty;
        public string key { get; set; } = string.Empty;
        public string status { get; set; } = "unknown";
        public string assetPath { get; set; } = string.Empty;
        public string assetType { get; set; } = "Unknown";
        public int dependencyCount { get; set; }
        public bool serializedScanComplete { get; set; }
        public int serializedPropertyCount { get; set; }
        public int missingReferenceCount { get; set; }
        public bool referencesComplete { get; set; }
        public List<UnityCandidateReference> references { get; set; } = new List<UnityCandidateReference>();
    }

    public sealed class UnityCandidateReference
    {
        public string fieldPath { get; set; } = string.Empty;
        public string assetPath { get; set; } = string.Empty;
        public string guid { get; set; } = string.Empty;
        public string objectId { get; set; } = string.Empty;
        public string type { get; set; } = "Unknown";
    }
}
