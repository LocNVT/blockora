# Codex Review

Status: PASS

Task:
fix: raise jumpVelocity so the player can clear a 1-unit step

Summary:
jumpVelocity=5 with gravity=18 gave an apex of v^2/(2g) ≈ 0.69 blocks, physically
unable to clear a 1-unit step. Raising jumpVelocity to 6.5 gives an apex of
≈1.17 blocks, enough to clear the step with margin. The chosen value exactly
matches MOB_CONFIG.stepJumpVelocity (6.5), which already carries the comment
"tuned to clear 1 block with margin but not 2" — the fix aligns player jump
physics with the existing, independently-tuned mob auto-step constant.

Critical:
- None

Important:
- None

Minor:
- None

Required fixes:
- None

Tests:
- The new test ("jump apex clears a 1-unit step") simulates a real jump from
  rest via stepPlayer for 200 physics steps (1/60 dt), tracks the actual
  simulated peak position, and asserts apex height > 1 block. This is a
  genuine regression test: it fails under the old jumpVelocity=5 (apex ≈0.69)
  and passes under 6.5 (apex ≈1.17) — not tautological, since it exercises the
  full gravity/integration loop rather than checking the constant directly.
  Existing test "jumps only when grounded" (line 112) compares against the
  live PLAYER_CONFIG.jumpVelocity rather than a hardcoded number, so it
  remains valid unchanged. Full suite: 1360/1360 tests pass (85 files),
  including voxelCollision, fallDamage, and mobPhysics.

Architecture:
- No structural changes; single tuning constant plus one additive test.
  Constant stays centralized in PLAYER_CONFIG per BlockDefinition/config
  conventions; no magic numbers introduced.

Performance:
- Negligible. Jump delta per physics step at 6.5 blocks/s over a 1/60s frame
  is ~0.108 blocks, far under maxSubstepDistance (0.5), so no additional
  collision substeps or tunneling risk. maxFallSpeed (40) and gravity (18)
  are unaffected since jumpVelocity only sets the initial upward velocity,
  not any clamp bound.

Reviewed files:
- src/config/constants.ts
- tests/playerPhysics.test.ts
- src/player/playerPhysics.ts
- src/player/voxelCollision.ts
- src/player/fallDamage.ts
- src/entities/mobPhysics.ts (MOB_CONFIG.stepJumpVelocity cross-reference)
- docs/ROADMAP.md, docs/PROGRESS.md (no conflicting assumptions found)

Recommendation:
continue
