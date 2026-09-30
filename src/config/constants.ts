export const WORLD_CONFIG = {
  blockSize: 1,
  chunkWidth: 16,
  chunkDepth: 16,
  chunkHeight: 128,
  renderDistance: 8,
  simulationDistance: 6,
  seaLevel: 32,
} as const;

const HEIGHT = 1.8;
const CROUCH_HEIGHT_RATIO = 0.7;
const EYE_HEIGHT_RATIO = 0.9;

export const PLAYER_CONFIG = {
  height: HEIGHT,
  /** Standing collision height (voxel AABB); crouching uses crouchHeight instead. */
  crouchHeight: HEIGHT * CROUCH_HEIGHT_RATIO,
  /** Full collision AABB width/depth (horizontal extent), centered on the player. */
  width: 0.6,
  walkSpeed: 4.3,
  sprintSpeed: 6.5,
  crouchSpeed: 2.2,
  jumpVelocity: 5,
  gravity: 18,
  /** Largest downward speed gravity can accelerate the player to (m/s), terminal velocity. */
  maxFallSpeed: 40,
  interactionDistance: 6,
  fov: 75,
  /** Eye height while standing, derived from player height. */
  eyeHeight: HEIGHT * EYE_HEIGHT_RATIO,
  /** Eye height while crouching (also reduces standing height). */
  crouchEyeHeight: HEIGHT * CROUCH_HEIGHT_RATIO * EYE_HEIGHT_RATIO,
  /** Radians of camera rotation per pixel of mouse movement. */
  mouseSensitivity: 0.0022,
  /** Epsilon kept away from +-PI/2 so the camera never flips at the poles. */
  pitchEpsilon: 0.001,
  /** Largest dt (seconds) fed to physics in one step, avoids tunneling after a stalled tab. */
  maxFrameDelta: 0.1,
  /** Skin gap kept between the player AABB and a colliding block face. */
  collisionEpsilon: 1e-4,
  /** Largest distance (blocks) any single collision substep may move on an axis. */
  maxSubstepDistance: 0.5,
  /** Probe distance below the feet used to detect resting-on-ground when velocity.y is 0. */
  groundProbeDistance: 0.05,
  /** Initial look pitch (radians) at spawn; slightly downward so a block sits under the crosshair. */
  spawnPitch: -0.5,
} as const;

/**
 * Player-adjustable settings (see src/settings): allowed ranges and the
 * localStorage key. Defaults come from PLAYER_CONFIG / WORLD_CONFIG.
 */
export const SETTINGS_CONFIG = {
  /** Versioned localStorage key; bump the suffix when the stored shape changes. */
  storageKey: 'blockora.settings.v1',
  fov: { min: 60, max: 110, step: 1 },
  /** Multiplier applied to PLAYER_CONFIG.mouseSensitivity (1 = the base value). */
  mouseSensitivity: { min: 0.25, max: 3, step: 0.05 },
  /** Rendered radius in chunks. */
  renderDistance: { min: 2, max: 12, step: 1 },
  /** Audio volumes, percent (0 = silent, 100 = full). */
  volume: { min: 0, max: 100, step: 1 },
  defaultMasterVolume: 80,
  defaultEffectsVolume: 100,
  defaultAmbientVolume: 60,
  /** Internal render resolution as a percent of the native (capped) pixel ratio. */
  resolutionScale: { min: 50, max: 100, step: 5 },
  defaultResolutionScale: 100,
  defaultFogEnabled: true,
  /** Selectable frame-rate caps in fps; 0 = unlimited (display refresh / vsync). */
  frameRateCaps: [0, 60, 30] as readonly number[],
  defaultFrameRateCap: 0,
} as const;

export const GRAPHICS_CONFIG = {
  /** The device pixel ratio is capped here before the resolution scale is applied. */
  maxPixelRatio: 2,
  /** The effective pixel ratio never drops below this. */
  minPixelRatio: 0.25,
  /** A frame renders when its time credit is within this many seconds of one cap interval (absorbs vsync jitter). */
  frameCapToleranceSeconds: 0.002,
} as const;

export const PAUSE_CONFIG = {
  /** Seconds after the game requests pointer lock during which being unlocked does not pause (lock is acquired asynchronously). */
  lockGraceSeconds: 0.75,
} as const;

export const RENDER_CONFIG = {
  skyColor: 0x87ceeb,
  fogNearChunks: 0.5,
  fogFarChunks: 1,
  cameraNear: 0.1,
  cameraFarChunks: 2,
  hemisphereSkyColor: 0xa6d8ff,
  hemisphereGroundColor: 0x4d6b3d,
  hemisphereIntensity: 0.9,
  directionalLightColor: 0xfff2d0,
  directionalLightIntensity: 1.6,
  directionalLightPosition: [50, 80, 30] as const,
  chunkTransparentOpacity: 0.6,
  /** Alpha-test cutoff for cutout transparency (leaves holes, glass frame vs pane). */
  chunkAlphaTest: 0.05,
  /** Color of the targeted-block outline wireframe. */
  blockOutlineColor: 0x000000,
  /** Outward padding (world units) added to the outline box so it doesn't z-fight the block. */
  blockOutlinePadding: 0.002,
} as const;

/**
 * Baked voxel light shading for chunk meshes (unlit node material; see
 * src/renderer/lightShading.ts). Levels are 0..15 (MAX_LIGHT).
 */
export const LIGHT_RENDER_CONFIG = {
  /** Brightness at light level 0 (caves never go fully black). */
  minBrightness: 0.06,
  /** Exponent applied to level/15; > 1 darkens mid levels (gamma-like falloff). */
  gamma: 1.6,
  /** Sky light multiplier at full night (daylight 0); lerps to 1 at full day (moonlight). */
  nightSkyScale: 0.3,
  /** Per-face directional shade so blocks keep depth without scene lights. */
  faceShadeTop: 1.0,
  faceShadeSideX: 0.8,
  faceShadeSideZ: 0.6,
  faceShadeBottom: 0.5,
} as const;

export const DAY_NIGHT_CONFIG = {
  /** Seconds of in-game daylight per full cycle (CLAUDE.md: 15 minute day). */
  dayLengthSeconds: 900,
  /** Seconds of in-game night per full cycle (CLAUDE.md: 5 minute night). */
  nightLengthSeconds: 300,
  /** timeOfDay at game start (fraction of the full day+night cycle); ~0.05 = just past dawn. */
  startTimeOfDay: 0.05,
  /** Width (fraction of the full cycle) of the smooth dawn/dusk blend on each side of sunrise/sunset. */
  transitionWidth: 0.03,
  /** Sky color at midnight. */
  nightSkyColor: 0x0a1030,
  /** Sky color at midday. */
  daySkyColor: 0x87ceeb,
  /** Warm tint blended in briefly around sunrise/sunset. */
  sunsetSkyColor: 0xff9955,
  /** Minimum directional (sun) light intensity, used at midnight. */
  sunIntensityNight: 0,
  /** Maximum directional (sun) light intensity, used at midday. */
  sunIntensityDay: 1.6,
  /** Minimum hemisphere ambient intensity at midnight; kept above 0 so the world stays visible with no block lighting yet. */
  ambientIntensityNight: 0.25,
  /** Maximum hemisphere ambient intensity at midday. */
  ambientIntensityDay: 0.9,
  /** Radius (world units) of the sun's orbit arc around the followed position. */
  sunOrbitRadius: 200,
} as const;

export const WORLD_GEN_CONFIG = {
  /** Default world seed used when none is supplied (e.g. quick-start / tests). */
  defaultSeed: 1,
  /** Column height (blocks) the height noise oscillates around. */
  baseHeight: 40,
  /** Max deviation (blocks) the height noise can add/subtract from baseHeight. */
  heightAmplitude: 20,
  heightNoise: {
    octaves: 4,
    frequency: 1 / 96,
    amplitude: 1,
    lacunarity: 2,
    persistence: 0.5,
  },
  /** Max deviation (blocks) the small-scale detail noise adds on top of the height noise. */
  detailAmplitude: 3,
  detailNoise: {
    octaves: 2,
    frequency: 1 / 12,
    amplitude: 1,
    lacunarity: 2,
    persistence: 0.5,
  },
  /** Topsoil (grass/sand) thickness in blocks below the surface. */
  surfaceDepth: 1,
  /** Subsoil (dirt) thickness in blocks below the topsoil, before solid stone. */
  subsoilDepth: 3,
  /** Low-frequency noise driving biome temperature/moisture; spans many chunks per biome region. */
  biomeNoise: {
    octaves: 3,
    frequency: 1 / 384,
    amplitude: 1,
    lacunarity: 2,
    persistence: 0.5,
  },
  /** Whittaker-style thresholds (on [0, 1) temperature/moisture noise) picking a biome. */
  biomeThresholds: {
    coldThreshold: 0.35,
    hotThreshold: 0.65,
    wetThreshold: 0.5,
  },
  /** 3D noise carving cave air pockets out of deep stone; higher frequency = smaller/more frequent pockets. */
  caveNoise: {
    octaves: 2,
    frequency: 1 / 16,
    amplitude: 1,
    lacunarity: 2,
    persistence: 0.5,
  },
  /** Noise value must be >= this for a deep-stone block to become cave air; higher = rarer/smaller caves. */
  caveThreshold: 0.78,
  /** Caves never carve within this many blocks of the surface (keeps topsoil/subsoil intact, no breaches). */
  caveSurfaceMargin: 6,
} as const;

/**
 * Deterministic structure placement (see src/world/structure). The world is
 * split into square regions of `regionSizeChunks` chunks; each region holds at
 * most one structure candidate at a hashed position, accepted with
 * `spawnChance` and then validated against the pure terrain queries.
 */
export const STRUCTURE_CONFIG = {
  /** Region edge length in chunks; one structure candidate per region. */
  regionSizeChunks: 6,
  /** Chance (0..1) a region's candidate is attempted at all (before site validation). */
  spawnChance: 0.35,
  /** Site is rejected when any footprint column's surface is below seaLevel + this (keeps ruins off water and beaches). */
  minSurfaceAboveSeaLevel: 2,
  /** Site is rejected when the footprint's surface height range (max - min) exceeds this (too steep). */
  maxSlope: 3,
  /** Deepest foundation fill (blocks) below the structure floor; must be >= maxSlope so a valid site never floats. */
  maxFoundationDepth: 4,
  /**
   * Underground templates (dungeons). The shallowest allowed floor puts the
   * room's top layer `ceilingBelowSurface` blocks under the footprint's lowest
   * surface column (below topsoil + subsoil, so the shell sits in stone and
   * never breaches the surface); the floor is then hashed up to `depthRange`
   * blocks deeper, never below `minFloorY`.
   */
  underground: {
    ceilingBelowSurface: 6,
    minFloorY: 5,
    depthRange: 12,
    /** Every footprint column's surface must be >= seaLevel + this (0 = no water above; rooms under open water would be unreachable without swimming). */
    minSurfaceAboveSeaLevel: 0,
  },
  /**
   * Villages (composite surface structures, see structure/villageLayout.ts):
   * a centrepiece (well) plus minHouses..maxHouses houses on slots around it,
   * each door facing the centre, joined to the centre by 1-wide gravel paths.
   * Piece and path columns reuse minSurfaceAboveSeaLevel (no water).
   */
  village: {
    /**
     * Fraction (0..1) of accepted region candidates that try a village first;
     * a rejected village site falls back to the region's ruin/dungeon pick,
     * so villages only replace ruins/dungeons where they actually fit.
     */
    share: 0.6,
    minHouses: 3,
    maxHouses: 5,
    /** Distance (blocks) from the village centre to a house centre on the four axis slots. */
    axisSlotDistance: 13,
    /** Per-axis offset (blocks) of the four diagonal house slots from the centre (< axisSlotDistance - house reach, so diagonal paths pass beside axis houses). */
    diagonalSlotOffset: 9,
    /** Surface height range allowed across each piece footprint (stricter than maxSlope). */
    maxPieceSlope: 2,
    /** Surface height range allowed across all piece footprints of the village together. */
    maxAreaSlope: 5,
  },
} as const;

export const ATLAS_CONFIG = {
  /** Pixel size (width and height) of one square tile in the atlas. */
  tileSize: 16,
  /** Number of tile columns; rows are derived from tile count. */
  columns: 8,
  /** Fractional inset (in UV units of a single tile) kept from each tile edge to avoid bleeding. */
  uvInset: 0.02,
  /** PRNG seed for deterministic procedural tile art. */
  seed: 1337,
} as const;

export const INVENTORY_CONFIG = {
  maxStackSize: 64,
  inventorySlots: 36,
  hotbarSlots: 9,
} as const;

export const CHEST_CONFIG = {
  /** Slots per chest container. */
  slots: 27,
  /** Chest positions must satisfy |x|, |z| < this (see ChestStore key packing). */
  maxHorizontalCoord: 1_048_576,
} as const;

export const SAVE_CONFIG = {
  /** IndexedDB database holding the single world save. */
  databaseName: 'blockora',
  /** IndexedDB schema version (object stores); independent of the save format version. */
  databaseVersion: 1,
  /** Seconds between autosave checks; a save is written only when something changed. */
  autosaveIntervalSeconds: 10,
  /**
   * Give up opening IndexedDB after this long (ms) and run without saving.
   * Generous on purpose: a cold first open can take seconds, and a false
   * timeout hides an existing save (title shows "Saving unavailable").
   */
  openTimeoutMs: 10_000,
} as const;

export const TOOL_CONFIG = {
  /** Numeric tool tiers; higher tiers are strictly better (durability/speed progression). */
  tiers: {
    wood: 1,
    stone: 2,
  },
  /** Break-speed multiplier per tier, keyed the same as `tiers`. */
  speed: {
    wood: 2,
    stone: 4,
  },
  /** Max durability (uses before breaking) per tier, keyed the same as `tiers`. */
  durability: {
    wood: 64,
    stone: 128,
  },
} as const;

export const BREAK_CONFIG = {
  /** Multiplier applied to hardness when the block can be harvested (correct tool type). */
  harvestMultiplier: 1.5,
  /** Multiplier applied to hardness when breaking without the correct tool (still breaks, no drop for requiresTool blocks). */
  noHarvestMultiplier: 5,
} as const;

export const SURVIVAL_CONFIG = {
  maxHealth: 20,
  /** Seconds of damage immunity granted after taking non-void damage. */
  damageInvulnerability: 0.5,
  /** Fall distance (blocks) below which no fall damage is taken. */
  safeFallDistance: 3,
  /** Fall damage (health points) per block fallen beyond safeFallDistance. */
  fallDamagePerBlock: 1,
  /** Feet Y below which the player takes void damage (fell out of the world). */
  voidY: -16,
  /** Void damage per second, applied continuously (bypasses invulnerability); large enough to kill fast. */
  voidDamagePerSecond: 20,
  /** Hunger points, 0..maxHunger (half-drumsticks = 1 point, like health's half-hearts). */
  maxHunger: 20,
  /** Exhaustion points that convert into 1 lost hunger point (see `PlayerHunger.addExhaustion`). */
  exhaustionPerHungerPoint: 4,
  /** Exhaustion added per second while alive and not sprinting (idle/walking baseline drain). */
  idleExhaustionPerSecond: 0.005,
  /** Exhaustion added per second while sprinting (on top of idle drain). */
  sprintExhaustionPerSecond: 0.1,
  /** Exhaustion added for each jump. */
  jumpExhaustion: 0.05,
  /** Regeneration only runs while hunger is at or above this many points. */
  regenHungerThreshold: 18,
  /** Seconds between each regeneration tick. */
  regenInterval: 4,
  /** Exhaustion added per health point regenerated. */
  regenExhaustion: 1.5,
  /** Seconds between each starvation damage tick (only while hunger is at 0). */
  starvationInterval: 4,
  /** Starvation never reduces health below this floor (starvation alone never kills). */
  starvationMinHealth: 1,
  /** Sprinting is disabled at or below this many hunger points. */
  sprintMinHunger: 6,
  /** Seconds of holding "use" on a selected food item required to eat it. */
  eatDuration: 1.6,
  /** Chance (0..1) that breaking a Leaves block drops an Apple. */
  appleDropChance: 0.05,
} as const;

export const MOB_CONFIG = {
  /** Seconds between each attempted passive-mob spawn wave. */
  spawnInterval: 5,
  /** Max spawn attempts per wave (each attempt may fail its column checks). */
  spawnAttemptsPerWave: 4,
  /** Mobs never spawn closer than this to the player (blocks). */
  minSpawnDistance: 24,
  /** Mobs never spawn farther than this from the player (blocks); should stay within render distance. */
  maxSpawnDistance: WORLD_CONFIG.renderDistance * WORLD_CONFIG.chunkWidth - 16,
  /** Mobs despawn once farther than this from the player (blocks). */
  despawnDistance: WORLD_CONFIG.renderDistance * WORLD_CONFIG.chunkWidth,
  /** Global cap on simultaneously-alive passive mobs. */
  maxPassiveMobs: 12,
  /** Minimum sky light (0..15) a spawn column must have (keeps mobs out of dark caves). */
  minSpawnSkyLight: 10,
  /** Gravity applied to mobs (blocks/s^2); matches the player for consistent falling feel. */
  gravity: 18,
  /** Largest downward speed gravity can accelerate a mob to (blocks/s). */
  maxFallSpeed: 40,
  /** Horizontal velocity damping applied per second while a mob is on the ground. */
  groundFriction: 8,
  /** Radians/s the mob turns toward its target yaw while wandering. */
  turnSpeed: 3,
  /** A 1-block step ahead (auto-jump) needs at least this much upward jump velocity (rise = v^2/(2*gravity), tuned to clear 1 block with margin but not 2). */
  stepJumpVelocity: 6.5,
  /** Never wander toward a look-ahead cell that would drop more than this many blocks. */
  maxSafeDropAhead: 3,
  /** Global cap on simultaneously-alive hostile mobs (separate from maxPassiveMobs). */
  maxHostileMobs: 8,
  /** Hostile spawn attempts per spawn wave (each may fail its column/light checks). */
  hostileSpawnAttemptsPerWave: 4,
  /** Hostile mobs spawn only where effective light (max(sky x daylight scale, block)) is at or below this (0..15). */
  hostileMaxSpawnLight: 7,
  /** Cave spawn search: candidate feet-level y is picked within +-this many blocks of the player's feet. */
  hostileCaveSearchRange: 12,
  /** Cave spawn search: scan at most this many cells downward from the candidate y for a floor. */
  hostileCaveScanDepth: 8,
  /** Daylight factor (0..1) at or above which exposed hostile mobs start to despawn. */
  hostileDespawnDaylight: 0.7,
  /** A hostile mob is "exposed" (may despawn in daylight) when the sky light at its cell is at least this. */
  hostileDespawnSkyLight: 12,
  /** Per-second chance an exposed hostile mob despawns while it is daylight. */
  hostileDespawnChancePerSecond: 0.25,
} as const;

export const SHAMBLER_CONFIG = {
  halfWidth: 0.3,
  height: 1.8,
  /** Wander speed (blocks/s). */
  walkSpeed: 1,
  idleDurationMin: 1.5,
  idleDurationMax: 4,
  wanderDurationMin: 2,
  wanderDurationMax: 5,
  /** Unused by the passive spawner (hostiles spawn via their own light-gated path); kept for the definition shape. */
  spawnWeight: 0,
  /** Max shamblers alive at once (also bounded by MOB_CONFIG.maxHostileMobs). */
  maxPerArea: 8,
  maxHealth: 20,
  /** Hostile mobs never flee; these exist only to satisfy the shared definition shape. */
  fleeSpeed: 0,
  fleeDuration: 0,
  /** No drops yet (no new items in this slice). */
  drops: [] as readonly never[],
  /** Speed (blocks/s) while chasing the player. */
  chaseSpeed: 2,
  /** Radians/s a chasing/attacking mob turns to face the player (faster than wander turning). */
  chaseTurnSpeed: 8,
  /** Damage (health points, half-hearts) dealt per successful attack. */
  attackDamage: 3,
  /** Max HORIZONTAL centre-to-centre distance (blocks) between mob and player at which the mob can attack. */
  attackReach: 1.2,
  /** Max |player feet y - mob feet y| (blocks) at which the mob can attack. */
  attackVerticalReach: 1.5,
  /** Seconds between two attacks. */
  attackCooldown: 1,
  /** Seconds of wind-up after first getting into reach before the first strike. */
  attackWindup: 0.5,
  /** Idle/wander mobs start chasing a living player within this horizontal distance (blocks). */
  detectionRange: 16,
  /** A chasing mob gives up beyond this horizontal distance (blocks). */
  loseTargetRange: 24,
} as const;

export const PIG_CONFIG = {
  halfWidth: 0.45,
  height: 0.9,
  walkSpeed: 1.2,
  /** Seconds spent idle before picking a new wander target, min/max range. */
  idleDurationMin: 1.5,
  idleDurationMax: 4,
  /** Seconds spent wandering toward the current target yaw, min/max range. */
  wanderDurationMin: 2,
  wanderDurationMax: 5,
  /** Relative likelihood of spawning a Pig vs other passive mobs (future use). */
  spawnWeight: 1,
  /** Max pigs allowed per despawn-radius area (kept simple: a flat per-type share of maxPassiveMobs). */
  maxPerArea: 8,
  /** Hit points; killed when damage brings this to 0 (see `damageMob`). */
  maxHealth: 10,
  /** Speed (blocks/s) while fleeing an attacker; faster than the normal wander walkSpeed. */
  fleeSpeed: 2.4,
  /** Seconds spent in the 'flee' AI state after being hurt. */
  fleeDuration: 3,
  /** Item drops on death: `count` is rolled uniformly in [min, max] (inclusive) per entry, using the mob's own seeded RNG. */
  drops: [{ itemId: 26 /* ItemId.RawPork, kept numeric to avoid an import cycle */, min: 1, max: 3 }],
} as const;

export const COW_CONFIG = {
  halfWidth: 0.45,
  height: 1.3,
  /** Slow, placid wander speed (blocks/s). */
  walkSpeed: 0.9,
  idleDurationMin: 2,
  idleDurationMax: 5,
  wanderDurationMin: 2,
  wanderDurationMax: 5,
  /** Relative likelihood of spawning a Cow vs other passive mobs. */
  spawnWeight: 1,
  /** Max cows alive at once (also bounded by MOB_CONFIG.maxPassiveMobs, shared with every passive type). */
  maxPerArea: 6,
  maxHealth: 10,
  fleeSpeed: 2,
  fleeDuration: 3,
  /** Drops rolled uniformly in [min, max] per entry; itemId 27 = ItemId.RawBeef (numeric to avoid an import cycle). */
  drops: [{ itemId: 27, min: 1, max: 3 }],
} as const;

export const CHICKEN_CONFIG = {
  halfWidth: 0.2,
  height: 0.7,
  /** Quick, twitchy wander speed (blocks/s). */
  walkSpeed: 1.4,
  idleDurationMin: 0.8,
  idleDurationMax: 2.5,
  /** Short wanders. */
  wanderDurationMin: 0.8,
  wanderDurationMax: 2,
  /** Relative likelihood of spawning a Chicken vs other passive mobs. */
  spawnWeight: 1,
  /** Max chickens alive at once (also bounded by MOB_CONFIG.maxPassiveMobs, shared with every passive type). */
  maxPerArea: 6,
  maxHealth: 4,
  fleeSpeed: 2.6,
  fleeDuration: 2.5,
  /** Terminal downward speed (blocks/s) while airborne: chickens flutter down instead of dropping. Mobs take no fall damage. */
  maxFallSpeed: 2.5,
  /** Drops rolled uniformly in [min, max] per entry; itemId 28 = ItemId.RawChicken (numeric to avoid an import cycle). */
  drops: [{ itemId: 28, min: 1, max: 1 }],
} as const;

export const COMBAT_CONFIG = {
  /** Damage dealt by an empty-hand melee attack. */
  handDamage: 1,
  /**
   * Extra damage added to `handDamage` when attacking with a tool, keyed by
   * ToolType. A tool with no entry (or an unrecognised type) adds 0. Kept as
   * a flat table (no tier scaling yet) — see docs/PROGRESS.md for future work.
   */
  toolDamageBonus: {
    axe: 2,
    pickaxe: 1,
    shovel: 0,
  } as const,
  /** Seconds a player must wait between two melee attacks. */
  attackCooldown: 0.4,
  /**
   * Melee attack range (blocks). Equal to PLAYER_CONFIG.interactionDistance
   * so attack range matches the existing block-interaction reach exactly
   * (kept as its own constant so combat tuning doesn't accidentally move
   * block-break/place range too).
   */
  attackReach: 6,
  /** Horizontal speed (blocks/s) imparted to a mob's velocity on hit, directed away from the attacker. */
  knockbackHorizontalSpeed: 4,
  /** Vertical (upward) speed (blocks/s) imparted to a mob's velocity on hit. */
  knockbackVerticalSpeed: 3,
  /** Seconds of damage immunity granted to a mob after being hit. */
  hurtInvulnerability: 0.5,
  /** Seconds the hurt-flash render tint is shown after being hit (independent of, and no longer than, hurtInvulnerability). */
  hurtFlashDuration: 0.25,
  /** Max random yaw jitter (radians) added each flee-state tick so several hurt mobs don't all flee in lockstep. */
  fleeYawJitter: 0.6,
} as const;

export const ITEM_DROP_CONFIG = {
  /** Downward acceleration applied to falling drops (blocks/s^2). */
  gravity: 18,
  /** Half-extent of the drop's tiny collision cube (blocks); full size = 2x this. */
  halfSize: 0.125,
  /** Distance (blocks) a drop's (expanded) AABB may be from the player's AABB and still be collected. */
  pickupRadius: 1.0,
  /** Seconds before a block-break drop becomes collectible. */
  pickupDelay: 0.25,
  /** Seconds before a manually-thrown (Q) drop becomes collectible. */
  throwPickupDelay: 1.5,
  /** Seconds a drop exists before despawning if never collected. */
  lifetime: 300,
  /** Horizontal velocity damping applied per second while a drop rests on the ground. */
  groundFriction: 6,
  /** Horizontal speed imparted to a thrown drop, along the look direction. */
  throwSpeed: 4,
  /** Extra upward velocity imparted to a thrown drop. */
  throwUpSpeed: 2,
  /** Max random offset (blocks) applied per axis when a drop spawns, so stacked breaks don't perfectly overlap. */
  spawnJitter: 0.2,
  /** Visual spin speed of rendered drops (radians/s). */
  spinSpeed: 1.2,
  /** Visual bob amplitude (blocks) of rendered drops. */
  bobAmplitude: 0.06,
  /** Visual bob speed (radians/s). */
  bobSpeed: 2.4,
} as const;

/** F3 debug overlay / profiling (measure-only; no gameplay effect). */
/** Chunk streaming budgets (see ChunkManager). */
export const CHUNK_STREAMING_CONFIG = {
  /** Generated chunks accepted per ChunkManager.update (edits + light + mesh run on the main thread). */
  maxAcceptsPerUpdate: 4,
  /** Outstanding generation requests; bounds cancelled work and result latency. */
  maxInFlight: 8,
  /** Chebyshev radius (chunks) generated synchronously around the start / respawn point before play. */
  warmUpRadius: 1,
  /** Main-thread budget (ms) per ChunkManager.update for accepting results + meshing (always >= 1 accept and 1 mesh). */
  frameBudgetMs: 6,
  /** Chunk rings generated + lit beyond renderDistance but never meshed (avoids remeshing the edge row while walking). */
  outerRing: 1,
  /**
   * Unloaded chunks whose block arrays are kept for reuse (LRU; memory-only).
   * 256 chunks * 32,768 B (Uint8, 16x16x128) = 8 MiB, about 13 rows of the
   * default loaded area.
   */
  chunkCacheSize: 256,
} as const;

/** Renderable sections per chunk mesh (opaque + transparent), each its own geometry. */
const CHUNK_MESH_SECTIONS = 2;
/** Chunk columns inside the largest selectable rendered radius (SETTINGS_CONFIG). */
const RENDERED_CHUNKS = (2 * SETTINGS_CONFIG.renderDistance.max + 1) ** 2;

/**
 * Pooled chunk section geometries (see ChunkGeometryPool). three r186's WebGL2
 * backend never evicts a geometry's VAO, so geometries are reused instead of
 * disposed. Capacity classes grow from these minimums by `capacityGrowthRatio`
 * (1.25: ~20 % less memory than powers of two in a recorded walk, for ~5 %
 * more growth replacements).
 */
export const CHUNK_GEOMETRY_POOL_CONFIG = {
  minVertexCapacity: 1024,
  minIndexCapacity: 1536,
  capacityGrowthRatio: 1.25,
  capacityQuantum: 64,
  /**
   * Released geometries kept for reuse; beyond this they are disposed. One
   * full rendered area at the maximum selectable render distance, so even a
   * teleport (every chunk released, then re-meshed) or a large render-distance
   * shrink is absorbed without disposing. Only geometries actually released
   * are held; nothing is preallocated.
   */
  maxFreeGeometries: RENDERED_CHUNKS * CHUNK_MESH_SECTIONS,
} as const;

export const DEBUG_CONFIG = {
  /** Frames kept in the rolling FPS / frame-time window. */
  frameWindow: 120,
  /** Samples kept in the rolling chunk-generation / light / mesh time windows. */
  sampleWindow: 64,
  /** Overlay refresh rate (Hz); text is rebuilt this often, not every frame. */
  overlayUpdateHz: 4,
  /** Length (ms) of the per-second counter buckets. */
  counterPeriodMs: 1000,
} as const;

export const AUDIO_CONFIG = {
  /** Simultaneous sound voices; the oldest is stolen beyond this. */
  maxVoices: 16,
  /** Seconds of the shared white-noise buffer (generated once, reused with random start offsets). */
  noiseSeconds: 2,
  /** Distance (blocks) up to which a positional sound is at full level. */
  referenceDistance: 2,
  /** Distance (blocks) beyond which a positional sound is inaudible (and skipped). */
  maxHearingDistance: 24,
  /** Extra level factor for a sound directly behind the listener (0..1; 1 = none). */
  behindGain: 0.8,
  /** How far below the feet (blocks) the surface block is probed for footstep / jump / land sounds. */
  surfaceProbeDepth: 0.2,
  /** Horizontal blocks walked per footstep. */
  strideWalk: 1.7,
  strideSprint: 2.1,
  strideCrouch: 1.3,
  /** Footstep level multiplier while crouching. */
  crouchStepGain: 0.4,
  /** Downward speed (blocks/s) below which touching the ground makes no landing sound. */
  landMinSpeed: 4,
  /** Downward speed (blocks/s) at which the landing sound reaches full level. */
  landFullSpeed: 20,
  /** Seconds between bite sounds while eating. */
  eatBiteInterval: 0.28,
  /** Seconds between a mob's occasional idle sounds (random in [min, max]) across all nearby mobs. */
  mobIdleIntervalMin: 3,
  mobIdleIntervalMax: 9,
  /** Ambient wind bed peak level (0..1) before the volume settings. */
  ambientMaxLevel: 0.14,
  /** Seconds the ambient level takes to follow daylight / sky light. */
  ambientSmoothingSeconds: 1.5,
  /** Seconds between ambient level updates. */
  ambientUpdateInterval: 0.25,
  /** Ambient level factor deep in a cave (sky light 0). */
  ambientCaveFactor: 0.15,
  /** Level scale for the whole effects bus. */
  effectsBusLevel: 0.9,
} as const;
