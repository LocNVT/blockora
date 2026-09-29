import { voxelAtlasLayout, voxelAtlasPixels } from '../renderer/chunkMeshes';
import { tileIndex } from '../world/texture/tiles';

/**
 * Renders atlas tiles into small cached data URLs so DOM `background-image`
 * can show pixel-accurate item/block icons without a full canvas/texture
 * pipeline per UI element. One cache instance is meant to be shared across
 * every UI surface that needs item icons (hotbar, inventory screen, ...).
 */
export class ItemIconCache {
  private readonly dataUrlCache = new Map<string, string>();

  /** Renders one tile (by atlas tile name) into a cached data URL, generated once and reused. */
  dataUrlForTile(name: string): string {
    const cached = this.dataUrlCache.get(name);
    if (cached !== undefined) {
      return cached;
    }

    const index = tileIndex(name);
    const { tileSize, columns } = voxelAtlasLayout;
    const col = index % columns;
    const row = Math.floor(index / columns);
    const originX = col * tileSize;
    const originY = row * tileSize;

    const canvas = document.createElement('canvas');
    canvas.width = tileSize;
    canvas.height = tileSize;
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      // Extremely unlikely (headless/test-like DOM); fall back to an empty icon
      // rather than throwing out of a per-frame update path.
      const fallback = '';
      this.dataUrlCache.set(name, fallback);
      return fallback;
    }

    const imageData = ctx.createImageData(tileSize, tileSize);
    const atlasWidth = voxelAtlasLayout.width;
    for (let y = 0; y < tileSize; y += 1) {
      for (let x = 0; x < tileSize; x += 1) {
        const srcOffset = ((originY + y) * atlasWidth + (originX + x)) * 4;
        const dstOffset = (y * tileSize + x) * 4;
        imageData.data[dstOffset] = voxelAtlasPixels[srcOffset] ?? 0;
        imageData.data[dstOffset + 1] = voxelAtlasPixels[srcOffset + 1] ?? 0;
        imageData.data[dstOffset + 2] = voxelAtlasPixels[srcOffset + 2] ?? 0;
        imageData.data[dstOffset + 3] = voxelAtlasPixels[srcOffset + 3] ?? 0;
      }
    }
    ctx.putImageData(imageData, 0, 0);

    const url = canvas.toDataURL();
    this.dataUrlCache.set(name, url);
    return url;
  }
}
