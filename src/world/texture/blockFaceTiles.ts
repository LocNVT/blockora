import { FaceDirection } from '../mesher/faces';
import type { BlockTexture } from '../blocks';
import type { BlockRegistry } from '../BlockRegistry';
import { tileIndex } from './tiles';

/** Sentinel tile index for faces that never emit geometry (e.g. Air). */
export const NO_TILE = 0xffff;

const FACE_COUNT = 6;

/** Resolves which texture key a given face direction uses from a block's texture definition. */
export function resolveFaceTile(texture: BlockTexture, face: FaceDirection): string {
  if ('all' in texture) {
    return texture.all;
  }
  if (face === FaceDirection.PosY) {
    return texture.top;
  }
  if (face === FaceDirection.NegY) {
    return texture.bottom;
  }
  return texture.side;
}

/**
 * Precomputed lookup of tile index by [blockId * 6 + faceDirection], built
 * once at startup so the mesher's hot loop never resolves strings per-face.
 */
export function buildFaceTileTable(registry: BlockRegistry): Uint16Array {
  const table = new Uint16Array(registry.size * FACE_COUNT).fill(NO_TILE);

  for (let id = 0; id < registry.size; id += 1) {
    const def = registry.get(id);
    if (def.texture === null) {
      continue;
    }
    for (let face = 0; face < FACE_COUNT; face += 1) {
      const key = resolveFaceTile(def.texture, face as FaceDirection);
      table[id * FACE_COUNT + face] = tileIndex(key);
    }
  }

  return table;
}

/** Looks up a precomputed face-tile table built by `buildFaceTileTable`. */
export function faceTileFromTable(table: Uint16Array, blockId: number, face: FaceDirection): number {
  return table[blockId * FACE_COUNT + face] ?? NO_TILE;
}

/**
 * Throws a descriptive error listing every renderable block (texture !== null)
 * that references a tile name absent from `tileNames`. Intended to run once
 * at startup so a missing/misspelled tile key fails fast with a clear message.
 */
export function validateBlockTextures(registry: BlockRegistry, tileNames: readonly string[]): void {
  const known = new Set(tileNames);
  const missing: string[] = [];

  for (let id = 0; id < registry.size; id += 1) {
    const def = registry.get(id);
    if (def.texture === null) {
      continue;
    }
    const keys = 'all' in def.texture
      ? [def.texture.all]
      : [def.texture.top, def.texture.side, def.texture.bottom];

    for (const key of keys) {
      if (!known.has(key)) {
        missing.push(`${def.name} -> "${key}"`);
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(`validateBlockTextures: unknown texture key(s):\n${missing.join('\n')}`);
  }
}
