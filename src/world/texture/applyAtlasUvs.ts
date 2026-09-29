import type { AtlasLayout } from './atlasLayout';
import { mapToAtlasUv } from './atlasLayout';

const UV_COMPONENTS = 2;

/**
 * Converts a mesh section's local UVs (0..width / 0..height per quad, as
 * emitted by MeshBuffers) plus its per-vertex tile indices into atlas-space
 * UVs, one pair per vertex. Pure function, no three imports.
 *
 * Only unit quads (local uv in {0,1}) are meshed today, so this is a direct
 * per-vertex remap. When greedy meshing lands, local uv can exceed 1 and
 * this function's per-vertex lerp would sample outside the tile; at that
 * point the local uv should be wrapped with `fract()` before/inside
 * `mapToAtlasUv` (or a texture-array/tiled-shader approach used instead) —
 * the `uvs` + `tiles` arrays are kept separate precisely so that switch is
 * possible without touching the mesher.
 */
export function applyAtlasUvs(
  uvs: Float32Array,
  tiles: Uint16Array,
  layout: AtlasLayout,
  out: Float32Array = new Float32Array(tiles.length * UV_COMPONENTS),
): Float32Array {
  const vertexCount = tiles.length;
  if (out.length < vertexCount * UV_COMPONENTS) {
    throw new RangeError(`applyAtlasUvs: output holds ${out.length} floats, needs ${vertexCount * UV_COMPONENTS}.`);
  }

  for (let v = 0; v < vertexCount; v += 1) {
    const tile = tiles[v] ?? 0;
    const localU = uvs[v * UV_COMPONENTS] ?? 0;
    const localV = uvs[v * UV_COMPONENTS + 1] ?? 0;
    const [u, uvV] = mapToAtlasUv(localU, localV, tile, layout);
    out[v * UV_COMPONENTS] = u;
    out[v * UV_COMPONENTS + 1] = uvV;
  }

  return out;
}
