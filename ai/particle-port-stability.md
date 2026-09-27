# Particle port stability: AOE versus Combat Magic

AOE's good observed result is not evidence that the shared kit implements every
Unity particle combination. Source inventories in the consuming project show
AOE has 30 primary prefabs plus 5 dependencies / 299 systems; Combat Magic has
62 / 521. Noise appears in 10 versus 92 systems; flipbook UV in 33 versus 197.
AOE actually has more distinct signatures under the current inventory (63 vs46),
so raw complexity is not a sufficient explanation. These numbers describe the
captured source snapshots, not a controlled model-performance comparison.

## Causes demonstrated by the repository

1. Different semantics and rendering families: AOE uses Hovl shader families;
   Combat Magic uses Legacy, Standard and stained GrabPass. A Noise kernel or
   sub-emitter implementation validates its measured subset, not Force RNG,
   renderer orientation, module spaces, birth order and sorting interactions.
2. Different reference: original Built-in/Linear materials were compared by the
   user with a working URP conversion. Camera Forward did not identify pipeline.
   Quality, legacy light intensity and material blend equations also matter.
3. Different execution surface: browser Preview ran adapters that Scene/Prefab
   Editor skipped. Serialized components were mistaken for active behavior.
4. Misleading generation summary: Combat assembler printed renderer `gaps:0`
   while hiding 9 module obligations from its console summary.
5. Coverage did not follow the new pack: the inherited regression registry had
   45 suites, 28 AOE suites and zero Combat Magic suites. General compile/import
   and bounded visible pixels cannot certify all new prefab phases or 95% fidelity.
6. Feature fixes reached main, but discoverability and acceptance lagged. Code
   existence, native numeric tests, binding, live lifecycle and final pixels are
   different gates. Historical work memory is guidance, not a current receipt.

## Implemented prevention

`tools/particle-feature-inventory.cjs --source <live-rendering.json> --out <file>`
extracts observed signatures and greedily chooses representative effects before
bulk conversion. Run source oracles and Editor/Preview probes on that set first.
Representatives are a triage optimization, never an exemption for other effects.

`summarizeBindingGaps` reports renderer and module gaps together. Zero gaps only
means generated-awaiting-visual-acceptance. Consuming assemblers should use this
summary and a strict exit when obligations remain; Combat Magic now does so with
`node tools/combat-magic/assemble.cjs --strict`.

New regression registries initialized with particle-vfx request a particleCatalog
by default. Existing registries can opt in with a project-relative JSON path:

```json
{
  "schemaVersion": 1,
  "prefabs": ["assets/prefabs/effect.prefab"],
  "bindingReport": "tools/vfx/binding-gaps.json",
  "referenceState": "tools/vfx/reference-render-state.json",
  "referenceDecision": "selected",
  "phases": ["birth", "peak", "decay"],
  "referenceMetrics": {"foregroundRgbSimilarity": 0.95, "foregroundIou": 0.95}
}
```

Keep referenceDecision unresolved until the actual desired pipeline/material
baseline is selected. Capture and validate that reference using the native
render-state guard; this catalog does not itself prove Unity was configured so.
Thresholds are explicit measurement requirements, not a claim that any one
metric measures all aspects of perceived similarity. Use source-derived phase
times and add loop/terminal coverage where needed.

Each catalog prefab/phase needs a mandatory particle-vfx matrix case with exact
particlePrefab and particlePhase identifiers, a watched prefab, native image,
checked semantic eval, bounded visible pixels and the requested reference metric
thresholds. The existing runner performs the actual checks. A different pack's
suites, screenshots without assertions, missing phases, unresolved baseline or
binding gaps cannot satisfy the catalog. Catalog, prefab, gap report and reference
state are part of receipt hashing and Git portability checks.

This gate proves declared matrix coverage, not honesty of arbitrary eval code:
source phase/seed/camera identity still needs reviewed producers. Editor lifecycle
must be tested separately through natural instantiation and installed markers;
browser captures cannot certify Scene/Prefab Editor. Keep pack-specific visuals
in the project and reusable native kernels/guards/tests in shared kit.

Combat Magic is deliberately not accepted by the new gate: 9 binding obligations,
unresolved reference choice and 186 uncovered prefab/phase cells remain. Existing
individual diagnostic captures are valuable but have not been promoted to full
catalog regression suites. Do not fabricate passing suites to clear this gate.

# Large-project scan diagnostics

Before treating a silent porter as an import or shader failure, establish its
active phase. Unity GUID indexing includes Assets and PackageCache. Directory
entry filtering now excludes irrelevant files before expensive filesystem
probes; accepted files and traversed directories still pass lstat/realpath
containment checks. Do not bypass those checks or omit packages to accelerate a
port. Prefer one sequential catalog batch to repeated one-prefab invocations,
which repeat the source index. On a busy multi-project machine, avoid starting
duplicate scans while an earlier scan is still active. The scan-cost and
port-path-boundaries tests cover the filter and retained path safeguards.

