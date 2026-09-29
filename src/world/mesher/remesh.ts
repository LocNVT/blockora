import type { BlockRegistry } from '../BlockRegistry';
import type { ChunkStore } from '../ChunkStore';
import { chunkKey, type ChunkCoord } from '../chunkCoords';
import { MeshBuffers, type ChunkMeshData } from './MeshBuffers';
import { meshChunk } from './meshChunk';
import { neighborhoodFromStore } from './BlockSampler';
import type { PerfProbe } from '../../debug/PerfStats';
import { createLightSampler, lightNeighborhoodFromStore } from '../light/LightSampler';

/** Minimal sink a remesh target must satisfy; ChunkMeshRenderer implements this shape. */
export interface ChunkMeshSink {
  upsert(cx: number, cz: number, data: ChunkMeshData): void;
  /** Removes a previously-upserted mesh (e.g. the chunk was unloaded); a no-op if it has none. */
  remove(cx: number, cz: number): void;
}

/**
 * Re-meshes each of `coords` and hands the result to `sink.upsert`. Coordinates
 * whose chunk isn't currently loaded in `store` are skipped (nothing to mesh,
 * nothing to render). Duplicate coordinates (by chunk key) are meshed once.
 *
 * `buffers` is reused across all coordinates in this call when provided,
 * avoiding per-chunk typed-array reallocation; a fresh MeshBuffers is created
 * otherwise.
 *
 * When a `probe` is given, each chunk's mesh generation time (neighbourhood
 * gather + `meshChunk`; excludes the sink upload) is recorded through it.
 *
 * Returns the chunk keys actually remeshed, in the order they were processed
 * (useful for tests/logging).
 */
export function remeshChunks(
  store: ChunkStore,
  registry: BlockRegistry,
  sink: ChunkMeshSink,
  coords: readonly ChunkCoord[],
  buffers: MeshBuffers = new MeshBuffers(),
  probe?: Pick<PerfProbe, 'now' | 'recordMesh'>,
): string[] {
  const seen = new Set<string>();
  const remeshed: string[] = [];

  for (const { cx, cz } of coords) {
    const key = chunkKey(cx, cz);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    if (store.getChunk(cx, cz) === undefined) {
      continue;
    }

    const meshStart = probe?.now() ?? 0;
    const neighborhood = neighborhoodFromStore(store, cx, cz);
    const lightSampler = createLightSampler(lightNeighborhoodFromStore(store, cx, cz));
    const data = meshChunk(neighborhood, registry, buffers, undefined, lightSampler);
    probe?.recordMesh((probe.now()) - meshStart);
    sink.upsert(cx, cz, data);
    remeshed.push(key);
  }

  return remeshed;
}
