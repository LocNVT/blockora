# VoxelWorld Roadmap

## Goal

Build a browser-based 3D voxel survival sandbox.

Priority:

```text
Playable
→ Correct
→ Stable
→ Performant
→ Expandable
→ Polished
```

---

# Phase 0 — Project Setup

* [x] Vite
* [x] TypeScript strict mode
* [x] Three.js
* [x] Vitest
* [x] ESLint
* [x] Basic folder structure
* [x] Development server
* [x] Production build

### Exit criteria

```text
pnpm dev  → works
pnpm build → works
pnpm test → works
```

---

# Phase 1 — Playable Voxel Prototype ✅ (completed 2026-09-29)

## Renderer

* [x] WebGPU renderer
* [x] WebGL2 fallback
* [x] Scene
* [x] Camera
* [x] Lighting
* [x] Basic sky/fog

## Player

* [x] First-person camera
* [x] Pointer lock
* [x] WASD movement
* [x] Gravity
* [x] Jump
* [x] Collision
* [x] Sprint
* [x] Crouch

## Voxel

* [x] BlockRegistry
* [x] Chunk data
* [x] Chunk coordinates
* [x] Basic chunk mesh
* [x] Face culling
* [x] Texture atlas

## Interaction

* [x] Block raycast
* [x] Block outline
* [x] Break block
* [x] Place block

### Exit criteria

The player can:

```text
Open browser
→ enter game
→ move
→ look around
→ jump
→ break blocks
→ place blocks
```

---

# Phase 2 — Procedural World ✅ (completed 2026-09-29)

* [x] Seed
* [x] Height noise
* [x] Detail noise
* [x] Plains
* [x] Forest
* [x] Desert
* [x] Taiga
* [x] Mountains
* [x] Swamp
* [x] Trees
* [x] Ores
* [x] Caves
* [x] Water
* [x] Chunk streaming
* [x] Chunk unload

### Exit criteria

World is deterministic and streams around the player.

---

# Phase 3 — Inventory & Crafting ✅ (completed 2026-09-29)

* [x] ItemRegistry
* [x] ItemStack
* [x] Inventory
* [x] Hotbar
* [x] Item pickup
* [x] Item drop
* [x] 2×2 crafting
* [x] 3×3 crafting table
* [x] Recipe registry
* [x] Tools
* [x] Tool durability

### Exit criteria

Player can collect resources and craft basic tools.

---

# Phase 4 — Survival ✅ (completed 2026-09-29)

* [x] Health
* [x] Hunger
* [x] Food
* [x] Damage
* [x] Regeneration
* [x] Death
* [x] Respawn
* [x] Day/night
* [x] Basic lighting
* [x] Torch

### Exit criteria

Basic survival loop works.

---

# Phase 5 — Mobs

* [x] Entity system
* [x] Passive mobs
* [ ] Hostile mobs
* [x] Spawn rules
* [x] Wander AI
* [ ] Target AI
* [ ] Chase AI
* [ ] Attack AI
* [ ] Death
* [ ] Drops
* [ ] Player combat

### Exit criteria

Player can encounter and fight mobs.

---

# Phase 6 — Structures

* [ ] Structure system
* [ ] Village
* [ ] Ruins
* [ ] Dungeon
* [ ] Loot
* [ ] Deterministic placement

### Exit criteria

Structures generate consistently from the world seed.

---

# Phase 7 — Persistence

* [ ] IndexedDB
* [ ] World metadata
* [ ] Player save
* [ ] Inventory save
* [ ] Modified blocks
* [ ] Chunk save
* [ ] Chunk load
* [ ] Save versioning
* [ ] Migration strategy

### Exit criteria

Close browser → reopen → world state remains.

---

# Phase 8 — Performance

## Profiling

* [ ] FPS measurement
* [ ] Frame time
* [ ] Draw calls
* [ ] Triangle count
* [ ] Memory
* [ ] Chunk generation time
* [ ] Mesh generation time

## Optimization

* [ ] Web Worker generation
* [ ] Transferable buffers
* [ ] Greedy meshing
* [ ] Chunk prioritization
* [ ] Chunk cache
* [ ] Mesh disposal
* [ ] Object pooling
* [ ] Frustum culling
* [ ] Chunk culling

### Target

```text
60 FPS target
30 FPS minimum
```

at:

```text
8 chunk render distance
```

on a reasonable desktop.

---

# Phase 9 — UX & Polish

* [ ] Main menu
* [ ] Pause menu
* [ ] Settings
* [ ] FOV
* [ ] Mouse sensitivity
* [ ] Render distance
* [ ] Audio settings
* [ ] Graphics settings
* [ ] Debug screen
* [ ] Loading screen
* [ ] Error handling
* [ ] Better textures
* [ ] Sound effects
* [ ] Ambient audio

---

# Phase 10 — Web Deployment

* [ ] Production build
* [ ] Static hosting
* [ ] Asset compression
* [ ] Cache strategy
* [ ] Error monitoring
* [ ] Performance monitoring
* [ ] Mobile compatibility investigation

Potential platforms:

```text
Vercel
Cloudflare Pages
Netlify
GitHub Pages
Nginx
```

---

# Phase 11 — Optional Multiplayer

Only start after single-player is stable.

* [ ] Server architecture
* [ ] WebSocket
* [ ] Authoritative server
* [ ] Player synchronization
* [ ] Chunk synchronization
* [ ] Block updates
* [ ] Entity synchronization
* [ ] Client prediction
* [ ] Server validation
* [ ] Persistence

Do not implement multiplayer during MVP.

---

# Task Rules

Each phase should be broken into small tasks.

Preferred task size:

```text
15–60 minutes of implementation
```

A task should normally modify:

```text
1–5 relevant files
```

Avoid large multi-system tasks.

---

# Definition of Done

A task is complete only when:

```text
Implementation complete
+
Tests pass
+
Build passes when relevant
+
No blocking runtime error
+
PROGRESS.md updated
```

A phase is complete only when its exit criteria are met.
