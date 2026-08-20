# Emitter regression fixtures

Two small C# files that reproduce every emitter defect found while validating
the compiler against the Unity project `BlastShooter-Android` on 2026-08-19.
Each one is deliberately ordinary Unity code — the bugs were never exotic.

| File | Reproduces |
| --- | --- |
| `ScalarAndVectorMath.cs` | Scalar arithmetic on identifiers containing `up` / `right` / `scale` / `position` being rewritten into `Vec3` calls; `.x` on a vector treated as a vector; consecutive vector locals aliasing one scratch object. |
| `MemberQualification.cs` | Bare references to the class's own methods, properties and statics; getter bodies left unqualified; `for` / `foreach` variables shadowing fields; members inside interpolated strings. |

The contract asserted by `unity-cs-compiler.test.cjs` is simply that both files
emit TypeScript that **type-checks with zero errors** against the Cocos engine's
own `cc.d.ts`. That is the property that was missing: before the fix the compiler
reported these as `1/1 TS syntax valid` with a 0.94 confidence score while the
output had 10 real type errors.

Keep them free of third-party dependencies so the assertion stays about the
emitter and nothing else.
