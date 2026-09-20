# Source Orbital investigation (2026-09-20)

The old porter approximated orbital motion with sampled velocity ellipses, modified emission Shape/startSpeed, damped upward velocity and invented random X/Z velocities. It handled orbitalY but lost orbitalZ (Buff 1) and coupled XYZ motion (Heal). These operations do not preserve the emitter axis.

Native Shuriken probes establish position rotation Z -> X -> Y, then radial displacement along the rotated position, followed by base/linear velocity. Buff 6 and Buff 1 source curves reproduce 100 native matched-birth trajectory samples with maximum position error below 0.0001. The shared adapter preserves all source curves and restores the fields previously modified by the approximation. Fourteen owners in Buff 1, Buff 6, Heal and Leaves buff are bound. Random ranges retain stable per-particle uniform samples; Unity/Cocos random seed channel identity is not claimed.

The generic prefab porter now stages and binds UnityParticleOrbitAdapter automatically. Missing AssetDB registration requires refresh and rerun; unsupported world/custom simulation, offsets, velocity limiting, weighted curves and Noise composition report high instead of silently inventing motion. Cache version 7 invalidates earlier approximations. Project capture scripts are evidence producers, not runtime dependencies.


Run node --test tools/unity-cocos-port/particle-orbit-native.test.cjs tools/unity-cocos-port/particle-orbit-binding.test.cjs. Native sampling evidence is in fixtures/particle-orbit-native.json.
