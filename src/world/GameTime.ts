import { DAY_NIGHT_CONFIG } from '../config/constants';

export type DayNightConfig = typeof DAY_NIGHT_CONFIG;

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/** Fraction of the full day+night cycle that is daytime, e.g. 900/(900+300) = 0.75. */
export function dayFraction(config: DayNightConfig): number {
  return config.dayLengthSeconds / (config.dayLengthSeconds + config.nightLengthSeconds);
}

/** Smoothstep easing (0 at edge0, 1 at edge1, clamped, smooth derivative at both ends). */
function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) {
    return x < edge0 ? 0 : 1;
  }
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Linear interpolation. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Sun elevation angle in radians for a given timeOfDay: 0 at sunrise (t=0),
 * PI at sunset (t=dayFraction), i.e. rises through [0, PI] during the day
 * segment, then continues below the horizon through [PI, 2*PI] during the
 * night segment, reaching the horizon again at wrap (t=1 === t=0).
 *
 * Mapping day and night segments separately onto their own [0, PI] and
 * [PI, 2*PI] half-arcs means a 15/5 (3:1) split still produces a symmetric
 * sun arc during the day and a symmetric (lower) arc during the night,
 * instead of a day-length-skewed arc.
 */
export function sunAngle(timeOfDay: number, config: DayNightConfig): number {
  const day = dayFraction(config);
  if (timeOfDay < day) {
    const segmentT = day === 0 ? 0 : timeOfDay / day;
    return segmentT * Math.PI;
  }
  const night = 1 - day;
  const segmentT = night === 0 ? 0 : (timeOfDay - day) / night;
  return Math.PI + segmentT * Math.PI;
}

/**
 * Daylight factor in [0, 1]: 1 at midday, at its minimum at midnight, with a
 * smooth (smoothstep) dawn/dusk transition of `config.transitionWidth`
 * (fraction of the full cycle) straddling sunrise (t=0/1 wrap) and sunset
 * (t=dayFraction), so the value is continuous with no jumps at either
 * boundary or across the wrap.
 */
export function daylightFactor(timeOfDay: number, config: DayNightConfig): number {
  const day = dayFraction(config);
  const w = Math.max(1e-6, config.transitionWidth);

  // Shift timeOfDay values from the tail of the night plateau (just before
  // the t=1 wrap) down by 1, so they line up contiguously with the dawn
  // ramp's [-w, w] window instead of being clamped to 0 by the dusk ramp
  // below. Without this, the night plateau (which reads 0 for any t past
  // day + w) would override the dawn ramp's rising value near the wrap,
  // producing a discontinuity between t=1-epsilon and t=0+epsilon.
  const t = timeOfDay > day + w ? timeOfDay - 1 : timeOfDay;

  // Sunrise transition: ramps 0 -> 1 over [-w, w], centered on dawn (t=0).
  const dawnRamp = smoothstep(-w, w, t);
  // Sunset transition: ramps 1 -> 0 over [day - w, day + w], centered on dusk.
  const duskRamp = 1 - smoothstep(day - w, day + w, t);

  // Daylight is "on" only in the window between dawn-complete and
  // dusk-complete; taking the min of the two ramps gives a continuous curve
  // that is 1 through the daytime plateau and 0 through the nighttime
  // plateau, with smooth transitions at both edges (including the wrap).
  return Math.min(dawnRamp, duskRamp);
}

/** Sky color blending night -> sunset tint -> day across the dawn/dusk transitions. */
export function skyColor(timeOfDay: number, config: DayNightConfig): RgbColor {
  const day = dayFraction(config);
  const w = Math.max(1e-6, config.transitionWidth);

  const night = colorFromHex(config.nightSkyColor);
  const dayCol = colorFromHex(config.daySkyColor);
  const sunset = colorFromHex(config.sunsetSkyColor);

  // Distance (in cycle-fraction units, wrap-aware) to the nearest of the two
  // terminators (dawn at t=0/1, dusk at t=day). Sunset tint peaks exactly at
  // the terminator and fades to 0 by `w` away from it on either side.
  const distToDusk = Math.abs(timeOfDay - day);
  const distToDawnRaw = Math.min(Math.abs(timeOfDay), Math.abs(timeOfDay - 1));
  const distToTerminator = Math.min(distToDusk, distToDawnRaw);
  const sunsetWeight = 1 - smoothstep(0, w, distToTerminator);

  const daylight = daylightFactor(timeOfDay, config);
  const base = lerpColor(night, dayCol, daylight);
  return lerpColor(base, sunset, sunsetWeight);
}

function colorFromHex(hex: number): RgbColor {
  return {
    r: ((hex >> 16) & 0xff) / 255,
    g: ((hex >> 8) & 0xff) / 255,
    b: (hex & 0xff) / 255,
  };
}

function lerpColor(a: RgbColor, b: RgbColor, t: number): RgbColor {
  return { r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) };
}

/**
 * Tracks elapsed in-game time as a deterministic, pure state machine: no
 * three.js or DOM dependency, advanced explicitly by `advance(dt)` each
 * frame. `timeOfDay` is a fraction of the full day+night cycle in [0, 1),
 * where [0, dayFraction) is daytime and [dayFraction, 1) is night.
 */
export class GameTime {
  private readonly config: DayNightConfig;
  private readonly cycleLengthSeconds: number;
  private elapsed: number;
  private cycles: number;

  constructor(config: DayNightConfig = DAY_NIGHT_CONFIG) {
    this.config = config;
    this.cycleLengthSeconds = config.dayLengthSeconds + config.nightLengthSeconds;
    this.cycles = 0;
    this.elapsed = 0;
    this.setTimeOfDay(config.startTimeOfDay);
  }

  /** Advances elapsed time by `dt` seconds; negative dt is clamped to 0 (a no-op). */
  advance(dt: number): void {
    const clamped = Math.max(0, dt);
    this.elapsed += clamped;
  }

  /** Total elapsed seconds since dayCount 0 / the initial `startTimeOfDay`. */
  get elapsedSeconds(): number {
    return this.elapsed;
  }

  /** Fraction of the current day+night cycle in [0, 1); wraps at 1. */
  get timeOfDay(): number {
    const t = (this.elapsed / this.cycleLengthSeconds) % 1;
    return t < 0 ? t + 1 : t;
  }

  /** True while timeOfDay is within the daytime segment [0, dayFraction). */
  get isDay(): boolean {
    return this.timeOfDay < dayFraction(this.config);
  }

  /** Number of full day+night cycles completed since construction. */
  get dayCount(): number {
    return this.cycles + Math.floor(this.elapsed / this.cycleLengthSeconds);
  }

  /** Jumps directly to a given timeOfDay fraction in [0, 1), preserving dayCount. */
  setTimeOfDay(t: number): void {
    const wrapped = ((t % 1) + 1) % 1;
    const currentCycles = Math.floor(this.elapsed / this.cycleLengthSeconds);
    this.cycles += currentCycles;
    this.elapsed = wrapped * this.cycleLengthSeconds;
  }
}
