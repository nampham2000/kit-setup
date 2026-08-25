#nullable enable
using System.ComponentModel;
using System.Collections.Generic;
using com.IvanMurzak.McpPlugin;
using com.IvanMurzak.ReflectorNet.Utils;

namespace CcPlayable.UnityIntelligence
{
    [AiToolType]
    public sealed class PlayablePortScanTool
    {
        public const string ToolId = "playable-port-scan";

        [AiTool(
            ToolId,
            Title = "Playable Port / Compact Scan",
            ReadOnlyHint = true,
            IdempotentHint = true)]
        [Description("Read-only compact Unity project facts for a Unity-to-Cocos playable port. Use probe first, scan for the bounded project sketch, and evidence for a paged GUID-resolution slice.")]
        public UnityLiveSnapshot Scan(
            [Description("probe, scan, or evidence.")]
            string action = "scan",
            [Description("Optional SHA-256 fingerprint from the Phase 1 static snapshot. The call fails if another Unity project is connected.")]
            string? expectedFingerprint = null,
            [Description("Zero-based reachable-asset cursor used only by evidence.")]
            int cursor = 0,
            [Description("GUID evidence page size from 1 to 512.")]
            int pageSize = 128,
            [Description("Maximum reachable prefabs whose component types are counted by scan, from 0 to 256.")]
            int maxPrefabs = 96,
            [Description("Bounded GUID candidates reported unresolved by the static scanner; Unity returns authoritative resolved/missing dispositions.")]
            List<string>? unresolvedGuids = null,
            [Description("Bounded logical asset paths whose binary serialization needs an authoritative Unity import disposition.")]
            List<string>? serializedAssetPaths = null)
        {
            return MainThread.Instance.Run(() => UnityIntelligenceScanner.Execute(
                action,
                expectedFingerprint,
                cursor,
                pageSize,
                maxPrefabs,
                unresolvedGuids,
                serializedAssetPaths));
        }
    }
}
