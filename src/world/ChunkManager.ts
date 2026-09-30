import type { BlockRegistry } from './BlockRegistry';
import type { ChunkStore } from './ChunkStore';
import type { WorldGenerator } from './WorldGenerator';
import type { ChunkMeshSink } from './mesher/remesh';
import { remeshChunks } from './mesher/remesh';
import { MeshBuffers } from './mesher/MeshBuffers';
import { Chunk } from './Chunk';
import { ChunkCache } from './ChunkCache';
import { chunkKey, type ChunkCoord } from './chunkCoords';
import { LightEngine } from './light/LightEngine';
import type { BlockEditStore } from './BlockEditStore';
import type { PerfProbe } from '../debug/PerfStats';
import {
  InProcessChunkGenerationService,
  type ChunkGenerationService,
  type GenerationLocation,
} from './worker/ChunkGenerationService';
import { generateChunkMessage } from './worker/chunkGenProtocol';
import { CHUNK_STREAMING_CONFIG } from '../config/constants';

/** Cumulative load timings (ms) since construction, for startup/perf logging. */
export interface ChunkLoadStats {
  readonly chunksLoaded: number;
  /** Sum of generation times as measured where generation ran (worker or main thread). */
  readonly generationMs: number;
  readonly lightMs: number;
}

/** Streaming queue sizes, for the F3 overlay. */
export interface ChunkStreamingStats {
  /** Desired chunks not loaded and not yet requested. */
  readonly pending: number;
  /** Requests sent to the generation service and not yet accepted. */
  readonly inFlight: number;
  readonly generation: GenerationLocation;
  /** Chunks currently meshed (visible) by this manager; <= loaded chunks (the outer ring is loaded, not meshed). */
  readonly meshed: number;
  /** Unloaded-chunk block cache: entries, capacity, and loads served from it vs generated. */
  readonly cache: { readonly size: number; readonly capacity: number; readonly hits: number; readonly misses: number };
}

export interface ChunkStreamingOptions {
  /** Generation backend; the manager owns it (see `dispose`). Default: in-process over `generator`. */
  readonly service?: ChunkGenerationService;
  /** Cap on outstanding requests. Default: max(CHUNK_STREAMING_CONFIG.maxInFlight, maxLoadsPerUpdate). */
  readonly maxInFlight?: number;
  /**
   * Main-thread time budget (ms) per `update` for accepting results and
   * meshing, read from the probe's clock. At least one accept and one mesh
   * still happen per update (when available) so streaming cannot starve.
   * Default: Infinity (count caps only); the game passes CHUNK_STREAMING_CONFIG.frameBudgetMs.
   */
  readonly frameBudgetMs?: number;
  /**
   * Extra chunk rings loaded, lit and kept beyond the rendered `radius` but
   * never meshed. Chunks unload beyond `radius + outerRing`. Default 0; the
   * game passes CHUNK_STREAMING_CONFIG.outerRing.
   */
  readonly outerRing?: number;
  /** Unloaded chunks kept in the LRU block cache (0 disables). Default: CHUNK_STREAMING_CONFIG.chunkCacheSize. */
  readonly chunkCacheSize?: number;
}

interface InFlightRequest {
  readonly id: number;
  readonly cx: number;
  readonly cz: number;
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

/** `neighbourMask` result for a chunk with a desired-but-unloaded neighbour. */
const INCOMPLETE = -1;

/**
 * Diagonal chunk offsets. Faces only sample axis neighbours, but the light a
 * chunk's faces read (its own cells and its axis neighbours' border cells)
 * can still change when a diagonal chunk is lit (light flows through the
 * shared axis neighbour; it can't reach further than one chunk, max level 15
 * < chunk width 16), so waiting for diagonals avoids a light remesh.
 */
const DIAGONALS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

/**
 * Streams chunks in and out around a moving player. Call `update` once per
 * frame with the player's current chunk coordinate.
 *
 * Generation is asynchronous through a `ChunkGenerationService` (a Web
 * Worker in the browser, in-process in tests / as fallback):
 * - When the center changes, chunks outside `radius` are unloaded (mesh +
 *   block data) and their in-flight requests cancelled; the desired chunks
 *   that are neither loaded nor in flight become `pending`, nearest-first.
 * - Every `update` requests pending chunks while fewer than `maxInFlight`
 *   are outstanding (one request per chunk; a chunk is never requested
 *   twice), then accepts at most `maxLoadsPerUpdate` finished results.
 *   A result is accepted only if it matches the chunk's current request id
 *   and the chunk isn't loaded yet; anything else is dropped as stale.
 * - An accepted chunk gets the player's `BlockEditStore` diff applied, is
 *   stored, lit (LightEngine.lightChunk), then meshed — as before.
 *
 * Rendered vs loaded radius: `radius` is the rendered (meshed) radius. With
 * `outerRing` = k, chunks out to `radius + k` are generated and lit but never
 * meshed, and unload only beyond `radius + k` (no other hysteresis). Moving
 * the center by one chunk therefore only *meshes* the newly visible row
 * (its neighbours already exist) and *removes the mesh* of the row that left
 * the rendered radius; nothing is remeshed for a missing neighbour.
 *
 * Complete-neighbourhood meshing: a chunk is meshed only once every chunk of
 * its 3x3 neighbourhood (4 axis + 4 diagonal; see DIAGONALS for why the
 * diagonals matter) is loaded or outside the loaded area (the world edge
 * counts as complete), so streaming meshes each chunk ~once instead of once
 * per arriving neighbour. A meshed chunk is remeshed when an axis neighbour
 * it was meshed without arrives (only possible with outerRing 0), or when
 * its light changes. Block edits remesh through blockEdit / remeshChunks
 * directly and are unaffected.
 *
 * Time budget (`frameBudgetMs`): `update` accepts results one at a time and
 * meshes candidates nearest-first, stopping each phase once the budget since
 * the start of `update` is spent, but always doing >= 1 accept and >= 1 mesh
 * when available. Unmeshed candidates carry over to the next `update`.
 *
 * Chunk cache: chunks that unload (moving or `setRadius` shrink) hand their
 * block array to a bounded LRU `ChunkCache` (memory-only, blocks only). When a
 * cached chunk becomes desired again it is accepted like a generated result
 * (same per-update cap and time budget) but without a worker request; its
 * edits are already in the blocks, so the BlockEditStore diff is not
 * re-applied, and light is always recomputed. Evicted chunks regenerate
 * normally (with the diff).
 *
 * `warmUp` / `loadAllPending` generate synchronously on the calling thread
 * (spawn / respawn / tests) with `generator`.
 */
export class ChunkManager {
  private readonly store: ChunkStore;
  private readonly generator: WorldGenerator;
  private readonly registry: BlockRegistry;
  private readonly sink: ChunkMeshSink;
  private radius: number;
  private readonly outerRing: number;
  /** radius + outerRing: chunks generated, lit and kept loaded. */
  private loadRadius: number;
  private readonly frameBudgetMs: number;
  private readonly maxLoadsPerUpdate: number;
  private readonly maxInFlight: number;
  private readonly meshBuffers = new MeshBuffers();
  private readonly light: LightEngine;
  private readonly edits: BlockEditStore | undefined;
  private readonly probe: PerfProbe | undefined;
  private readonly service: ChunkGenerationService;

  private readonly cache: ChunkCache;
  private cacheHits = 0;
  private cacheMisses = 0;

  private chunksLoaded = 0;
  private generationMs = 0;
  private lightMs = 0;

  private lastCenter: ChunkCoord | null = null;
  /** Chunks to keep loaded (within loadRadius). */
  private desiredKeys: ReadonlySet<string> = new Set();
  /** Chunks to mesh (within radius). */
  private renderKeys: ReadonlySet<string> = new Set();
  /** Desired, not loaded, not yet requested; nearest-first. */
  private pendingLoads: ChunkCoord[] = [];
  /** Desired, not loaded, present in the cache; nearest-first. Accepted like generated results, without a request. */
  private cachedLoads: ChunkCoord[] = [];
  private readonly inFlight = new Map<string, InFlightRequest>();
  private nextRequestId = 1;
  /** Chunks meshed by this manager and still current -> axis-neighbour presence mask at that mesh. */
  private readonly meshedWith = new Map<string, number>();
  private readonly meshCandidates = new Map<string, ChunkCoord>();
  private readonly lightChanged = new Set<string>();

  constructor(
    store: ChunkStore,
    generator: WorldGenerator,
    registry: BlockRegistry,
    sink: ChunkMeshSink,
    radius: number,
    maxLoadsPerUpdate: number = CHUNK_STREAMING_CONFIG.maxAcceptsPerUpdate,
    light: LightEngine = new LightEngine(store, registry),
    edits?: BlockEditStore,
    probe?: PerfProbe,
    streaming: ChunkStreamingOptions = {},
  ) {
    this.store = store;
    this.generator = generator;
    this.registry = registry;
    this.sink = sink;
    this.radius = radius;
    this.outerRing = Math.max(0, Math.floor(streaming.outerRing ?? 0));
    this.loadRadius = radius + this.outerRing;
    this.frameBudgetMs = streaming.frameBudgetMs ?? Number.POSITIVE_INFINITY;
    this.maxLoadsPerUpdate = maxLoadsPerUpdate;
    this.maxInFlight = Math.max(1, streaming.maxInFlight ?? Math.max(CHUNK_STREAMING_CONFIG.maxInFlight, maxLoadsPerUpdate));
    this.light = light;
    this.edits = edits;
    this.probe = probe;
    this.cache = new ChunkCache(streaming.chunkCacheSize ?? CHUNK_STREAMING_CONFIG.chunkCacheSize);
    this.service = streaming.service ?? new InProcessChunkGenerationService(generator, () => this.now());
  }

  /** Clock for load timings: the probe's (injectable) clock when present. */
  private now(): number {
    return this.probe !== undefined ? this.probe.now() : performance.now();
  }

  get stats(): ChunkLoadStats {
    return { chunksLoaded: this.chunksLoaded, generationMs: this.generationMs, lightMs: this.lightMs };
  }

  get streaming(): ChunkStreamingStats {
    return {
      pending: this.pendingLoads.length + this.cachedLoads.length,
      inFlight: this.inFlight.size,
      generation: this.service.location,
      meshed: this.meshedWith.size,
      cache: { size: this.cache.size, capacity: this.cache.capacity, hits: this.cacheHits, misses: this.cacheMisses },
    };
  }

  /**
   * Re-evaluates the desired area when `center` changed, then requests
   * pending chunks (bounded by `maxInFlight`), accepts up to
   * `maxLoadsPerUpdate` generated chunks and meshes what became meshable,
   * nearest-first, within the time budget (>= 1 accept and >= 1 mesh).
   */
  update(center: ChunkCoord): void {
    const deadline = this.now() + this.frameBudgetMs;
    this.setCenter(center);
    this.requestPending();
    this.acceptGenerated(deadline);
    this.requestPending();
    this.flushMeshes(deadline);
  }

  /**
   * Makes `center` the streaming center and synchronously loads every chunk
   * within `radius` of it (capped at the manager's radius) on the calling
   * thread, cancelling their in-flight requests. Use before the game reads
   * the terrain (spawn height, restored position, respawn); the rest of the
   * area keeps streaming through `update`.
   */
  warmUp(center: ChunkCoord, radius: number = CHUNK_STREAMING_CONFIG.warmUpRadius): void {
    this.setCenter(center);
    for (const coord of chunksWithinRadius(center, Math.min(radius, this.radius))) {
      this.loadNow(coord);
    }
    this.flushMeshes(Number.POSITIVE_INFINITY);
    this.requestPending();
  }

  /**
   * Synchronously loads every desired chunk not loaded yet (cancelling their
   * requests), ignoring all budgets. For tests and tools; the game uses
   * `warmUp` + `update`.
   */
  loadAllPending(): void {
    if (this.lastCenter === null) {
      return;
    }
    for (const coord of chunksWithinRadius(this.lastCenter, this.loadRadius)) {
      this.loadNow(coord);
    }
    this.pendingLoads = [];
    this.cachedLoads = [];
    this.flushMeshes(Number.POSITIVE_INFINITY);
  }

  /**
   * Changes the rendered radius at runtime. The desired / rendered sets are
   * recomputed around the current center: growing queues the new chunks
   * (nearest-first, streamed through the normal budgets) and meshes already
   * loaded ones once their neighbourhood is complete; shrinking unloads chunks
   * beyond the new `radius + outerRing`, cancels their requests and removes
   * the meshes of chunks that left the rendered radius. No effect before the
   * first `update` / `warmUp` beyond storing the value.
   */
  setRadius(radius: number): void {
    const next = Math.max(0, Math.floor(radius));
    if (next === this.radius) {
      return;
    }
    this.radius = next;
    this.loadRadius = next + this.outerRing;
    if (this.lastCenter !== null) {
      this.recomputeArea(this.lastCenter);
    }
  }

  /** Current rendered (meshed) radius in chunks. */
  get renderRadius(): number {
    return this.radius;
  }

  /** Cancels outstanding requests and disposes the generation service. */
  dispose(): void {
    for (const request of this.inFlight.values()) {
      this.service.cancel(request.id);
    }
    this.inFlight.clear();
    this.pendingLoads = [];
    this.cachedLoads = [];
    this.cache.clear();
    this.service.dispose();
  }

  private setCenter(center: ChunkCoord): void {
    if (this.lastCenter !== null && this.lastCenter.cx === center.cx && this.lastCenter.cz === center.cz) {
      return;
    }
    this.recomputeArea(center);
  }

  /** Rebuilds the desired / rendered chunk sets for `center` and the current radii, then unloads / requeues accordingly. */
  private recomputeArea(center: ChunkCoord): void {
    this.lastCenter = center;

    const previousRender = this.renderKeys;
    const desired = chunksWithinRadius(center, this.loadRadius);
    this.desiredKeys = new Set(desired.map(({ cx, cz }) => chunkKey(cx, cz)));
    this.renderKeys = new Set(
      chunksWithinRadius(center, this.radius).map(({ cx, cz }) => chunkKey(cx, cz)),
    );
    // Cached chunks that are wanted again are set aside while this unload fills
    // the cache, so the new entries cannot evict them; then they go back as the
    // most recent entries (farthest first, so the nearest stay newest).
    const wanted: { readonly coord: ChunkCoord; readonly blocks: Uint8Array }[] = [];
    for (let i = desired.length - 1; i >= 0; i -= 1) {
      const coord = desired[i] as ChunkCoord;
      const blocks = this.store.hasChunk(coord.cx, coord.cz) ? undefined : this.cache.take(coord.cx, coord.cz);
      if (blocks !== undefined) {
        wanted.push({ coord, blocks });
      }
    }
    this.unloadOutOfRange();
    for (const { coord, blocks } of wanted) {
      this.cache.put(coord.cx, coord.cz, blocks);
    }
    this.cancelUndesiredRequests();
    const missing = desired.filter(
      ({ cx, cz }) => !this.store.hasChunk(cx, cz) && !this.inFlight.has(chunkKey(cx, cz)),
    );
    this.cachedLoads = missing.filter(({ cx, cz }) => this.cache.has(cx, cz));
    this.pendingLoads = missing.filter(({ cx, cz }) => !this.cache.has(cx, cz));

    // Chunks that left the rendered radius but stay loaded (the outer ring):
    // drop their mesh; they are simply not rendered any more.
    for (const key of previousRender) {
      if (this.renderKeys.has(key)) {
        continue;
      }
      const chunk = this.chunkOfKey(key);
      if (chunk !== undefined) {
        this.sink.remove(chunk.cx, chunk.cz);
        this.meshedWith.delete(key);
        this.meshCandidates.delete(key);
        this.lightChanged.delete(key);
      }
    }

    // Newly visible chunks, and loaded chunks that were waiting for a
    // neighbour that is no longer desired, may be meshable now.
    for (const chunk of this.store.chunks()) {
      const key = chunkKey(chunk.cx, chunk.cz);
      if (this.renderKeys.has(key) && !this.meshedWith.has(key)) {
        this.meshCandidates.set(key, { cx: chunk.cx, cz: chunk.cz });
      }
    }
  }

  private chunkOfKey(key: string): ChunkCoord | undefined {
    const [cx, cz] = key.split(',').map(Number);
    return cx !== undefined && cz !== undefined && this.store.hasChunk(cx, cz) ? { cx, cz } : undefined;
  }

  private unloadOutOfRange(): void {
    const toUnload: ChunkCoord[] = [];
    for (const chunk of this.store.chunks()) {
      if (!this.desiredKeys.has(chunkKey(chunk.cx, chunk.cz))) {
        toUnload.push({ cx: chunk.cx, cz: chunk.cz });
      }
    }

    // Farthest from the new center first, so when a big unload (teleport,
    // radius shrink) overflows the cache it is the far chunks that get evicted.
    toUnload.sort((a, b) => this.distanceToCenter(b) - this.distanceToCenter(a));
    for (const { cx, cz } of toUnload) {
      const key = chunkKey(cx, cz);
      this.sink.remove(cx, cz);
      // Blocks (player edits included) move to the cache; the Chunk object is dropped, so nothing aliases them.
      const chunk = this.store.getChunk(cx, cz);
      this.store.removeChunk(cx, cz);
      if (chunk !== undefined) {
        this.cache.put(cx, cz, chunk.blocks);
      }
      this.meshedWith.delete(key);
      this.meshCandidates.delete(key);
      this.lightChanged.delete(key);
    }
  }

  private cancelUndesiredRequests(): void {
    for (const [key, request] of this.inFlight) {
      if (!this.desiredKeys.has(key)) {
        this.service.cancel(request.id);
        this.inFlight.delete(key);
      }
    }
  }

  private requestPending(): void {
    let consumed = 0;
    while (this.inFlight.size < this.maxInFlight && consumed < this.pendingLoads.length) {
      const coord = this.pendingLoads[consumed] as ChunkCoord;
      consumed += 1;
      const key = chunkKey(coord.cx, coord.cz);
      if (this.store.hasChunk(coord.cx, coord.cz) || this.inFlight.has(key)) {
        continue; // loaded synchronously (warm-up) or by an edit meanwhile
      }
      const id = this.nextRequestId;
      this.nextRequestId += 1;
      this.inFlight.set(key, { id, cx: coord.cx, cz: coord.cz });
      this.service.request(id, coord.cx, coord.cz);
    }
    if (consumed > 0) {
      this.pendingLoads.splice(0, consumed);
    }
  }

  /**
   * Accepts results one at a time (<= maxLoadsPerUpdate polled), stopping once
   * `deadline` has passed -- but only after at least one chunk was inserted.
   */
  private acceptGenerated(deadline: number): void {
    if (this.maxLoadsPerUpdate <= 0) {
      return;
    }
    let inserted = 0;
    for (let handled = 0; handled < this.maxLoadsPerUpdate; handled += 1) {
      if (inserted > 0 && this.now() >= deadline) {
        return;
      }
      if (this.cachedLoads.length > 0) {
        if (this.acceptCached()) {
          inserted += 1;
        }
        continue;
      }
      if (this.inFlight.size === 0) {
        return;
      }
      const result = this.service.poll(1)[0];
      if (result === undefined) {
        return;
      }
      const key = chunkKey(result.cx, result.cz);
      const request = this.inFlight.get(key);
      if (request === undefined || request.id !== result.id) {
        continue; // stale: cancelled or superseded
      }
      this.inFlight.delete(key);
      if (this.store.hasChunk(result.cx, result.cz)) {
        continue; // already present (e.g. created by a block edit): never double-insert
      }
      this.insertChunk(new Chunk(result.cx, result.cz, result.blocks), result.genMs, false);
      inserted += 1;
    }
  }

  /**
   * Loads the nearest cached chunk (no worker request). Returns whether a
   * chunk was inserted; an entry evicted since it was queued falls back to a
   * normal request.
   */
  private acceptCached(): boolean {
    const coord = this.cachedLoads.shift() as ChunkCoord;
    if (this.store.hasChunk(coord.cx, coord.cz)) {
      return false;
    }
    const blocks = this.cache.take(coord.cx, coord.cz);
    if (blocks === undefined) {
      this.pendingLoads.unshift(coord);
      return false;
    }
    this.cacheHits += 1;
    this.insertChunk(new Chunk(coord.cx, coord.cz, blocks), 0, true);
    return true;
  }

  /** Generates `coord` on the calling thread unless already loaded, superseding any in-flight request. */
  private loadNow(coord: ChunkCoord): void {
    if (this.store.hasChunk(coord.cx, coord.cz)) {
      return;
    }
    const key = chunkKey(coord.cx, coord.cz);
    const request = this.inFlight.get(key);
    if (request !== undefined) {
      this.service.cancel(request.id);
      this.inFlight.delete(key);
    }
    const cached = this.cache.take(coord.cx, coord.cz);
    if (cached !== undefined) {
      this.cacheHits += 1;
      this.insertChunk(new Chunk(coord.cx, coord.cz, cached), 0, true);
      return;
    }
    const generated = generateChunkMessage(this.generator, 0, coord.cx, coord.cz, () => this.now());
    this.insertChunk(new Chunk(coord.cx, coord.cz, generated.blocks), generated.genMs, false);
  }

  /**
   * Edits -> store -> light, then queues the chunk, its loaded neighbours and light-changed chunks for meshing.
   *
   * A chunk `fromCache` already contains the player's edits (they were applied
   * to the live chunk before it unloaded), so the BlockEditStore diff is NOT
   * applied again: `applyTo` records the block it finds as the "generated"
   * original, which for a cached chunk is the edited value, and would drop
   * every edit from the store. Light is always recomputed (neighbour light may
   * have changed while the chunk was away; light is never cached).
   */
  private insertChunk(chunk: Chunk, genMs: number, fromCache: boolean): void {
    const coord: ChunkCoord = { cx: chunk.cx, cz: chunk.cz };
    if (!fromCache) {
      this.cacheMisses += 1;
      this.edits?.applyTo(chunk);
    }
    this.store.setChunk(chunk);
    const lightStart = this.now();
    const lightChanged = this.light.lightChunk(coord.cx, coord.cz);
    const lightEnd = this.now();
    this.generationMs += genMs;
    this.lightMs += lightEnd - lightStart;
    if (!fromCache) {
      this.probe?.recordChunkGeneration(genMs);
    }
    this.probe?.recordLight(lightEnd - lightStart);
    this.chunksLoaded += 1;

    // Itself + every loaded chunk of its 3x3 neighbourhood (they may be complete now).
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const cx = coord.cx + dx;
        const cz = coord.cz + dz;
        const key = chunkKey(cx, cz);
        if (this.renderKeys.has(key) && this.store.hasChunk(cx, cz)) {
          this.meshCandidates.set(key, { cx, cz });
        }
      }
    }
    for (const changed of lightChanged) {
      const key = chunkKey(changed.cx, changed.cz);
      if (!this.renderKeys.has(key)) {
        continue; // never meshed, nothing to refresh
      }
      this.meshCandidates.set(key, changed);
      this.lightChanged.add(key);
    }
  }

  /**
   * Bitmask of loaded axis neighbours (bit i = axisNeighbors()[i]), or
   * INCOMPLETE when some neighbour is desired but not loaded yet.
   */
  private neighbourMask(coord: ChunkCoord): number {
    let mask = 0;
    const neighbors = axisNeighbors(coord);
    for (let bit = 0; bit < neighbors.length; bit += 1) {
      const { cx, cz } = neighbors[bit] as ChunkCoord;
      if (this.store.hasChunk(cx, cz)) {
        mask |= 1 << bit;
      } else if (this.desiredKeys.has(chunkKey(cx, cz))) {
        return INCOMPLETE;
      }
    }
    for (const [dx, dz] of DIAGONALS) {
      const cx = coord.cx + dx;
      const cz = coord.cz + dz;
      if (!this.store.hasChunk(cx, cz) && this.desiredKeys.has(chunkKey(cx, cz))) {
        return INCOMPLETE;
      }
    }
    return mask;
  }

  /**
   * Meshes candidates whose neighbourhood is complete and whose mesh is
   * missing or out of date, nearest-first. Stops once `deadline` has passed
   * (after >= 1 mesh); the rest stays a candidate for the next call.
   */
  private flushMeshes(deadline: number): void {
    if (this.meshCandidates.size === 0) {
      this.lightChanged.clear();
      return;
    }
    const ready: { readonly coord: ChunkCoord; readonly key: string; readonly mask: number; readonly dist: number }[] = [];
    for (const [key, coord] of this.meshCandidates) {
      if (!this.store.hasChunk(coord.cx, coord.cz) || !this.renderKeys.has(key)) {
        this.meshCandidates.delete(key);
        this.lightChanged.delete(key);
        continue;
      }
      const mask = this.neighbourMask(coord);
      const previous = this.meshedWith.get(key);
      const outdated =
        previous === undefined || this.lightChanged.has(key) || (mask !== INCOMPLETE && (mask & ~previous) !== 0);
      if (!outdated) {
        this.meshCandidates.delete(key);
        this.lightChanged.delete(key);
        continue;
      }
      if (mask === INCOMPLETE) {
        // Mesh later, once the missing neighbour arrives (or leaves the desired area).
        this.meshedWith.delete(key);
        this.meshCandidates.delete(key);
        this.lightChanged.delete(key);
        continue;
      }
      ready.push({ coord, key, mask, dist: this.distanceToCenter(coord) });
    }
    ready.sort((a, b) => a.dist - b.dist);

    for (let i = 0; i < ready.length; i += 1) {
      if (i > 0 && this.now() >= deadline) {
        return; // the rest carries over (still in meshCandidates)
      }
      const { coord, key, mask } = ready[i] as (typeof ready)[number];
      this.meshedWith.set(key, mask);
      this.meshCandidates.delete(key);
      this.lightChanged.delete(key);
      remeshChunks(this.store, this.registry, this.sink, [coord], this.meshBuffers, this.probe);
    }
  }

  /** Squared chunk distance to the streaming center (nearest-first ordering). */
  private distanceToCenter({ cx, cz }: ChunkCoord): number {
    const center = this.lastCenter;
    return center === null ? 0 : (cx - center.cx) ** 2 + (cz - center.cz) ** 2;
  }
}
