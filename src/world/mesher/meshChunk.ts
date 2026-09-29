import { FACES, FaceDirection } from './faces';
import { isFaceVisible, hasGeometry, layerFor } from './faceVisibility';
import { createBlockSampler, type BlockSampler, type ChunkNeighborhood } from './BlockSampler';
import { MeshBuffers, type ChunkMeshData } from './MeshBuffers';
import type { QuadEmitter } from './QuadEmitter';
import type { BlockRegistry } from '../BlockRegistry';
import { buildFaceTileTable } from '../texture/blockFaceTiles';
import { WORLD_CONFIG } from '../../config/constants';
import { createLightSampler, type LightNeighborhood, type LightSampler } from '../light/LightSampler';

const { chunkWidth, chunkDepth, chunkHeight } = WORLD_CONFIG;

const QUAD_SIZE = 1;

/** Memoized default face-tile tables, keyed by registry identity (derived data, never mutated). */
const defaultFaceTileCache = new WeakMap<BlockRegistry, Uint16Array>();

/**
 * Lazily builds (and caches) the default face-tile table for `registry`, so
 * callers that don't care about atlas layout customization (tests, most
 * production call sites) don't need to build one themselves.
 */
function defaultFaceTilesFor(registry: BlockRegistry): Uint16Array {
  let table = defaultFaceTileCache.get(registry);
  if (table === undefined) {
    table = buildFaceTileTable(registry);
    defaultFaceTileCache.set(registry, table);
  }
  return table;
}

/**
 * Iterates every block in the chunk and, for each of its 6 faces, emits a
 * unit quad through `emitter` when that face is visible per `isFaceVisible`.
 * No greedy merging — one quad per visible block face. Kept swappable behind
 * `meshChunk` so a future `emitGreedyFaces` can replace it without touching
 * callers. Each quad carries the packed light of the cell it faces
 * (`lightSampler` at block + face normal): flat per-face lighting.
 */
export function emitCulledFaces(
  sampler: BlockSampler,
  registry: BlockRegistry,
  emitter: QuadEmitter,
  faceTileTable: Uint16Array,
  lightSampler: LightSampler,
): void {
  for (let y = 0; y < chunkHeight; y += 1) {
    for (let z = 0; z < chunkDepth; z += 1) {
      for (let x = 0; x < chunkWidth; x += 1) {
        const blockId = sampler(x, y, z);
        if (!hasGeometry(blockId, registry)) {
          continue;
        }

        const layer = layerFor(blockId, registry);

        for (let face = 0; face < FACES.length; face += 1) {
          const descriptor = FACES[face];
          if (descriptor === undefined) {
            continue;
          }
          const [dx, dy, dz] = descriptor.normal;
          const neighbor = sampler(x + dx, y + dy, z + dz);

          if (isFaceVisible(blockId, neighbor, registry)) {
            emitter.emitQuad(
              face as FaceDirection,
              x,
              y,
              z,
              QUAD_SIZE,
              QUAD_SIZE,
              blockId,
              layer,
              faceTileTable,
              lightSampler(x + dx, y + dy, z + dz),
            );
          }
        }
      }
    }
  }
}

/**
 * Light neighbourhood matching a ChunkNeighborhood's 4 axis neighbours
 * (diagonals null — flat face lighting never samples them). Missing chunks
 * read as open sky per `createLightSampler`.
 */
export function lightNeighborhoodFromChunks(neighborhood: ChunkNeighborhood): LightNeighborhood {
  const { center, posX, negX, posZ, negZ } = neighborhood;
  return {
    cx: center.cx,
    cz: center.cz,
    chunks: [null, negZ, null, negX, center, posX, null, posZ, null],
  };
}

/**
 * Meshes one chunk's neighbourhood into opaque + transparent geometry data
 * using face culling (no greedy meshing). Reuses `buffers` when provided
 * (calls `reset()` first) so repeated meshing avoids reallocating typed
 * arrays; otherwise allocates a fresh MeshBuffers for this call only.
 * `faceTileTable` defaults to a cached table built from `registry` via
 * `buildFaceTileTable` — pass a custom one only for tests/tools.
 * `lightSampler` defaults to one over `neighborhood`'s chunks' `light`
 * arrays; pass one (e.g. from `lightNeighborhoodFromStore`) to swap the source.
 */
export function meshChunk(
  neighborhood: ChunkNeighborhood,
  registry: BlockRegistry,
  buffers: MeshBuffers = new MeshBuffers(),
  faceTileTable: Uint16Array = defaultFaceTilesFor(registry),
  lightSampler: LightSampler = createLightSampler(lightNeighborhoodFromChunks(neighborhood)),
): ChunkMeshData {
  buffers.reset();
  const sampler = createBlockSampler(neighborhood);
  const emitter: QuadEmitter = {
    emitQuad: (face, x, y, z, width, height, blockId, layer, tileTable, packedLight): void => {
      buffers.pushQuad(face, x, y, z, width, height, blockId, layer, tileTable, packedLight);
    },
  };
  emitCulledFaces(sampler, registry, emitter, faceTileTable, lightSampler);
  return buffers.toMeshData();
}
