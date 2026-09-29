import type { BlockChange } from './blockEdit';
import type { Chunk } from './Chunk';
import { chunkKey, localIndex, type ChunkCoord } from './chunkCoords';

/**
 * One chunk's player edits in TypedArray form — the persisted shape (and cheap
 * to structured-clone / transfer). `indices[i]` is a local block index (see
 * `localIndex`; CHUNK_VOLUME = 32768 fits Uint16) and `blocks[i]` the block id
 * the player left there. Indices are unique and ascending.
 */
export interface ChunkEditsRecord {
  readonly cx: number;
  readonly cz: number;
  readonly indices: Uint16Array;
  readonly blocks: Uint8Array;
}

/** Chunk edits that changed since the last `takeDirty`: records to write and chunks whose record must be deleted. */
export interface DirtyEdits {
  readonly puts: readonly ChunkEditsRecord[];
  readonly deletes: readonly ChunkCoord[];
}

interface ChunkEdits {
  readonly cx: number;
  readonly cz: number;
  /** Local index -> block id the player left there. */
  readonly current: Map<number, number>;
  /**
   * Local index -> seed-generated block id, when known (learned from the
   * first edit's `previous`, or from the freshly generated chunk in
   * `applyTo`). Lets an edit that reverts a block to its generated value drop
   * the entry. Entries restored from a save have no original until their
   * chunk is generated.
   */
  readonly original: Map<number, number>;
}

/**
 * In-memory sparse diff of the player's block edits relative to the
 * seed-generated world, per chunk (local index -> block id). The chunk arrays
 * themselves are dropped on unload; this store is not, so re-generating a
 * chunk and calling `applyTo` before lighting/meshing restores the edits.
 * It is also exactly what gets persisted (see src/save), with per-chunk dirty
 * tracking so a save writes only the chunks that changed.
 */
export class BlockEditStore {
  private readonly byChunk = new Map<string, ChunkEdits>();
  private readonly dirty = new Map<string, ChunkCoord>();

  /** Number of chunks that currently hold at least one edit. */
  get chunkCount(): number {
    return this.byChunk.size;
  }

  /** Total number of edited blocks across all chunks. */
  get editCount(): number {
    let total = 0;
    for (const edits of this.byChunk.values()) {
      total += edits.current.size;
    }
    return total;
  }

  /** True when some chunk's edits changed since the last `takeDirty`. */
  hasDirty(): boolean {
    return this.dirty.size > 0;
  }

  /**
   * Records a committed block edit. An edit that puts a block back to its
   * generated value removes the entry (and the chunk entry once empty).
   */
  record(change: BlockChange): void {
    const key = chunkKey(change.cx, change.cz);
    const index = localIndex(change.lx, change.ly, change.lz);
    let edits = this.byChunk.get(key);
    if (edits === undefined) {
      edits = { cx: change.cx, cz: change.cz, current: new Map(), original: new Map() };
      this.byChunk.set(key, edits);
    }
    if (!edits.current.has(index)) {
      // No prior edit: the block being replaced is the generated one.
      edits.original.set(index, change.previous);
    }

    if (edits.original.get(index) === change.next) {
      this.dropEntry(key, edits, index);
    } else {
      edits.current.set(index, change.next);
    }
    this.dirty.set(key, { cx: change.cx, cz: change.cz });
  }

  /**
   * Applies the recorded edits to a freshly generated `chunk` (call before
   * lighting/meshing). Entries that already match the generated block are
   * dropped (marked dirty so the persisted record shrinks). Returns how many
   * blocks were overwritten.
   */
  applyTo(chunk: Chunk): number {
    const key = chunkKey(chunk.cx, chunk.cz);
    const edits = this.byChunk.get(key);
    if (edits === undefined) {
      return 0;
    }
    let applied = 0;
    for (const [index, block] of edits.current) {
      const generated = chunk.blocks[index];
      if (generated === undefined) {
        continue;
      }
      edits.original.set(index, generated);
      if (generated === block) {
        this.dropEntry(key, edits, index);
        this.dirty.set(key, { cx: chunk.cx, cz: chunk.cz });
      } else {
        chunk.blocks[index] = block;
        applied += 1;
      }
    }
    return applied;
  }

  /** Block id recorded at a chunk-local index, or undefined when that block is unedited. */
  editAt(cx: number, cz: number, index: number): number | undefined {
    return this.byChunk.get(chunkKey(cx, cz))?.current.get(index);
  }

  /** Replaces the store's contents with previously persisted records (not marked dirty). */
  restore(records: readonly ChunkEditsRecord[]): void {
    this.byChunk.clear();
    this.dirty.clear();
    for (const record of records) {
      if (record.indices.length === 0) {
        continue;
      }
      const current = new Map<number, number>();
      for (let i = 0; i < record.indices.length; i += 1) {
        current.set(record.indices[i] as number, record.blocks[i] as number);
      }
      this.byChunk.set(chunkKey(record.cx, record.cz), {
        cx: record.cx,
        cz: record.cz,
        current,
        original: new Map(),
      });
    }
  }

  /** Every chunk's edits as records (copies), e.g. for a full rewrite. */
  allRecords(): ChunkEditsRecord[] {
    return Array.from(this.byChunk.values(), toRecord);
  }

  /**
   * Snapshot of every chunk changed since the last call (copies, safe to
   * persist asynchronously while editing continues) and clears the dirty set.
   * A dirty chunk with no edits left becomes a delete.
   */
  takeDirty(): DirtyEdits {
    const puts: ChunkEditsRecord[] = [];
    const deletes: ChunkCoord[] = [];
    for (const [key, coord] of this.dirty) {
      const edits = this.byChunk.get(key);
      if (edits === undefined) {
        deletes.push(coord);
      } else {
        puts.push(toRecord(edits));
      }
    }
    this.dirty.clear();
    return { puts, deletes };
  }

  /** Re-marks chunks dirty (e.g. after a failed save of a `takeDirty` snapshot). */
  markDirty(coords: Iterable<ChunkCoord>): void {
    for (const { cx, cz } of coords) {
      this.dirty.set(chunkKey(cx, cz), { cx, cz });
    }
  }

  private dropEntry(key: string, edits: ChunkEdits, index: number): void {
    edits.current.delete(index);
    edits.original.delete(index);
    if (edits.current.size === 0) {
      this.byChunk.delete(key);
    }
  }
}

function toRecord(edits: ChunkEdits): ChunkEditsRecord {
  const sorted = Array.from(edits.current.keys()).sort((a, b) => a - b);
  const indices = new Uint16Array(sorted.length);
  const blocks = new Uint8Array(sorted.length);
  sorted.forEach((index, i) => {
    indices[i] = index;
    blocks[i] = edits.current.get(index) ?? 0;
  });
  return { cx: edits.cx, cz: edits.cz, indices, blocks };
}
