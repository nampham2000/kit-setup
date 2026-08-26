# Unity Intelligence

Unity Intelligence is the canonical project-understanding layer shared by the Unity → Cocos porting tools. It combines a fast static index with an optional Unity-side scanner exposed through a narrow Unity-MCP adapter.

Agents should start with:

```text
npm run ai:port:preflight -- --project <UnityProjectRoot>
```

`port.preflight` uses provider `auto`: it briefly probes an already-running local Unity-MCP endpoint, merges authoritative live facts when available, and otherwise continues with the static snapshot plus an explicit diagnostic. In one process it builds a feature sketch, routes every high diagnostic to implementation/verification, and writes a content-bound receipt to user-local cache. It never installs anything unless `--bootstrap` is supplied. `port.plan` remains a legacy/deep dependency planner and should only run when the compact brief is insufficient.

## Implementation preflight and mutation gate

The default project intent emits a <=12 KiB `unity-port-implementation-brief` containing `decision`, `coreGameplay`, core-routed `features`, a complete compact `obligationIndex` (all high code/counts), `coreObligationIndex`, routed `obligations`, ordered capabilities, verification steps, and a receipt ID. When detail must be trimmed, both indexes remain complete and the agent follows the shared compact route plus a bounded diagnostic query. Focused scene/prefab/script/shader/feature/diagnostic intents route typed evidence but are analysis-only; they do not authorize output writes.

### Playable-core golden path (Phase 5)

`playable-core` is the default preflight profile. It scores enabled build scenes, selects one gameplay entry, and rebuilds reachability from that scene instead of every loading/menu scene. The resulting closure keeps core input/rules/state/movement/spawn/timing/win-lose feedback. Main menu, shop/IAP, daily/meta screens, persistence, analytics/ads SDKs, and online services are classified as deterministic adapters or explicit deferred scope. No high is deleted: `obligationIndex` is the full source audit, while `coreObligationIndex` records `required`, `adapter`, or `deferred` disposition. Use `--profile full-project` only for a deliberate non-playable/full-game port.

Start and finish a core port with:

```text
npm run ai:port:core:init -- --unity-project <UnityProjectRoot> --cocos-project <CocosProjectRoot>
npm run ai:port:core:verify -- --unity-project <UnityProjectRoot> --cocos-project <CocosProjectRoot>
```

`core:init` reruns mandatory preflight and writes `.ai/port/core-gameplay.json` with pending, compact fidelity checkpoints. It refuses a hard-blocked source or ambiguous gameplay entry. `core:verify` runs verify, zero-GC lint, Cocos asset import, build, and Chrome runtime smoke in order. It then computes a 100-point evidence-weighted core parity score. The minimum acceptance is 80, the target is 90, and input response, core rules/state, and win/lose/restart are mandatory. Compiler confidence and unchecked booleans never count: every checkpoint needs existing Unity evidence, an existing Cocos target, and matching JSON runtime/visual evidence. The score is a transparent parity rubric, not a claim of pixel-perfect or automatically proven semantic equivalence.

### Phase 6 acceptance hardening

Manifest schema v2 pins the exact target gameplay scene, nine checkpoint IDs/weights/mandatory flags, the 80/90 thresholds, and the fixed verify/build/runtime gate list. Creation uses an exclusive lock plus compare-and-swap, so `--force` cannot overwrite a manifest changed by another agent. Manifest, target, and evidence paths reject traversal and symlink/junction redirects.

Each file under `.ai/port/evidence/*.json` uses `cc-playable-core-checkpoint-evidence` schema v1 and binds `briefId`, `stateFingerprint`, one checkpoint, observations, and SHA-256 for every current target file. Changing a target invalidates old evidence automatically. `input-response`, `core-rules-state`, and `win-lose-restart` require `runtime` or `runtime-visual`; a screenshot alone cannot satisfy behavior. Gate subprocesses are fixed, sequential, bounded to ten minutes/2 MiB each, redact project paths and credential-shaped output, and stop on first failure.

The three-project regression prints cold/warm progress to stderr while keeping one JSON document on stdout. It now fails if warm scan exceeds 20 seconds or the selected core closure exceeds 20% of project-owned assets. This protects the low-usage path without weakening source-integrity checks.

The receipt is atomic, <=4 KiB, contains no absolute path/source/token, and lives in one fixed user-local receipt store so every port gate reads the same authorization. `--cache-dir` only relocates the larger incremental scan index. A receipt expires after 24 hours and becomes stale immediately when editable Unity source, `.meta`, package manifest, project settings, snapshot provider/merger, extractor, router, or capability workflow changes. Scene, prefab, closure-output, C# compiler, and shader CLI write boundaries validate it before their first output write. Dry runs stop before directory creation, `.meta` generation, converter launch, and output writes. A real write must bind to `Assets`, an embedded/local/exact PackageCache root selected by the Unity manifest, or a closure staging directory carrying exact provenance; `Temp`, `UserSettings`, arbitrary project files, unrelated external sources, symlink/reparse escapes, and cached absolute/traversal paths are rejected.

`port.closure --copy-to` writes `.unity-port-provenance.json` atomically next to the staged C# files. The marker binds the current receipt, project state, staging-directory identity, origin logical paths, and source/target SHA-256 hashes without storing absolute paths. `port.compile` consumes it with `--unity-project <UnityProjectRoot>` and fails before output if a file was added, removed, edited, copied from another project, or if the marker was moved.

Static `UNITY_REACHABLE_GUID_UNRESOLVED` evidence is a completion obligation, not an implementation deadlock: static YAML can report references that require Unity's imported asset database to interpret. The live scanner receives at most 512 such GUIDs and 96 reachable partial serialized paths. It clears static uncertainty only when every requested candidate returns bounded complete evidence: a resolved GUID includes its recovered path and complete direct dependency mappings; a serialized asset includes a complete bounded `SerializedObject`/object-reference walk. Missing or partial/truncated evidence becomes an authoritative live high and blocks implementation. Candidate dispositions remain internal; agents still consume the compact decision/features/obligations contract.

High source diagnostics are not treated uniformly: source-integrity/unknown highs block implementation, while DOTween, coroutine, animator, Addressables, DI, and shader highs become mandatory completion obligations. This lets agents implement the missing behavior without pretending the original Unity source warning must disappear.

## One-command Unity setup

```text
npm run unity:intel:doctor -- --project <UnityProjectRoot>
npm run unity:intel:setup -- --project <UnityProjectRoot>
```

Setup installs:

- local UPM package `com.ccplayable.unity-intelligence@0.3.0`;
- upstream [IvanMurzak/Unity-MCP 0.89.0](https://github.com/IvanMurzak/Unity-MCP/tree/71931e260b32339ca35f89de409da0516930cb5c), pinned to an exact commit;
- the OpenUPM scopes required by the upstream package.

The tool writes `Packages/manifest.json` atomically, creates a loopback-only token configuration, then follows one safe reload path:

- attach to the existing Editor when its project lock and exact version agree; or
- launch the exact declared Unity Editor in batch mode for a closed project.

It never launches a second Editor against a held lock and never substitutes a nearby Unity version. An attached Editor can briefly serve the old endpoint while domain reload is in progress, so compatibility readiness calls omit the candidate parameters introduced in `0.3.0` and retry only scanner-version/capability mismatches within the requested deadline. Setup accepts readiness only from package `0.3.0`, protocol `1`, and (when candidates will be sent) the `candidateDisposition` capability. The first valid bootstrap scan only proves import/domain-reload readiness. The service then rebuilds the static baseline and requires a second authoritative scan against that exact fingerprint; the first marker can never authorize implementation. Unity exit code alone is not trusted. Before reload begins, manifest/config use validate-all-then-mutate CAS rollback. Once reload/import begins, ownership of generated package state may have changed; failure therefore preserves the complete setup generation instead of partially deleting it. Fix the reported compile/import error and rerun setup. `--keep-on-failure` remains an explicit debugging option but does not weaken this safety boundary.

## Compact contract

The static `UnityProjectSnapshot` keeps the full internal graph needed by porting tools. The Unity-side `UnityLiveSnapshotPatch` contributes only bounded facts:

- enabled build scenes and Unity-resolved GUIDs;
- reachable asset/type counts and entry prefabs;
- bounded prefab component census;
- registered packages and compiled assemblies;
- evidence-backed diagnostics and feature signals.
- bounded static-candidate dispositions with recovered dependency/reference edges. Candidate input travels through a read-bounded temporary JSON file (<=256 KiB, including maximum UTF-8 paths) in batch mode, never an environment variable.

The merger rejects another project's patch, keeps inputs immutable, records static/live conflicts, and only clears a static diagnostic through an explicit complete candidate disposition/`resolvesDiagnosticKeys` entry. Partial candidate pages never imply completeness.

Agent-facing output is deliberately smaller than the internal index:

- summary and feature sketch: at most 24 KiB;
- implementation preflight brief: at most 12 KiB; receipt: at most 4 KiB;
- paged section query: at most 48 KiB and 200 items;
- cursor bound to `scanId + section + query`;
- no raw YAML, raw C#, token/credential fields, or absolute filesystem paths;
- at most three compact evidence items per feature/diagnostic summary.

The Unity scanner is edit-time only and always reports `playModeCapture: false`; it does not claim to observe GameObjects created only at runtime. It walks nested/list serialized properties across every sub-asset at a logical path, identifies object references by GUID plus local file ID, and treats missing scripts or non-null references that cannot be represented inside `Assets/Packages` as incomplete evidence. Direct MCP and batch both accept at most 512 unresolved GUIDs plus 96 serialized assets. Reference evidence is globally bounded to 512 entries and 256 KiB; the exact serialized candidate array is bounded to 768 KiB. Excess evidence is degraded to compact `partial` records while preserving every requested key, so truncation can never clear a source diagnostic.

## Focused commands

```text
npm run ai:unity:scan -- --project <UnityProjectRoot>
npm run ai:unity:query -- --project <UnityProjectRoot> --section features
npm run ai:unity:query -- --project <UnityProjectRoot> --section scripts --search GameManager
```

The workspace MCP server (`unity-intel`) exposes only four tools: doctor, mandatory preflight scan, feature sketch, and bounded slice. Feature/slice calls fail with `UNITY_SCAN_REQUIRED` when an agent skips the scan, instead of silently rescanning and hiding the brief. Error payloads redact absolute paths. Concurrent scans are generation-ordered per project: only the newest-started scan may publish its snapshot, and a superseded caller must use the newer brief. The full upstream Unity-MCP tool catalog is intentionally not forwarded to agents, reducing schema/token overhead while retaining the authoritative Unity-side scan.

## Static index and cache

The static provider discovers `Assets`, embedded/local packages, and exact installed package roots; builds GUID, asset, dependency and C# type/assembly indexes; and starts reachability from enabled build scenes. Registry packages require the exact manifest/lock version. Git and local-tarball packages require the resolved path and fingerprint recorded by the context-matched `Library/PackageManager/projectResolution.json`; similarly named stale cache siblings are rejected. Vendor/sample/editor evidence remains available for GUID resolution while the default porting view filters it out.

Incremental cache lives outside both Unity and Cocos projects. Editable assets are checked per file. `Library/PackageCache` is treated as immutable for warm-scan performance; use `--refresh-cache` after manual in-place edits.
