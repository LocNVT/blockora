import * as THREE from 'three';
import { createRenderer } from './renderer/createRenderer';
import { createScene } from './renderer/scene';
import { FrameLimiter } from './renderer/frameLimiter';
import { computePixelRatio } from './renderer/resolution';
import { createCamera, resizeCamera } from './renderer/camera';
import { ChunkMeshRenderer, setChunkDaylight } from './renderer/chunkMeshes';
import { BlockOutline } from './renderer/BlockOutline';
import { ItemDropRenderer } from './renderer/ItemDropRenderer';
import { MobRenderer } from './renderer/MobRenderer';
import { EntityStore } from './entities/EntityStore';
import { createMobSpawnTimer, updateMobs } from './entities/updateMobs';
import { mobDistancesFor, mulberry32 } from './entities/mobSpawning';
import { createPlayerState } from './player/PlayerState';
import { stepPlayer } from './player/playerPhysics';
import { InputController } from './player/InputController';
import { applyStateToCamera } from './player/firstPersonCamera';
import { eyePosition, lookDirection } from './player/cameraRay';
import { PlayerHealth } from './player/PlayerHealth';
import { PlayerHunger, SurvivalTicker } from './player/PlayerHunger';
import { FallTracker } from './player/fallDamage';
import { computeSpawnPosition, resolveSpawnHeight } from './player/spawn';
import { Crosshair } from './ui/Crosshair';
import { HealthHud } from './ui/HealthHud';
import { HungerHud } from './ui/HungerHud';
import { DeathScreen } from './ui/DeathScreen';
import { DebugOverlay } from './ui/DebugOverlay';
import { FpsCounter } from './ui/FpsCounter';
import { PauseMenu } from './ui/PauseMenu';
import { showBanner, showFatalError } from './ui/ErrorScreen';
import { ErrorCoordinator, isBenignWindowMessage } from './errors/ErrorCoordinator';
import { guardFrame } from './errors/frameGuard';
import { SettingsScreen } from './ui/SettingsScreen';
import { MainMenu } from './ui/MainMenu';
import {
  POINTER_LOCK_FAILED_MESSAGE,
  POINTER_LOCK_UNSUPPORTED_MESSAGE,
  classifyPlatform,
  readCapabilityInputs,
} from './platform/capabilities';
import { requestLockSafely } from './platform/pointerLock';
import { LoadingScreen } from './ui/LoadingScreen';
import { MenuFlow, type MenuFlowResult, type WorldStartParams } from './menu/MenuFlow';
import {
  LOADING_STAGES,
  loadingProgress,
  nextQuitStep,
  storageStatusOf,
  type LoadingStageId,
} from './menu/menuModel';
import { PauseController, simulationDt } from './gameplay/pause';
import { applyLookSensitivity, clampSettings, type GameSettings } from './settings/GameSettings';
import { loadSettings, saveSettings } from './settings/settingsStorage';
import { applyFov, applyRenderDistanceToView, setFogEnabled } from './renderer/viewSettings';
import { AudioSystem } from './audio/AudioSystem';
import { volumesFromSettings } from './audio/volume';
import { GameEventQueue, type GameEventSink } from './events/GameEvents';
import { MovementEventTracker } from './events/movementEvents';
import { EatEventTracker } from './events/eatEvents';
import { MobIdleEventTimer } from './events/mobIdleEvents';
import { getSkyLight } from './world/light';
import { PerfStats, type PerfProbe } from './debug/PerfStats';
import { readJsHeapMb, readRendererStats, type DebugSnapshot } from './debug/debugText';
import { DayNightLighting } from './renderer/DayNightLighting';
import { GameTime, daylightFactor } from './world/GameTime';
import { blockRegistry } from './world/BlockRegistry';
import { ChunkStore } from './world/ChunkStore';
import { ChunkManager } from './world/ChunkManager';
import { createChunkGenerationService } from './world/worker/createChunkGenerationService';
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
import { applyLightAndCollectRemesh, type BlockChange } from './world/blockEdit';
import { BlockEditStore } from './world/BlockEditStore';
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
import { openSaveStore, type IndexedDbSaveStore } from './save/IndexedDbSaveStore';
import { applySave, createWorldSaver, loadSave, type GameSaveState, type LoadSaveResult } from './save/gameSave';
import { SaveScheduler } from './save/SaveScheduler';
import { playerAabb } from './player/voxelCollision';
import { validateBlockTextures } from './world/texture/blockFaceTiles';
import { TILE_NAMES } from './world/texture/tiles';
import {
  COMBAT_CONFIG,
  DAY_NIGHT_CONFIG,
  PLAYER_CONFIG,
  SAVE_CONFIG,
  SURVIVAL_CONFIG,
  CHUNK_STREAMING_CONFIG,
  AUDIO_CONFIG,
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

/** World systems every committed block edit must update. */
interface BlockEditTargets {
  readonly store: ChunkStore;
  readonly light: LightEngine;
  readonly chunkMeshRenderer: ChunkMeshRenderer;
  readonly meshBuffers: MeshBuffers;
  readonly edits: BlockEditStore;
  readonly probe: PerfProbe;
  /** Receives the sound-relevant events of committed edits. */
  readonly events: GameEventSink;
}

/**
 * The single commit path for player block edits: records the change in the
 * edit store (so it survives chunk unload and gets saved), relights and
 * remeshes every affected chunk.
 */
function commitBlockChange(change: BlockChange, targets: BlockEditTargets): void {
  targets.edits.record(change);
  remeshChunks(
    targets.store,
    blockRegistry,
    targets.chunkMeshRenderer,
    applyLightAndCollectRemesh(change, targets.light),
    targets.meshBuffers,
    targets.probe,
  );
}

/**
 * Applies a block break (completed by `BreakProgress` reaching 'broken') at
 * the current raycast hit, using `tool`'s properties to decide the drop, and
 * remeshes any chunks whose mesh may have changed. Returns whether an edit
 * was made (callers should re-run the raycast so the outline reflects the new
 * block state in the same frame).
 */
function applyBreak(
  targets: BlockEditTargets,
  drops: ItemDropSystem,
  hit: ReturnType<typeof createVoxelRaycastBlockHit> | null,
  tool: ReturnType<ItemRegistry['toolFor']>,
  inventory: Inventory,
  chests: ChestContext,
): boolean {
  const blockDefBeforeBreak = hit !== null ? blockRegistry.get(hit.blockId) : null;
  const change = breakAndDrop(targets.store, blockRegistry, itemRegistry, drops, hit, Math.random, tool, chests);
  if (change === null) {
    return false;
  }
  if (blockDefBeforeBreak !== null) {
    applyToolWear(inventory, blockDefBeforeBreak, tool, itemRegistry);
  }
  commitBlockChange(change, targets);
  targets.events.emit({
    type: 'blockBreak',
    blockId: change.previous,
    position: { x: change.wx + 0.5, y: change.wy + 0.5, z: change.wz + 0.5 },
  });
  return true;
}

/**
 * Applies a pending place action (if any) against the current raycast hit,
 * remeshes any chunks whose mesh may have changed, and returns whether an
 * edit was made (see `applyBreak` for the re-raycast rationale).
 */
function applyPlace(
  targets: BlockEditTargets,
  inventory: Inventory,
  hit: ReturnType<typeof createVoxelRaycastBlockHit> | null,
  playerBox: ReturnType<typeof playerAabb>,
): boolean {
  const change = placeSelectedItem(targets.store, blockRegistry, itemRegistry, inventory, hit, playerBox);
  if (change === null) {
    return false;
  }
  commitBlockChange(change, targets);
  targets.events.emit({
    type: 'blockPlace',
    blockId: change.next,
    position: { x: change.wx + 0.5, y: change.wy + 0.5, z: change.wz + 0.5 },
  });
  return true;
}

/** Uniform unsigned 32-bit integer from the browser CSPRNG (new-world seeds). */
function randomUint32(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] ?? 0;
}

/** Resolves after the browser has had a chance to paint (bounded, so a hidden tab cannot stall startup). */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, 250);
    requestAnimationFrame(() => {
      window.setTimeout(() => {
        window.clearTimeout(timer);
        resolve();
      }, 0);
    });
  });
}

/** Shows a loading stage and lets it paint before the (synchronous) work of that stage starts. */
async function enterLoadingStage(loading: LoadingScreen, id: LoadingStageId): Promise<void> {
  const stage = LOADING_STAGES.find((candidate) => candidate.id === id);
  loading.setStage(stage?.label ?? '', loadingProgress(id));
  await nextPaint();
}

/**
 * Shows the title screen and resolves with the world the player chose. The
 * saved world is only cleared after the explicit "Replace" confirmation.
 */
function runTitleScreen(
  container: HTMLElement,
  settings: GameSettings,
  onSettingsChange: (next: GameSettings) => void,
  store: IndexedDbSaveStore | null,
  load: LoadSaveResult,
): Promise<WorldStartParams> {
  const saved = load.status === 'loaded' ? load.data.meta : null;
  const flow = new MenuFlow({
    status: storageStatusOf(store !== null, load),
    savedSeed: saved?.seed ?? null,
    clearSave: async () => {
      await store?.clear();
    },
    random: randomUint32,
    platform: classifyPlatform(readCapabilityInputs({ document, matchMedia: (q) => window.matchMedia(q) })),
  });
  return new Promise((resolve) => {
    const settingsScreen = new SettingsScreen(container, settings, onSettingsChange, () => settingsScreen.hide());
    const handle = (result: MenuFlowResult): void => {
      if (result.kind === 'start') {
        menu.dispose();
        settingsScreen.dispose();
        resolve(result.params);
      } else if (result.kind === 'error') {
        menu.setError(result.message);
        menu.setBusy(false);
        menu.showMain();
      } else if (flow.state === 'confirm-replace') {
        menu.showConfirm(flow.pendingNewSeed);
      }
    };
    const menu = new MainMenu(container, flow.model, flow.suggestedSeed, saved, {
      onContinue: () => handle(flow.continueWorld()),
      onNewWorld: (seedText) => handle(flow.newWorld(seedText)),
      onSettings: () => settingsScreen.show(),
      onTryAnyway: () => {
        flow.tryAnyway();
        menu.applyModel(flow.model);
      },
      onConfirmReplace: () => {
        menu.setError('');
        menu.setBusy(true);
        void flow.confirmReplace().then(handle);
      },
      onCancelReplace: () => {
        flow.cancelReplace();
        menu.showMain();
      },
    });
  });
}

/** Central error policy; see ErrorCoordinator for the fatal vs banner rule. */
const errors = new ErrorCoordinator(
  {
    showFatal: showFatalError,
    showBanner,
    log: (message, error) => console.error(message, error),
  },
  { userAgent: navigator.userAgent, buildMode: import.meta.env.MODE },
);

async function bootstrap(): Promise<void> {
  validateBlockTextures(blockRegistry, TILE_NAMES);

  const container = document.getElementById('app');
  if (!container) {
    throw new Error('App container not found');
  }

  let created: Awaited<ReturnType<typeof createRenderer>>;
  try {
    created = await createRenderer();
  } catch (error) {
    errors.fatal(error, 'renderer-init');
    return;
  }
  const { renderer, backend } = created;
  errors.setBackend(backend);
  console.info(`[renderer] using backend: ${backend}`);
  container.appendChild(renderer.domElement);

  const sceneWithLights = createScene();
  const scene = sceneWithLights.scene;
  const camera = createCamera(window.innerWidth / window.innerHeight);

  // Player preferences (localStorage, defaults when unavailable) drive the
  // camera FOV, look sensitivity and render distance; see applySettings below.
  let settings: GameSettings = loadSettings();

  // Graphics: internal resolution (pixel ratio) and fog; the frame-rate cap is read per frame.
  function applyResolution(): void {
    renderer.setPixelRatio(computePixelRatio(settings.resolutionScale, window.devicePixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  function applyGraphicsSettings(previous: GameSettings | null, next: GameSettings): void {
    if (previous === null || next.resolutionScale !== previous.resolutionScale) {
      applyResolution();
    }
    if (previous === null || next.fogEnabled !== previous.fogEnabled) {
      setFogEnabled(scene, sceneWithLights.fog, next.fogEnabled, next.renderDistance);
    }
  }
  applyGraphicsSettings(null, settings);

  // Audio: the sound engine only starts on the first user gesture (browser
  // autoplay policy) and everything stays silent if Web Audio is unavailable.
  const audio = new AudioSystem(volumesFromSettings(settings));
  const unlockAudio = (): void => {
    audio.unlock();
    if (audio.status !== 'locked') {
      window.removeEventListener('pointerdown', unlockAudio, true);
      window.removeEventListener('keydown', unlockAudio, true);
    }
    if (audio.status === 'unavailable') {
      errors.warn('audio-unavailable', 'Audio is unavailable in this browser; the game will be silent.');
    }
  };
  window.addEventListener('pointerdown', unlockAudio, true);
  window.addEventListener('keydown', unlockAudio, true);
  document.addEventListener('visibilitychange', () => audio.setHidden(document.hidden));
  window.addEventListener('pagehide', () => audio.dispose());
  const gameEvents = new GameEventQueue();

  // Read the save (if any) for the title screen. The world is built once, after
  // the player picks Continue or New world: the chosen seed drives generation
  // and a continued save chunk edits must be in place before the first chunk
  // is generated. A save that cannot be read blocks Continue; New world (after
  // a confirm) clears it, so it is never overwritten silently.
  const saveStore = await openSaveStore();
  if (saveStore === null) {
    errors.warn('save-unavailable', 'Saving is unavailable in this browser. Your progress will not be kept.');
  }
  const storedLoad = await loadSave(saveStore);
  if (storedLoad.status === 'blocked') {
    errors.warn('save-blocked', 'Your saved world could not be read, so saving is disabled for this session.');
  }
  const start = await runTitleScreen(
    container,
    settings,
    (next) => {
      const previous = settings;
      settings = clampSettings(next);
      applyGraphicsSettings(previous, settings);
      saveSettings(settings);
      audio.setVolumes(volumesFromSettings(settings));
    },
    saveStore,
    storedLoad,
  );
  const loading = new LoadingScreen(container);
  loading.show();
  await enterLoadingStage(loading, 'terrain');

  // A new world starts from an empty save (the store was cleared if needed).
  const loadResult: LoadSaveResult = start.newWorld ? { status: 'empty' } : storedLoad;
  const saved = loadResult.status === 'loaded' ? loadResult.data : null;
  const seed = start.seed;
  applyFov(camera, settings.fov);
  applyRenderDistanceToView(scene, camera, settings.renderDistance);
  let mobDistances = mobDistancesFor(settings.renderDistance);
  const blockEdits = new BlockEditStore();
  if (saved !== null) {
    blockEdits.restore(saved.chunks);
    console.info(
      `[save] loaded world (seed=${seed}, edited chunks=${blockEdits.chunkCount}, ` +
        `saved ${new Date(saved.meta.savedAt).toISOString()})`,
    );
  }

  const gameTime = new GameTime();
  const dayNightLighting = new DayNightLighting(sceneWithLights);

  const perfStats = new PerfStats();
  const worldGenerator = new WorldGenerator(seed);
  const chunkStore = new ChunkStore();
  const lightEngine = new LightEngine(chunkStore, blockRegistry);
  const chunkMeshRenderer = new ChunkMeshRenderer(scene);

  const spawn = computeSpawnPosition(worldGenerator);

  const chunkManager = new ChunkManager(
    chunkStore,
    worldGenerator,
    blockRegistry,
    chunkMeshRenderer,
    settings.renderDistance,
    undefined,
    lightEngine,
    blockEdits,
    perfStats,
    {
      service: createChunkGenerationService(worldGenerator, () =>
        errors.warn('chunk-worker', 'Chunk generation fell back to the main thread; the game may run slower.'),
      ),
      frameBudgetMs: CHUNK_STREAMING_CONFIG.frameBudgetMs,
      outerRing: CHUNK_STREAMING_CONFIG.outerRing,
    },
  );
  // Warm-up: synchronously generate the start chunk + its ring on the main
  // thread so there's solid ground (and a resolvable spawn height) before the
  // first frame; the rest of renderDistance streams in through the generation
  // worker via the per-frame budgeted update() below.
  // A loaded world resumes at the saved position; respawn still uses `spawn`.
  const startPosition = saved?.player.position ?? spawn.position;
  const spawnChunkStart = perfStats.now();
  chunkManager.warmUp(worldToChunkCoord(startPosition.x, startPosition.z));
  const spawnLoadStats = chunkManager.stats;
  console.info(
    `[chunks] initial spawn load time=${(perfStats.now() - spawnChunkStart).toFixed(2)}ms ` +
      `(chunks=${spawnLoadStats.chunksLoaded} generation=${spawnLoadStats.generationMs.toFixed(2)}ms ` +
      `light=${spawnLoadStats.lightMs.toFixed(2)}ms)`,
  );

  const editMeshBuffers = new MeshBuffers();
  const isSolid = createSolidQuery(chunkStore, blockRegistry);
  const isTargetable = createTargetQuery(chunkStore, blockRegistry);
  const isFluid = createFluidQuery(chunkStore, blockRegistry);

  // Spawn chunk is loaded above, so lift a new world's spawn out of any
  // generated tree/overhang (a saved position is restored as-is by applySave).
  const spawnFeetY = saved === null ? resolveSpawnHeight(chunkStore, blockRegistry, spawn.position) : startPosition.y;
  const playerState = createPlayerState({ ...startPosition, y: spawnFeetY }, spawn.pitch);
  const input = new InputController(renderer.domElement as HTMLCanvasElement);
  const crosshair = new Crosshair(container);
  const blockOutline = new BlockOutline(scene);
  const breakProgress = new BreakProgress();
  const eatProgress = new EatProgress();
  const playerHealth = new PlayerHealth();
  const playerHunger = new PlayerHunger();
  const survivalTicker = new SurvivalTicker();
  const fallTracker = new FallTracker();
  const movementEvents = new MovementEventTracker(gameEvents);
  const eatEvents = new EatEventTracker(gameEvents);
  const mobIdleEvents = new MobIdleEventTimer(gameEvents, Math.random);
  const healthHud = new HealthHud(container);
  const hungerHud = new HungerHud(container);
  const deathScreen = new DeathScreen(container);
  const debugOverlay = new DebugOverlay(container);
  const fpsCounter = new FpsCounter(container);
  fpsCounter.setVisible(settings.showFpsCounter);

  const inventory = new Inventory();
  if (saved === null) {
    giveStartingItems(inventory);
  }
  const hotbarHud = new HotbarHud(container, itemRegistry, blockRegistry);

  // Crafting grids are created once and reused across screen opens; only the
  // ContainerSession wrapping them is recreated per open (cheap, stateless
  // besides the held cursor).
  const craftingGrid2x2 = new CraftingGrid(2, 2);
  const craftingGrid3x3 = new CraftingGrid(3, 3);
  const inventoryScreen = new InventoryScreen(container, itemRegistry, blockRegistry);

  const drops = new ItemDropSystem();
  // Chest contents live outside the chunk arrays and are not dropped on chunk
  // unload; they are persisted with the save.
  const chestContext: ChestContext = {
    chests: new ChestStore(),
    worldSeed: seed,
    lootTableAt: (x, y, z) => worldGenerator.structureLootTableAt(x, y, z),
  };
  const blockEditTargets: BlockEditTargets = {
    store: chunkStore,
    light: lightEngine,
    chunkMeshRenderer,
    meshBuffers: editMeshBuffers,
    edits: blockEdits,
    probe: perfStats,
    events: gameEvents,
  };

  const saveState: GameSaveState = {
    seed,
    gameTime,
    player: playerState,
    health: playerHealth,
    hunger: playerHunger,
    inventory,
    chests: chestContext.chests,
  };
  if (saved !== null) {
    applySave(saved, saveState);
  }
  let lastHealth = playerHealth.health;
  const worldSaver = createWorldSaver(saveStore, loadResult, saveState, blockEdits);
  let saveFailing = false;
  const saveScheduler =
    worldSaver === null
      ? null
      : new SaveScheduler(
          SAVE_CONFIG.autosaveIntervalSeconds,
          // A successful save clears the failure flag, so a later frame failure flushes again.
          () =>
            worldSaver.save().then(() => {
              saveFailing = false;
            }),
          () => worldSaver.isDirty(),
          (error: unknown) => {
            saveFailing = true;
            console.warn('[save] saving the world failed; will retry.', error);
            errors.warn('save-failed', 'Saving the world failed. The game will keep retrying.');
          },
        );
  if (saveScheduler !== null) {
    // Flush when the tab is hidden or the page goes away; the snapshot and the
    // IndexedDB requests are issued synchronously inside the handler.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        saveScheduler.flush();
      }
    });
    window.addEventListener('pagehide', () => saveScheduler.flush());
  }
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
  const mobRng = mulberry32(seed + MOB_RNG_SEED_OFFSET);

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
    applyResolution();
  }
  window.addEventListener('resize', onWindowResize);

  /** Drops a leftover stack (couldn't fit back into the inventory on close) at the player's current eye position. */
  function dropLeftoverAtEye(stack: ItemStack): void {
    const eye = eyePosition(playerState, PLAYER_CONFIG);
    drops.spawn(stack, eye);
  }

  const pauseController = new PauseController();
  /** Asks for pointer lock (from a user gesture) without flashing the pause menu while it is acquired. */
  function requestGameLock(): void {
    // A refused request (e.g. the user just pressed Esc) leaves the pause menu up.
    const result = requestLockSafely(renderer.domElement);
    if (result === 'unsupported') {
      pauseMenu.setStatus(POINTER_LOCK_UNSUPPORTED_MESSAGE, 'error');
      return;
    }
    if (result === 'failed') {
      pauseMenu.setStatus(POINTER_LOCK_FAILED_MESSAGE, 'error');
      return;
    }
    pauseController.expectLock();
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
    gameEvents.emit({ type: 'chestOpen' });
  }

  function closeInventoryScreen(): void {
    openChestPos = null;
    inventoryScreen.close(dropLeftoverAtEye);
    // Keydown is a user gesture, so re-requesting the lock here is allowed;
    // if it is refused (e.g. focus was lost) the pause menu simply appears
    // once the grace window ends; no error surfaces.
    requestGameLock();
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
    gameEvents.emit({ type: 'playerDeath' });
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
    movementEvents.reset();

    chunkManager.warmUp(worldToChunkCoord(spawn.position.x, spawn.position.z));

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
    requestGameLock();
  }
  deathScreen.onRespawn(respawn);

  // Settings are applied live and persisted on every change. Render distance
  // re-derives fog, camera far plane and mob spawn/despawn distances, and
  // resizes the chunk streaming area (new chunks stream in over time).
  function applySettings(next: GameSettings): void {
    const previous = settings;
    settings = next;
    if (next.fov !== previous.fov) {
      applyFov(camera, next.fov);
    }
    if (next.renderDistance !== previous.renderDistance) {
      chunkManager.setRadius(next.renderDistance);
      applyRenderDistanceToView(scene, camera, next.renderDistance);
      mobDistances = mobDistancesFor(next.renderDistance);
    }
    applyGraphicsSettings(previous, next);
    fpsCounter.setVisible(next.showFpsCounter);
    audio.setVolumes(volumesFromSettings(next));
    saveSettings(next);
  }

  let settingsOpen = false;
  const settingsScreen = new SettingsScreen(
    container,
    settings,
    (next) => applySettings(clampSettings(next)),
    () => {
      settingsOpen = false;
    },
  );
  const saveDisabledReason: string | null =
    saveScheduler !== null ? null : 'Saving is unavailable: browser storage is blocked.';
  let quitWarned = false;
  const pauseMenu = new PauseMenu(container, {
    onResume: requestGameLock,
    onSettings: () => {
      settingsOpen = true;
    },
    onSave: () => {
      if (saveScheduler === null) {
        return;
      }
      pauseMenu.setSaveBusy(true);
      pauseMenu.setStatus('Saving...', 'info');
      void saveScheduler.flushAndWait().then((succeeded) => {
        pauseMenu.setSaveBusy(false);
        if (succeeded) {
          pauseMenu.setStatus('Saved', 'ok');
        } else {
          pauseMenu.setStatus('Saving failed; it will retry automatically.', 'error');
        }
      });
    },
    onQuit: () => {
      const step = nextQuitStep(saveScheduler !== null, quitWarned);
      if (step === 'warn') {
        quitWarned = true;
        pauseMenu.setStatus('Progress will not be saved. Click again to quit anyway.', 'error');
      } else if (step === 'quit' || saveScheduler === null) {
        location.reload();
      } else {
        pauseMenu.setSaveBusy(true);
        pauseMenu.setStatus('Saving...', 'info');
        void saveScheduler.flushAndWait().then((succeeded) => {
          if (succeeded) {
            pauseMenu.setStatus('Saved. Returning to title...', 'ok');
            location.reload();
          } else {
            pauseMenu.setSaveBusy(false);
            pauseMenu.setStatus('Saving failed, so the game was not closed. Try again.', 'error');
          }
        });
      }
    },
  });
  pauseMenu.setSaveAvailability(saveDisabledReason);
  let wasPaused = false;
  let menuShowsStart: boolean | null = null;

  // Compile every visible material (chunks, sky, lights) and the block
  // outline before the first frame, so the shader/pipeline stalls happen
  // during startup rather than in-game (e.g. on the first targeted block).
  // Only a warm-up: a failure must not stop the game from starting.
  await enterLoadingStage(loading, 'shaders');
  try {
    await blockOutline.precompile(() => renderer.compileAsync(scene, camera));
  } catch (error) {
    console.warn('[renderer] material precompile failed; shaders will compile on first use.', error);
  }

  await enterLoadingStage(loading, 'first-frame');
  let loadingHidden = false;

  const onFrameFailure = (error: unknown): void => {
    try {
      renderer.setAnimationLoop(null);
    } catch {
      // Stopping is best effort; the guard already ignores further frames.
    }
    try {
      if (saveScheduler !== null && !saveFailing) {
        saveScheduler.flush();
      }
    } catch {
      // Best-effort save; never throw from the error path.
    }
    errors.fatal(error, 'frame');
  };

  // The animation callback runs at the display rate. The frame-rate cap skips
  // whole frames (nothing simulated or drawn); a rendered frame's dt is the
  // real time since the previous rendered one, so the simulation stays correct.
  const frameLimiter = new FrameLimiter();
  renderer.setAnimationLoop(guardFrame((timestamp) => {
    timer.update(timestamp);
    const step = frameLimiter.step(timer.getDelta(), settings.frameRateCap);
    if (!step.render) {
      return;
    }
    perfStats.markFrame();
    const frameDt = step.dt;

    // Paused (unlocked with no other screen owning the cursor) freezes the
    // simulation: every dt below is 0 and the player/mob/drop steps are skipped.
    // Rendering, chunk streaming and the UI keep running.
    const paused = pauseController.update(frameDt, {
      locked: input.isLocked(),
      screenOpen: inventoryScreen.isOpen,
      dead: playerHealth.isDead,
    });
    const dt = simulationDt(paused, frameDt);

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
    applyLookSensitivity(sampled, settings);
    if (!playerHealth.isDead && !paused) {
      // Sprint gate: low hunger forces sprint off before physics/activity
      // tracking see it (playerPhysics itself is untouched).
      if (!playerHunger.canSprint()) {
        sampled.sprint = false;
      }
      const isMoving = sampled.forward !== 0 || sampled.right !== 0;
      const sprinting = sampled.sprint && isMoving;
      const jumped = sampled.jump && playerState.onGround;

      const velocityYBefore = playerState.velocity.y;
      stepPlayer(playerState, sampled, dt, isSolid);

      const feetInFluid = isFluid(
        Math.floor(playerState.position.x),
        Math.floor(playerState.position.y),
        Math.floor(playerState.position.z),
      );
      movementEvents.update({
        x: playerState.position.x,
        z: playerState.position.z,
        onGround: playerState.onGround,
        crouching: playerState.crouching,
        sprinting,
        inFluid: feetInFluid,
        velocityYBefore,
        jumped,
        surfaceBlockId: chunkStore.getBlock(
          Math.floor(playerState.position.x),
          Math.floor(playerState.position.y - AUDIO_CONFIG.surfaceProbeDepth),
          Math.floor(playerState.position.z),
        ),
      });
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
    if (uiInput.toggleDebug) {
      debugOverlay.toggle();
    }
    if (playerHealth.isDead) {
      // Death already closed the inventory screen in handleDeath(); ignore
      // further toggle/close latches while dead so they don't reopen it.
    } else if (paused) {
      // The pause menu owns input: Esc goes back from settings, or resumes.
      if (uiInput.close) {
        if (settingsOpen) {
          settingsOpen = false;
        } else {
          requestGameLock();
        }
      }
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

    // One overlay at a time: the pause menu / settings screen exist only while
    // paused, which excludes the inventory and death screens by construction.
    if (paused && !wasPaused) {
      settingsOpen = false;
      quitWarned = false;
      pauseMenu.setStatus(saveDisabledReason ?? '', saveDisabledReason === null ? 'info' : 'error');
    }
    wasPaused = paused;
    if (!paused) {
      settingsOpen = false;
    }
    const startScreen = pauseController.isStartScreen;
    if (startScreen !== menuShowsStart) {
      menuShowsStart = startScreen;
      pauseMenu.setMode(startScreen ? 'start' : 'paused');
    }
    const showMenu = paused && !settingsOpen;
    const showSettings = paused && settingsOpen;
    if (showMenu !== pauseMenu.visible) {
      if (showMenu) {
        pauseMenu.show();
      } else {
        pauseMenu.hide();
      }
    }
    if (showSettings !== settingsScreen.visible) {
      if (showSettings) {
        settingsScreen.show();
      } else {
        settingsScreen.hide();
      }
    }

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

    if (!inventoryScreen.isOpen && !playerHealth.isDead && !paused) {
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
            const mobPosition = { ...target.position };
            const attack = performMobAttack(target, rayOrigin, tool, entityStore, drops, inventory, itemRegistry, mobRng);
            if (attack.applied) {
              gameEvents.emit({
                type: attack.killed ? 'mobDeath' : 'mobHurt',
                mobType: target.type,
                position: mobPosition,
              });
            }
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

        eatEvents.update(eatState, dt);
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
            blockEditTargets,
            drops,
            hit,
            tool,
            inventory,
            chestContext,
          );
        } else if (actions.placePressed && selectedFood === undefined && !attacking) {
          edited = applyPlace(
            blockEditTargets,
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
      eatEvents.update('idle', dt);
      crosshair.setProgress(0);
    }

    if (!paused) {
      drops.update(dt, isSolid, isColumnLoaded);
      if (drops.collect(playerAabb(playerState), inventory) > 0) {
        gameEvents.emit({ type: 'pickup' });
      }
    }
    itemDropRenderer.update(drops.drops());

    // Mobs keep simulating/rendering even while the player is dead (only
    // player movement/actions are frozen above).
    if (!paused) {
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
        distances: mobDistances,
      });
    }
    mobRenderer.update(entityStore.all(), dt);
    if (!paused) {
      mobIdleEvents.update(dt, entityStore.all(), playerState.position);
    }

    // Sound: a health drop (any source) is a hurt cry; death has its own event.
    if (playerHealth.health < lastHealth && !playerHealth.isDead) {
      gameEvents.emit({ type: 'playerHurt' });
    }
    lastHealth = playerHealth.health;
    audio.setPaused(paused);
    audio.setListener(rayOrigin.x, rayOrigin.y, rayOrigin.z, playerState.yaw);
    gameEvents.drain((event) => audio.play(event));
    audio.updateAmbient(
      frameDt,
      daylightFactor(gameTime.timeOfDay, DAY_NIGHT_CONFIG),
      getSkyLight(chunkStore, Math.floor(rayOrigin.x), Math.floor(rayOrigin.y), Math.floor(rayOrigin.z)),
    );

    blockOutline.update(hit);
    hotbarHud.update(inventory, !paused && !playerHealth.isDead);

    saveScheduler?.update(dt);
    fpsCounter.update(perfStats.now(), () => perfStats.snapshot().fps);

    renderer.render(scene, camera);
    if (!loadingHidden) {
      // First frame is on screen: the world is ready and the pause menu (Click to play) takes over.
      loadingHidden = true;
      loading.hide();
      errors.markFirstFrame();
    }

    // Read renderer.info *after* render(): its per-frame counters are reset by
    // the animation loop before this callback runs.
    debugOverlay.update(perfStats.now(), (): DebugSnapshot => ({
      backend,
      perf: perfStats.snapshot(),
      renderer: readRendererStats(renderer.info),
      jsHeapMb: readJsHeapMb(),
      chunksLoaded: chunkStore.size,
      chunkStreaming: chunkManager.streaming,
      mobCount: entityStore.count(),
      position: playerState.position,
      chunk: worldToChunkCoord(playerState.position.x, playerState.position.z),
      renderDistance: settings.renderDistance,
      resolution: {
        width: renderer.domElement.width,
        height: renderer.domElement.height,
        pixelRatio: renderer.getPixelRatio(),
        scalePercent: settings.resolutionScale,
      },
    }));
  }, onFrameFailure));
}

// Uncaught errors / rejections: fatal before the first frame, banner afterwards (see ErrorCoordinator).
window.addEventListener('error', (event) => {
  if (isBenignWindowMessage(event.message)) {
    return;
  }
  errors.late(event.error ?? event.message);
});
window.addEventListener('unhandledrejection', (event) => errors.late(event.reason));

bootstrap().catch((error: unknown) => errors.fatal(error, 'bootstrap'));
