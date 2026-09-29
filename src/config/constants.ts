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
