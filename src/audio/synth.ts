import type { AudioRng, ResolvedLayer } from './variation';

/**
 * Tiny Web Audio synth used only by `AudioSystem`: builds the node graph of
 * one sound from resolved recipe layers (oscillators / filtered noise with an
 * ADSR-shaped gain). Kept separate from AudioSystem for size, not for reuse;
 * nothing outside `src/audio` touches Web Audio.
 */

/** White-noise buffer, generated once and shared (each noise layer starts at its own offset). */
export function createNoiseBuffer(ctx: BaseAudioContext, seconds: number, rng: AudioRng): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    data[i] = rng() * 2 - 1;
  }
  return buffer;
}

/** The nodes of one playing sound, so they can be stopped and disconnected. */
export interface VoiceGraph {
  readonly nodes: AudioNode[];
  readonly sources: AudioScheduledSourceNode[];
  readonly output: GainNode;
}

/** Extra seconds a source keeps running past its envelope, so the release tail is never cut. */
const STOP_MARGIN = 0.02;
/** Floor for exponential ramps (they cannot reach 0). */
const MIN_FREQ = 20;

function scheduleEnvelope(param: AudioParam, layer: ResolvedLayer, start: number): void {
  const { attack, decay, sustain, hold, release } = layer.env;
  const peak = layer.gain;
  param.setValueAtTime(0, start);
  param.linearRampToValueAtTime(peak, start + attack);
  param.linearRampToValueAtTime(peak * sustain, start + attack + decay);
  param.setValueAtTime(peak * sustain, start + attack + decay + hold);
  param.linearRampToValueAtTime(0, start + attack + decay + hold + release);
}

function createLayerSource(
  ctx: BaseAudioContext,
  layer: ResolvedLayer,
  noise: AudioBuffer,
  start: number,
  total: number,
): AudioScheduledSourceNode {
  if (layer.source === 'noise') {
    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    source.start(start, layer.noiseOffset * noise.duration);
    return source;
  }
  const osc = ctx.createOscillator();
  osc.type = layer.source;
  osc.frequency.setValueAtTime(Math.max(MIN_FREQ, layer.freq), start);
  if (layer.freqEnd !== null) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(MIN_FREQ, layer.freqEnd), start + total);
  }
  osc.start(start);
  return osc;
}

/**
 * Builds and starts one sound. `onAllEnded` runs once, after every source has
 * ended (or been stopped). The graph is `sources -> [filter] -> layer gain ->
 * output gain -> [stereo panner] -> destination`.
 */
export function startVoice(
  ctx: BaseAudioContext,
  destination: AudioNode,
  noise: AudioBuffer,
  layers: readonly ResolvedLayer[],
  level: number,
  pan: number,
  onAllEnded: () => void,
): VoiceGraph {
  const now = ctx.currentTime;
  const nodes: AudioNode[] = [];
  const sources: AudioScheduledSourceNode[] = [];

  const output = ctx.createGain();
  output.gain.value = level;
  nodes.push(output);
  if (typeof ctx.createStereoPanner === 'function') {
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    output.connect(panner);
    panner.connect(destination);
    nodes.push(panner);
  } else {
    output.connect(destination);
  }

  let remaining = layers.length;
  for (const layer of layers) {
    const start = now + layer.delay;
    const { attack, decay, hold, release } = layer.env;
    const total = attack + decay + hold + release;
    const source = createLayerSource(ctx, layer, noise, start, total);
    const layerGain = ctx.createGain();
    scheduleEnvelope(layerGain.gain, layer, start);
    if (layer.filter === null) {
      source.connect(layerGain);
    } else {
      const filter = ctx.createBiquadFilter();
      filter.type = layer.filter.type;
      filter.frequency.value = layer.filter.freq;
      filter.Q.value = layer.filter.q;
      source.connect(filter);
      filter.connect(layerGain);
      nodes.push(filter);
    }
    layerGain.connect(output);
    nodes.push(layerGain);
    source.onended = (): void => {
      remaining -= 1;
      if (remaining === 0) {
        onAllEnded();
      }
    };
    source.stop(start + total + STOP_MARGIN);
    sources.push(source);
    nodes.push(source);
  }
  return { nodes, sources, output };
}

/** Silences a voice at once and stops its sources (used when it is stolen or the system is disposed). */
export function silenceVoice(ctx: BaseAudioContext, voice: VoiceGraph): void {
  const now = ctx.currentTime;
  voice.output.gain.cancelScheduledValues(now);
  voice.output.gain.value = 0;
  for (const source of voice.sources) {
    source.onended = null;
    try {
      source.stop(now);
    } catch {
      // Not started / already stopped: nothing to do.
    }
  }
}

/** Disconnects every node of a finished voice so it can be garbage collected. */
export function disconnectVoice(voice: VoiceGraph): void {
  for (const node of voice.nodes) {
    try {
      node.disconnect();
    } catch {
      // Already disconnected.
    }
  }
}
