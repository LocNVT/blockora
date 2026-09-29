import type { BlockRegistry } from '../BlockRegistry';
import type { Chunk } from '../Chunk';
import type { ChunkStore } from '../ChunkStore';
import { WORLD_CONFIG } from '../../config/constants';
import { chunkKey, type ChunkCoord } from '../chunkCoords';
import { LightQueue } from './LightQueue';
import { LightChannel, MAX_LIGHT, channelOf, withChannel } from './lightNibbles';

const { chunkWidth: W, chunkDepth: D, chunkHeight: H } = WORLD_CONFIG;
const TOP_Y = H - 1;
const CHUNK_CACHE_SIZE = 9;

/** Border bits: which neighbouring chunks' meshes can see a changed cell. */
const NEG_X = 1;
const POS_X = 2;
const NEG_Z = 4;
const POS_Z = 8;
/** Corner bits: a changed corner cell is also sampled by the diagonal chunk (smooth lighting). */
const CORNERS: readonly (readonly [number, number, number])[] = [
  [16, -1, -1],
  [32, -1, 1],
  [64, 1, -1],
  [128, 1, 1],
];
const ALL_BORDERS = 0xff;

const NEIGHBOR_OFFSETS: readonly (readonly [number, number, number])[] = [
  [NEG_X, -1, 0],
  [POS_X, 1, 0],
  [NEG_Z, 0, -1],
  [POS_Z, 0, 1],
];

/** Local x in the center chunk adjacent to a neighbour's border cell at x (dx = neighbour offset). */
function innerX(x: number, dx: number): number {
  return dx === -1 ? 0 : dx === 1 ? W - 1 : x;
}

function innerZ(z: number, dz: number): number {
  return dz === -1 ? 0 : dz === 1 ? D - 1 : z;
}

function borderBits(lx: number, lz: number): number {
  const negX = lx === 0;
  const posX = lx === W - 1;
  const negZ = lz === 0;
  const posZ = lz === D - 1;
  let bits = (negX ? NEG_X : 0) | (posX ? POS_X : 0) | (negZ ? NEG_Z : 0) | (posZ ? POS_Z : 0);
  if (negX && negZ) bits |= 16;
  if (negX && posZ) bits |= 32;
  if (posX && negZ) bits |= 64;
  if (posX && posZ) bits |= 128;
  return bits;
}

/**
 * Voxel sky + block light (0..15 each) stored packed in `Chunk.light`.
 *
 * Rules (see docs/PROGRESS.md "Voxel lighting"):
 * - Light entering a block loses `1 + lightOpacity(block)`; opacity 15
 *   (every opaque block) therefore blocks it completely.
 * - Sky light moving straight down from a level-15 cell loses only the
 *   block's opacity, so open air columns stay 15 all the way to the ground.
 * - The world top (y = chunkHeight) is a virtual level-15 sky source.
 * - Block light is seeded from `BlockDefinition.lightLevel`.
 *
 * Chunks are "lit" once `lightChunk` ran for them; unlit chunks (and unloaded
 * ones) are treated as absent: light neither reads from nor spills into them.
 * When a chunk is lit, loaded lit neighbours' border light flows in and its
 * own light spills out, so the result is independent of load order.
 *
 * Every public operation returns the deduped chunk coords whose light
 * changed, plus loaded neighbours touching a changed border cell (their
 * meshes sample it), in deterministic order.
 *
 * All BFS work runs on reused Int32Array ring buffers; nothing is allocated
 * per visited cell.
 */
export class LightEngine {
  private readonly store: ChunkStore;
  private readonly opacity: Uint8Array;
  private readonly emission: Uint8Array;
  private readonly addQueue = new LightQueue();
  private readonly removeQueue = new LightQueue();
  private readonly reseedQueue = new LightQueue();
  private readonly litChunks = new WeakSet<Chunk>();

  private readonly cacheCx = new Int32Array(CHUNK_CACHE_SIZE);
  private readonly cacheCz = new Int32Array(CHUNK_CACHE_SIZE);
  private readonly cacheChunks: (Chunk | null)[] = [];
  private cacheCount = 0;
  private cacheNext = 0;

  private readonly changed = new Map<Chunk, number>();

  /** Scratch output of `resolve`: the chunk and local x/z of the last resolved cell. */
  private rChunk: Chunk | null = null;
  private rLx = 0;
  private rLz = 0;

  constructor(store: ChunkStore, registry: BlockRegistry) {
    this.store = store;
    this.opacity = registry.lightOpacityTable;
    this.emission = registry.lightEmissionTable;
  }

  /** True once `lightChunk` has computed light for this chunk. */
  isLit(chunk: Chunk): boolean {
    return this.litChunks.has(chunk);
  }

  /**
   * Computes light for a freshly loaded chunk (cx, cz): sky columns, block
   * emitters, light flowing in from lit neighbours, and spill-out into them.
   * Returns [] if the chunk isn't in the store.
   */
  lightChunk(cx: number, cz: number): ChunkCoord[] {
    const chunk = this.store.getChunk(cx, cz);
    if (chunk === undefined) {
      return [];
    }
    this.beginOperation();
    this.litChunks.add(chunk);
    chunk.light.fill(0);
    this.changed.set(chunk, ALL_BORDERS);

    this.fillSkyColumns(chunk);
    this.seedSkySpread(chunk);
    this.seedNeighborBorders(chunk, LightChannel.Sky);
    this.propagate(LightChannel.Sky);

    this.seedEmitters(chunk);
    this.seedNeighborBorders(chunk, LightChannel.Block);
    this.propagate(LightChannel.Block);

    return this.endOperation();
  }

  /**
   * Updates light after the block at (wx, wy, wz) changed from `previous` to
   * `next` (already written into the store). Handles removal and
   * re-propagation for both channels, across chunk borders.
   */
  updateBlock(wx: number, wy: number, wz: number, previous: number, next: number): ChunkCoord[] {
    if (wy < 0 || wy >= H) {
      return [];
    }
    const cx = Math.floor(wx / W);
    const cz = Math.floor(wz / D);
    const chunk = this.store.getChunk(cx, cz);
    if (chunk === undefined) {
      return [];
    }
    if (!this.litChunks.has(chunk)) {
      // e.g. a chunk created by an edit in an unloaded region: light it fully.
      return this.lightChunk(cx, cz);
    }
    const opacityChanged = this.opacity[previous] !== this.opacity[next];
    if (!opacityChanged && this.emission[previous] === this.emission[next]) {
      return [];
    }

    this.beginOperation();
    if (opacityChanged) {
      // Sky light depends only on opacity; emission-only edits skip it.
      this.relightCell(wx, wy, wz, LightChannel.Sky);
    }
    this.relightCell(wx, wy, wz, LightChannel.Block);
    return this.endOperation();
  }

  // ---- initial chunk light ----

  private fillSkyColumns(chunk: Chunk): void {
    const { blocks, light } = chunk;
    const opacity = this.opacity;
    for (let z = 0; z < D; z += 1) {
      for (let x = 0; x < W; x += 1) {
        let level = MAX_LIGHT;
        for (let y = TOP_Y; y >= 0; y -= 1) {
          const index = x + W * (z + D * y);
          const op = opacity[blocks[index] ?? 0] ?? MAX_LIGHT;
          level -= level === MAX_LIGHT ? op : op + 1;
          if (level <= 0) {
            break;
          }
          light[index] = level << LightChannel.Sky;
        }
      }
    }
  }

  /**
   * Queues sky cells that can raise a horizontal neighbour (in this chunk or
   * across the border in a lit neighbour). Column fill already resolved
   * straight-down light, and a column never gets brighter going down, so only
   * horizontal differences need seeding.
   */
  private seedSkySpread(chunk: Chunk): void {
    const { light } = chunk;
    const originX = chunk.cx * W;
    const originZ = chunk.cz * D;
    const negX = this.chunkAt(chunk.cx - 1, chunk.cz)?.light ?? null;
    const posX = this.chunkAt(chunk.cx + 1, chunk.cz)?.light ?? null;
    const negZ = this.chunkAt(chunk.cx, chunk.cz - 1)?.light ?? null;
    const posZ = this.chunkAt(chunk.cx, chunk.cz + 1)?.light ?? null;
    for (let y = 0; y < H; y += 1) {
      for (let z = 0; z < D; z += 1) {
        for (let x = 0; x < W; x += 1) {
          const index = x + W * (z + D * y);
          const level = (light[index] ?? 0) >> LightChannel.Sky;
          if (level <= 1) {
            continue;
          }
          // Packed values compare by sky nibble first, so `< threshold` means "sky < level - 1".
          const threshold = (level - 1) << LightChannel.Sky;
          const raisesNeighbor =
            (x > 0 ? (light[index - 1] ?? 0) : negX === null ? threshold : (negX[index + W - 1] ?? 0)) < threshold ||
            (x < W - 1 ? (light[index + 1] ?? 0) : posX === null ? threshold : (posX[index - W + 1] ?? 0)) < threshold ||
            (z > 0 ? (light[index - W] ?? 0) : negZ === null ? threshold : (negZ[index + W * (D - 1)] ?? 0)) < threshold ||
            (z < D - 1 ? (light[index + W] ?? 0) : posZ === null ? threshold : (posZ[index - W * (D - 1)] ?? 0)) < threshold;
          if (raisesNeighbor) {
            this.addQueue.push(originX + x, y, originZ + z, level);
          }
        }
      }
    }
  }

  private seedEmitters(chunk: Chunk): void {
    const { blocks, light } = chunk;
    const originX = chunk.cx * W;
    const originZ = chunk.cz * D;
    for (let index = 0; index < blocks.length; index += 1) {
      const emitted = this.emission[blocks[index] ?? 0] ?? 0;
      if (emitted === 0) {
        continue;
      }
      light[index] = withChannel(light[index] ?? 0, LightChannel.Block, emitted);
      const x = index % W;
      const z = Math.floor(index / W) % D;
      const y = Math.floor(index / (W * D));
      this.addQueue.push(originX + x, y, originZ + z, emitted);
    }
  }

  /** Queues the lit neighbours' cells that face `chunk`, so their light flows in. */
  private seedNeighborBorders(chunk: Chunk, channel: LightChannel): void {
    for (const [, dx, dz] of NEIGHBOR_OFFSETS) {
      const neighbor = this.chunkAt(chunk.cx + dx, chunk.cz + dz);
      if (neighbor === null) {
        continue;
      }
      const originX = neighbor.cx * W;
      const originZ = neighbor.cz * D;
      // The neighbour's face toward `chunk`: its x (or z) at the opposite edge.
      const fixedX = dx === -1 ? W - 1 : dx === 1 ? 0 : -1;
      const fixedZ = dz === -1 ? D - 1 : dz === 1 ? 0 : -1;
      for (let y = 0; y < H; y += 1) {
        for (let i = 0; i < (fixedX >= 0 ? D : W); i += 1) {
          const x = fixedX >= 0 ? fixedX : i;
          const z = fixedZ >= 0 ? fixedZ : i;
          const level = channelOf(neighbor.light[x + W * (z + D * y)] ?? 0, channel);
          // Skip cells that cannot brighten the adjacent cell of `chunk`.
          const inner = channelOf(chunk.light[innerX(x, dx) + W * (innerZ(z, dz) + D * y)] ?? 0, channel);
          if (level - 1 > inner) {
            this.addQueue.push(originX + x, y, originZ + z, level);
          }
        }
      }
    }
  }

  // ---- incremental update ----

  private relightCell(wx: number, wy: number, wz: number, channel: LightChannel): void {
    const index = this.resolve(wx, wy, wz);
    const chunk = this.rChunk;
    if (index < 0 || chunk === null) {
      return;
    }
    const packed = chunk.light[index] ?? 0;
    const old = channelOf(packed, channel);
    if (old > 0) {
      chunk.light[index] = withChannel(packed, channel, 0);
      this.mark(chunk, this.rLx, this.rLz);
    }
    this.removeQueue.push(wx, wy, wz, old);
    const source = this.sourceLevel(chunk, index, wy, channel);
    if (source > 0) {
      this.reseedQueue.push(wx, wy, wz, source);
    }

    this.runRemoval(channel);
    this.applyReseeds(channel);
    this.propagate(channel);
  }

  private runRemoval(channel: LightChannel): void {
    const queue = this.removeQueue;
    while (queue.size > 0) {
      const offset = queue.shift();
      const buffer = queue.buffer;
      const wx = buffer[offset] ?? 0;
      const wy = buffer[offset + 1] ?? 0;
      const wz = buffer[offset + 2] ?? 0;
      const level = buffer[offset + 3] ?? 0;
      this.removeNeighbor(wx - 1, wy, wz, level, channel, false);
      this.removeNeighbor(wx + 1, wy, wz, level, channel, false);
      this.removeNeighbor(wx, wy, wz - 1, level, channel, false);
      this.removeNeighbor(wx, wy, wz + 1, level, channel, false);
      this.removeNeighbor(wx, wy + 1, wz, level, channel, false);
      this.removeNeighbor(wx, wy - 1, wz, level, channel, true);
    }
  }

  /**
   * A neighbour dimmer than the removed cell (or a straight-down 15 sky chain)
   * may have been lit through it: clear it and continue removal. Anything
   * else is lit independently and re-propagates into the cleared area.
   */
  private removeNeighbor(
    wx: number,
    wy: number,
    wz: number,
    removedLevel: number,
    channel: LightChannel,
    down: boolean,
  ): void {
    const index = this.resolve(wx, wy, wz);
    const chunk = this.rChunk;
    if (index < 0 || chunk === null) {
      return;
    }
    const packed = chunk.light[index] ?? 0;
    const level = channelOf(packed, channel);
    if (level === 0) {
      return;
    }
    const skyChain = channel === LightChannel.Sky && down && removedLevel === MAX_LIGHT && level === MAX_LIGHT;
    if (level < removedLevel || skyChain) {
      chunk.light[index] = withChannel(packed, channel, 0);
      this.mark(chunk, this.rLx, this.rLz);
      this.removeQueue.push(wx, wy, wz, level);
      const source = this.sourceLevel(chunk, index, wy, channel);
      if (source > 0) {
        this.reseedQueue.push(wx, wy, wz, source);
      }
    } else {
      this.addQueue.push(wx, wy, wz, level);
    }
  }

  /** Light a cell produces by itself: its emission, or virtual sky at the world top. */
  private sourceLevel(chunk: Chunk, index: number, wy: number, channel: LightChannel): number {
    const block = chunk.blocks[index] ?? 0;
    if (channel === LightChannel.Block) {
      return this.emission[block] ?? 0;
    }
    if (wy !== TOP_Y) {
      return 0;
    }
    return Math.max(0, MAX_LIGHT - (this.opacity[block] ?? MAX_LIGHT));
  }

  private applyReseeds(channel: LightChannel): void {
    const queue = this.reseedQueue;
    while (queue.size > 0) {
      const offset = queue.shift();
      const buffer = queue.buffer;
      const wx = buffer[offset] ?? 0;
      const wy = buffer[offset + 1] ?? 0;
      const wz = buffer[offset + 2] ?? 0;
      const source = buffer[offset + 3] ?? 0;
      this.raise(wx, wy, wz, source, channel);
    }
  }

  // ---- propagation ----

  private propagate(channel: LightChannel): void {
    const queue = this.addQueue;
    while (queue.size > 0) {
      const offset = queue.shift();
      const buffer = queue.buffer;
      const wx = buffer[offset] ?? 0;
      const wy = buffer[offset + 1] ?? 0;
      const wz = buffer[offset + 2] ?? 0;
      const index = this.resolve(wx, wy, wz);
      const chunk = this.rChunk;
      if (index < 0 || chunk === null) {
        continue;
      }
      // Use the cell's current level: it may have risen since it was queued.
      const level = channelOf(chunk.light[index] ?? 0, channel);
      if (level <= 1) {
        continue;
      }
      this.spreadTo(wx - 1, wy, wz, level, channel, false);
      this.spreadTo(wx + 1, wy, wz, level, channel, false);
      this.spreadTo(wx, wy, wz - 1, level, channel, false);
      this.spreadTo(wx, wy, wz + 1, level, channel, false);
      this.spreadTo(wx, wy + 1, wz, level, channel, false);
      this.spreadTo(wx, wy - 1, wz, level, channel, true);
    }
  }

  private spreadTo(wx: number, wy: number, wz: number, from: number, channel: LightChannel, down: boolean): void {
    const index = this.resolve(wx, wy, wz);
    const chunk = this.rChunk;
    if (index < 0 || chunk === null) {
      return;
    }
    const op = this.opacity[chunk.blocks[index] ?? 0] ?? MAX_LIGHT;
    const straightSky = channel === LightChannel.Sky && down && from === MAX_LIGHT;
    const next = from - (straightSky ? op : op + 1);
    this.raiseResolved(chunk, index, wx, wy, wz, next, channel);
  }

  private raise(wx: number, wy: number, wz: number, level: number, channel: LightChannel): void {
    const index = this.resolve(wx, wy, wz);
    const chunk = this.rChunk;
    if (index < 0 || chunk === null) {
      return;
    }
    this.raiseResolved(chunk, index, wx, wy, wz, level, channel);
  }

  /** Writes `level` if it brightens the (already resolved) cell, and queues it for spreading. */
  private raiseResolved(
    chunk: Chunk,
    index: number,
    wx: number,
    wy: number,
    wz: number,
    level: number,
    channel: LightChannel,
  ): void {
    if (level <= 0) {
      return;
    }
    const packed = chunk.light[index] ?? 0;
    if (channelOf(packed, channel) >= level) {
      return;
    }
    chunk.light[index] = withChannel(packed, channel, level);
    this.mark(chunk, this.rLx, this.rLz);
    this.addQueue.push(wx, wy, wz, level);
  }

  // ---- chunk access / change tracking ----

  /**
   * Resolves a world cell to its lit chunk (in `rChunk`, local x/z in
   * `rLx`/`rLz`) and returns its local index, or -1 when y is out of range or
   * the chunk is absent/unlit.
   */
  private resolve(wx: number, wy: number, wz: number): number {
    if (wy < 0 || wy >= H) {
      this.rChunk = null;
      return -1;
    }
    const cx = Math.floor(wx / W);
    const cz = Math.floor(wz / D);
    const chunk = this.chunkAt(cx, cz);
    this.rChunk = chunk;
    if (chunk === null) {
      return -1;
    }
    this.rLx = wx - cx * W;
    this.rLz = wz - cz * D;
    return this.rLx + W * (this.rLz + D * wy);
  }

  /** Lit chunk at (cx, cz) or null; small per-operation cache avoids string-keyed lookups per cell. */
  private chunkAt(cx: number, cz: number): Chunk | null {
    for (let i = 0; i < this.cacheCount; i += 1) {
      if (this.cacheCx[i] === cx && this.cacheCz[i] === cz) {
        return this.cacheChunks[i] ?? null;
      }
    }
    const found = this.store.getChunk(cx, cz);
    const chunk = found !== undefined && this.litChunks.has(found) ? found : null;
    const slot = this.cacheCount < CHUNK_CACHE_SIZE ? this.cacheCount++ : this.cacheNext;
    if (slot === this.cacheNext) {
      this.cacheNext = (this.cacheNext + 1) % CHUNK_CACHE_SIZE;
    }
    this.cacheCx[slot] = cx;
    this.cacheCz[slot] = cz;
    this.cacheChunks[slot] = chunk;
    return chunk;
  }

  private mark(chunk: Chunk, lx: number, lz: number): void {
    const bits = borderBits(lx, lz);
    const current = this.changed.get(chunk);
    if (current === undefined || (current | bits) !== current) {
      this.changed.set(chunk, (current ?? 0) | bits);
    }
  }

  private beginOperation(): void {
    this.cacheCount = 0;
    this.cacheNext = 0;
    this.cacheChunks.length = 0;
    this.changed.clear();
    this.addQueue.clear();
    this.removeQueue.clear();
    this.reseedQueue.clear();
  }

  private endOperation(): ChunkCoord[] {
    const seen = new Set<string>();
    const result: ChunkCoord[] = [];
    const add = (cx: number, cz: number): void => {
      const key = chunkKey(cx, cz);
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ cx, cz });
      }
    };

    for (const [chunk, bits] of this.changed) {
      add(chunk.cx, chunk.cz);
      for (const [bit, dx, dz] of NEIGHBOR_OFFSETS) {
        if ((bits & bit) !== 0 && this.chunkAt(chunk.cx + dx, chunk.cz + dz) !== null) {
          add(chunk.cx + dx, chunk.cz + dz);
        }
      }
      for (const [bit, dx, dz] of CORNERS) {
        if ((bits & bit) !== 0 && this.chunkAt(chunk.cx + dx, chunk.cz + dz) !== null) {
          add(chunk.cx + dx, chunk.cz + dz);
        }
      }
    }

    this.changed.clear();
    this.cacheChunks.length = 0;
    this.cacheCount = 0;
    return result;
  }
}
