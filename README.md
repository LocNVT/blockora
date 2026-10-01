# Blockora

A 3D voxel survival sandbox that runs directly in the browser — explore a procedurally generated world, mine and build, craft tools, survive the night, and find loot in ruins, dungeons and villages.

Built with AI-assisted ("vibe") coding. Inspired by voxel sandbox games; all code, names, textures and sounds are original — textures and sounds are generated procedurally, with no image or audio files.

## Features

- **Infinite procedural world** from a seed: six biomes, trees, caves, ores, water, streamed in chunks around the player.
- **Mining and building** with 17 block types, a 36-slot inventory (including a 9-slot hotbar), 2×2 and 3×3 crafting, wooden and stone tools with durability.
- **Survival**: health, hunger, food, fall damage, a 15-minute day / 5-minute night cycle, and voxel lighting with torches (caves are dark).
- **Mobs**: pigs, cows and chickens (passive, flee when hit, drop food) and the shambler, a hostile mob that hunts you in the dark.
- **Structures**: ruins, underground dungeons and villages, each with loot chests.
- **Saving**: the world, player, inventory, chests and every block you change are saved in your browser (IndexedDB).
- **Menus and settings**: title screen with seeds, pause menu, FOV, mouse sensitivity, render distance (2–12), volume, resolution scale, fog and frame-rate limit.
- **Performance**: chunk generation in a Web Worker, a per-frame streaming budget, pooled geometry, and an F3 overlay with live stats.

## Requirements

- A desktop browser with **WebGPU or WebGL2** (current Chrome or Edge recommended) and a **keyboard and mouse**. Touch devices aren't supported yet.
- To run from source: **Node.js 22** and **pnpm 9**.

## Run locally

```sh
pnpm install
pnpm dev
```

Open the URL Vite prints (usually http://localhost:5173).

If `pnpm` isn't installed, prefix each command with `npx -y pnpm@9`, e.g. `npx -y pnpm@9 dev`.

Production build (closer to the deployed site):

```sh
pnpm build
pnpm preview
```

## How to play

On the title screen choose **New world** (leave the seed empty for a random world) or **Continue**, then click **Play**.

| Key | Action |
|---|---|
| W A S D | Move |
| Mouse | Look |
| Space | Jump |
| Left Shift | Sprint |
| Left Ctrl | Crouch |
| Left mouse (hold) | Break block / attack |
| Right mouse | Place block · eat (hold) · open crafting table / chest |
| 1–9 · mouse wheel | Select hotbar slot |
| Q | Drop held item |
| E | Inventory |
| Esc | Pause menu (settings, save, quit) |
| F3 | Performance overlay |

Tips:

- Stone and ores need a **pickaxe** to drop anything. Start by crafting one at the crafting table (3 planks or cobblestone across the top, 2 sticks down the middle).
- Logs give wood (1 wood → 4 planks); leaves sometimes drop apples.
- Build a shelter and place **torches** before night — shamblers only spawn in the dark.
- Keep hunger high to regenerate health; hold right-click with food selected to eat.

## Development

| Command | Purpose |
|---|---|
| `pnpm dev` | Start the dev server |
| `pnpm build` | Type-check and build to `dist/` |
| `pnpm preview` | Serve the production build |
| `pnpm test` | Run the test suite (Vitest) |
| `pnpm test:watch` | Tests in watch mode |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript only |

Stack: TypeScript (strict), Three.js `WebGPURenderer` (WebGPU with WebGL2 fallback), Vite, Web Workers, IndexedDB, Vitest. No UI framework — the UI is plain DOM.

```text
src/
  world/      chunks, generation, light, meshing, structures, worker
  player/     input, physics, health, hunger
  entities/   mobs: AI, physics, spawning, combat
  items/      items, inventory, chests, loot
  crafting/   recipes and crafting grids
  renderer/   renderer setup, chunk / mob / item rendering
  save/       save format and IndexedDB storage
  audio/      procedural sound
  ui/, menu/  HUD, screens, title menu
  settings/, debug/, errors/, platform/
tests/        Vitest tests
docs/         roadmap, progress, deployment, performance
```

## Documentation

- [docs/ROADMAP.md](docs/ROADMAP.md) — planned work by phase
- [docs/PROGRESS.md](docs/PROGRESS.md) — current state, known issues, decisions
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — deploying to Cloudflare Pages
- [docs/PERFORMANCE.md](docs/PERFORMANCE.md) — measuring performance with the F3 overlay
- [CLAUDE.md](CLAUDE.md) — development rules for AI-assisted work

## Status

Early but playable. Not yet available: touch controls, smelting / iron tools, cooked food, beds, multiplayer. See the roadmap and the Known Issues in PROGRESS.md.

## License

No license has been chosen yet.
