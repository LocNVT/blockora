import * as THREE from 'three';
import { createRenderer } from './renderer/createRenderer';
import { createScene } from './renderer/scene';
import { createCamera, resizeCamera } from './renderer/camera';
import { ChunkMeshRenderer, setChunkDaylight } from './renderer/chunkMeshes';
import { BlockOutline } from './renderer/BlockOutline';
import { ItemDropRenderer } from './renderer/ItemDropRenderer';
import { MobRenderer } from './renderer/MobRenderer';
import { EntityStore } from './entities/EntityStore';
import { createMobSpawnTimer, updateMobs } from './entities/updateMobs';
import { mulberry32 } from './entities/mobSpawning';
import { createPlayerState } from './player/PlayerState';
import { stepPlayer } from './player/playerPhysics';
import { InputController } from './player/InputController';
import { applyStateToCamera } from './player/firstPersonCamera';
import { eyePosition, lookDirection } from './player/cameraRay';
import { PlayerHealth } from './player/PlayerHealth';
import { PlayerHunger, SurvivalTicker } from './player/PlayerHunger';
import { FallTracker } from './player/fallDamage';
import { computeSpawnPosition, resolveSpawnHeight } from './player/spawn';
import { PointerLockHint } from './ui/PointerLockHint';
import { Crosshair } from './ui/Crosshair';
import { HealthHud } from './ui/HealthHud';
import { HungerHud } from './ui/HungerHud';
import { DeathScreen } from './ui/DeathScreen';
import { DayNightLighting } from './renderer/DayNightLighting';
import { GameTime, daylightFactor } from './world/GameTime';
import { blockRegistry } from './world/BlockRegistry';
import { ChunkStore } from './world/ChunkStore';
import { ChunkManager } from './world/ChunkManager';
import { WorldGenerator } from './world/WorldGenerator';
import { createSolidQuery } from './world/SolidQuery';
import { createTargetQuery } from './world/TargetQuery';
import { createFluidQuery } from './world/FluidQuery';
import { createVoxelRaycastBlockHit, raycastBlock } from './world/voxelRaycast';
import { createEntityRaycastHit, raycastEntities } from './entities/entityRaycast';
import { resolveAttackOrBreak, performMobAttack } from './gameplay/combatActions';
import { mobDefinition } from './entities/mobDefinitions';
import { worldToChunkCoord } from './world/chunkCoords';
import { BlockId } from './world/blocks';
import { MeshBuffers, remeshChunks } from './world/mesher';
import { applyLightAndCollectRemesh } from './world/blockEdit';
import { LightEngine } from './world/light';
import {
  applyHotbarInput,
  applyToolWear,
  breakAndDrop,
  placeSelectedItem,
  throwSelectedItem,
  giveStartingItems,
} from './gameplay/hotbarActions';
import { breakDuration, BreakProgress } from './gameplay/breakTime';
import { EatProgress } from './gameplay/eatProgress';
import { blockUseAction } from './gameplay/blockUse';
import { openChestContainer, type ChestContext } from './gameplay/chestActions';
import { ChestStore } from './items/ChestStore';
import { playerAabb } from './player/voxelCollision';
import { validateBlockTextures } from './world/texture/blockFaceTiles';
import { TILE_NAMES } from './world/texture/tiles';
import {
  COMBAT_CONFIG,
  DAY_NIGHT_CONFIG,
  PLAYER_CONFIG,
  SURVIVAL_CONFIG,
  WORLD_CONFIG,
  WORLD_GEN_CONFIG,
} from './config/constants';
import { Inventory } from './items/Inventory';
import { itemRegistry, type ItemRegistry } from './items/ItemRegistry';
import type { MovementInput } from './player/playerPhysics';
import { ItemDropSystem } from './items/ItemDrops';
import type { ItemStack } from './items/ItemStack';
import { ContainerSession } from './items/ContainerSession';
import { CraftingGrid } from './crafting/CraftingGrid';
import { HotbarHud } from './ui/HotbarHud';
import { InventoryScreen } from './ui/InventoryScreen';

/**
 * Applies a block break (completed by `BreakProgress` reaching 'broken') at
 * the current raycast hit, using `tool`'s properties to decide the drop, and
 * remeshes any chunks whose mesh may have changed. Returns whether an edit
 * was made (callers should re-run the raycast so the outline reflects the new
 * block state in the same frame).
 */
function applyBreak(
  store: ChunkStore,
  light: LightEngine,
  chunkMeshRenderer: ChunkMeshRenderer,
  meshBuffers: MeshBuffers,
  drops: ItemDropSystem,
  hit: ReturnType<typeof createVoxelRaycastBlockHit> | null,
  tool: ReturnType<ItemRegistry['toolFor']>,
  inventory: Inventory,
  chests: ChestContext,
): boolean {
  const blockDefBeforeBreak = hit !== null ? blockRegistry.get(hit.blockId) : null;
  const change = breakAndDrop(store, blockRegistry, itemRegistry, drops, hit, Math.random, tool, chests);
  if (change === null) {
    return false;
  }
  if (blockDefBeforeBreak !== null) {
    applyToolWear(inventory, blockDefBeforeBreak, tool, itemRegistry);
  }
  remeshChunks(
    store,
    blockRegistry,
    chunkMeshRenderer,
    applyLightAndCollectRemesh(change, light),
    meshBuffers,
  );
  return true;
}

/**
 * Applies a pending place action (if any) against the current raycast hit,
 * remeshes any chunks whose mesh may have changed, and returns whether an
 * edit was made (see `applyBreak` for the re-raycast rationale).
 */
function applyPlace(
  store: ChunkStore,
  light: LightEngine,
  chunkMeshRenderer: ChunkMeshRenderer,
  meshBuffers: MeshBuffers,
  inventory: Inventory,
  hit: ReturnType<typeof createVoxelRaycastBlockHit> | null,
  playerBox: ReturnType<typeof playerAabb>,
): boolean {
  const change = placeSelectedItem(store, blockRegistry, itemRegistry, inventory, hit, playerBox);
  if (change === null) {
    return false;
  }
  remeshChunks(
    store,
    blockRegistry,
    chunkMeshRenderer,
    applyLightAndCollectRemesh(change, light),
    meshBuffers,
  );
  return true;
}

async function bootstrap(): Promise<void> {
  validateBlockTextures(blockRegistry, TILE_NAMES);

  const container = document.getElementById('app');
  if (!container) {
    throw new Error('App container not found');
  }

  const { renderer, backend } = await createRenderer();
  console.info(`[renderer] using backend: ${backend}`);
  container.appendChild(renderer.domElement);

  const sceneWithLights = createScene();
  const scene = sceneWithLights.scene;
  const camera = createCamera(window.innerWidth / window.innerHeight);

  const gameTime = new GameTime();
  const dayNightLighting = new DayNightLighting(sceneWithLights);

  const worldGenerator = new WorldGenerator(WORLD_GEN_CONFIG.defaultSeed);
  const chunkStore = new ChunkStore();
  const lightEngine = new LightEngine(chunkStore, blockRegistry);
  const chunkMeshRenderer = new ChunkMeshRenderer(scene);

  const spawn = computeSpawnPosition(worldGenerator);

  const chunkManager = new ChunkManager(
    chunkStore,
    worldGenerator,
    blockRegistry,
    chunkMeshRenderer,
    WORLD_CONFIG.renderDistance,
    undefined,
    lightEngine,
  );
  // Only force-load a small area synchronously so there's solid ground under
  // the player before the first frame renders; the rest of renderDistance
  // streams in over subsequent frames via the per-frame budgeted update()
  // below, instead of stalling startup on the full render-distance area.
  const spawnChunkStart = performance.now();
  chunkManager.update(worldToChunkCoord(spawn.position.x, spawn.position.z));
  const spawnLoadStats = chunkManager.stats;
  console.info(
    `[chunks] initial spawn load time=${(performance.now() - spawnChunkStart).toFixed(2)}ms ` +
      `(chunks=${spawnLoadStats.chunksLoaded} generation=${spawnLoadStats.generationMs.toFixed(2)}ms ` +
      `light=${spawnLoadStats.lightMs.toFixed(2)}ms)`,
  );

  const editMeshBuffers = new MeshBuffers();
  const isSolid = createSolidQuery(chunkStore, blockRegistry);
  const isTargetable = createTargetQuery(chunkStore, blockRegistry);
  const isFluid = createFluidQuery(chunkStore, blockRegistry);

  // Spawn chunk is loaded above, so lift the spawn out of any generated tree/overhang.
  const spawnFeetY = resolveSpawnHeight(chunkStore, blockRegistry, spawn.position);
  const playerState = createPlayerState({ ...spawn.position, y: spawnFeetY }, spawn.pitch);
  const input = new InputController(renderer.domElement as HTMLCanvasElement);
  const hint = new PointerLockHint(container);
  const crosshair = new Crosshair(container);
  const blockOutline = new BlockOutline(scene);
  const breakProgress = new BreakProgress();
  const eatProgress = new EatProgress();
  const playerHealth = new PlayerHealth();
  const playerHunger = new PlayerHunger();
  const survivalTicker = new SurvivalTicker();
  const fallTracker = new FallTracker();
  const healthHud = new HealthHud(container);
  const hungerHud = new HungerHud(container);
  const deathScreen = new DeathScreen(container);

  const inventory = new Inventory();
  giveStartingItems(inventory);
  const hotbarHud = new HotbarHud(container, itemRegistry, blockRegistry);

  // Crafting grids are created once and reused across screen opens; only the
  // ContainerSession wrapping them is recreated per open (cheap, stateless
  // besides the held cursor).
  const craftingGrid2x2 = new CraftingGrid(2, 2);
  const craftingGrid3x3 = new CraftingGrid(3, 3);
  const inventoryScreen = new InventoryScreen(container, itemRegistry, blockRegistry);

  const drops = new ItemDropSystem();
  // Chest contents live outside the chunk arrays and are not dropped on chunk
  // unload (the world stays in memory this phase; persistence is Phase 7).
  const chestContext: ChestContext = {
    chests: new ChestStore(),
    worldSeed: WORLD_GEN_CONFIG.defaultSeed,
    lootTableAt: (x, y, z) => worldGenerator.structureLootTableAt(x, y, z),
  };
  /** World position of the chest whose screen is open, or null (inventory/crafting screens). */
  let openChestPos: { x: number; y: number; z: number } | null = null;
  const itemDropRenderer = new ItemDropRenderer(scene, itemRegistry, blockRegistry);
  const isColumnLoaded = (wx: number, wz: number): boolean => {
    const { cx, cz } = worldToChunkCoord(wx, wz);
    return chunkStore.hasChunk(cx, cz);
  };

  // Mob seed is derived from the world seed so mob spawning/AI stays
  // deterministic per world without colliding with world-gen's own noise seeds.
  const MOB_RNG_SEED_OFFSET = 9001;
  const entityStore = new EntityStore();
  const mobRenderer = new MobRenderer(scene, chunkStore);
  const mobSpawnTimer = createMobSpawnTimer();
  const mobRng = mulberry32(WORLD_GEN_CONFIG.defaultSeed + MOB_RNG_SEED_OFFSET);

  const timer = new THREE.Timer();
  timer.connect(document);

  // Reused across frames to avoid per-frame allocation in the raycast hot path.
  const rayOrigin = { x: 0, y: 0, z: 0 };
  const rayDirection = { x: 0, y: 0, z: 0 };
  const rayHit = createVoxelRaycastBlockHit();
  const entityRayHit = createEntityRaycastHit();
  /** Seconds remaining before the player may melee-attack again (COMBAT_CONFIG.attackCooldown). */
  let attackCooldownRemaining = 0;

  function onWindowResize(): void {
    resizeCamera(camera, window.innerWidth / window.innerHeight);
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', onWindowResize);

  /** Drops a leftover stack (couldn't fit back into the inventory on close) at the player's current eye position. */
  function dropLeftoverAtEye(stack: ItemStack): void {
    const eye = eyePosition(playerState, PLAYER_CONFIG);
    drops.spawn(stack, eye);
  }

  function openInventoryScreen(mode: '2x2' | '3x3'): void {
    const grid = mode === '2x2' ? craftingGrid2x2 : craftingGrid3x3;
    const session = new ContainerSession(inventory, grid);
    document.exitPointerLock();
    inventoryScreen.open(mode, session);
  }

  function openChestScreen(x: number, y: number, z: number): void {
    const container = openChestContainer(chestContext, x, y, z);
    const session = new ContainerSession(inventory, craftingGrid2x2, undefined, undefined, container);
    document.exitPointerLock();
    openChestPos = { x, y, z };
    inventoryScreen.open('chest', session);
  }

  function closeInventoryScreen(): void {
    openChestPos = null;
    inventoryScreen.close(dropLeftoverAtEye);
    // Keydown is a user gesture, so re-requesting the lock here is allowed;
    // if it's refused (e.g. focus was lost) the "Click to play" hint simply
    // reappears next frame via the isLocked() check below — no error surfaces.
    renderer.domElement.requestPointerLock();
  }

  /**
   * Runs once when the player dies: releases pointer lock, closes the
   * inventory screen if it was open (returning its grid/cursor via the
   * existing close path), and shows the death overlay. Movement/actions are
   * frozen by skipping stepPlayer/input handling in the frame loop while
   * `playerHealth.isDead` (see the animation loop below) rather than here.
   *
   * Inventory is intentionally kept on death for now — dropping items on
   * death is a later survival decision (see docs/PROGRESS.md).
   */
  // Edge-detected once per death in the frame loop, whatever the damage source
  // (fall, void, or future mobs), so the death screen can never be skipped.
  let deathHandled = false;
  function handleDeath(): void {
    deathHandled = true;
    openChestPos = null;
    document.exitPointerLock();
    if (inventoryScreen.isOpen) {
      inventoryScreen.close(dropLeftoverAtEye);
    }
    deathScreen.show();
  }

  /**
   * Respawn: full heal, clear fall tracking, teleport to the (deterministic)
   * world spawn with zeroed velocity and spawn look angles, ensure the spawn
   * chunk is loaded before teleporting, hide the death overlay, and
   * re-request pointer lock (the button click is a user gesture).
   */
  function respawn(): void {
    playerHealth.reset();
    playerHunger.reset();
    survivalTicker.reset();
    fallTracker.reset();

    chunkManager.update(worldToChunkCoord(spawn.position.x, spawn.position.z));

    playerState.position.x = spawn.position.x;
    playerState.position.y = resolveSpawnHeight(chunkStore, blockRegistry, spawn.position);
    playerState.position.z = spawn.position.z;
    playerState.velocity.x = 0;
    playerState.velocity.y = 0;
    playerState.velocity.z = 0;
    playerState.pitch = spawn.pitch;
    playerState.yaw = 0;
    playerState.onGround = false;
    playerState.crouching = false;

    deathHandled = false;
    deathScreen.hide();
    renderer.domElement.requestPointerLock();
  }
  deathScreen.onRespawn(respawn);

  renderer.setAnimationLoop((timestamp) => {
    timer.update(timestamp);
    const dt = timer.getDelta();

    // Time keeps advancing even while dead (death only freezes movement/actions).
    gameTime.advance(dt);
    dayNightLighting.apply(gameTime.timeOfDay, playerState.position);
    // Chunk meshes are unlit (baked voxel light); daylight scales their sky light.
    setChunkDaylight(daylightFactor(gameTime.timeOfDay, DAY_NIGHT_CONFIG));

    playerHealth.update(dt);

    // Always sample (clears accumulated mouse-look deltas even while dead, so
    // the camera doesn't snap on respawn), but feed a zeroed input into
    // stepPlayer while dead so movement/actions are frozen.
    const sampled: MovementInput = input.sample();
    if (!playerHealth.isDead) {
      // Sprint gate: low hunger forces sprint off before physics/activity
      // tracking see it (playerPhysics itself is untouched).
      if (!playerHunger.canSprint()) {
        sampled.sprint = false;
      }
      const isMoving = sampled.forward !== 0 || sampled.right !== 0;
      const sprinting = sampled.sprint && isMoving;
      const jumped = sampled.jump && playerState.onGround;

      stepPlayer(playerState, sampled, dt, isSolid);

      const feetInFluid = isFluid(
        Math.floor(playerState.position.x),
        Math.floor(playerState.position.y),
        Math.floor(playerState.position.z),
      );
      const fallDamage = fallTracker.update(playerState, feetInFluid);
      if (fallDamage > 0) {
        playerHealth.damage(fallDamage, 'fall');
      }

      if (playerState.position.y < SURVIVAL_CONFIG.voidY) {
        // Accumulate at least 1 damage/frame so a tiny dt never rounds the
        // void's damage-per-second down to 0 (guarantees the void always
        // kills in finite time even at very high frame rates).
        const voidDamage = Math.max(1, Math.round(SURVIVAL_CONFIG.voidDamagePerSecond * dt));
        playerHealth.damage(voidDamage, 'void');
      }

      survivalTicker.update(playerHealth, playerHunger, dt, { sprinting, jumped });
    }
    if (playerHealth.isDead && !deathHandled) {
      handleDeath();
    }
    applyStateToCamera(camera, playerState);

    healthHud.update(playerHealth.health, playerHealth.isDead);
    hungerHud.update(playerHunger.hunger, playerHealth.isDead);

    chunkManager.update(worldToChunkCoord(playerState.position.x, playerState.position.z));

    const uiInput = input.consumeUiInput();
    if (playerHealth.isDead) {
      // Death already closed the inventory screen in handleDeath(); ignore
      // further toggle/close latches while dead so they don't reopen it.
    } else if (uiInput.toggleInventory) {
      if (inventoryScreen.isOpen) {
        closeInventoryScreen();
      } else {
        openInventoryScreen('2x2');
      }
    } else if (uiInput.close && inventoryScreen.isOpen) {
      closeInventoryScreen();
    }

    // A chest screen must not outlive its block (broken or its chunk unloaded).
    if (
      openChestPos !== null &&
      chunkStore.getBlock(openChestPos.x, openChestPos.y, openChestPos.z) !== BlockId.Chest
    ) {
      closeInventoryScreen();
    }

    // Hint hidden while any overlay (inventory, death screen) owns the screen.
    hint.setLocked(input.isLocked() || inventoryScreen.isOpen || playerHealth.isDead);

    eyePosition(playerState, PLAYER_CONFIG, rayOrigin);
    lookDirection(playerState.yaw, playerState.pitch, rayDirection);
    let hit = raycastBlock(
      chunkStore,
      blockRegistry,
      rayOrigin,
      rayDirection,
      PLAYER_CONFIG.interactionDistance,
      rayHit,
      isTargetable,
    );

    if (attackCooldownRemaining > 0) {
      attackCooldownRemaining = Math.max(0, attackCooldownRemaining - dt);
    }

    if (!inventoryScreen.isOpen && !playerHealth.isDead) {
      applyHotbarInput(inventory, input.consumeHotbarInput());

      const actions = input.consumeActions();
      const useAction = actions.placePressed && hit !== null ? blockUseAction(hit.blockId) : null;
      const selectedItemId = inventory.selectedStack()?.itemId;
      const selectedFood = selectedItemId !== undefined ? itemRegistry.foodFor(selectedItemId) : undefined;

      // Entity-vs-block priority: a mob closer than (or equally close as) the
      // block under the crosshair wins LMB this frame — it is attacked
      // (one-shot per press, respecting the cooldown) and block-breaking is
      // not started/continued this frame (see `resolveAttackOrBreak`).
      const entityHit = raycastEntities(
        rayOrigin,
        rayDirection,
        COMBAT_CONFIG.attackReach,
        entityStore.all(),
        mobDefinition,
        entityRayHit,
      );
      const attacking = entityHit !== null && resolveAttackOrBreak(entityHit, hit) === 'attack';

      if (attacking && entityHit !== null) {
        if (actions.attackPressed && attackCooldownRemaining <= 0) {
          const target = entityStore.get(entityHit.mobId);
          if (target !== undefined) {
            const tool = selectedItemId !== undefined ? itemRegistry.toolFor(selectedItemId) : undefined;
            performMobAttack(target, rayOrigin, tool, entityStore, drops, inventory, itemRegistry, mobRng);
            attackCooldownRemaining = COMBAT_CONFIG.attackCooldown;
          }
        }
      }

      if (useAction !== null && hit !== null) {
        // Block use wins on the press frame even if a food item is selected:
        // RMB opens the screen instead of taking a bite or placing a block.
        if (useAction === 'crafting_table') {
          openInventoryScreen('3x3');
        } else {
          openChestScreen(hit.x, hit.y, hit.z);
        }
        breakProgress.update(null, false, dt, 0);
        eatProgress.update(null, false, false, dt);
        crosshair.setProgress(0);
      } else {
        const tool = selectedItemId !== undefined ? itemRegistry.toolFor(selectedItemId) : undefined;
        const target = hit !== null ? { x: hit.x, y: hit.y, z: hit.z } : null;
        const duration = hit !== null ? breakDuration(blockRegistry.get(hit.blockId), tool) : 0;
        // Attacking this frame forces break-held to false: an entity in
        // front of a block never lets that block start/continue breaking.
        const breakHeld = !attacking && input.isBreakHeld();
        const breakState = breakProgress.update(target, breakHeld, dt, duration);

        // Selected item is food: RMB is "eat" instead of "place" (no block
        // placement while holding food). Break (LMB) still works normally.
        const eatState =
          selectedFood !== undefined
            ? eatProgress.update(selectedItemId ?? null, playerHunger.canEat(), input.isUseHeld(), dt)
            : eatProgress.update(null, false, false, dt);

        if (eatState === 'eating') {
          crosshair.setProgress(eatProgress.progress);
        } else {
          crosshair.setProgress(breakProgress.progress);
        }

        if (eatState === 'eaten' && selectedFood !== undefined) {
          inventory.takeFromSelected(1);
          playerHunger.eat(selectedFood.hunger);
        }

        let edited = false;
        if (breakState === 'broken') {
          edited = applyBreak(
            chunkStore,
            lightEngine,
            chunkMeshRenderer,
            editMeshBuffers,
            drops,
            hit,
            tool,
            inventory,
            chestContext,
          );
        } else if (actions.placePressed && selectedFood === undefined && !attacking) {
          edited = applyPlace(
            chunkStore,
            lightEngine,
            chunkMeshRenderer,
            editMeshBuffers,
            inventory,
            hit,
            playerAabb(playerState),
          );
        }

        if (edited) {
          // Re-run the raycast so the outline reflects the new block state
          // this same frame (collision already updates immediately since it
          // reads live from ChunkStore via SolidQuery).
          hit = raycastBlock(
            chunkStore,
            blockRegistry,
            rayOrigin,
            rayDirection,
            PLAYER_CONFIG.interactionDistance,
            rayHit,
            isTargetable,
          );
        }
      }
      if (actions.dropPressed) {
        throwSelectedItem(inventory, drops, rayOrigin, rayDirection);
      }
    } else {
      // Screen is open: still consume latches so they don't fire the instant
      // the screen closes, but do not act on them (and don't accumulate break
      // progress while the screen is up).
      input.consumeHotbarInput();
      input.consumeActions();
      breakProgress.update(null, false, dt, 0);
      eatProgress.update(null, false, false, dt);
      crosshair.setProgress(0);
    }

    drops.update(dt, isSolid, isColumnLoaded);
    const playerBox = playerAabb(playerState);
    drops.collect(playerBox, inventory);
    itemDropRenderer.update(drops.drops());

    // Mobs keep simulating/rendering even while the player is dead (only
    // player movement/actions are frozen above).
    updateMobs(entityStore, dt, mobSpawnTimer, {
      store: chunkStore,
      registry: blockRegistry,
      isSolid,
      isFluid,
      rng: mobRng,
      playerPosition: playerState.position,
      playerAlive: !playerHealth.isDead,
      daylight: daylightFactor(gameTime.timeOfDay, DAY_NIGHT_CONFIG),
      // PlayerHealth ignores damage while dead or invulnerable.
      onAttackPlayer: (damage: number): void => {
        playerHealth.damage(damage, 'generic');
      },
    });
    mobRenderer.update(entityStore.all(), dt);

    blockOutline.update(hit);
    hotbarHud.update(inventory);

    renderer.render(scene, camera);
  });
}

bootstrap().catch((error: unknown) => {
  console.error('Failed to initialize renderer:', error);
  const container = document.getElementById('app');
  if (container) {
    const message = error instanceof Error ? error.message : String(error);
    container.textContent = `Failed to start Blockora: ${message}`;
  }
});
