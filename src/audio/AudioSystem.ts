import { AUDIO_CONFIG } from '../config/constants';
import type { GameEvent } from '../events/GameEvents';
import { disconnectVoice, createNoiseBuffer, silenceVoice, startVoice, type VoiceGraph } from './synth';
import { soundFor, recipeDuration } from './soundRecipes';
import { spatialize, type Listener } from './spatial';
import { resolveRecipe, type AudioRng } from './variation';
import { VoiceScheduler } from './voiceScheduler';
import { ambientTarget, percentToGain, type VolumeLevels } from './volume';

export type AudioStatus = 'locked' | 'running' | 'suspended' | 'unavailable' | 'disposed';

export interface AudioSystemOptions {
  /** Random source for sound variation (default Math.random). */
  readonly rng?: AudioRng;
  /** Creates the context; null / a throw means Web Audio is unavailable (default: the browser AudioContext). */
  readonly createContext?: () => AudioContext | null;
}

function defaultCreateContext(): AudioContext | null {
  return typeof AudioContext === 'undefined' ? null : new AudioContext();
}

const IDLE_LISTENER: Listener = { x: 0, y: 0, z: 0, yaw: 0 };

/**
 * The only owner of Web Audio. The AudioContext is created lazily on the first
 * user gesture (`unlock`), because browsers block audio before one. Graph:
 *
 *   voices -> effects gain --\
 *                             +-> master gain -> destination
 *   wind bed -> ambient gain -/
 *
 * Every call is a safe no-op when Web Audio is missing or the context cannot
 * start. Sounds are procedural (see soundRecipes / synth); at most
 * `AUDIO_CONFIG.maxVoices` play at once, the oldest being stolen.
 */
export class AudioSystem {
  private readonly rng: AudioRng;
  private readonly createContext: () => AudioContext | null;
  private readonly scheduler = new VoiceScheduler(AUDIO_CONFIG.maxVoices);
  private readonly voices = new Map<number, VoiceGraph>();
  private volumes: VolumeLevels;
  private listener: Listener = IDLE_LISTENER;
  private paused = false;
  private hidden = false;
  private failed = false;
  private disposed = false;
  private ambientClock = 0;
  private requestedSuspended: boolean | null = null;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private effects: GainNode | null = null;
  private ambient: GainNode | null = null;
  private wind: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private windNodes: AudioNode[] = [];

  constructor(volumes: VolumeLevels, options: AudioSystemOptions = {}) {
    this.volumes = volumes;
    this.rng = options.rng ?? Math.random;
    this.createContext = options.createContext ?? defaultCreateContext;
  }

  get status(): AudioStatus {
    if (this.disposed) {
      return 'disposed';
    }
    if (this.failed) {
      return 'unavailable';
    }
    if (this.ctx === null) {
      return 'locked';
    }
    return this.ctx.state === 'running' ? 'running' : 'suspended';
  }

  /** Sounds currently counted against the voice cap. */
  get voiceCount(): number {
    return this.scheduler.count;
  }

  /**
   * Call from a user gesture (a click / key press). Creates the context on the
   * first call and starts it unless the game is paused / hidden. Never throws.
   */
  unlock(): void {
    if (this.disposed || this.failed) {
      return;
    }
    if (this.ctx === null && !this.build()) {
      return;
    }
    this.syncSuspension();
  }

  /** The game is paused (menu open): the context is suspended so nothing plays. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.syncSuspension();
  }

  /** The tab is hidden: the context is suspended. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.syncSuspension();
  }

  /** Applies new volume settings (percent) immediately, even while suspended. */
  setVolumes(volumes: VolumeLevels): void {
    this.volumes = volumes;
    this.applyVolumes();
  }

  /** Where the player is / faces, for positional sounds. Cheap: stores the values. */
  setListener(x: number, y: number, z: number, yaw: number): void {
    this.listener = { x, y, z, yaw };
  }

  /** Plays the sound for a game event (silent events and an unavailable context are ignored). */
  play(event: GameEvent): void {
    const ctx = this.ctx;
    const effects = this.effects;
    const noise = this.noise;
    if (ctx === null || effects === null || noise === null || ctx.state !== 'running') {
      return;
    }
    const request = soundFor(event);
    if (request === null) {
      return;
    }
    let level = request.gain;
    let pan = 0;
    if (request.position !== undefined) {
      const spatial = spatialize(this.listener, request.position.x, request.position.y, request.position.z);
      if (spatial === null) {
        return;
      }
      level *= spatial.gain;
      pan = spatial.pan;
    }

    for (const endedId of this.scheduler.prune(ctx.currentTime)) {
      this.finishVoice(endedId);
    }
    const layers = resolveRecipe(request.recipe, this.rng);
    const admission = this.scheduler.admit(ctx.currentTime, recipeDuration(request.recipe));
    if (admission.stolen !== null) {
      this.stealVoice(ctx, admission.stolen);
    }
    const id = admission.id;
    try {
      const voice = startVoice(ctx, effects, noise, layers, level, pan, () => this.finishVoice(id));
      this.voices.set(id, voice);
    } catch (error) {
      this.scheduler.release(id);
      console.warn('[audio] could not start a sound.', error);
    }
  }

  /**
   * Follows daylight (0..1) and the player's sky light (0..15): the wind bed
   * is louder outdoors by day and nearly silent in caves. Throttled internally.
   */
  updateAmbient(dt: number, daylight: number, skyLight: number): void {
    this.ambientClock += Math.max(0, dt);
    if (this.ambientClock < AUDIO_CONFIG.ambientUpdateInterval) {
      return;
    }
    this.ambientClock = 0;
    const ctx = this.ctx;
    if (ctx === null || this.wind === null) {
      return;
    }
    const level = ambientTarget(daylight, skyLight) * AUDIO_CONFIG.ambientMaxLevel;
    this.wind.gain.setTargetAtTime(level, ctx.currentTime, AUDIO_CONFIG.ambientSmoothingSeconds / 3);
  }

  /** Stops every sound, disconnects the graph and closes the context. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const ctx = this.ctx;
    if (ctx !== null) {
      for (const voice of this.voices.values()) {
        silenceVoice(ctx, voice);
        disconnectVoice(voice);
      }
    }
    this.voices.clear();
    for (const id of this.scheduler.ids()) {
      this.scheduler.release(id);
    }
    for (const node of [...this.windNodes, this.wind, this.ambient, this.effects, this.master]) {
      node?.disconnect();
    }
    this.windNodes = [];
    if (ctx !== null) {
      void ctx.close().catch(() => undefined);
    }
    this.ctx = this.master = this.effects = this.ambient = this.wind = null;
    this.noise = null;
  }

  private build(): boolean {
    try {
      const ctx = this.createContext();
      if (ctx === null) {
        this.failed = true;
        return false;
      }
      const master = ctx.createGain();
      const effects = ctx.createGain();
      const ambient = ctx.createGain();
      effects.connect(master);
      ambient.connect(master);
      master.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
      this.effects = effects;
      this.ambient = ambient;
      this.noise = createNoiseBuffer(ctx, AUDIO_CONFIG.noiseSeconds, this.rng);
      this.applyVolumes();
      this.startWind(ctx, ambient, this.noise);
      return true;
    } catch (error) {
      console.warn('[audio] Web Audio is unavailable; the game will be silent.', error);
      this.failed = true;
      this.ctx = null;
      return false;
    }
  }

  /** Quiet looped noise through a low-pass with a slow swell: the level itself follows `updateAmbient`. */
  private startWind(ctx: AudioContext, destination: GainNode, noise: AudioBuffer): void {
    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.6;
    const bed = ctx.createGain();
    bed.gain.value = 0;
    const swell = ctx.createOscillator();
    swell.frequency.value = 0.13;
    const swellDepth = ctx.createGain();
    swellDepth.gain.value = 120;
    swell.connect(swellDepth);
    swellDepth.connect(filter.frequency);
    source.connect(filter);
    filter.connect(bed);
    bed.connect(destination);
    source.start();
    swell.start();
    this.wind = bed;
    this.windNodes = [source, filter, bed, swell, swellDepth];
  }

  private applyVolumes(): void {
    if (this.master === null || this.effects === null || this.ambient === null) {
      return;
    }
    this.setParam(this.master.gain, percentToGain(this.volumes.master));
    this.setParam(this.effects.gain, percentToGain(this.volumes.effects) * AUDIO_CONFIG.effectsBusLevel);
    this.setParam(this.ambient.gain, percentToGain(this.volumes.ambient));
  }

  private setParam(param: AudioParam, value: number): void {
    param.cancelScheduledValues(0);
    param.value = value;
  }

  private syncSuspension(): void {
    const ctx = this.ctx;
    if (ctx === null || this.disposed) {
      return;
    }
    const wantSuspended = this.paused || this.hidden;
    if (wantSuspended === this.requestedSuspended) {
      return;
    }
    this.requestedSuspended = wantSuspended;
    const action = wantSuspended ? ctx.suspend() : ctx.resume();
    action.catch((error: unknown) => console.warn('[audio] could not change the audio state.', error));
  }

  private stealVoice(ctx: AudioContext, id: number): void {
    const voice = this.voices.get(id);
    if (voice === undefined) {
      return;
    }
    silenceVoice(ctx, voice);
    disconnectVoice(voice);
    this.voices.delete(id);
  }

  private finishVoice(id: number): void {
    this.scheduler.release(id);
    const voice = this.voices.get(id);
    if (voice !== undefined) {
      disconnectVoice(voice);
      this.voices.delete(id);
    }
  }
}
