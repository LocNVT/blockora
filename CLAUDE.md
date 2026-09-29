# VoxelWorld — Claude Code Instructions

## Agent & Model Strategy

Use the cheapest capable model for each task.

### Haiku — Simple Tasks
Use Haiku for:
- boilerplate
- simple file creation
- straightforward CRUD
- simple UI changes
- formatting
- typo/documentation fixes
- simple unit tests
- repetitive mechanical changes
- small isolated bug fixes with an obvious cause

### Sonnet — Normal Development
Use Sonnet for:
- most feature implementation
- TypeScript/Three.js gameplay systems
- inventory/crafting
- player controller
- chunk management
- collision
- UI
- persistence
- integration between existing systems
- normal debugging
- refactoring across several files

### Opus — Complex Tasks
Use Opus for:
- architectural decisions
- world generation design
- greedy meshing
- Web Worker architecture
- difficult performance problems
- complex debugging
- concurrency/state consistency
- major refactoring
- tasks where requirements are ambiguous
- reviewing critical architecture

### Delegation Rules

Before implementing a task:
1. Estimate task complexity.
2. Choose the cheapest model capable of completing it reliably.
3. Prefer Haiku for mechanical work.
4. Prefer Sonnet for normal implementation.
5. Escalate to Opus when architecture, performance, or difficult debugging is involved.
6. Do not use Opus for simple mechanical tasks.

The main agent should remain responsible for:
- understanding ROADMAP.md
- deciding task boundaries
- architectural consistency
- reviewing delegated work
- updating PROGRESS.md
- running tests/build

## 1. Project

VoxelWorld is a browser-based 3D voxel survival sandbox.

Goal:

> A playable voxel game that runs directly in a modern browser.

Inspired by voxel sandbox games, but all code, names, textures, sounds, and assets must be original.

---

## 2. Stack

Use:

* TypeScript
* Three.js
* Vite
* WebGPU when available
* WebGL2 fallback
* Web Workers
* IndexedDB
* Vitest

Package manager:

* pnpm

Do not introduce another framework unless there is a strong technical reason.

Do not use React for the game renderer.

---

## 3. Core Architecture

```text
Game
├── Renderer
├── World
│   ├── ChunkManager
│   ├── Chunk
│   ├── WorldGenerator
│   └── ChunkMesher
├── Player
├── Inventory
├── Crafting
├── Items
├── Mobs
├── Combat
├── Save
├── Audio
└── UI
```

Keep systems modular.

Prefer composition over inheritance.

Avoid global mutable state.

Avoid giant manager classes.

Keep rendering, simulation, persistence, and UI separate.

---

## 4. Performance Rules

These rules are mandatory.

### Never

* Create one Three.js Mesh per block.
* Create one Material per block.
* Create one Texture per block.
* Store every block as a JavaScript object.
* Generate the entire world at startup.
* Run expensive chunk generation synchronously on the main thread.
* Use localStorage for world data.

### Prefer

* TypedArray
* BufferGeometry
* Texture Atlas
* Face culling
* Greedy meshing
* Chunk streaming
* Web Workers
* Transferable ArrayBuffer
* Object pooling where useful
* Frustum/chunk culling

Voxel storage should use:

```ts
Uint8Array | Uint16Array
```

depending on the required block ID range.

---

## 5. World Constants

Initial defaults:

```text
Block size: 1
Chunk width: 16
Chunk depth: 16
Chunk height: 128

Render distance: 8 chunks
Simulation distance: 6 chunks

Sea level: 32

Player height: 1.8
Walk speed: 4.3
Sprint speed: 6.5
Crouch speed: 2.2
Jump velocity: 5
Gravity: 18

Interaction distance: 6

FOV: 75
```

Keep these values configurable.

Do not scatter magic numbers through gameplay code.

---

## 6. Rendering

Renderer selection:

```text
WebGPU → preferred
WebGL2 → fallback
```

Rendering must support:

* Texture atlas
* Chunk meshes
* Transparent blocks
* Basic lighting
* Fog
* Sky
* Day/night lighting

Do not optimize blindly.

Measure:

* FPS
* frame time
* draw calls
* triangles
* memory
* chunk generation time
* mesh generation time

---

## 7. Chunk Rules

Chunk coordinates are integer coordinates.

A chunk contains:

```text
16 × 16 × 128
```

blocks.

Use deterministic indexing.

Example:

```ts
index = x + width * (z + depth * y)
```

Chunk generation must be deterministic:

```text
same seed
+
same chunk coordinate
=
same generated chunk
```

---

## 8. World Generation

Generation should be data/config driven.

Initial systems:

* Height noise
* Detail noise
* Biomes
* Trees
* Ores
* Caves
* Water

Initial biomes:

* Plains
* Forest
* Desert
* Taiga
* Mountains
* Swamp

Do not build advanced terrain systems before the basic generator is playable.

---

## 9. Blocks

Use a central BlockRegistry.

Every block should define only the properties it needs.

Example:

```ts
interface BlockDefinition {
  id: number;
  name: string;
  solid: boolean;
  transparent: boolean;
  hardness: number;
  toolType?: ToolType;
  dropItem?: number;
  texture: BlockTexture;
  lightLevel: number;
  flammable: boolean;
}
```

Initial blocks:

```text
Air
Grass
Dirt
Stone
Sand
Gravel
Water
Wood
Leaves
CoalOre
IronOre
GoldOre
Glass
Planks
Cobblestone
Torch
CraftingTable
Chest
```

---

## 10. Player

Desktop controls:

```text
WASD      Move
Mouse     Look
Space     Jump
Shift     Sprint
Ctrl      Crouch
LMB       Break
RMB       Place
E         Inventory
1-9       Hotbar
Esc       Pause
F3        Debug
```

Use Pointer Lock API.

Player collision should be voxel/AABB based.

Do not add a heavy physics engine unless required.

---

## 11. Inventory

Initial:

```text
36 inventory slots
9 hotbar slots
64 max stack
```

Support:

* Add
* Remove
* Stack
* Split
* Move
* Drop
* Hotbar selection

Inventory logic must not depend on UI.

---

## 12. Crafting

Support:

* 2×2 player crafting
* 3×3 crafting table

Recipes must be data-driven.

Do not hard-code recipes into UI code.

---

## 13. Survival

Initial:

```text
Health: 20
Hunger: 20

Day: 15 minutes
Night: 5 minutes
```

Implement:

* Health
* Hunger
* Food
* Regeneration
* Damage
* Death

Do not overcomplicate survival mechanics in MVP.

---

## 14. Mobs

Initial:

```text
Passive:
Cow
Pig
Chicken

Hostile:
Zombie-like
Spider-like
```

AI states:

```text
Idle
Wander
Target
Chase
Attack
Flee
Dead
```

Keep AI simple until the world and player systems are stable.

---

## 15. Persistence

Use IndexedDB.

Save:

```text
world seed
player position
player rotation
inventory
health
hunger
time
modified chunks
```

Prefer:

```text
seed + modified blocks
```

instead of saving the entire generated world.

Do not use localStorage for chunk data.

---

## 16. Web Workers

Expensive operations should eventually run in Workers:

```text
terrain generation
chunk generation
mesh generation
```

Communication should prefer:

```text
TypedArray
ArrayBuffer
Transferable
```

Avoid sending large nested JavaScript objects between threads.

---

## 17. Code Style

Use strict TypeScript.

Prefer:

```text
small functions
clear names
explicit types for public APIs
immutable data where practical
```

Avoid:

```text
any
large functions
deep nesting
unnecessary abstractions
premature optimization
```

Do not refactor unrelated code during a feature task.

---

## 18. Dependencies

Before adding a dependency:

1. Check whether native/browser APIs are sufficient.
2. Check whether existing dependencies already solve it.
3. Add a dependency only when it provides meaningful value.

Do not add libraries for trivial utilities.

---

## 19. Testing

Use Vitest.

Prioritize tests for:

* Chunk indexing
* Block registry
* Seed determinism
* Terrain generation
* Inventory
* Item stacking
* Crafting
* Tool durability
* Save/load
* Chunk serialization

Every bug fix should add a regression test when practical.

---

## 20. Development Workflow

For every task:

```text
1. Read relevant documentation.
2. Inspect only relevant files.
3. Implement the smallest complete change.
4. Run targeted tests.
5. Run build when appropriate.
6. Fix errors.
7. Update PROGRESS.md.
```

Do not scan the entire repository unless necessary.

Do not reread unchanged files.

Do not paste large files into responses.

---

## 21. Scope Control

Every task has a scope.

If an unrelated issue is discovered:

* Do not fix it automatically.
* Record it in PROGRESS.md under "Known Issues".
* Continue the current task.

Only expand scope if the discovered issue blocks the current task.

---

## 22. Documentation

Keep these files updated:

```text
CLAUDE.md
docs/ROADMAP.md
docs/PROGRESS.md
docs/ARCHITECTURE.md
```

Do not duplicate large technical explanations between files.

`CLAUDE.md` = rules.

`ROADMAP.md` = planned work.

`PROGRESS.md` = current state.

`ARCHITECTURE.md` = technical design.

---

## 23. Commit Strategy

Prefer small logical commits.

Examples:

```text
feat: add voxel chunk storage
feat: add chunk meshing
feat: add player movement
feat: add block interaction
feat: add terrain generation
perf: move chunk generation to worker
fix: prevent duplicate chunk generation
```

Do not create commits containing unrelated changes.

---

## 24. Response Format

After completing a task, report only:

```text
Status: PASS / FAIL

Changed:
- file
- file

Tests:
- PASS / FAIL

Build:
- PASS / FAIL

Known issues:
- ...

Next:
- ...
```

Do not provide long explanations unless requested.

---

## 25. Context Efficiency

This project is intentionally designed for efficient AI-assisted development.

Always:

* Read only relevant files.
* Use targeted search.
* Avoid repeating requirements already present in documentation.
* Avoid unnecessary explanations.
* Avoid rewriting working code.
* Avoid unrelated refactors.
* Keep changes small.
* Update PROGRESS.md after meaningful tasks.

Before starting a task, read:

```text
CLAUDE.md
docs/PROGRESS.md
```

Then inspect only the files needed for that task.

---

## 26. Current Development Priority

Always follow:

```text
ROADMAP.md
```

Do not jump ahead unless explicitly requested.

Current target:

> Build the smallest playable voxel game first, then expand it incrementally.

## Codex Review Workflow

Every completed implementation task must be reviewed by Codex before moving to the next roadmap task.

### Responsibilities

Claude Code:
- Owns implementation.
- Runs tests, lint and build.
- Reads and follows CODEX_REVIEW.md.
- Fixes issues identified by Codex.
- Re-runs validation after fixes.
- Decides when the task is ready for final review.
- Updates PROGRESS.md only after validation.

Codex:
- Acts as an independent code reviewer.
- Reviews the current git diff and relevant source files.
- Reviews tests and architecture.
- Does NOT modify source code.
- Does NOT create speculative refactors.
- Reports concrete findings only.

### Review Process

After implementation:

1. Claude runs:
   - targeted tests
   - full tests
   - lint
   - build

2. Claude asks Codex to review the implementation.

3. Codex writes the review result to:
   `docs/CODEX_REVIEW.md`

4. Codex must classify the result as:

   PASS
   - No blocking correctness, architecture, security or test issues.

   PASS_WITH_NOTES
   - No blocking issues.
   - Minor observations may remain.

   FAIL
   - At least one issue must be fixed before continuing.

5. If FAIL:
   - Claude reads CODEX_REVIEW.md.
   - Claude fixes only the reported issues.
   - Claude reruns tests/lint/build.
   - Claude requests another Codex review.

6. Only PASS or PASS_WITH_NOTES allows Claude to continue to the next roadmap task.

### Codex Review Scope

Codex should prioritize:

1. Correctness
2. Regression risk
3. Architecture
4. Performance
5. Memory/resource lifecycle
6. Test coverage
7. Type safety
8. Security where relevant

Do not reject working code merely because Codex prefers a different style.

Do not request speculative abstractions.

Do not request optimizations without evidence or a clear performance risk.

Do not expand the task scope.

### Review Output

Codex must keep `docs/CODEX_REVIEW.md` concise.

Format:

# Codex Review

Status: PASS | PASS_WITH_NOTES | FAIL

Task:
<task name>

Summary:
<short summary>

Critical:
- <finding or None>

Important:
- <finding or None>

Minor:
- <finding or None>

Required fixes:
- <fix or None>

Tests:
- <assessment>

Architecture:
- <assessment>

Performance:
- <assessment>

Reviewed files:
- <files>

Recommendation:
<continue / fix and review again>