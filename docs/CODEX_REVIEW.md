# Codex Review

_Written by Claude from Codex's verbatim output (Codex sandbox was read-only). Reviewed commit 0c02e93._

Status: PASS_WITH_NOTES

Task:  
Phase 5 entity system + passive pig

Summary:  
The commit adds a plain-data entity store, passive pig AI and voxel physics, spawn/despawn rules, and instanced rendering. No concrete critical or important defect was found in the reviewed implementation.

Critical:
- None

Important:
- None

Minor:
- `mobAI` and `mobPhysics` assume nonnegative, finite `dt`; the production `updateMobs` path clamps the frame delta.
- `MobRenderer.update` allocates a filtered array and a `Set` each frame. The current passive-mob cap of 12 keeps this bounded; profile before raising the cap.

Required fixes:
- None

Tests:
- New tests cover entity storage and removal, AI transitions and turning, collision and hazards, spawning and despawning, and deterministic sequences. `git diff --check HEAD^ HEAD` passes. Tests and build were not run during this review.

Architecture:
- Simulation data and systems are separated from Three.js rendering, and collision reuses the shared voxel AABB core. The committed `PROGRESS.md` records the implemented slice. The separate uncommitted `CLAUDE.md` edit was excluded.

Performance:
- Instanced meshes keep draw calls fixed across the current pig population, with explicit renderer disposal. Spawn checks are bounded to four attempts per five-second wave, and the mob population is capped.

Reviewed files:
- `src/config/constants.ts`
- `src/entities/EntityStore.ts`
- `src/entities/mobAI.ts`
- `src/entities/mobDefinitions.ts`
- `src/entities/mobPhysics.ts`
- `src/entities/mobSpawning.ts`
- `src/entities/updateMobs.ts`
- `src/main.ts`
- `src/renderer/MobRenderer.ts`
- `tests/EntityStore.test.ts`
- `tests/mobAI.test.ts`
- `tests/mobPhysics.test.ts`
- `tests/mobSpawning.test.ts`
- `docs/ROADMAP.md`
- `docs/PROGRESS.md`

Recommendation:  
Continue
