import type { FaceDirection } from './faces';
import type { BlockId } from '../blocks';

export type MeshLayer = 'opaque' | 'transparent';

/**
 * Sink for emitted quads, decoupled from the storage (MeshBuffers) so the
 * face-emission algorithm (culled today, greedy later) can stay agnostic of
 * how geometry is accumulated. Coordinates (x, y, z) are chunk-local; width
 * and height are 1 for single-block faces (a future greedy mesher emits
 * larger values through this same interface).
 *
 * `packedLight` (see src/world/light/lightNibbles) is the light of the cell
 * the face looks into and is written to all 4 vertices (flat lighting). A
 * greedy mesher must therefore only merge faces whose packed light is equal
 * (in addition to equal block id / tile), or the merged quad would smear one
 * face's light across the others.
 */
export interface QuadEmitter {
  emitQuad(
    face: FaceDirection,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    blockId: BlockId,
    layer: MeshLayer,
    faceTileTable: Uint16Array,
    packedLight: number,
  ): void;
}
