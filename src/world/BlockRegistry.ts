import { BLOCK_DEFINITIONS, BlockId, type BlockDefinition } from './blocks';

const UINT8_MAX = 255;
/** Light levels (emission and opacity) are nibbles: 0..15. */
const MAX_LIGHT_VALUE = 15;

/**
 * Validates and indexes block definitions for fast lookup.
 * Definitions must be dense (id === array index), starting with Air at 0,
 * so ids can be used directly as array/TypedArray indices.
 */
export class BlockRegistry {
  private readonly definitions: readonly BlockDefinition[];
  private readonly byName: ReadonlyMap<string, BlockDefinition>;
  private readonly solidFlags: Uint8Array;
  private readonly transparentFlags: Uint8Array;
  private readonly targetableFlags: Uint8Array;
  private readonly replaceableFlags: Uint8Array;
  private readonly fluidFlags: Uint8Array;
  /** Per-id light emission (BlockDefinition.lightLevel), 0..15. */
  readonly lightEmissionTable: Uint8Array;
  /** Per-id extra light attenuation (BlockDefinition.lightOpacity or derived), 0..15. */
  readonly lightOpacityTable: Uint8Array;

  constructor(definitions: readonly BlockDefinition[]) {
    BlockRegistry.validate(definitions);

    this.definitions = definitions;

    const byName = new Map<string, BlockDefinition>();
    const solidFlags = new Uint8Array(definitions.length);
    const transparentFlags = new Uint8Array(definitions.length);
    const targetableFlags = new Uint8Array(definitions.length);
    const replaceableFlags = new Uint8Array(definitions.length);
    const fluidFlags = new Uint8Array(definitions.length);
    const lightEmission = new Uint8Array(definitions.length);
    const lightOpacity = new Uint8Array(definitions.length);

    for (const def of definitions) {
      byName.set(def.name, def);
      solidFlags[def.id] = def.solid ? 1 : 0;
      transparentFlags[def.id] = def.transparent ? 1 : 0;

      const defaultTargetable = def.texture !== null;
      const targetable = def.targetable ?? defaultTargetable;
      targetableFlags[def.id] = targetable ? 1 : 0;
      replaceableFlags[def.id] = def.id === BlockId.Air || def.replaceable === true ? 1 : 0;
      fluidFlags[def.id] = def.fluid === true ? 1 : 0;
      lightEmission[def.id] = def.lightLevel;
      lightOpacity[def.id] = def.lightOpacity ?? (def.transparent ? 0 : MAX_LIGHT_VALUE);
    }

    this.byName = byName;
    this.solidFlags = solidFlags;
    this.transparentFlags = transparentFlags;
    this.targetableFlags = targetableFlags;
    this.replaceableFlags = replaceableFlags;
    this.fluidFlags = fluidFlags;
    this.lightEmissionTable = lightEmission;
    this.lightOpacityTable = lightOpacity;
  }

  private static validate(definitions: readonly BlockDefinition[]): void {
    if (definitions.length === 0) {
      throw new Error('BlockRegistry: definitions must not be empty.');
    }

    const seenIds = new Set<number>();
    const seenNames = new Set<string>();

    definitions.forEach((def, index) => {
      if (!Number.isInteger(def.id) || def.id < 0) {
        throw new Error(`BlockRegistry: block "${def.name}" has an invalid id (${def.id}).`);
      }
      if (def.id > UINT8_MAX) {
        throw new Error(
          `BlockRegistry: block "${def.name}" has id ${def.id}, which does not fit in a Uint8 (0-255).`,
        );
      }
      if (def.id !== index) {
        throw new Error(
          `BlockRegistry: block "${def.name}" has id ${def.id} but is at array index ${index}. ` +
            'Definitions must be contiguous and sorted by id starting from 0.',
        );
      }
      if (seenIds.has(def.id)) {
        throw new Error(`BlockRegistry: duplicate block id ${def.id}.`);
      }
      seenIds.add(def.id);

      if (seenNames.has(def.name)) {
        throw new Error(`BlockRegistry: duplicate block name "${def.name}".`);
      }
      seenNames.add(def.name);

      BlockRegistry.validateLightValue(def.name, 'lightLevel', def.lightLevel);
      if (def.lightOpacity !== undefined) {
        BlockRegistry.validateLightValue(def.name, 'lightOpacity', def.lightOpacity);
      }
    });

    const first = definitions[0];
    if (first === undefined || first.id !== BlockId.Air || first.name !== 'air') {
      throw new Error('BlockRegistry: id 0 must be the "air" block.');
    }
  }

  private static validateLightValue(name: string, field: string, value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > MAX_LIGHT_VALUE) {
      throw new Error(
        `BlockRegistry: block "${name}" has ${field} ${value}; expected an integer in 0..${MAX_LIGHT_VALUE}.`,
      );
    }
  }

  get size(): number {
    return this.definitions.length;
  }

  has(id: number): boolean {
    return Number.isInteger(id) && id >= 0 && id < this.definitions.length;
  }

  get(id: number): BlockDefinition {
    const def = this.definitions[id];
    if (def === undefined) {
      throw new Error(`BlockRegistry: unknown block id ${id}.`);
    }
    return def;
  }

  getByName(name: string): BlockDefinition | undefined {
    return this.byName.get(name);
  }

  isSolid(id: number): boolean {
    return this.solidFlags[id] === 1;
  }

  isTransparent(id: number): boolean {
    return this.transparentFlags[id] === 1;
  }

  isTargetable(id: number): boolean {
    return this.targetableFlags[id] === 1;
  }

  /** True if a placed block may overwrite this one (Air, and blocks marked `replaceable`). */
  isReplaceable(id: number): boolean {
    return this.replaceableFlags[id] === 1;
  }

  /** Light emitted by this block (0..15). */
  lightEmission(id: number): number {
    return this.lightEmissionTable[id] ?? 0;
  }

  /** Extra light lost entering this block (0..15; 15 = fully blocks light). */
  lightOpacity(id: number): number {
    return this.lightOpacityTable[id] ?? MAX_LIGHT_VALUE;
  }

  /** True if this block is a fluid (e.g. Water) — see `BlockDefinition.fluid`. */
  isFluid(id: number): boolean {
    return this.fluidFlags[id] === 1;
  }
}

export const blockRegistry = new BlockRegistry(BLOCK_DEFINITIONS);
