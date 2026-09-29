import type { EntityStore, MobEntity } from '../entities/EntityStore';
import type { EntityRaycastHit } from '../entities/entityRaycast';
import type { VoxelRaycastBlockHit } from '../world/voxelRaycast';
import { mobDefinition } from '../entities/mobDefinitions';
import { damageMob, meleeDamage, rollMobDrops } from '../entities/mobCombat';
import type { Rng } from '../entities/mobAI';
import type { ToolProperties } from '../items/items';
import type { ItemRegistry } from '../items/ItemRegistry';
import type { Inventory } from '../items/Inventory';
import type { ItemDropSystem, Vec3 } from '../items/ItemDrops';
import { createStack } from '../items/ItemStack';
import { ItemId } from '../items/items';

/**
 * Which action LMB should perform this frame: attacking a mob always takes
 * priority over block breaking when both are in range, since an entity
 * standing in front of a block would otherwise be unreachable to hit. Rules:
 * - No entity hit -> 'break' (existing hold-to-break flow, unchanged).
 * - Entity hit but no block hit -> 'attack'.
 * - Both hit -> whichever is nearer wins; an exact tie favors 'attack' (a mob
 *   standing flush against a block face is the more common/intended target).
 * Pure, no side effects — callers use the result to decide whether to run the
 * attack path or the existing break-progress path this frame.
 */
export function resolveAttackOrBreak(
  entityHit: EntityRaycastHit | null,
  blockHit: VoxelRaycastBlockHit | null,
): 'attack' | 'break' {
  if (entityHit === null) {
    return 'break';
  }
  if (blockHit === null) {
    return 'attack';
  }
  return entityHit.distance <= blockHit.distance ? 'attack' : 'break';
}

/**
 * Executes one melee attack against `mob`: computes damage from the held
 * tool, applies it (respecting hurt-invulnerability/knockback/flee via
 * `damageMob`), wears the held tool by 1 use if one was held (kept simple and
 * consistent with `applyToolWear`'s per-use model — attacking is treated like
 * a single "block break" of wear for now), and on a kill removes the mob from
 * `entityStore` and spawns its item drops (rolled from `mobRng`, the same
 * seeded RNG the mob simulation already uses, so drop counts stay
 * deterministic per world) via `drops`. Returns the `damageMob` result.
 */
export function performMobAttack(
  mob: MobEntity,
  sourcePos: Vec3,
  tool: ToolProperties | undefined,
  entityStore: EntityStore,
  drops: ItemDropSystem,
  inventory: Inventory,
  itemRegistry: ItemRegistry,
  mobRng: Rng,
): ReturnType<typeof damageMob> {
  const def = mobDefinition(mob.type);
  const damage = meleeDamage(tool);
  const result = damageMob(mob, damage, sourcePos, def);

  if (!result.applied) {
    return result;
  }

  if (tool !== undefined) {
    // Wear-by-1 per attack, consistent with breaking one hardness>0 block
    // (see `applyToolWear`) — kept simple for this combat slice.
    inventory.damageSelected(1, itemRegistry);
  }

  if (result.killed) {
    const rolled = rollMobDrops(def, mobRng);
    for (const drop of rolled) {
      if (drop.count <= 0) {
        continue;
      }
      const stack = createStack(drop.itemId as ItemId, drop.count, itemRegistry);
      drops.spawn(stack, { ...mob.position });
    }
    entityStore.remove(mob.id);
  }

  return result;
}
