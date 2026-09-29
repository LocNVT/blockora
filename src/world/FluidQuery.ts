import type { BlockRegistry } from './BlockRegistry';
import type { ChunkStore } from './ChunkStore';

/** True if the given block id is a fluid (e.g. Water) — data-driven via `BlockDefinition.fluid`. */
export function isFluidBlock(registry: BlockRegistry, id: number): boolean {
  return registry.isFluid(id);
}

/**
 * Answers whether the block at integer block coordinates (x, y, z) is a
 * fluid. Mirrors SolidQuery/TargetQuery's shape, backed by `isFluidBlock`.
 */
export type FluidQuery = (x: number, y: number, z: number) => boolean;

/** Builds a FluidQuery backed by a ChunkStore and a BlockRegistry. */
export function createFluidQuery(store: ChunkStore, registry: BlockRegistry): FluidQuery {
  return (x: number, y: number, z: number): boolean => isFluidBlock(registry, store.getBlock(x, y, z));
}
