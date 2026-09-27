# Combat Magic port issue coverage

Updated 2026-09-27. Shared integration is not whole-pack visual acceptance.
Every listed commit is in shared-kit main; the companion fix registry supplies
portable implementation/test paths. Historical discoveries are archived in
combat-magic-porting-lessons.json. Read current guards and this status before
reusing a historical lesson. Game captures, materials and gallery remain in
the consuming project; they are not reusable shared assets.

## User-reported issues

| Report | Shared coverage | Remaining acceptance |
|---|---|---|
| EFX3302 sourceRendererPivot in trail/static; import UUID downloads; shader error log | 3dc14a6 per-pass property/uniform validation and complete idempotent publication; ff73019 cross-stage precision validation | Live import still required; Asset tree events are not shader errors. |
| Chaotic explosion flat gray/black surface | Capture layer visibility contract a2b7f67; stained GrabPass equal-key ordering da504f0; procedural sort centers 68b3c6f | Pack-specific GrabPass binding stays in project. Other motion/Noise bounds are guarded. |
| Cube (1) black; lighting, skybox and color | Native light kernel/SH selection 7b6deb8,e81f17f; legacy intensity 5c3057f; pipeline/quality guard db8479b | Standard BRDF/environment shader and source SH/cube assets are pack-specific. Recreate source ambient SH, reflection mips and solid camera clear; do not substitute a global brightness boost. Original Preview environment was measured; Editor/full-pack lighting is not globally accepted. |
| black-arc-black-zone ground/camera mismatch | Native billboard frames 7931027; render-state/quality guard db8479b; camera masks a2b7f67 | Match actual camera matrices, viewport and timeline. The user's Editor/Preview surface is not established for every screenshot; no blanket camera parity claim. |
| Dark chaotic-explosion, black-circle/cloud, blood-arc-black-ring, blood-circle, blood-massacre, lightning-arc-black-ring | Sorting 68b3c6f plus material reference guard 84e6d4e | Original Built-in versus working URP baseline differs. No universal tint fix has been accepted. |
| Reversed black/fire/volcanic/lightning tornado and lightning-whirling-arc-zone | Native rotation RNG/endpoints ae76f98; LF-stable fixture bd7c69f; Editor lifecycle 84db2d1 | Preview audit found 79 matched spins with no opposite direction; this does not establish every Editor screenshot or TwoCurves RNG parity. |
| blood-ring/shock/spike, frost-ring/shock/spike/wave retract toward camera | Module frames 4d71d1f; scale cdeea08,3de05b1; Editor lifecycle 84db2d1 | Historical browser audit: 106 matched downward particles, no wrong direction. Its earlier statement that decorators were absent is superseded by 84db2d1. No source curve retuning. |
| fire-flaming-explosion / fire-eradication-beam rays too long | Random-force native clock cb76c72; Editor lifecycle 84db2d1 | Live Editor missing adapters reproduced and fixed. Native-force A/B greatly reduced excess radius; residual position/count differences remain. |
| frost-crystal solid core | Local Sphere Mesh birth alignment add6ffb | 48 native aligned births and live Editor check; Preview radial core restored. Initial-state/shape jitter RNG and 95% full appearance remain open. |
| hex-aura-orange pale | Material reference audit 7d80009, including Soft Additive versus migrated URP Additive | Matching original Built-in captures are close. Choice between original and user's working URP remains pending; no color mutation was made. |

## Other discovered issues and portability

The companion lesson archive includes every project `*-lessons.json` present
at this audit: native frames, Noise size/randomness, trails, birth timing/order,
particle lights, shader precision, idempotent generation, sub-emitter force,
dry-run mutation, capture clocks, fidelity thresholds, emission windows,
GrabPass ties, projectile clocks/contact, hierarchy scale, fixed Force,
initial-state channels, module frames, Edge shape/jitter, forward lighting/SH,
size measurement, render-state guards, shape streams, material baselines and
capture request identity. These discoveries already have canonical code and
tests in main; the archive makes the reasoning available without this project.

Recent additional discoveries have direct current entries:

- Editor components can be serialized but inactive without executeInEditMode
  and playOnFocus. Check installed markers after compilation, not refresh ack.
- Sphere alignment is additive Euler at birth before zero speed, not a
  LookRotation quaternion. Current measured subset is deliberately narrow.
- Soft Additive has no tint multiplier; equal white coefficients do not mean
  equal equations or destination blend. Resolve reference intent first.
- Lost Play Mode RPC acknowledgement can still produce a completed capture;
  request identity da03460 prevents accepting another request's output.

Do not overwrite working Unity URP materials with legacy shaders. Do not mark
all particles 95% accepted from numeric kernels, successful imports or this
coverage audit. Portable code, source fixtures, regression tests, AI routing
and unresolved acceptance are distinct deliverables.
