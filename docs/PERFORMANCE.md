# Performance testing

How to measure Blockora's performance on a real machine and report it. Headless / CI runs use a software GPU, so only real-hardware numbers can decide rendering work.

## 1. Open the overlay

Start a world, click Play, press **F3**. The overlay refreshes 4 times a second; press F3 again to hide it.

| Line | Meaning | Good | Investigate if |
|---|---|---|---|
| `[WebGPU]` / `[WebGL2]` | Graphics backend | WebGPU on current Chrome / Edge | WebGL2 on a browser that should support WebGPU |
| FPS | Frames per second (capped by the display, usually 60) | ≈ display refresh | below 50 |
| Frame ms avg / p95 / max | Frame time over the **last 120 frames (~2 s)**; 16.7 ms = 60 FPS | p95 ≤ 20, max ≤ 33 | p95 > 25 or max > 50 (visible stutter) |
| Draw calls / Triangles | GPU work per frame | anything if FPS holds | FPS drops while these are high |
| Geometries / Textures | Live GPU resources | flat after returning to the same place | keeps growing while walking back and forth |
| JS heap | JavaScript memory (Chrome only) | levels off | keeps climbing over many minutes |
| Chunks loaded / gen/s / mesh/s | Streaming activity right now | 0/s when standing still | — |
| Chunk ms gen / light / mesh | Average cost per chunk (gen runs in a Web Worker) | gen < 10, light < 2, mesh < 5 | light or mesh above 6 (the per-frame budget) |
| Chunk queue | Pending / in-flight requests, `gen on worker`, meshed, cache fill + hit rate | `gen on worker` | `gen on main` (worker failed — slower streaming) |
| Resolution | Internal render size and ratio | — | — |

## 2. Test scenarios

Run each for ~20 s, then take a screenshot of the overlay **while the scenario is still happening** (frame times only cover the last ~2 s).

1. **Baseline** — default settings (render distance 8), windowed, standing still.
2. **Stress** — fullscreen, Settings → render distance **12**, standing still.
3. **Streaming** — render distance 12, **sprint in a straight line into new terrain**, press F3 mid-sprint (`gen/s` must be above 0 in the screenshot).
4. **Return trip** — walk ~10 chunks away and back; on the way back the cache hit rate should rise and `Geometries` should return to its earlier level.
5. **Night / caves** — at night with shamblers around, and underground with torches.
6. **Long session** — play 15+ minutes; note whether JS heap levels off.

## 3. If it's slow

Settings (Esc → Settings), in order of impact:

1. **Render distance** 12 → 8 → 6 (draw calls and triangles drop roughly with its square).
2. **Resolution scale** 100 % → 75 % (helps GPU-bound frames, e.g. high-DPI screens).
3. **Frame rate limit** 60 or 30 (steadier frames, less heat / battery on laptops).
4. **Distance fog** on (no performance cost, hides the streaming edge).

Also: enable hardware acceleration in the browser, close other heavy tabs, and plug laptops in.

## 4. What to report

- The overlay screenshot(s) and which scenario each is from.
- Browser + version, GPU / CPU (or laptop model), display size and refresh rate, render distance and resolution scale.
- Any stutter you *felt* (when, doing what), even if the numbers look fine.

## 5. Reference results

| Date | Machine | Scenario | Backend | FPS | Frame avg / p95 / max (ms) | Draw calls | Triangles | Heap |
|---|---|---|---|---|---|---|---|---|
| 2026-09-30 | owner's desktop, 1555×739 | 1 · rd 8, standing | WebGPU | 59.9 | 16.7 / 16.9 / 17.2 | 140 | 209 k | 129 MB |
| 2026-09-30 | owner's desktop, 1555×739 | 2 · rd 12, standing | WebGPU | 59.8 | 16.7 / 17.0 / 20.5 | 493 | 545 k | 214 MB |
| 2026-10-01 | owner's desktop, 1875×919 | 4 · rd 12, ~360 blocks travelled, standing | WebGPU | 59.9 | 16.7 / 16.9 / 17.5 | 260 | 334 k | 228 MB |

All results so far are vsync-locked at 60 FPS: the GPU is not the bottleneck on this machine, so greedy meshing / occlusion culling are not needed (see ROADMAP Phase 8). Still missing: a mid-sprint capture (scenario 3) and a lower-end machine.
