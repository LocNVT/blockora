import { BlockId } from './blocks';
import { CHUNK_VOLUME, isInsideChunk, localIndex } from './chunkCoords';

const MAX_BLOCK_ID = 255;

/**
 * A single chunk column: chunkWidth x chunkHeight x chunkDepth blocks, zero-filled (Air).
 * Storage-only — does not know about the BlockRegistry, so it stays independent of
 * block metadata and safe to construct/transfer from a worker.
 */
export class Chunk {
  readonly cx: number;
  readonly cz: number;
  readonly blocks: Uint8Array;
  /**
   * Packed per-block light, same indexing as `blocks`: sky light in the high
   * nibble, block light in the low nibble (see src/world/light/lightNibbles).
   * Derived data — written only by the LightEngine, never persisted (it is
   * recomputed from blocks on load).
   */
  readonly light: Uint8Array;

  private dirtyFlag = false;

  constructor(cx: number, cz: number, blocks?: Uint8Array, light?: Uint8Array) {
    this.cx = cx;
    this.cz = cz;

    if (blocks !== undefined) {
      if (blocks.length !== CHUNK_VOLUME) {
        throw new Error(
          `Chunk: expected a Uint8Array of length ${CHUNK_VOLUME}, got ${blocks.length}.`,
        );
      }
      this.blocks = blocks;
    } else {
      this.blocks = new Uint8Array(CHUNK_VOLUME);
    }

    if (light !== undefined && light.length !== CHUNK_VOLUME) {
      throw new Error(`Chunk: expected a light Uint8Array of length ${CHUNK_VOLUME}, got ${light.length}.`);
    }
    this.light = light ?? new Uint8Array(CHUNK_VOLUME);
  }

  get dirty(): boolean {
    return this.dirtyFlag;
  }

  markClean(): void {
    this.dirtyFlag = false;
  }

  /** Returns Air for any out-of-bounds coordinate. */
  getBlock(x: number, y: number, z: number): BlockId {
    if (!isInsideChunk(x, y, z)) {
      return BlockId.Air;
    }
    return this.blocks[localIndex(x, y, z)] as BlockId;
  }

  /** Returns false (no-op) for out-of-bounds coordinates. Throws on an invalid block id. */
  setBlock(x: number, y: number, z: number, id: number): boolean {
    if (!isInsideChunk(x, y, z)) {
      return false;
    }
    if (!Number.isInteger(id) || id < 0 || id > MAX_BLOCK_ID) {
      throw new RangeError(`Chunk: invalid block id ${id}; expected an integer in 0..255.`);
    }

    const index = localIndex(x, y, z);
    if (this.blocks[index] === id) {
      return false;
    }

    this.blocks[index] = id;
    this.dirtyFlag = true;
    return true;
  }
}
