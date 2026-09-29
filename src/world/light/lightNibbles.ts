/** Highest light level for either channel (a 4-bit nibble). */
export const MAX_LIGHT = 15;

/** Packs sky light (high nibble) and block light (low nibble) into one byte. */
export function packLight(sky: number, block: number): number {
  return ((sky & 0x0f) << 4) | (block & 0x0f);
}

/** Sky light (0..15) from a packed light byte. */
export function skyLightOf(packed: number): number {
  return (packed >> 4) & 0x0f;
}

/** Block light (0..15) from a packed light byte. */
export function blockLightOf(packed: number): number {
  return packed & 0x0f;
}

/** Light channel selector; values are the bit shift of the channel's nibble. */
export const LightChannel = {
  Block: 0,
  Sky: 4,
} as const;

export type LightChannel = (typeof LightChannel)[keyof typeof LightChannel];

/** Reads one channel's level from a packed light byte. */
export function channelOf(packed: number, channel: LightChannel): number {
  return (packed >> channel) & 0x0f;
}

/** Returns `packed` with `channel` replaced by `level` (0..15). */
export function withChannel(packed: number, channel: LightChannel, level: number): number {
  return (packed & ~(0x0f << channel) & 0xff) | ((level & 0x0f) << channel);
}
