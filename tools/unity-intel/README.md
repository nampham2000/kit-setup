# Unity Intelligence

Unity Intelligence is the canonical project-understanding layer shared by the Unity → Cocos porting tools. It combines a fast static index with an optional Unity-side scanner exposed through a narrow Unity-MCP adapter.

Agents should start with:

```text
npm run ai:port:plan -- --project <UnityProjectRoot>
```

`port.plan` uses provider `auto`: it briefly probes an already-running local Unity-MCP endpoint, merges authoritative live facts when available, and otherwise continues with the static snapshot plus an explicit diagnostic. It never installs anything unless `--bootstrap` is supplied.

## One-command Unity setup

```text
npm run unity:intel:doctor -- --project <UnityProjectRoot>
npm run unity:intel:setup -- --project <UnityProjectRoot>
```

Setup installs:

- local UPM package `com.ccplayable.unity-intelligence@0.2.0`;
- upstream [IvanMurzak/Unity-MCP 0.89.0](https://github.com/IvanMurzak/Unity-MCP/tree/71931e260b32339ca35f89de409da0516930cb5c), pinned to an exact commit;
- the OpenUPM scopes required by the upstream package.

The tool writes `Packages/manifest.json` atomically, creates a loopback-only token configuration, then follows one safe reload path:

- attach to the existing Editor when its project lock and exact version agree; or
- launch the exact declared Unity Editor in batch mode for a closed project.

It never launches a second Editor against a held lock and never substitutes a nearby Unity version. Success requires a fresh, schema-valid result marker with the same project fingerprint; Unity exit code alone is not trusted. On failure, the default rollback covers manifest/config, `packages-lock.json`, a newly generated reserved `Assets/Plugins/NuGet` footprint, and Unity-MCP gate defines. `--keep-on-failure` is an explicit opt-out for debugging.

## Compact contract

The static `UnityProjectSnapshot` keeps the full internal graph needed by porting tools. The Unity-side `UnityLiveSnapshotPatch` contributes only bounded facts:

- enabled build scenes and Unity-resolved GUIDs;
- reachable asset/type counts and entry prefabs;
- bounded prefab component census;
- registered packages and compiled assemblies;
- evidence-backed diagnostics and feature signals.

The merger rejects another project's patch, keeps inputs immutable, records static/live conflicts, and only clears a static diagnostic through an explicit `resolvesDiagnosticKeys` entry.

Agent-facing output is deliberately smaller than the internal index:

- summary and feature sketch: at most 24 KiB;
- paged section query: at most 48 KiB and 200 items;
- cursor bound to `scanId + section + query`;
- no raw YAML, raw C#, token/credential fields, or absolute filesystem paths;
- at most three compact evidence items per feature/diagnostic summary.

The Unity scanner is edit-time only and always reports `playModeCapture: false`; it does not claim to observe GameObjects created only at runtime.

## Focused commands

```text
npm run ai:unity:scan -- --project <UnityProjectRoot>
npm run ai:unity:query -- --project <UnityProjectRoot> --section features
npm run ai:unity:query -- --project <UnityProjectRoot> --section scripts --search GameManager
```

The workspace MCP server (`unity-intel`) exposes only four tools: doctor, scan, feature sketch, and bounded slice. The full upstream Unity-MCP tool catalog is intentionally not forwarded to agents, reducing schema/token overhead while retaining the authoritative Unity-side scan.

## Static index and cache

The static provider discovers `Assets`, embedded/local packages, and matching `Library/PackageCache` versions; builds GUID, asset, dependency and C# type/assembly indexes; and starts reachability from enabled build scenes. Vendor/sample/editor evidence remains available for GUID resolution while the default porting view filters it out.

Incremental cache lives outside both Unity and Cocos projects. Editable assets are checked per file. `Library/PackageCache` is treated as immutable for warm-scan performance; use `--refresh-cache` after manual in-place edits.
