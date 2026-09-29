import { BlockId } from './blocks';
import { Chunk } from './Chunk';
import { WORLD_CONFIG } from '../config/constants';
import { chunkKey, worldToChunkCoord, worldToLocal } from './chunkCoords';

const { chunkHeight } = WORLD_CONFIG;

/**
 * In-memory lookup of loaded chunks, keyed by chunk column coordinate.
 * Pure block storage/access — no generation, meshing, or persistence here.
 */
export class ChunkStore {
  private readonly chunksByKey = new Map<string, Chunk>();

  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.chunksByKey.get(chunkKey(cx, cz));
  }

  /** Read-only iteration over every currently loaded chunk. */
  chunks(): IterableIterator<Chunk> {
    return this.chunksByKey.values();
  }

  /** Number of currently loaded chunks. */
  get size(): number {
    return this.chunksByKey.size;
  }

  setChunk(chunk: Chunk): void {
    this.chunksByKey.set(chunkKey(chunk.cx, chunk.cz), chunk);
  }

  /** Unloads chunk (cx, cz), if loaded. Returns whether a chunk was actually removed. */
  removeChunk(cx: number, cz: number): boolean {
    return this.chunksByKey.delete(chunkKey(cx, cz));
  }

  hasChunk(cx: number, cz: number): boolean {
    return this.chunksByKey.has(chunkKey(cx, cz));
  }

  getOrCreateChunk(cx: number, cz: number): Chunk {
    const existing = this.getChunk(cx, cz);
    if (existing !== undefined) {
      return existing;
    }
    const created = new Chunk(cx, cz);
    this.setChunk(created);
    return created;
  }

  /** Returns Air for coordinates outside 0..chunkHeight-1 or in an unloaded chunk. */
  getBlock(wx: number, wy: number, wz: number): BlockId {
    const y = Math.floor(wy);
    if (y < 0 || y >= chunkHeight) {
      return BlockId.Air;
    }

    const { cx, cz } = worldToChunkCoord(wx, wz);
    const chunk = this.getChunk(cx, cz);
    if (chunk === undefined) {
      return BlockId.Air;
    }

    const local = worldToLocal(wx, y, wz);
    return chunk.getBlock(local.x, local.y, local.z);
  }

  /** Creates the target chunk if missing. Returns false (no-op) when y is out of range. */
  setBlock(wx: number, wy: number, wz: number, id: number): boolean {
    const y = Math.floor(wy);
    if (y < 0 || y >= chunkHeight) {
      return false;
    }

    const { cx, cz } = worldToChunkCoord(wx, wz);
    const chunk = this.getOrCreateChunk(cx, cz);
    const local = worldToLocal(wx, y, wz);
    return chunk.setBlock(local.x, local.y, local.z, id);
  }
}
