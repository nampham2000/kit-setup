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

Electro_Particles exposed a missing binding, not a missing RNG kernel: View
billboards with 2D TwoConstants rotation over lifetime used Cocos randomness.
The old gate selected Mesh/Local/3D renderers only. The native retained rotation
channel already matched 217 native deltas, but was never installed here. Bind
UnityParticleEulerRotationAdapter for View billboard TwoConstants as well; check
both converter attachment and late-cycle images. Do not extend this evidence to
TwoCurves or other renderer modes without native validation.

Seeded Sphere/Hemisphere positions are intentionally approximate in
UnityParticleShapeRandom. Existing native fixtures bound each source-axis error
by radius * 0.007 plus float tolerance. Carry that limitation into pack reports;
transform the bound conservatively with shape/world scale. A visual score does
not make that radius implementation bit-identical. Other shapes/motion errors
must not inherit a blanket loosened position threshold.

Electricity adds a native-verified constant prewarm subset: billboard, looping,
zero-size Box shape, constant initial values, no motion, random inputs or other
enabled modules. Only this invariant may resolve the generic initialization RNG
obligation. Meshes, randomized inputs and new enabled modules keep the guard.
The fixture records five source contracts and their native phase samples; this
does not certify arbitrary prewarm RNG.

Thin effects can miss all three runtime smoke-test sample locations. The runOne
API accepts contentProbePoints (up to 16 normalized points) selected from an
independent visible native reference. Default probes remain active. Do not disable
the blank-frame guard, sample UI, or choose points from the candidate image.

For Linear Unity alpha particles, decode sRGB texture values before filtering,
blend into a linear floating-point target, then apply the sRGB transfer once.
Electricity's raw gamma blending produced dark purple despite correct blend
factors. Reusing UnitySrgbTexture, UnityLinearTarget and the measured AOE frame
pipeline corrected sampled RGB to within one byte without tint compensation.
Check the actual source pipeline first; do not apply this to Gamma sources.

Check the first visible frame, not just particle count. Creator 3.8.8 detaches an
empty particle model in beforeRender, then sets _needAttach one render too late
after the first birth. Electricity ef_01 reproduced count=1 and correct lifetime
with a blank image at frame zero. The simulation-step adapter now reattaches a
live, enabled, non-culled model after update, without an extra simulation step.
The native frame-zero sprite became visible after this fix. Tests retain empty,
culled, disabled, and already-attached behavior.

Electricity VFX pack exposed two integration gaps despite existing unit coverage:
the CLI passes an Assets root to particle bindings, while the timestep/gravity
reader expected a project root; normalize both forms and test the CLI-shaped
input. Also include UnityParticlePrewarmAdapter in the Editor lifecycle audit.
Its absence was reproduced on ef_04; after the opt-in, all five prewarmed
Electricity emitters installed the hook in a natural Scene instantiation.
Keep the initial-state prewarm/RNG obligation until native samples establish
that contract; a working prewarm hook does not certify RNG equivalence.

A targeted `preflight --intent prefab` is an analysis view and does not issue a
mutation receipt. For an asset-pack conversion, run project-intent preflight
with `--profile full-project` before invoking the porter. Check
`decision.mutationReceiptIssued` and `receiptId`, not only the CLI's successful
JSON-file write. Run it after the reference Editor finishes importing assets.

Before treating a silent porter as an import or shader failure, establish its
active phase. Unity GUID indexing includes Assets and PackageCache. Directory
entry filtering now excludes irrelevant files before expensive filesystem
probes; accepted files and traversed directories still pass lstat/realpath
containment checks. Do not bypass those checks or omit packages to accelerate a
port. Prefer one sequential catalog batch to repeated one-prefab invocations,
which repeat the source index. On a busy multi-project machine, avoid starting
duplicate scans while an earlier scan is still active. The scan-cost and
port-path-boundaries tests cover the filter and retained path safeguards.

Electro saturated emitters exposed two separate lifecycle gaps. Cocos emits before
retiring expired particles, which can skip native births at capacity; double
lifetime subtraction can also shift an exact death boundary. Eligible source
systems now opt into pre-emission retirement and float lifetime storage. Sources
with enabled sub-emitter, collision, trail or trigger modules are excluded until
their callback order is measured. Six independent native timelines cover capacity
2/4, constant/random lifetime and two viewport seeds.

An early adapter onLoad can run before ParticleSystem creates its CPU processor.
Install capacity retirement again in start, idempotently, and verify the runtime
marker on a naturally instantiated prefab before accepting a replay. Algorithm
tests alone missed this integration gap. Check counts, birth seeds and lifetimes
at late frames, not just visible startup frames; never reset a reference seed to
hide saturated-pool divergence.

Stretched billboard acceptance must include an asymmetric texture and off-axis
camera/particle positions. The native width axis is projected into the camera
plane; reflect the cross-product order with the coordinate basis, otherwise the
texture width is mirrored. Route all source stretched renderers through the source
effect, including zero-pivot Mobile materials. Sixteen native BakeMesh cases cover
parallel/oblique velocities and both camera projections. Geometry alone cannot
prove UV orientation: seeded Electro Charge Arm replay exposed the width mirror
(frame-15 foreground overlap improved from .243 to .902 after correcting it).
Keep the residual thin-edge/radial approximation visible in the image report.

