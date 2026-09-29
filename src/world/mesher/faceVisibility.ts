import { BlockId } from '../blocks';
import type { BlockRegistry } from '../BlockRegistry';

/**
 * Pure face-culling rule, shared by the culled mesher today and a future
 * greedy mesher. A face is emitted only when it could actually be seen:
 * - Air never has a visible face (there's no geometry to draw).
 * - Facing Air: always visible.
 * - Facing an opaque neighbour: hidden (fully occluded).
 * - Facing a transparent neighbour: hidden only when it's the same block id
 *   (e.g. glass-glass, water-water — no internal seam), otherwise visible
 *   (e.g. stone-glass: the stone's face toward the glass IS visible).
 */
export function isFaceVisible(self: BlockId, neighbor: BlockId, registry: BlockRegistry): boolean {
  if (self === BlockId.Air) {
    return false;
  }
  if (neighbor === BlockId.Air) {
    return true;
  }
  if (!registry.isTransparent(neighbor)) {
    return false;
  }
  return neighbor !== self;
}

/** A block with no texture (e.g. Air) never produces geometry. */
export function hasGeometry(blockId: BlockId, registry: BlockRegistry): boolean {
  if (blockId === BlockId.Air) {
    return false;
  }
  return registry.get(blockId).texture !== null;
}

/** Opaque blocks mesh into the opaque layer; transparent blocks into the transparent layer. */
export function layerFor(blockId: BlockId, registry: BlockRegistry): 'opaque' | 'transparent' {
  return registry.isTransparent(blockId) ? 'transparent' : 'opaque';
}
