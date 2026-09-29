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
