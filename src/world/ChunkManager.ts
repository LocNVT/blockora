import type { BlockRegistry } from './BlockRegistry';
import type { ChunkStore } from './ChunkStore';
import type { WorldGenerator } from './WorldGenerator';
import type { ChunkMeshSink } from './mesher/remesh';
import { remeshChunks } from './mesher/remesh';
import { MeshBuffers } from './mesher/MeshBuffers';
import { chunkKey, type ChunkCoord } from './chunkCoords';
import { LightEngine } from './light/LightEngine';
import type { BlockEditStore } from './BlockEditStore';
import type { PerfProbe } from '../debug/PerfStats';

/** Cumulative load timings (ms) since construction, for startup/perf logging. */
export interface ChunkLoadStats {
  readonly chunksLoaded: number;
  readonly generationMs: number;
  readonly lightMs: number;
}

/**
 * Chunk coordinates within `radius` (Chebyshev/square, matching how render
 * distance is described in world constants) of `center`, nearest-first so a
 * load budget prioritizes the chunks closest to the player.
 */
function chunksWithinRadius(center: ChunkCoord, radius: number): ChunkCoord[] {
  const coords: ChunkCoord[] = [];
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dz = -radius; dz <= radius; dz += 1) {
      coords.push({ cx: center.cx + dx, cz: center.cz + dz });
    }
  }
  coords.sort((a, b) => {
    const da = Math.max(Math.abs(a.cx - center.cx), Math.abs(a.cz - center.cz));
    const db = Math.max(Math.abs(b.cx - center.cx), Math.abs(b.cz - center.cz));
    return da - db;
  });
  return coords;
}

/** The 4 axis-aligned neighbours of a chunk coordinate (no diagonals — see blockEdit.affectedChunks). */
function axisNeighbors({ cx, cz }: ChunkCoord): ChunkCoord[] {
  return [
    { cx: cx - 1, cz },
    { cx: cx + 1, cz },
    { cx, cz: cz - 1 },
    { cx, cz: cz + 1 },
  ];
}

/**
 * Streams chunks in and out around a moving player: generates + meshes
 * chunks within `renderDistance` of the player's current chunk, and unloads
 * (removes the mesh and drops the block data for) chunks that fall outside
 * it. Call `update` once per frame with the player's current chunk
 * coordinate. Recomputing which chunks are in range only happens when that
 * coordinate changes, but any load work left over from a previous call
 * (see `maxLoadsPerUpdate`) continues to make progress on every call.
 *
 * Newly-loaded chunks also trigger a remesh of their already-loaded
 * axis-aligned neighbours, since a neighbour meshed while this chunk was
 * still unloaded would have face-culled its boundary against Air (see
 * BlockSampler) and needs to redraw that seam now that real data exists.
 *
 * When a `BlockEditStore` is given, the player's recorded edits for a chunk
 * are applied to the freshly generated blocks (initial load or reload after
 * unload) before lighting and meshing, so both reflect the edited world.
 *
 * Each generated chunk is lit (LightEngine.lightChunk) before meshing; light
 * that flowed into already-loaded chunks (including diagonals) remeshes them
 * too.
 *
 * Load work is budgeted per `update` call (`maxLoadsPerUpdate`) so crossing
 * many chunk boundaries in one frame (e.g. a large teleport) doesn't stall
 * the main thread generating/meshing dozens of chunks synchronously; the
 * remaining chunks are picked up on subsequent calls.
 */
export class ChunkManager {
  private readonly store: ChunkStore;
  private readonly generator: WorldGenerator;
  private readonly registry: BlockRegistry;
  private readonly sink: ChunkMeshSink;
  private readonly radius: number;
  private readonly maxLoadsPerUpdate: number;
  private readonly meshBuffers = new MeshBuffers();
  private readonly light: LightEngine;
  private readonly edits: BlockEditStore | undefined;
  private readonly probe: PerfProbe | undefined;

  private chunksLoaded = 0;
  private generationMs = 0;
  private lightMs = 0;

  private lastCenter: ChunkCoord | null = null;
  private pendingLoads: ChunkCoord[] = [];

  constructor(
    store: ChunkStore,
    generator: WorldGenerator,
    registry: BlockRegistry,
    sink: ChunkMeshSink,
    radius: number,
    maxLoadsPerUpdate = 4,
    light: LightEngine = new LightEngine(store, registry),
    edits?: BlockEditStore,
    probe?: PerfProbe,
  ) {
    this.store = store;
    this.generator = generator;
    this.registry = registry;
    this.sink = sink;
    this.radius = radius;
    this.maxLoadsPerUpdate = maxLoadsPerUpdate;
    this.light = light;
    this.edits = edits;
    this.probe = probe;
  }

  /** Clock for load timings: the probe's (injectable) clock when present. */
  private now(): number {
    return this.probe !== undefined ? this.probe.now() : performance.now();
  }

  get stats(): ChunkLoadStats {
    return { chunksLoaded: this.chunksLoaded, generationMs: this.generationMs, lightMs: this.lightMs };
  }

  /**
   * Re-evaluates which chunks should be loaded around `center` (a chunk
   * coordinate) when it has changed since the last call, then makes
   * progress on any pending loads (bounded by `maxLoadsPerUpdate`) every
   * call regardless — so a large initial/teleport load finishes over
   * several frames even while the player stands still.
   */
  update(center: ChunkCoord): void {
    if (this.lastCenter === null || this.lastCenter.cx !== center.cx || this.lastCenter.cz !== center.cz) {
      this.lastCenter = center;

      const desired = chunksWithinRadius(center, this.radius);
      this.unloadOutOfRange(new Set(desired.map(({ cx, cz }) => chunkKey(cx, cz))));
      this.pendingLoads = desired.filter(({ cx, cz }) => !this.store.hasChunk(cx, cz));
    }

    this.loadPending();
  }

  private unloadOutOfRange(desiredKeys: ReadonlySet<string>): void {
    const toUnload: ChunkCoord[] = [];
    for (const chunk of this.store.chunks()) {
      if (!desiredKeys.has(chunkKey(chunk.cx, chunk.cz))) {
        toUnload.push({ cx: chunk.cx, cz: chunk.cz });
      }
    }

    for (const { cx, cz } of toUnload) {
      this.sink.remove(cx, cz);
      this.store.removeChunk(cx, cz);
    }
  }

  /**
   * Loads every chunk currently pending in one call, ignoring the per-update
   * budget. Intended for startup only (there is nothing to render yet, so
   * there is no per-frame stall to avoid — unlike `update`, which budgets
   * load work so streaming while the player is already playing stays smooth).
   */
  loadAllPending(): void {
    while (this.pendingLoads.length > 0) {
      this.loadPending(Number.POSITIVE_INFINITY);
    }
  }

  /** Loads up to `maxLoadsPerUpdate` chunks from `pendingLoads`, remeshing them and their loaded neighbours. */
  private loadPending(budget: number = this.maxLoadsPerUpdate): void {
    if (this.pendingLoads.length === 0) {
      return;
    }

    const neighborsToRemesh = new Map<string, ChunkCoord>();
    let loadsRemaining = budget;
    let consumed = 0;

    for (const coord of this.pendingLoads) {
      if (loadsRemaining <= 0) {
        break;
      }
      consumed += 1;
      if (this.store.hasChunk(coord.cx, coord.cz)) {
        // Could have been loaded by a previous call already (e.g. as a
        // neighbour of another pending chunk); nothing left to do here.
        continue;
      }

      const generationStart = this.now();
      const chunk = this.generator.generateChunk(coord.cx, coord.cz);
      this.edits?.applyTo(chunk);
      this.store.setChunk(chunk);
      const lightStart = this.now();
      const lightChanged = this.light.lightChunk(coord.cx, coord.cz);
      const lightEnd = this.now();
      this.generationMs += lightStart - generationStart;
      this.lightMs += lightEnd - lightStart;
      this.probe?.recordChunkGeneration(lightStart - generationStart);
      this.probe?.recordLight(lightEnd - lightStart);
      this.chunksLoaded += 1;
      loadsRemaining -= 1;

      neighborsToRemesh.set(chunkKey(coord.cx, coord.cz), coord);
      for (const changed of lightChanged) {
        neighborsToRemesh.set(chunkKey(changed.cx, changed.cz), changed);
      }
      for (const neighbor of axisNeighbors(coord)) {
        if (this.store.hasChunk(neighbor.cx, neighbor.cz)) {
          neighborsToRemesh.set(chunkKey(neighbor.cx, neighbor.cz), neighbor);
        }
      }
    }

    this.pendingLoads = this.pendingLoads.slice(consumed);

    if (neighborsToRemesh.size > 0) {
      remeshChunks(
        this.store,
        this.registry,
        this.sink,
        Array.from(neighborsToRemesh.values()),
        this.meshBuffers,
        this.probe,
      );
    }
  }
}
