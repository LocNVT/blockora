import type { WorldGenerator } from '../WorldGenerator';

/**
 * Message protocol between the main thread and the chunk-generation worker.
 * Plain data only; the generated block array travels as a Transferable.
 *
 * main -> worker: `init` once (seed), then `generate` / `cancel` by request id.
 * worker -> main: `generated` (blocks buffer transferred) or `failed`.
 */
export type ChunkGenRequest =
  | { readonly type: 'init'; readonly seed: number }
  | { readonly type: 'generate'; readonly id: number; readonly cx: number; readonly cz: number }
  | { readonly type: 'cancel'; readonly id: number };

/** A finished chunk: seed-generated block ids (no edits, no light). */
export interface GeneratedChunk {
  readonly id: number;
  readonly cx: number;
  readonly cz: number;
  /** CHUNK_VOLUME block ids, `localIndex` order (same as `Chunk.blocks`). */
  readonly blocks: Uint8Array;
  /** Generation time measured where it ran (worker or main thread). */
  readonly genMs: number;
}

export interface ChunkGenResult extends GeneratedChunk {
  readonly type: 'generated';
}

export interface ChunkGenFailure {
  readonly type: 'failed';
  readonly id: number;
  readonly message: string;
}

export type ChunkGenResponse = ChunkGenResult | ChunkGenFailure;

/**
 * The one generation function both backends run (in-process service and the
 * worker), so their output is byte-identical for the same seed.
 */
export function generateChunkMessage(
  generator: WorldGenerator,
  id: number,
  cx: number,
  cz: number,
  now: () => number,
): ChunkGenResult {
  const start = now();
  const { blocks } = generator.generateChunk(cx, cz);
  return { type: 'generated', id, cx, cz, blocks, genMs: now() - start };
}
