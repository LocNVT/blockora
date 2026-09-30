import { describe, it, expect } from 'vitest';
import { AUDIO_CONFIG, SETTINGS_CONFIG } from '../src/config/constants';
import { VoiceScheduler } from '../src/audio/voiceScheduler';
import { distanceGain, spatialize, type Listener } from '../src/audio/spatial';
import { ambientTarget, percentToGain, volumesFromSettings } from '../src/audio/volume';
import { GameEventQueue, type GameEvent } from '../src/events/GameEvents';
import { MovementEventTracker, type MovementSample, strideLength } from '../src/events/movementEvents';
import { EatEventTracker } from '../src/events/eatEvents';
import { MobIdleEventTimer } from '../src/events/mobIdleEvents';
import { mulberry32 } from '../src/util/mulberry32';
import { DEFAULT_SETTINGS, clampSettings, validateSettings } from '../src/settings/GameSettings';
import { loadSettings, type SettingsStorage } from '../src/settings/settingsStorage';
import { BlockId } from '../src/world/blocks';
import { AudioSystem } from '../src/audio/AudioSystem';

describe('VoiceScheduler', () => {
  it('admits up to the cap without stealing', () => {
    const s = new VoiceScheduler(3);
    for (let i = 0; i < 3; i += 1) {
      expect(s.admit(i, 1).stolen).toBeNull();
    }
    expect(s.count).toBe(3);
  });

  it('steals the oldest voice when full and never exceeds the cap', () => {
    const s = new VoiceScheduler(3);
    const a = s.admit(0, 10);
    const b = s.admit(1, 10);
    const c = s.admit(2, 10);
    const d = s.admit(3, 10);
    expect(d.stolen).toBe(a.id);
    expect(s.ids()).toEqual([b.id, c.id, d.id]);
    for (let i = 4; i < 50; i += 1) {
      s.admit(i, 10);
      expect(s.count).toBeLessThanOrEqual(3);
    }
  });

  it('release frees a slot and prune removes ended voices', () => {
    const s = new VoiceScheduler(2);
    const a = s.admit(0, 1);
    s.admit(0.5, 5);
    expect(s.release(a.id)).toBe(true);
    expect(s.release(a.id)).toBe(false);
    expect(s.admit(0.6, 1).stolen).toBeNull();
    expect(s.prune(2)).toHaveLength(1);
    expect(s.count).toBe(1);
    expect(s.prune(100)).toHaveLength(1);
    expect(s.count).toBe(0);
  });
});

describe('spatial audio', () => {
  const at = (yaw: number): Listener => ({ x: 0, y: 0, z: 0, yaw });

  it('is full level near and silent far, monotonic in between', () => {
    expect(distanceGain(0)).toBe(1);
    expect(distanceGain(AUDIO_CONFIG.referenceDistance)).toBe(1);
    expect(distanceGain(AUDIO_CONFIG.maxHearingDistance)).toBe(0);
    let last = 1;
    for (let d = AUDIO_CONFIG.referenceDistance; d <= AUDIO_CONFIG.maxHearingDistance; d += 1) {
      expect(distanceGain(d)).toBeLessThanOrEqual(last);
      last = distanceGain(d);
    }
    expect(spatialize(at(0), 0, 0, AUDIO_CONFIG.maxHearingDistance + 1)).toBeNull();
  });

  it('pans by the listener yaw: facing -Z, +X is right and -X is left', () => {
    expect(spatialize(at(0), 5, 0, 0)?.pan).toBeCloseTo(1);
    expect(spatialize(at(0), -5, 0, 0)?.pan).toBeCloseTo(-1);
    expect(Math.abs(spatialize(at(0), 0, 0, -5)?.pan ?? 1)).toBeLessThan(1e-9);
  });

  it('turning the listener swaps the sides', () => {
    // Yaw +90 degrees turns the listener to face -X: -X is dead ahead, +Z is on the left.
    const ahead = spatialize(at(Math.PI / 2), -5, 0, 0);
    expect(Math.abs(ahead?.pan ?? 1)).toBeLessThan(1e-9);
    expect(spatialize(at(Math.PI), 5, 0, 0)?.pan).toBeCloseTo(-1);
    expect(spatialize(at(Math.PI / 2), 0, 0, 5)?.pan).toBeCloseTo(-1);
  });

  it('a source behind is centred and slightly quieter than one ahead at the same distance', () => {
    const ahead = spatialize(at(0), 0, 0, -8);
    const behind = spatialize(at(0), 0, 0, 8);
    expect(behind?.pan ?? 1).toBeCloseTo(0);
    expect(behind?.gain ?? 0).toBeLessThan(ahead?.gain ?? 0);
    expect(behind?.gain ?? 0).toBeGreaterThan(0);
  });

  it('a source on the listener is centred at full level', () => {
    expect(spatialize(at(1), 0.1, 0, 0.1)).toEqual({ gain: 1, pan: 0 });
  });
});

function sample(over: Partial<MovementSample>): MovementSample {
  return {
    x: 0,
    z: 0,
    onGround: true,
    crouching: false,
    sprinting: false,
    inFluid: false,
    velocityYBefore: 0,
    jumped: false,
    surfaceBlockId: BlockId.Stone,
    ...over,
  };
}

function collect(): { queue: GameEventQueue; drain: () => GameEvent[] } {
  const queue = new GameEventQueue();
  return {
    queue,
    drain: () => {
      const out: GameEvent[] = [];
      queue.drain((e) => out.push(e));
      return out;
    },
  };
}

describe('MovementEventTracker', () => {
  it('emits one footstep per stride walked, independent of frame rate', () => {
    for (const step of [0.01, 0.1, 0.5]) {
      const { queue, drain } = collect();
      const t = new MovementEventTracker(queue);
      let x = 0;
      t.update(sample({ x }));
      const total = strideLength(false, false) * 4 + 0.01;
      while (x < total) {
        x += step;
        t.update(sample({ x }));
      }
      const steps = drain().filter((e) => e.type === 'footstep');
      expect(steps.length).toBe(4);
    }
  });

  it('does not step while standing still, airborne or swimming', () => {
    const { queue, drain } = collect();
    const t = new MovementEventTracker(queue);
    for (let i = 0; i < 100; i += 1) {
      t.update(sample({ x: 0 }));
    }
    for (let i = 0; i < 100; i += 1) {
      t.update(sample({ x: i * 0.5, onGround: false }));
    }
    for (let i = 0; i < 100; i += 1) {
      t.update(sample({ x: 100 + i * 0.5, inFluid: true }));
    }
    expect(drain().filter((e) => e.type === 'footstep')).toHaveLength(0);
  });

  it('sprinting strides are longer and crouching strides shorter', () => {
    expect(strideLength(true, false)).toBeGreaterThan(strideLength(false, false));
    expect(strideLength(false, true)).toBeLessThan(strideLength(false, false));
  });

  it('emits the surface block, sprint and crouch flags', () => {
    const { queue, drain } = collect();
    const t = new MovementEventTracker(queue);
    t.update(sample({ x: 0, surfaceBlockId: BlockId.Sand }));
    t.update(sample({ x: 3, surfaceBlockId: BlockId.Sand, crouching: true }));
    expect(drain()).toEqual([{ type: 'footstep', blockId: BlockId.Sand, sprinting: false, crouching: true }]);
  });

  it('jump fires once from the ground; landing fires only above the minimum fall speed', () => {
    const { queue, drain } = collect();
    const t = new MovementEventTracker(queue);
    t.update(sample({ jumped: true, onGround: false }));
    t.update(sample({ onGround: false }));
    t.update(sample({ onGround: true, velocityYBefore: -(AUDIO_CONFIG.landMinSpeed - 1) }));
    t.update(sample({ onGround: false }));
    t.update(sample({ onGround: true, velocityYBefore: -15 }));
    expect(drain()).toEqual([
      { type: 'jump', blockId: BlockId.Stone },
      { type: 'land', blockId: BlockId.Stone, fallSpeed: 15 },
    ]);
  });

  it('landing in water is silent and a teleport does not count as walking', () => {
    const { queue, drain } = collect();
    const t = new MovementEventTracker(queue);
    t.update(sample({ onGround: false }));
    t.update(sample({ onGround: true, inFluid: true, velocityYBefore: -20 }));
    t.update(sample({ x: 500 }));
    t.update(sample({ x: 501 }));
    expect(drain()).toEqual([]);
  });
});

describe('EatEventTracker', () => {
  it('bites at the interval while eating, then gulps once', () => {
    const { queue, drain } = collect();
    const t = new EatEventTracker(queue);
    const dt = 0.05;
    const frames = Math.round(1 / dt);
    for (let i = 0; i < frames; i += 1) {
      t.update('eating', dt);
    }
    t.update('eaten', dt);
    const events = drain();
    const bites = events.filter((e) => e.type === 'eatBite').length;
    expect(bites).toBeGreaterThanOrEqual(3);
    expect(bites).toBeLessThanOrEqual(5);
    expect(events.filter((e) => e.type === 'eatDone')).toHaveLength(1);
    expect(events[events.length - 1]?.type).toBe('eatDone');
  });

  it('stays silent while idle', () => {
    const { queue, drain } = collect();
    const t = new EatEventTracker(queue);
    for (let i = 0; i < 50; i += 1) {
      t.update('idle', 0.1);
    }
    expect(drain()).toEqual([]);
  });
});

describe('MobIdleEventTimer', () => {
  it('voices a nearby mob now and then, ignoring ones out of hearing range', () => {
    const { queue, drain } = collect();
    const t = new MobIdleEventTimer(queue, mulberry32(3));
    const near = { type: 0, position: { x: 3, y: 0, z: 0 } };
    const far = { type: 1, position: { x: 500, y: 0, z: 0 } };
    for (let i = 0; i < 400; i += 1) {
      t.update(0.1, [near, far], { x: 0, y: 0, z: 0 });
    }
    const events = drain();
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events.length).toBeLessThanOrEqual(15);
    expect(events.every((e) => e.type === 'mobIdle' && e.mobType === 0)).toBe(true);
  });
});

describe('GameEventQueue', () => {
  it('delivers events in emission order exactly once', () => {
    const q = new GameEventQueue();
    q.emit({ type: 'pickup' });
    q.emit({ type: 'chestOpen' });
    q.emit({ type: 'playerHurt' });
    const seen: string[] = [];
    q.drain((e) => seen.push(e.type));
    expect(seen).toEqual(['pickup', 'chestOpen', 'playerHurt']);
    q.drain((e) => seen.push(e.type));
    expect(seen).toHaveLength(3);
    expect(q.length).toBe(0);
  });

  it('is bounded: the oldest events drop first', () => {
    const q = new GameEventQueue(2);
    q.emit({ type: 'pickup' });
    q.emit({ type: 'chestOpen' });
    q.emit({ type: 'playerHurt' });
    const seen: string[] = [];
    q.drain((e) => seen.push(e.type));
    expect(seen).toEqual(['chestOpen', 'playerHurt']);
  });
});

describe('volume helpers', () => {
  it('converts percent to a clamped linear gain', () => {
    expect(percentToGain(0)).toBe(0);
    expect(percentToGain(50)).toBe(0.5);
    expect(percentToGain(100)).toBe(1);
    expect(percentToGain(250)).toBe(1);
    expect(percentToGain(-5)).toBe(0);
    expect(percentToGain(Number.NaN)).toBe(0);
  });

  it('ambient is louder by day and outdoors, and quiet in caves', () => {
    expect(ambientTarget(1, 15)).toBeGreaterThan(ambientTarget(0, 15));
    expect(ambientTarget(1, 15)).toBeGreaterThan(ambientTarget(1, 0));
    expect(ambientTarget(1, 0)).toBeLessThan(0.2);
    expect(ambientTarget(1, 15)).toBeLessThanOrEqual(1);
    expect(ambientTarget(-1, 99)).toBeGreaterThan(0);
  });
});

describe('audio settings', () => {
  it('has defaults inside the range', () => {
    expect(DEFAULT_SETTINGS.masterVolume).toBe(80);
    expect(DEFAULT_SETTINGS.effectsVolume).toBe(100);
    expect(DEFAULT_SETTINGS.ambientVolume).toBe(60);
    expect(volumesFromSettings(DEFAULT_SETTINGS)).toEqual({ master: 80, effects: 100, ambient: 60 });
  });

  it('clamps and rounds volumes', () => {
    const c = clampSettings({ ...DEFAULT_SETTINGS, masterVolume: 500, effectsVolume: -20, ambientVolume: 33.6 });
    expect(c.masterVolume).toBe(SETTINGS_CONFIG.volume.max);
    expect(c.effectsVolume).toBe(SETTINGS_CONFIG.volume.min);
    expect(c.ambientVolume).toBe(34);
  });

  it('validates untrusted volumes per field', () => {
    expect(validateSettings({ masterVolume: 30 })).toEqual({ ...DEFAULT_SETTINGS, masterVolume: 30 });
    expect(validateSettings({ masterVolume: '30', effectsVolume: NaN, ambientVolume: 900 })).toEqual({
      ...DEFAULT_SETTINGS,
      ambientVolume: 100,
    });
  });

  it('an old v1 record without volume fields loads with the defaults', () => {
    const storage: SettingsStorage = {
      getItem: () => JSON.stringify({ fov: 90, mouseSensitivity: 1.5, renderDistance: 6, showFpsCounter: true }),
      setItem: () => undefined,
    };
    expect(loadSettings(storage)).toEqual({
      ...DEFAULT_SETTINGS,
      fov: 90,
      mouseSensitivity: 1.5,
      renderDistance: 6,
      showFpsCounter: true,
    });
  });
});

describe('AudioSystem without Web Audio', () => {
  it('no-ops safely when no context can be created', () => {
    const audio = new AudioSystem({ master: 80, effects: 100, ambient: 60 }, { createContext: () => null });
    expect(audio.status).toBe('locked');
    audio.play({ type: 'pickup' });
    audio.unlock();
    expect(audio.status).toBe('unavailable');
    audio.setPaused(true);
    audio.setHidden(true);
    audio.setVolumes({ master: 0, effects: 0, ambient: 0 });
    audio.setListener(0, 0, 0, 0);
    audio.updateAmbient(1, 1, 15);
    audio.play({ type: 'pickup' });
    expect(audio.voiceCount).toBe(0);
    audio.dispose();
    expect(audio.status).toBe('disposed');
  });

  it('survives a throwing context factory', () => {
    const audio = new AudioSystem(
      { master: 80, effects: 100, ambient: 60 },
      {
        createContext: () => {
          throw new Error('blocked');
        },
      },
    );
    audio.unlock();
    expect(audio.status).toBe('unavailable');
  });
});

/** Every source file under src/ as raw text, keyed by its path relative to src/ (e.g. 'audio/synth.ts'). */
const SOURCES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true })).map(
    ([path, text]) => [path.replace('../src/', ''), String(text)],
  ),
);

describe('module boundaries', () => {
  it('finds the source files', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(100);
    expect(Object.keys(SOURCES)).toContain('audio/AudioSystem.ts');
  });

  it('gameplay / simulation modules never import audio', () => {
    const dirs = ['gameplay/', 'entities/', 'player/', 'world/', 'items/', 'events/'];
    for (const [path, text] of Object.entries(SOURCES)) {
      if (!dirs.some((dir) => path.startsWith(dir))) {
        continue;
      }
      const audioImport = text.split(/\r?\n/).filter((line) => /\bfrom\s+['"][^'"]*\/audio\//.test(line));
      expect(audioImport, `${path} imports audio`).toEqual([]);
    }
  });

  it('only src/audio touches Web Audio', () => {
    const banned = /\b(AudioContext|createGain|createOscillator|createBufferSource|createStereoPanner)\b/;
    for (const [path, text] of Object.entries(SOURCES)) {
      if (!path.startsWith('audio/')) {
        expect(text, path).not.toMatch(banned);
      }
    }
  });
});
