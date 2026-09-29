import type { BlockRegistry } from './BlockRegistry';
import type { ChunkStore } from './ChunkStore';
import type { WorldGenerator } from './WorldGenerator';
import type { ChunkMeshSink } from './mesher/remesh';
import { remeshChunks } from './mesher/remesh';
import { MeshBuffers } from './mesher/MeshBuffers';
import { Chunk } from './Chunk';
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
}

export interface ChunkStreamingOptions {
  /** Generation backend; the manager owns it (see `dispose`). Default: in-process over `generator`. */
  readonly service?: ChunkGenerationService;
  /** Cap on outstanding requests. Default: max(CHUNK_STREAMING_CONFIG.maxInFlight, maxLoadsPerUpdate). */
  readonly maxInFlight?: number;
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
 * Complete-neighbourhood meshing: a chunk is meshed only once every chunk of
 * its 3x3 neighbourhood (4 axis + 4 diagonal; see DIAGONALS for why the
 * diagonals matter) is loaded or outside the desired radius (the world edge
 * counts as complete), so streaming meshes each chunk ~once instead of once
 * per arriving neighbour. A meshed chunk is remeshed when an axis neighbour
 * it was meshed without arrives (e.g. the old world edge after the center
 * moves), or when its light changes. Block edits remesh through blockEdit /
 * remeshChunks directly and are unaffected.
 *
 * `warmUp` / `loadAllPending` generate synchronously on the calling thread
 * (spawn / respawn / tests) with `generator`.
 */
export class ChunkManager {
  private readonly store: ChunkStore;
  private readonly generator: WorldGenerator;
  private readonly registry: BlockRegistry;
  private readonly sink: ChunkMeshSink;
  private readonly radius: number;
  private readonly maxLoadsPerUpdate: number;
  private readonly maxInFlight: number;
  private readonly meshBuffers = new MeshBuffers();
  private readonly light: LightEngine;
  private readonly edits: BlockEditStore | undefined;
  private readonly probe: PerfProbe | undefined;
  private readonly service: ChunkGenerationService;

  private chunksLoaded = 0;
  private generationMs = 0;
  private lightMs = 0;

  private lastCenter: ChunkCoord | null = null;
  private desiredKeys: ReadonlySet<string> = new Set();
  /** Desired, not loaded, not yet requested; nearest-first. */
  private pendingLoads: ChunkCoord[] = [];
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
    this.maxLoadsPerUpdate = maxLoadsPerUpdate;
    this.maxInFlight = Math.max(1, streaming.maxInFlight ?? Math.max(CHUNK_STREAMING_CONFIG.maxInFlight, maxLoadsPerUpdate));
    this.light = light;
    this.edits = edits;
    this.probe = probe;
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
    return { pending: this.pendingLoads.length, inFlight: this.inFlight.size, generation: this.service.location };
  }

  /**
   * Re-evaluates the desired area when `center` changed, then requests
   * pending chunks (bounded by `maxInFlight`), accepts up to
   * `maxLoadsPerUpdate` generated chunks and meshes what became meshable.
   */
  update(center: ChunkCoord): void {
    this.setCenter(center);
    this.requestPending();
    this.acceptGenerated();
    this.requestPending();
    this.flushMeshes();
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
    this.flushMeshes();
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
    for (const coord of chunksWithinRadius(this.lastCenter, this.radius)) {
      this.loadNow(coord);
    }
    this.pendingLoads = [];
    this.flushMeshes();
  }

  /** Cancels outstanding requests and disposes the generation service. */
  dispose(): void {
    for (const request of this.inFlight.values()) {
      this.service.cancel(request.id);
    }
    this.inFlight.clear();
    this.pendingLoads = [];
    this.service.dispose();
  }

  private setCenter(center: ChunkCoord): void {
    if (this.lastCenter !== null && this.lastCenter.cx === center.cx && this.lastCenter.cz === center.cz) {
      return;
    }
    this.lastCenter = center;

    const desired = chunksWithinRadius(center, this.radius);
    this.desiredKeys = new Set(desired.map(({ cx, cz }) => chunkKey(cx, cz)));
    this.unloadOutOfRange();
    this.cancelUndesiredRequests();
    this.pendingLoads = desired.filter(
      ({ cx, cz }) => !this.store.hasChunk(cx, cz) && !this.inFlight.has(chunkKey(cx, cz)),
    );

    // The desired edge moved: a loaded chunk waiting for a neighbour that is
    // no longer desired may have become meshable.
    for (const chunk of this.store.chunks()) {
      const key = chunkKey(chunk.cx, chunk.cz);
      if (!this.meshedWith.has(key)) {
        this.meshCandidates.set(key, { cx: chunk.cx, cz: chunk.cz });
      }
    }
  }

  private unloadOutOfRange(): void {
    const toUnload: ChunkCoord[] = [];
    for (const chunk of this.store.chunks()) {
      if (!this.desiredKeys.has(chunkKey(chunk.cx, chunk.cz))) {
        toUnload.push({ cx: chunk.cx, cz: chunk.cz });
      }
    }

    for (const { cx, cz } of toUnload) {
      const key = chunkKey(cx, cz);
      this.sink.remove(cx, cz);
      this.store.removeChunk(cx, cz);
      this.meshedWith.delete(key);
      this.meshCandidates.delete(key);
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

  private acceptGenerated(): void {
    if (this.inFlight.size === 0 || this.maxLoadsPerUpdate <= 0) {
      return;
    }
    for (const result of this.service.poll(this.maxLoadsPerUpdate)) {
      const key = chunkKey(result.cx, result.cz);
      const request = this.inFlight.get(key);
      if (request === undefined || request.id !== result.id) {
        continue; // stale: cancelled or superseded
      }
      this.inFlight.delete(key);
      if (this.store.hasChunk(result.cx, result.cz)) {
        continue; // already present (e.g. created by a block edit): never double-insert
      }
      this.insertChunk(new Chunk(result.cx, result.cz, result.blocks), result.genMs);
    }
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
    const generated = generateChunkMessage(this.generator, 0, coord.cx, coord.cz, () => this.now());
    this.insertChunk(new Chunk(coord.cx, coord.cz, generated.blocks), generated.genMs);
  }

  /** Edits -> store -> light, then queues the chunk, its loaded neighbours and light-changed chunks for meshing. */
  private insertChunk(chunk: Chunk, genMs: number): void {
    const coord: ChunkCoord = { cx: chunk.cx, cz: chunk.cz };
    this.edits?.applyTo(chunk);
    this.store.setChunk(chunk);
    const lightStart = this.now();
    const lightChanged = this.light.lightChunk(coord.cx, coord.cz);
    const lightEnd = this.now();
    this.generationMs += genMs;
    this.lightMs += lightEnd - lightStart;
    this.probe?.recordChunkGeneration(genMs);
    this.probe?.recordLight(lightEnd - lightStart);
    this.chunksLoaded += 1;

    // Itself + every loaded chunk of its 3x3 neighbourhood (they may be complete now).
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const cx = coord.cx + dx;
        const cz = coord.cz + dz;
        if (this.store.hasChunk(cx, cz)) {
          this.meshCandidates.set(chunkKey(cx, cz), { cx, cz });
        }
      }
    }
    for (const changed of lightChanged) {
      const key = chunkKey(changed.cx, changed.cz);
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

  /** Meshes candidates whose neighbourhood is complete and whose mesh is missing or out of date. */
  private flushMeshes(): void {
    if (this.meshCandidates.size === 0) {
      this.lightChanged.clear();
      return;
    }
    const toMesh: ChunkCoord[] = [];
    for (const [key, coord] of this.meshCandidates) {
      if (!this.store.hasChunk(coord.cx, coord.cz)) {
        continue;
      }
      const mask = this.neighbourMask(coord);
      const previous = this.meshedWith.get(key);
      const outdated =
        previous === undefined || this.lightChanged.has(key) || (mask !== INCOMPLETE && (mask & ~previous) !== 0);
      if (!outdated) {
        continue;
      }
      if (mask === INCOMPLETE) {
        // Mesh later, once the missing neighbour arrives (or leaves the desired area).
        this.meshedWith.delete(key);
        continue;
      }
      this.meshedWith.set(key, mask);
      toMesh.push(coord);
    }
    this.meshCandidates.clear();
    this.lightChanged.clear();

    if (toMesh.length > 0) {
      remeshChunks(this.store, this.registry, this.sink, toMesh, this.meshBuffers, this.probe);
    }
  }
}
