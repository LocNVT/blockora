# VoxelWorld Progress

## Current Phase

**Phase 8 — Performance**

## Current Task

Phase 8: `glDrawElements` warning + mesh disposal audit.

---

# Phase 0

* [x] Vite project
* [x] TypeScript strict mode
* [x] Three.js
* [x] Vitest
* [x] ESLint
* [x] Folder structure
* [x] Development server
* [x] Production build
* [x] Basic documentation

---

# Phase 1

* [x] Renderer
* [x] WebGPU
* [x] WebGL2 fallback
* [x] Scene
* [x] Camera
* [x] Player movement
* [x] Player collision
* [x] Chunk data
* [x] Block registry
* [x] Chunk mesh
* [x] Face culling
* [x] Texture atlas
* [x] Raycast
* [x] Break block
* [x] Place block

---

# Phase 2

* [x] Seed
* [x] Terrain generation
* [x] Biomes
* [x] Trees
* [x] Ores
* [x] Caves
* [x] Water
* [x] Chunk streaming
* [x] Chunk unloading

Phase 2 exit criteria met: world is deterministic (seed + chunk coord) and streams around the player.

---

# Phase 3

* [x] Items
* [x] Inventory
* [x] Hotbar
* [x] Item drop
* [x] Item pickup
* [x] Crafting
* [x] Tools
* [x] Durability

---

# Phase 4

* [x] Health
* [x] Hunger
* [x] Food
* [x] Damage
* [x] Death
* [x] Respawn
* [x] Day/night
* [x] Torch

---

# Phase 5

* [x] Entity system
* [x] Passive mobs
* [x] Hostile mobs
* [x] AI
* [x] Combat
* [x] Drops

---

# Phase 6

* [x] Structures
* [x] Village
* [x] Ruins
* [x] Dungeon
* [x] Loot

---

# Phase 7

* [x] IndexedDB
* [x] World save
* [x] World load
* [x] Player persistence
* [x] Modified chunk persistence
* [x] Save versioning

---

# Phase 8

* [ ] Performance profiling
* [ ] Web Workers
* [ ] Transferable buffers
* [ ] Greedy meshing
* [ ] Chunk prioritization
* [ ] Memory optimization
* [ ] Rendering optimization

---

# Phase 9

* [ ] Main menu
* [ ] Settings
* [ ] Audio
* [ ] Loading screen
* [ ] Better textures
* [ ] Better UI
* [ ] Polish

---

# Known Issues

* No feedback when sprint is blocked by low hunger; starvation damage is subject to the 0.5 s invulnerability window.
* Eating and crafting-table "use" share RMB; crafting-table use always wins on the press frame (see `main.ts` frame loop), so a food item selected while looking at a crafting table cannot be eaten by right-clicking it (works fine away from a crafting table).
* `HungerHud` right-side placement uses a fixed pixel `transform` offset mirrored from `HealthHud`'s centered layout rather than a shared layout primitive; revisit if either HUD's width changes.
* Texture preview row (one block of each type) was removed from the playable world along with the flat test platform; no in-game way to visually spot-check every atlas texture until Phase 9 polish or a dedicated debug tool.
* `pnpm` is not on PATH on the dev machine; use `npx -y pnpm@9 <cmd>` or enable corepack.
* Vite warns bundle > 500 kB (Three.js). Address in Phase 8 via code splitting.
* WebGPU path not yet verified on real GPU hardware (headless check covered WebGL2 fallback only).
* Transparent faces within a chunk are not depth-sorted (fine for now; revisit with water/glass-heavy scenes).
* Atlas UV mapping assumes unit quads; greedy meshing will need shader-side `fract()` on local UV + per-vertex tile (both kept in `ChunkMeshData`) or a texture array.
* Headless Chrome CLI (`--virtual-time-budget`) runs only a few rAF frames; for interactive checks drive real Chrome with `playwright-core` installed in a scratch dir (not a project dependency).
* Browser requests `/favicon.ico` → 404 console error (no favicon yet).
* No swimming: players sink in water; camera inside water sees no water surface/fog (back faces not rendered). Breaking a block underwater leaves an air pocket (no fluid simulation).
* `giveStartingItems` still grants a test kit; temporary until survival/crafting give a real progression.
* `src/ui/HotbarHud.ts` imports atlas pixels from `src/renderer/chunkMeshes.ts` (UI → renderer dependency); move shared atlas data to a neutral module if it grows.
* Inventory screen's floating cursor stack shows no durability bar (slots do).
* Inventory is kept on death (no item drop on death yet); respawn is always world spawn (0, 0), no beds/spawn points.
* Fall damage verified by unit tests only (no in-browser fall check yet).
* Light from an unloaded neighbour stays in surrounding chunks (stale only if the reloaded chunk differs).
* Item drops use the lit standard material (stay bright in dark caves); lighting is flat per face (no smooth lighting / AO); chunk shader duplicates `src/renderer/lightShading.ts` math (keep in sync).
* A greedy mesher must only merge faces with equal light.
* Pigs use a lit `MeshStandardMaterial` scaled by sampled voxel light (chunks are unlit), so mob vs terrain brightness can differ slightly; `maxPerArea` is a global count. Pigs are rare near the default spawn (little grass).
* Combat: tool damage is a flat per-type bonus (no tier scaling); attacking wears a held tool by 1 like a block break; raw pork can be eaten raw (no cooking yet); PIG_CONFIG drop `itemId` is numeric (26) to avoid an import cycle (pinned by a test).
* Mobs: no pathfinding — chasers steer straight at the player and stop at ledges / water / walls > 1 block (common on rough terrain); no player knockback (player velocity is input-driven); daylight despawn is a per-second chance, no burning visuals; cave spawns are sparse (random scan); shambler has no drops; only Pig as passive mob (Cow / Chicken from CLAUDE.md §14 not added).
* Chests: `chestKey` throws for |x| or |z| ≥ 1,048,576 (Codex minor); no shift-click; RMB on a chest always opens it (can't place against it).
* Persistence: not saved — item drops, mobs, crafting-grid contents, the cursor-held stack while a screen is open; a save this build can't read (read error / invalid / newer version) disables saving for the session (warning in console) — reset by clearing site data, no new-world UI; new worlds always use `defaultSeed`; the IndexedDB adapter has no node tests (browser-verified only); the IndexedDB connection stays open with no `versionchange` / close handling, so a future schema upgrade could be blocked by another open tab (Codex minor); placing into a not-yet-loaded neighbour chunk still creates an empty never-generated chunk (pre-existing), and the edit records Air as the original.
* Startup: ~180–210 ms first-frame long task remains (first-use GL driver work; software GPU) plus ~130 ms module-eval task (atlas data-URL generation could be lazy / off-thread); mob / item-drop materials not confirmed precompiled (none on screen at startup). Pre-existing WebGL warning `GL_INVALID_OPERATION: glDrawElements: Must have element array buffer bound` on every run (A/B-checked: not caused by the precompile) — likely an empty indexed / instanced mesh being drawn; investigate.
* Streaming: new rows appear one chunk later (meshed once ring neighbours load); block-edit remeshes bypass ChunkManager's mesh bookkeeping (harmless in practice — edits are within 6 blocks); worker results arrive in request order; light and meshing stay on the main thread; `ChunkManager.dispose()` / `DebugOverlay.dispose()` not called (no teardown).
* Profiling: mesh upload (`sink.upsert`) isn't timed separately (only visible in frame time); frame time includes vsync wait; headless numbers are software-GPU.
* Villages: house floors sit on the highest footprint column + 1, so doorways can be 1–3 blocks above the path (player jump ≈ 0.69 blocks — may need a placed block to enter; not browser-verified); hostiles can spawn on house roofs at night; layout recomputed per chunk (no cache); no slope rule on paths; duplicate path segments where routes share columns.
* Structures: one placement attempt per 6×6-chunk region (rejected site → empty region); ruins and dungeons share that roll, so ruins are ~half as frequent as before dungeons; dungeons are sealed (reached by digging or a crossing cave) and hostile spawns reach them only when the player is within ~12 blocks vertically; floor sits on the highest footprint column, so up to 3 blocks of foundation can show on slopes.
* Crosshair stays faintly visible through the inventory panel; Chest has no container UI yet (only Crafting Table has a use action).
* Outline (thin dark lines) is subtle against dark textures; tune `RENDER_CONFIG.blockOutlineColor` in Phase 9.
* `requiresTool` is tier-agnostic (any pickaxe harvests stone/ores); add `minTier` when iron tools exist.
* Leaves and Glass drop nothing when broken (no "silk touch"/shears equivalent yet); revisit once tools/durability land.
* Item drops have no visual pickup feedback (sound/flash) yet; candidate for Phase 9 polish.
* Crafting table / chest tiles are nearly identical plain boxes; improve art in Phase 9.
* No auto step-up: 1-block ledges need a jump (by design for now).

---

# Technical Debt

None.

---

# Decisions

## 2026-09-29

### Voxel lighting (user-approved)

Per-chunk sky light + block light (0–15) propagated by BFS flood fill, stored in typed arrays alongside block data, baked into a per-vertex light attribute by the mesher; day/night scales sky light via one shared material uniform.

Reason:

Caves/interiors go dark, torches scale to many lights at no per-light render cost, and data stays worker-friendly (typed arrays). Rejected: per-torch three.js point lights (don't scale, caves stay lit).

## 2026-09-28

### Browser-first architecture

Use:

```text
TypeScript
Three.js
Vite
WebGPU
WebGL2 fallback
Web Workers
IndexedDB
```

Reason:

The project must run directly in a browser without installation.

### Chunk architecture

Use:

```text
16 × 16 × 128
```

Reason:

Small enough for streaming and mesh updates while remaining simple.

### Voxel storage

Use TypedArrays.

Reason:

Lower memory overhead and better performance than JavaScript objects.

### Multiplayer

Deferred.

Reason:

Single-player voxel engine should be stable before introducing networking complexity.

---

# Latest Completed Work

## 2026-09-30 — Phase 8 startup stall diagnosis + precompile

* Measured (headless SwiftShader, 3 runs): module eval / page load ~130 ms long task (bundle parse + tile-atlas data-URL generation `dataUrlForTile` ~32 ms); `createRenderer` ~22 ms; save load ~17 ms; `warmUp` ~58 ms (gen 36 + light 11, pure JS); frame 0 ~203 ms = 34 ms game update + ~165 ms `renderer.render` (first-use GL work: shader compile / link, atlas upload, bindings — expected to shrink a lot on real hardware).
* Found and fixed a second ~50 ms in-game hitch: the block-outline `LineBasicMaterial` compiled the first time a block was targeted (renderers skip invisible objects when compiling). `renderer.compileAsync(scene, camera)` now runs before the animation loop with the outline temporarily shown (`BlockOutline.precompile`, visibility restored in `finally`); a compile failure only logs a warning. The in-game long task is gone in all runs; time to first frame unchanged (~1.42 s). Codex review PASS_WITH_NOTES (first round, no findings beyond the documented tradeoffs).

## 2026-09-30 — Phase 8 optimisation 2: time budget + never-meshed outer ring

* `ChunkManager` options `frameBudgetMs` (6 ms, via the probe clock) and `outerRing` (1), passed from `CHUNK_STREAMING_CONFIG` in main.ts (class defaults off). Accepts one result at a time and meshes nearest-first until the deadline, always ≥ 1 accept + ≥ 1 mesh when available; leftovers carry over. `warmUp` / `loadAllPending` ignore the budget.
* Chunks out to renderDistance + 1 are generated and lit but not meshed; unload beyond that; leaving the rendered radius removes the mesh. Walking meshes exactly 1 chunk per newly visible chunk (tested). Loaded 289 → 361, meshed 289. Mob spawn (112) / despawn (128) stay inside the rendered radius (config invariant test).
* Measured (same perf-check.mjs, same session before / after): walking rAF callback p95 34.4 → 10.5 ms, max 51.4 → 13.6 ms, long tasks 1 → 0; startup p95 36.9 → 12.9 ms (the one ~200 ms first-frame stall remains); triangles −9 % (edge faces now culled against real neighbours), draw calls unchanged, heap ~77 MB.
* Codex review PASS_WITH_NOTES (first round). Its minor note (unload left keys in `lightChanged`) was tidied with an explicit delete; the set was already self-clearing in `flushMeshes`, so no functional change and no regression test.

## 2026-09-30 — Phase 8 optimisation 1: worker generation + mesh-once streaming

* `src/world/worker/`: `ChunkGenerationService` (`request` / `poll` / `cancel` / `dispose`, ids assigned by ChunkManager) with an in-process implementation (tests + fallback) and a Web Worker implementation (`chunkGen.worker.ts`, own 21 kB bundle chunk, no three). Messages: init(seed) / generate(id, cx, cz) / cancel(id) → generated(id, cx, cz, blocks as transferred buffer, genMs) / failed; worker failure → log once, reroute to main thread. Both paths share `generateChunkMessage` (byte-identical to `WorldGenerator.generateChunk`, tested).
* `ChunkManager` async: nearest-first requests, `maxInFlight` 8, accept ≤ 4 / update, stale / cancelled results dropped by request id, unload cancels in-flight. Accept = edit diff → setChunk → light → mesh queue (same order as before). `warmUp(center)` generates the 3×3 spawn area synchronously (startup + respawn). `CHUNK_STREAMING_CONFIG`.
* Meshing: a chunk is meshed only when its full 3×3 neighbourhood is loaded or outside the radius (diagonals included — light can cross into a diagonal-shared neighbour); per-chunk mask of missing axis neighbours triggers one remesh when they arrive. Block edits still remesh immediately.
* Measured (headless SwiftShader; main-thread rAF callback time): startup p95 86–88 → 37 ms, long tasks 65 → 5; walking p95 80 → 35 ms, max ~100 → ~50 ms, long tasks 20 → 0–1; meshes per new chunk 3.0 → 1.0 (startup), 2.5 → 1.8–2.0 (walking); heap 150 → 78 MB. Terrain identical (same draw calls / triangles). F3 shows `Chunk queue pending / in-flight / gen on worker|main`. Codex review PASS_WITH_NOTES (first round; notes: synchronous 3×3 warm-up is a startup / respawn stall risk; dispose not called).

## 2026-09-30 — Phase 8 profiling: F3 debug overlay

* `src/debug/`: `RollingWindow` (Float64Array ring, avg / max / p95, no per-push allocation), `PerfStats` (injected clock; FPS + frame avg / p95 / max over 120 frames; gen / light / mesh ms over 64 samples; per-second generated / meshed counters) behind a `PerfProbe` seam passed to `ChunkManager` and `remeshChunks`; pure `formatDebugLines` / `readRendererStats` / `readJsHeapMb`. `DEBUG_CONFIG`.
* `src/ui/DebugOverlay.ts`: F3 toggle (preventDefault, pointer lock untouched), top-left monospace panel, 4 Hz refresh, nothing built while hidden. Shows backend, FPS, frame ms, draw calls, triangles, geometries / textures, JS heap, chunks loaded + gen/s + mesh/s, chunk gen / light / mesh ms, mobs, position / chunk, render distance. `renderer.info` read after `render()` (autoReset; same object for WebGPU and WebGL2).
* Baseline (headless Chrome, SwiftShader software GPU — FPS not representative; CPU timings are): render distance 8, 289 chunks, 207–234 draw calls (~2 per chunk), 330–362 k triangles, heap ~150 MB, chunk gen ~3.8 ms + light ~0.5 ms + ~2.7 remeshes × ~2.5 ms ≈ 11 ms main-thread per new chunk; up to 4 loads / frame → ~45 ms loading frames.
* Codex review PASS_WITH_NOTES (first round; `DebugOverlay.dispose()` isn't called — harmless without teardown).
* Next optimisation (evidence): chunk streaming on the main thread is the bottleneck → batch neighbour remeshes, then move generation / light / meshing to a Web Worker with transferables. Greedy meshing after re-measuring on real hardware.

## 2026-09-30 — Phase 7 persistence (save format + IndexedDB) — Phase 7 complete

* `src/world/BlockEditStore.ts`: sparse per-chunk diff (local index → block id) of player edits vs generated terrain, recorded at the single commit path in main.ts (`commitBlockChange`), applied by ChunkManager right after `generateChunk` before lighting / meshing → edits survive chunk unload (fixes the old known issue). Reverting to the generated block drops the entry; per-chunk dirty tracking.
* `src/save/saveFormat.ts`: `SAVE_FORMAT_VERSION = 1`, `migrate()` + `MIGRATIONS` table, sections meta / player (incl. inventory as Uint16 ids / Uint8 counts / Uint16 damage) / chests (Int32 positions, concatenated slots, initialised set) / chunk edits (Uint16 indices + Uint8 blocks); full validation → `SaveFormatError` / `SaveVersionError`.
* `src/save/IndexedDbSaveStore.ts`: DB `blockora` v1, stores meta / player / chests / chunkEdits (`"cx,cz"`), one all-or-nothing readwrite transaction per save, only dirty chunks written. Unavailable / blocked / timeout → game runs without saving (one warning).
* `SaveScheduler` + `WorldSaver`: autosave every 10 s when changed, flush on `visibilitychange` hidden and `pagehide`, one save in flight. Load before world build: saved seed, edits, player, health / hunger, inventory, chests, time. `SAVE_CONFIG`.
* Fix (Codex review FAIL): a save that couldn't be read (newer version, invalid, read error) fell back to a new world whose next save overwrote it. `loadSave` now returns loaded / empty / blocked, and `createWorldSaver` disables saving when blocked. Regression tests. Codex re-review PASS_WITH_NOTES.
* Verified in real Chrome with a persistent profile: close → relaunch restored position, look, health 17, hunger 17, all 36 slots, broken / placed blocks, chest contents and time of day; ChunkManager unload / reload kept edits.

## 2026-09-30 — Phase 6 village (Phase 6 complete)

* Composite structures: a region yields a `RegionLayout { pieces, paths }` (`layoutForRegion`). An accepted region rolls village (`STRUCTURE_CONFIG.village.share` 0.6) first; a rejected village site falls back to the unchanged ruin / dungeon roll. `src/world/structure/villageLayout.ts` (`planVillage`, pure): well at the centre, 3–5 houses on 8 slots (4 axis at 13, 4 diagonal at ±9) with doors facing the centre, overlap guard drops colliding houses.
* Site: Plains / Desert on every piece and path column, surface ≥ sea level + 2, per-piece slope ≤ 2, whole-village span ≤ 5. Paths: 1-wide axis-aligned gravel replacing the pure `surfaceHeight` top block (straight or L), chunk-local; trees skipped near pieces and paths.
* Templates: Cottage 5×5×5, Longhouse 5×7×6 (planks / wood / glass / cobblestone, one torch + one `village_chest` each), Well 5×5×5 (enclosed still water). Default seed per 400 regions: 46 ruins / 51 dungeons / 27 villages; nearest village centre (−34, 42, −176), ~163 blocks from spawn.
* Lookup bound: ≤ 1804 column queries per chunk (was 324); generation time unchanged within noise. Verified in real Chrome (temporary teleport hook, removed): houses, paths, well, torch-lit interior at night, chest loot. Codex review PASS_WITH_NOTES (first round, no findings).

## 2026-09-30 — Phase 6 underground dungeon

* Templates gain `placement: 'surface' | 'underground'`. Underground floor is hashed within a 12-block band whose top keeps the ceiling ≥ 6 blocks under the footprint's lowest surface (floor ≥ y 5); skipped where any column is below sea level; all biomes. Pure site checks, so chunk-order independence holds (tested).
* `DUNGEON_TEMPLATE`: 9×5×9 cobblestone room (stone / gravel variation, 2 pillars, 1×2 wall gap left to terrain), shell always overwrites caves, interior carved, no light sources (shambler spawns pass the darkness check at full daylight). Two chests with the richer `dungeon_chest` table (4–7 rolls: iron / gold ore, coal, torches, food, stone tools).
* One candidate per region picks ruin or dungeon via the template hash → no overlaps. `STRUCTURE_CONFIG.underground`. Default seed: dungeon at (80, 25, −41), ~102 blocks from spawn (it replaced the former nearest ruin there).
* Generation time within noise (~+1 %). Verified in real Chrome (temporary teleport hook, removed): dark room, chest loot opens. Codex review PASS_WITH_NOTES (first round).

## 2026-09-29 — Phase 6 chest storage + ruin loot

* `src/items/ChestStore.ts`: 27-slot containers (existing `Inventory` rules) keyed by a packed numeric world position, kept outside chunk voxel data, survives chunk unload. RMB opens a chest screen (`InventoryScreen` 'chest' mode, `ContainerSession` 'chest' area); breaking a chest spills its contents; the screen closes if the chest block disappears.
* Loot: data-driven `LOOT_TABLES` (`ruin_chest`: 3–5 weighted rolls of apple, raw pork, coal, torch, planks, stick, iron ore, wooden / stone tools). Ruin template has one chest; `StructurePlacer.lootTableAt` is a pure seed query, loot is rolled lazily on first open / break, never refills, player-placed chests stay empty.
* One shared `src/util/mulberry32.ts` (was duplicated). Verified in real Chrome (temporary teleport hook, removed). Codex review PASS_WITH_NOTES (first round).

## 2026-09-29 — Phase 6 structure system + ruin

* `src/world/structure/`: plain-data templates (ASCII layer maps → placements, `force` / `ifAir`), pure Y rotation (0/90/180/270), `StructurePlacer` (one hashed candidate per 6×6-chunk region, inset so footprints never leave their region → no overlaps, ≤ 4 regions per chunk; site check via `surfaceHeight` / `biomeAt`: allowed biomes, surface ≥ sea level + 2, slope ≤ 3), `stampStructure` (writes only cells inside the generated chunk). `STRUCTURE_CONFIG`.
* WorldGenerator order: terrain → caves / ores → water → trees → structures; trees whose root is within tree reach of a footprint are skipped (no half-cut trees). Chunk-order independence tested (4-chunk ruin generated in 4 orders → identical blocks).
* Ruin: 7×5×7 broken cobblestone / stone walls, doorway with plank lintel, collapsed gravel corner, holed plank floor, cobblestone foundation down to terrain. Plains / Forest / Desert, ~28 % of regions. Default seed: nearest ruin at (81, 42, −41), ~103 blocks from spawn.
* Generation time unchanged within noise (~4.2–5.1 ms / chunk before and after). Verified in real Chrome (temporary teleport hook, removed); Codex review PASS_WITH_NOTES (first round).

## 2026-09-29 — Phase 5 hostile mob (Shambler) — Phase 5 complete

* `MobType.Shambler` (original zombie-like, `SHAMBLER_CONFIG`: 20 HP, chase 2.0, attack 3 dmg / 1.0 s cooldown / 0.5 s windup, reach 1.2 horizontal + 1.5 vertical, detect 16 / lose 24). `MobDefinition.hostile` stats.
* AI: 'target' merged into 'chase' (acquisition is the idle/wander → chase tick); chase → attack in reach with a clear chest-to-chest voxel ray; damage via injected `onAttackPlayer` port (main.ts → `PlayerHealth.damage`); drops target when the player dies or leaves 24 blocks; hostiles chase the attacker when hit instead of fleeing.
* Spawning: effective light ≤ 7 (night surface, or dark caves any time via a downward scan), separate cap 8; daylight despawn in open sky light. `MobRenderer`: 4 more instanced part meshes (≤ 8 mob draw calls total).
* Fixes from Codex review: cave scan stopped at a lit surface above a dark cave; shamblers could attack through block corners. Both have regression tests.
* Verified in real Chrome (Playwright, temporary QA hook, removed): night spawns, chase, player hearts 20 → 17 → 14, killed by melee, no page errors.

## 2026-09-29 — Phase 5 mob combat + drops

* Mob health / hurt invulnerability / hurt flash / knockback / death (`src/entities/mobCombat.ts`), `flee` AI state for passive mobs (faster, away from attacker), raw pork drop (1–3, food +3).
* Player melee: LMB-press edge (`attackPressed`), entity raycast (`src/entities/entityRaycast.ts`, slab vs mob AABB) before block breaking — nearer target wins, ties favour the mob (`src/gameplay/combatActions.ts`); damage = hand 1 + tool-type bonus, 0.4 s cooldown, reach 6. `COMBAT_CONFIG`.
* Fix: physics overwrote horizontal velocity every frame, cancelling knockback; mobs now keep knockback velocity until they land (`knockedBack`) + regression test.
* Verified in real Chrome (Playwright, temporary QA hooks, removed): 10 hand hits kill a pig, flee after each hit, red hurt flash, drop spawned, no page errors.

## 2026-09-29 — Phase 5 entity system + passive pig

* `src/entities/`: `EntityStore` (plain records, monotonic ids, swap-remove), data-driven `mobDefinitions` (Pig), `mobAI` (Idle ↔ Wander, seeded RNG), `mobPhysics` (gravity + shared `moveAabbThroughVoxels`, friction, 1-block auto-jump, avoids water / >3-block drops), `mobSpawning` (grass columns with 2 free cells and sky light ≥ 10, 24 blocks .. render edge, cap 12, despawn far/unloaded), `updateMobs` orchestrator. `MOB_CONFIG` / `PIG_CONFIG`.
* `src/renderer/MobRenderer.ts`: blocky pig from boxes, one `InstancedMesh` per part (4 draw calls total), per-instance colour from sampled voxel light + daylight, leg swing from walked distance.
* Verified in real Chrome (Playwright, temporary faster spawn config, reverted): pigs spawn on grass and render lit, no page errors.

## 2026-09-29 — Phase 4 dry-land spawn (Phase 4 complete)

* `src/player/spawn.ts`: `findSpawnColumn` (nearest dry column — surface ≥ sea level — by square rings from (0, 0), deterministic per seed, fallback origin), spawn at column centre, `resolveSpawnHeight` lifts the spawn out of trees/overhangs once the spawn chunk is loaded (startup + respawn).
* Fix (Codex review FAIL): spawn was hard-coded to (0, 0), underwater for the default seed + regression tests over several seeds.
* Verified in real Chrome (Playwright): new game starts on a bright beach, no page errors.

## 2026-09-29 — Phase 4 light-aware meshing + shading

* Mesher emits per-vertex `light` (2 bytes: sky, block) from the cell each face looks into; `remeshChunks` passes the 3×3 light sampler. Still no three imports.
* `src/renderer/chunkMeshes.ts`: normalized Uint8 `voxelLight` attribute; chunk materials are shared unlit `MeshBasicNodeMaterial`s: albedo × lightCurve(max(sky × daylight, block)) × face shade; alpha/transparency/fog preserved. One shared daylight uniform (`setChunkDaylight`) fed from `GameTime`. `LIGHT_RENDER_CONFIG`; pure `src/renderer/lightShading.ts`.
* Verified in real Chrome (Playwright, WebGL2): sealed cave near-black, torches light it with falloff, night dims surface, no page errors.

## 2026-09-29 — Phase 4 voxel light engine (data only)

* `src/world/light/` (no three): packed `chunk.light` (sky high nibble, block low nibble; derived, never saved), `lightOpacity` (Leaves 1, Water 2, opaque 15) + emission from `lightLevel` (Torch 14), column sky fill + BFS, two-queue incremental updates, cross-chunk spill (load-order independent), typed-array ring queues, `createLightSampler` (3×3 chunks incl. diagonals).
* Integrated into `ChunkManager` (light before meshing) and the edit flow (`applyLightAndCollectRemesh`). ~1.7 ms initial light per chunk, ~0.25 ms per edit (node).
* Verified by an exact full-recompute comparison over randomized edit sequences across chunk borders.

## 2026-09-29 — Phase 4 day/night cycle

* `DAY_NIGHT_CONFIG` (15 min day / 5 min night, dawn/dusk width, sky colours, sun/ambient ranges with a night ambient floor).
* `src/world/GameTime.ts` (pure): `GameTime`, `sunAngle` (separate day/night half-arcs), `daylightFactor` (smoothstep dawn/dusk, continuous across wrap), `skyColor` (night → sunset → day).
* `src/renderer/DayNightLighting.ts`: applies sky/fog colour, light intensities and sun direction each frame without allocations; `createScene` now returns its lights.
* Verified in real Chrome (Playwright): noon, dusk (orange sky), midnight (dark but playable), no page errors.

## 2026-09-29 — Phase 4 hunger, food, regeneration

* `SURVIVAL_CONFIG` hunger values (max 20, exhaustion → hunger, regen at ≥ 18 every 4 s, starvation every 4 s floored at 1 HP, sprint needs > 6, eat 1.6 s, apple drop 5%).
* `src/player/PlayerHunger.ts`: pure `PlayerHunger` + `SurvivalTicker` (idle/sprint/jump exhaustion, regeneration, starvation; frozen while dead).
* Food: `ItemDefinition.food`, `ItemRegistry.foodFor`, Apple (item 25, `apple` tile); Leaves drop an apple by chance (injectable random).
* Eating: `InputController.isUseHeld()` + pure `src/gameplay/eatProgress.ts`; RMB with food eats (crafting-table use still wins on press). Sprint gated by hunger. `src/ui/HungerHud.ts`. Respawn resets hunger.
* Verified in real Chrome (Playwright): apple moved to hotbar via inventory screen, hold RMB → progress bar, apple consumed, hunger 10 → 14, no block placed, no page errors.

## 2026-09-29 — Phase 4 health, damage, death, respawn

* `SURVIVAL_CONFIG` (20 HP, 0.5 s invulnerability, safe fall 3, void y −16).
* `src/player/PlayerHealth.ts` (pure; void bypasses invulnerability), `src/player/fallDamage.ts` `FallTracker` (peak-to-landing distance; fluid resets), `BlockDefinition.fluid` + `BlockRegistry.isFluid`, `src/world/FluidQuery.ts`, `src/player/spawn.ts` `computeSpawnPosition`.
* `src/ui/HealthHud.ts` (10 canvas-drawn hearts, damage flash), `src/ui/DeathScreen.ts` (Respawn resets health, reloads spawn chunk, teleports, re-locks pointer).
* Fix: death screen only triggered when death happened inside the fall/void branch; now edge-detected every frame for any damage source. Fix: "Click to play" hint showed over the death screen.
* Verified in real Chrome (Playwright): hearts, damage flash, death screen, respawn to full health + pointer lock, no page errors.

## 2026-09-29 — Phase 3 tool durability (Phase 3 complete)

* `TOOL_CONFIG.durability` (wood 64, stone 128) → `ToolProperties.maxDurability`; `ItemStack.damage` (tools only, omitted when 0), `canStack` requires equal damage, split/merge preserve it, `durabilityFraction`.
* `Inventory.damageSelected`; `applyToolWear` (−1 per block with hardness > 0 broken while holding a tool; tool breaks at max). Fix: `ContainerSession.placeOne` dropped damage.
* Durability bars in `HotbarHud` / `InventoryScreen`. Fix: bars never showed (`style.display = ''` fell back to the stylesheet's `none`).
* Verified in real Chrome (Playwright): craft sticks + wooden pickaxe at a crafting table, equip, 3 breaks → bar at 61/64, no page errors.

## 2026-09-29 — Phase 3 tools + timed breaking

* Items 19–24: wooden/stone pickaxe, axe, shovel (`ItemDefinition.tool`, stack 1, `ItemRegistry.toolFor`), icon tiles, shaped recipes. `TOOL_CONFIG`, `BREAK_CONFIG` in constants.
* `BlockDefinition.requiresTool` (stone, cobblestone, ores): no drop unless broken with the matching tool type.
* `src/gameplay/breakTime.ts`: `canHarvest`, `breakDuration` (hardness × harvest multiplier ÷ tool speed), pure `BreakProgress` (resets on release / target change).
* Break is now hold-to-break (`InputController.isBreakHeld()`); crosshair shows progress. Place/Q stay one-shot.
* Verified in real Chrome (Playwright): progress bar, sand breaks after 0.75 s by hand, drop + pickup, no page errors.

## 2026-09-29 — Phase 3 crafting UI (2×2 + 3×3)

* `src/items/ContainerSession.ts` (pure): cursor stack + slot click rules (primary pick/place/merge/swap, secondary half/one), result slot crafts via `RecipeRegistry`, `close()` returns cursor + grid to inventory (leftovers dropped).
* `src/ui/InventoryScreen.ts`: E opens 2×2 screen; right-click on Crafting Table (`src/gameplay/blockUse.ts`) opens 3×3; releases/re-requests pointer lock; changed-slot re-render only. Shared `src/ui/itemIconCache.ts` (also used by `HotbarHud`).
* `InputController.consumeUiInput()`: E (locked or not), Esc (while unlocked).
* Verified in real Chrome (Playwright): wood → 4 planks via 2×2, cursor place, close re-locks; crafting table opens 3×3; no page errors.

## 2026-09-29 — Phase 3 recipe registry + crafting grid logic

* `src/crafting/recipes.ts`: data-driven shaped/shapeless recipes (planks, sticks, crafting table, torches, chest).
* `src/crafting/RecipeRegistry.ts`: validated at construction (ids, items, counts, trimmed rectangular patterns, key usage, ambiguity); `match(view)` trims the grid's bounding box, supports mirroring, first match in registration order.
* `src/crafting/CraftingGrid.ts`: 2×2 / 3×3 grid of stacks; `craft` consumes one per used cell; `clear` returns contents.
* Fix: shaped/shapeless ambiguity was only checked for single-cell shapes; now any equal ingredient multiset is rejected + regression test.

## 2026-09-29 — Phase 3 item drop + item pickup

* `src/items/blockDrops.ts`: data-driven drop table (`BlockId → ItemId | null` overrides: Stone→Cobblestone, Grass→Dirt, CoalOre→Coal, Leaves/Glass→none; default = block's own item). Removed unused `BlockDefinition.dropItem`.
* `src/items/ItemDrops.ts`: `ItemDropSystem` (spawn, gravity/friction/voxel collision, lifetime + unloaded-column despawn, pickup with delay/radius and partial pickup). `ITEM_DROP_CONFIG` in constants.
* `src/player/voxelCollision.ts`: extracted size-parametric `moveAabbThroughVoxels` (used by player and drops; no behaviour change).
* `hotbarActions`: `breakAndDrop` (replaces direct collection), `throwSelectedItem` (Q). `ItemDefinition.icon` + `stick`/`coal` tiles.
* `src/renderer/ItemDropRenderer.ts`: one `InstancedMesh` per item type present, shared atlas material, cached per-item cube geometry.
* Verified in real Chrome (Playwright): break → drop → pickup, Q throw, textured drop cubes, no game console errors.

## 2026-09-29 — Phase 3 Hotbar

* `InputController`: Digit1–9 selection and wheel scroll (while locked) via `consumeHotbarInput()`.
* `src/gameplay/hotbarActions.ts`: `applyHotbarInput`, `placeSelectedItem` (places selected item's block, consumes one), `breakAndCollect` (temporary direct collection), `STARTING_ITEMS` / `giveStartingItems`.
* `src/items/itemIcons.ts` (block item → side-face tile) and `src/ui/HotbarHud.ts` (9-slot HUD, atlas icons cached per tile, per-slot reference diffing so unchanged slots do no DOM work).
* Fix: placement into Water was impossible ("Air only"), blocking building in generated seas; added `BlockDefinition.replaceable` (Water) + `BlockRegistry.isReplaceable`, used by `tryPlaceBlock` + regression test.
* Verified in real Chrome (Playwright): HUD icons/counts, key + wheel selection, place consumes one, break collects one, no game console errors.

## 2026-09-29 — Phase 3 Inventory model

* `src/items/Inventory.ts`: 36 slots (hotbar = 0–8), `add` (merge existing in slot order, then empty slots; returns leftover), `canAdd`, `take` / `takeHalf`, `set`, `move` (move / merge / swap), `countItem` / `hasItem` / `removeItem` (reverse slot order, hotbar consumed last), hotbar selection with wrap-around scroll, `takeFromSelected`, `clear`. UI-independent.

## 2026-09-29 — Phase 3 ItemRegistry + ItemStack

* `src/items/items.ts`: `ItemId` (1–18; 0 = None/empty slot, persisted — append only), separate from `BlockId`; block items carry `placesBlock`; plus Stick, Coal.
* `src/items/ItemRegistry.ts`: validated dense registry (id = index + 1, unique names, stack size 1..64, valid unique `placesBlock`), `itemForBlock` / `blockForItem` lookups.
* `src/items/ItemStack.ts`: immutable stacks with pure `createStack`, `canStack`, `mergeStacks`, `splitStack`, `splitHalf`.
* `INVENTORY_CONFIG` in constants.

## 2026-09-29 — Phase 2 chunk streaming + unloading (Phase 2 complete)

* `src/world/ChunkManager.ts` (new): streams chunks around a moving player. `update(center)` recomputes the desired square-radius chunk set only when `center` (a chunk coordinate) changes, unloads everything now out of range (`ChunkMeshSink.remove` + `ChunkStore.removeChunk`), and queues the rest as `pendingLoads`. Every call then loads up to `maxLoadsPerUpdate` (default 4) pending chunks — spreading a large jump (startup, teleport) across frames instead of stalling one — and remeshes each newly-loaded chunk's already-loaded axis-aligned neighbours too, fixing the previously-tracked "neighbour not remeshed when it loads later" known issue. `loadAllPending()` drains the whole queue (startup only, before the first frame).
* `src/world/ChunkStore.ts`: added `removeChunk(cx, cz)` and `hasChunk(cx, cz)` — there was previously no way to unload a chunk.
* `src/world/mesher/remesh.ts`: `ChunkMeshSink` gained a required `remove(cx, cz)` method (unload needs to dispose the mesh, not just upsert); `ChunkMeshRenderer` already implemented it from Phase 1.
* `src/main.ts`: replaced the fixed-7x7-at-startup `buildGeneratedWorld`/`meshAndRenderWorld` with `ChunkManager` (radius = `WORLD_CONFIG.renderDistance` = 8); render loop calls `chunkManager.update(worldToChunkCoord(playerState.position.x, playerState.position.z))` every frame. Startup only force-loads the player's immediate area (avoids stalling on the full 17x17 render-distance area synchronously); the rest streams in over the next several frames.
* Verified in real Chrome via Playwright: walked the player in a large loop across many chunk boundaries (~14s), zero console errors, no seam gaps/holes at chunk boundaries, new biomes (forest) visibly streamed in far from spawn.
* Codex review: PASS_WITH_NOTES (`docs/CODEX_REVIEW.md`) — no required fixes; one minor test-coverage note (rapid center oscillation) addressed with an additional test after review.
* **Phase 2 exit criteria met**: world is deterministic (seed + chunk coord) and streams around the player.

## 2026-09-29 — Phase 2 caves

* `src/world/noise/valueNoise2D.ts`: added `hash3D`... (already added in the ores task) — reused unchanged; no new noise primitives needed for caves.
* `src/config/constants.ts`: `WORLD_GEN_CONFIG.caveNoise` / `caveThreshold` / `caveSurfaceMargin` (6 blocks — caves never carve within this many blocks of a column's own surface).
* `src/world/cave/CavePlacer.ts`: deterministic `isCaveAt(worldX, worldY, worldZ, surfaceY)` — 3D noise thresholding (clumpy pockets), gated by the surface margin; purely a function of (seed, position, surfaceY), no cross-chunk state needed (unlike trees).
* `src/world/WorldGenerator.ts`: the deep-stone branch of `generateChunk` now checks cave carving *before* ore (`isCaveAt ? Air : (oreAt() ?? Stone)`) — a cave carves through what would have been ore too. Caves can reach y=0 (no floor limit; intentional MVP scope, confirmed safe by Codex review). Since `surfaceDepth+subsoilDepth` (4) < `caveSurfaceMargin` (6), at least 2 solid deep-stone blocks always separate topsoil from any cave void, so a tree can never root above a hollowed-out column.
* Two pre-existing `WorldGenerator` tests ("no Air below surface/sea level") were rewritten: their old assumption is no longer true now that caves legitimately carve Air underground; the new versions assert the correct updated invariant (Air below the surface is only valid at/below `surfaceY - caveSurfaceMargin`).
* Codex review: PASS_WITH_NOTES (`docs/CODEX_REVIEW.md`) — no required fixes; confirmed cave-before-ore ordering is correct and the tree/cave interaction is safe.

## 2026-09-29 — Phase 2 ores

* `src/world/noise/valueNoise2D.ts`: added `hash3D`, `valueNoise3D` (trilinear-interpolated 3D value noise, same construction as `valueNoise2D` extended to Y), and `fractalNoise3D` (octave sum, mirrors `fractalNoise2D`) — enables volumetric (not just per-column) noise fields.
* `src/world/ore/OreVein.ts`: data-driven `ORE_VEIN_DEFINITIONS` (CoalOre/IronOre/GoldOre — block id, inclusive Y band, noise config, threshold; shallower = more common/wider band, deeper = rarer/narrower band).
* `src/world/ore/OrePlacer.ts`: deterministic `oreAt(worldX, worldY, worldZ)` — 3D noise thresholding per ore type (clumpy vein-like blobs, not uniform per-block rolls), checked in order Coal → Iron → Gold (first match wins); purely a function of (seed, position), no cross-chunk state needed (unlike trees).
* `src/world/WorldGenerator.ts`: the deep-stone branch of `generateChunk` is now `this.orePlacer.oreAt(worldX, y, worldZ) ?? BlockId.Stone`; ore never touches topsoil/subsoil/water/air (only the pre-existing "would have been Stone" branch).
* Codex review: PASS_WITH_NOTES (`docs/CODEX_REVIEW.md`) — no required fixes; minor test-coverage notes (assert ore absence below minY, and absence outside the deep-stone band) addressed with additional tests + one config-derived (not hardcoded) constant after review.

## 2026-09-29 — Phase 2 trees

* `src/world/biome/treeDensity.ts`: per-biome spawn probability table (`TREE_DENSITY_BY_BIOME`) — Plains sparse, Forest dense, Taiga medium; Desert/Mountains/Swamp get 0 (no cactus/mangrove block exists yet, so no tree type suits them in this MVP).
* `src/world/biome/TreePlacer.ts`: deterministic `isTreeSpawn(worldX, worldZ, biomeId)` (per-column lattice hash, distinct seed offset) and `treeBlocks()` (trunk Wood column + 3-layer tapered Leaves canopy as `{dx, dy, dz, blockId}` offsets); `TREE_MAX_HORIZONTAL_REACH` exported for chunk padding.
* `src/world/noise/valueNoise2D.ts`: exported `latticeHash2D` (the existing raw per-integer-column hash, undocumented before) for discrete per-column placement decisions — distinct from the smoothly-interpolated `valueNoise2D` used for continuous terrain fields.
* `src/world/WorldGenerator.ts`: `generateChunk` now runs a `stampTrees` pass after terrain fill — scans world columns in this chunk plus a canopy-reach margin, and for each deterministic tree spawn (skipping beach/underwater roots, same `BEACH_HEIGHT_MARGIN` cutoff as terrain) stamps whichever of its blocks land inside this chunk (`isInsideChunk` clips the rest, naturally picked up when the owning neighbour chunk itself generates — no shared/mutable state between chunks).
* Codex review: first pass FAIL (beach-root threshold used `<= seaLevel` instead of `<= seaLevel + BEACH_HEIGHT_MARGIN`, letting trees root one block into the beach band) — fixed and re-reviewed; final PASS_WITH_NOTES (`docs/CODEX_REVIEW.md`) — one minor doc-comment nit, fixed.

## 2026-09-29 — Phase 2 biomes

* `src/world/biome/Biome.ts`: `BiomeId` (Plains/Forest/Desert/Taiga/Mountains/Swamp) and data-driven `BIOME_DEFINITIONS` (surface/subsurface block ids, `heightOffset`, `heightAmplitudeScale` per biome; `getBiomeDefinition` lookup).
* `src/world/biome/BiomeSelector.ts`: deterministic `BiomeSelector` — low-frequency temperature/moisture `fractalNoise2D` (distinct seed offsets from terrain height/detail noise) classified via Whittaker-style thresholds (`WORLD_GEN_CONFIG.biomeThresholds`) into one of the 6 biomes; regions span many chunks (`biomeNoise` frequency 1/384).
* `src/world/WorldGenerator.ts`: `biomeAt(x, z)` added; `surfaceHeight` takes an optional biome (avoids recomputing it in `generateChunk`) and applies `heightOffset`/`heightAmplitudeScale` on top of the existing height/detail noise; `generateChunk` fills each column's topsoil/subsoil with the biome's blocks instead of the hardcoded grass/dirt (beach-band sand override unchanged).
* `WORLD_GEN_CONFIG.biomeNoise` / `biomeThresholds` added to `src/config/constants.ts` — no magic numbers in biome selection.
* Codex review: PASS_WITH_NOTES (`docs/CODEX_REVIEW.md`) — no required fixes; one minor note (add direct surface-block assertions for Plains/Forest/Taiga/Swamp, not just Mountains/Desert) addressed with additional tests after review.

## 2026-09-29 — Phase 2 seed + deterministic height-noise terrain generation

* `src/world/noise/valueNoise2D.ts`: deterministic seeded 2D value noise (integer hash + smoothstep interpolation, no external noise library) and `fractalNoise2D` (octave sum, normalized to [0, 1)).
* `src/world/WorldGenerator.ts`: seeded `WorldGenerator` — `surfaceHeight(x, z)` combines height + detail noise (distinct seed offsets keep layers uncorrelated), clamped to chunk bounds; `generateChunk(cx, cz)` fills grass/sand top, dirt/sand subsoil, stone below, water up to sea level. Deterministic: same seed + chunk coord → same blocks.
* `WORLD_GEN_CONFIG` added to `src/config/constants.ts` (seed, amplitudes, noise octave params, soil depths — no magic numbers in gen code).
* `src/main.ts`: `buildTestWorld` (hand-built flat platform) replaced with `buildGeneratedWorld` (7x7 chunk area from the seeded generator, main thread); spawn position now derived from generated surface height instead of a hardcoded platform center.
* Codex review: PASS_WITH_NOTES (`docs/CODEX_REVIEW.md`) — no required fixes; noted startup chunk-gen cost (tracked in Known Issues) and a test-comment accuracy nit (fixed).

## 2026-09-29 — Phase 1 break / place + selective remeshing (Phase 1 complete)

* `src/world/blockEdit.ts`: `setBlockAt` → `BlockChange` (invalid id throws; out-of-range / unchanged → null) and `affectedChunks` (chunk + axis neighbours on boundaries, max 3).
* `src/gameplay/blockInteraction.ts`: `tryBreakBlock` (targetable, in range → Air), `tryPlaceBlock` (Air target, in height, no overlap with player AABB; `DEFAULT_PLACE_BLOCK` = Planks).
* `src/world/mesher/remesh.ts`: `ChunkMeshSink` + `remeshChunks` (deduped, skips unloaded); `ChunkMeshRenderer implements ChunkMeshSink`.
* `InputController`: injectable `doc`, one-shot LMB/RMB latches via `consumeActions()` (only while locked), context menu prevented. `voxelCollision.playerAabb` exported.
* Verified in real Chrome via Playwright: pointer lock, look, walk, jump, break/place one block per press, seam face exposed after boundary break, no game console errors.

## 2026-09-29 — Phase 1 block raycast + outline

* `src/world/voxelRaycast.ts` (no Three.js): Amanatides–Woo DDA `raycastVoxels` (hit cell, distance to entry point, face/normal, place position; start-inside → distance 0, no face; max distance inclusive; reusable `out`) and `raycastBlock` wrapper adding `blockId`.
* Targetability: optional `BlockDefinition.targetable` (Water = false), `BlockRegistry.isTargetable`, `src/world/TargetQuery.ts`.
* `src/player/cameraRay.ts` (eye position + look direction, matches camera 'YXZ'); `src/renderer/BlockOutline.ts` (one reused `LineSegments`); `src/ui/Crosshair.ts`; `PLAYER_CONFIG.spawnPitch`.
* Fix: `stepPlayer` clamps negative dt to 0 (first-frame `THREE.Timer` delta could be negative, reversing gravity) + regression test.

## 2026-09-29 — Phase 1 texture atlas

* `src/world/texture/` (no Three.js): `TILE_NAMES` (21 tiles), face → tile table + `validateBlockTextures`, `AtlasLayout` / inset tile UV rects, seeded procedural tile art (`generateAtlasPixels`), `applyAtlasUvs`.
* Mesher emits local UVs + per-vertex tile index; vertex tints removed.
* `src/renderer/voxelAtlasTexture.ts`: one shared `DataTexture` (nearest, no mipmaps); chunk materials use `map` + `alphaTest`; opaque/transparent groups unchanged.
* `ATLAS_CONFIG` and `RENDER_CONFIG.chunkAlphaTest` in constants. Test world has a preview row of every block.

## 2026-09-28 — Phase 1 chunk mesher with face culling

* `src/world/mesher/` (no Three.js): `faces` table, `BlockSampler`/`ChunkNeighborhood` (missing neighbour → Air), `isFaceVisible` rule, reusable growable `MeshBuffers` → `ChunkMeshData` (opaque + transparent sections, transferable typed arrays), `QuadEmitter` seam, `emitCulledFaces` (swappable for greedy), `meshChunk`.
* UVs emitted per quad scaled by width/height, ready for atlas remap; normals stored as Int8.
* `src/renderer/chunkMeshes.ts`: one `BufferGeometry` per chunk with opaque/transparent groups, shared materials, `ChunkMeshRenderer` (upsert/remove/dispose).
* `ChunkStore.chunks()` iterator. `src/main.ts` placeholder `InstancedMesh` removed; test platform meshed via `ChunkMesher` (4 chunks, 1216 triangles, ~15 ms, matches hand count).

## 2026-09-28 — Phase 1 player voxel collision

* `src/world/ChunkStore.ts` (world-coord block get/set over a chunk map) and `src/world/SolidQuery.ts` (registry-backed solidity query; physics depends only on this).
* `src/player/voxelCollision.ts`: player AABB vs solid voxels, axis order Y→X→Z, substeps < 0.5 block, face clamp with skin epsilon, ground probe, no uncrouching into ceilings.
* `stepPlayer` takes a `SolidQuery` instead of the flat floor stand-in; new collision constants in `PLAYER_CONFIG`.
* `src/main.ts`: test platform (incl. negative coords, wall, step) stored in `ChunkStore`.
* ESLint: `^_` ignore pattern for unused vars.

## 2026-09-28 — Phase 1 voxel foundation

* `src/world/blocks.ts`: `BlockId` (0–17, persisted — append only), `BlockDefinition`, `BLOCK_DEFINITIONS`.
* `src/world/BlockRegistry.ts`: validated dense registry (id = index, Air at 0, Uint8 range) with `Uint8Array` solid/transparent flags; default `blockRegistry`.
* `src/world/chunkCoords.ts`: `CHUNK_VOLUME`, `localIndex`, `isInsideChunk`, negative-safe `worldToChunkCoord` / `worldToLocal`, `chunkKey`.
* `src/world/Chunk.ts`: `Uint8Array` storage, safe get/set (out-of-bounds → Air / false), dirty flag; registry-independent.

## 2026-09-28 — Phase 1 player movement

* `src/player/`: `PlayerState`, pure `stepPlayer` physics (walk/sprint/crouch, gravity, jump, dt clamp, pitch clamp), `InputController` (KeyboardEvent.code + Pointer Lock; releases keys on blur/unlock), `firstPersonCamera`.
* `src/ui/PointerLockHint.ts` "Click to play" overlay. Loop uses `THREE.Timer` (`Clock` deprecated in r183).

## 2026-09-28 — Phase 1 renderer

* `src/renderer/`: `createRenderer` (WebGPURenderer from `three/webgpu`; `forceWebGL` for WebGL2 fallback), `scene` (sky, fog, hemisphere + directional light), `camera`, `backend` (pure, testable helpers).
* `RENDER_CONFIG` in `src/config/constants.ts`.
* Verified in headless Chrome: WebGL2 fallback renders sky, fog and lit test grid.

## 2026-09-28 — Phase 0 project setup

* Vite 8 + TypeScript 5.9 (strict, `noUncheckedIndexedAccess`) + Three.js r186 + Vitest 5 + ESLint 9 (flat, typescript-eslint 8).
* Config constants: `src/config/constants.ts` (`WORLD_CONFIG`, `PLAYER_CONFIG`).
* Placeholder `src/main.ts` (WebGL cube). Folders: `src/{config,renderer,world,player,ui}`, `tests/`.

---

# Latest Build

```text
pnpm build → PASS (tsc + vite build)
pnpm lint  → PASS
pnpm dev   → PASS
```

---

# Latest Tests

```text
pnpm test → PASS (70 files, 1136 tests)
```

---

# Next Task

Phase 8: find and fix the `GL_INVALID_OPERATION: glDrawElements` warning (empty indexed / instanced draw), then mesh disposal audit (geometry / material counts stay flat while walking back and forth) and a frustum-culling check (chunk mesh bounding spheres). Greedy meshing after real-hardware numbers.
