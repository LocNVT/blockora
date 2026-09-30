import { describe, it, expect } from 'vitest';
import { DAY_NIGHT_CONFIG, PAUSE_CONFIG } from '../src/config/constants';
import { PauseController, simulationDt, type PauseContext } from '../src/gameplay/pause';
import { GameTime } from '../src/world/GameTime';
import { PlayerHealth } from '../src/player/PlayerHealth';
import { PlayerHunger, SurvivalTicker } from '../src/player/PlayerHunger';

const LOCKED: PauseContext = { locked: true, screenOpen: false, dead: false };
const UNLOCKED: PauseContext = { locked: false, screenOpen: false, dead: false };
const FRAME = 1 / 60;

describe('PauseController', () => {
  it('starts paused on the start screen; the first lock resumes and ends the start screen', () => {
    const pause = new PauseController();
    expect(pause.update(FRAME, UNLOCKED)).toBe(true);
    expect(pause.isStartScreen).toBe(true);
    expect(pause.update(FRAME, LOCKED)).toBe(false);
    expect(pause.isStartScreen).toBe(false);
  });

  it('losing the lock with nothing else open pauses (Esc, alt-tab); regaining it resumes', () => {
    const pause = new PauseController();
    pause.update(FRAME, LOCKED);
    expect(pause.update(FRAME, UNLOCKED)).toBe(true);
    expect(pause.paused).toBe(true);
    expect(pause.isStartScreen).toBe(false);
    expect(pause.update(FRAME, LOCKED)).toBe(false);
  });

  it('an open screen or the death screen owns the unlocked cursor: never paused', () => {
    const pause = new PauseController();
    pause.update(FRAME, LOCKED);
    expect(pause.update(FRAME, { locked: false, screenOpen: true, dead: false })).toBe(false);
    expect(pause.update(FRAME, { locked: false, screenOpen: false, dead: true })).toBe(false);
    expect(pause.update(FRAME, { locked: false, screenOpen: true, dead: true })).toBe(false);
  });

  it('closing a screen and re-requesting the lock does not flash the menu during the grace window', () => {
    const pause = new PauseController();
    pause.update(FRAME, LOCKED);
    pause.update(FRAME, { locked: false, screenOpen: true, dead: false });
    pause.expectLock();
    expect(pause.update(FRAME, UNLOCKED)).toBe(false);
    expect(pause.update(PAUSE_CONFIG.lockGraceSeconds / 2, UNLOCKED)).toBe(false);
    // The lock never arrived (refused): the grace runs out and the menu appears.
    expect(pause.update(PAUSE_CONFIG.lockGraceSeconds, UNLOCKED)).toBe(true);
  });

  it('acquiring the lock clears the grace window', () => {
    const pause = new PauseController();
    pause.expectLock();
    pause.update(FRAME, LOCKED);
    expect(pause.update(FRAME, UNLOCKED)).toBe(true);
  });

  it('the grace window does not tick down while a screen owns the cursor', () => {
    const pause = new PauseController();
    pause.expectLock();
    pause.update(PAUSE_CONFIG.lockGraceSeconds * 2, { locked: false, screenOpen: true, dead: false });
    expect(pause.update(FRAME, UNLOCKED)).toBe(false);
  });
});

describe('simulation is frozen while paused', () => {
  it('simulationDt is 0 when paused and the frame dt otherwise', () => {
    expect(simulationDt(true, 0.016)).toBe(0);
    expect(simulationDt(false, 0.016)).toBe(0.016);
  });

  it('game time does not advance with the paused dt', () => {
    const time = new GameTime();
    const start = time.timeOfDay;
    const startElapsed = time.elapsedSeconds;
    time.advance(simulationDt(true, 5));
    expect(time.timeOfDay).toBe(start);
    expect(time.elapsedSeconds).toBe(startElapsed);
    time.advance(simulationDt(false, 5));
    expect(time.elapsedSeconds).toBe(startElapsed + 5);
    expect(DAY_NIGHT_CONFIG.dayLengthSeconds).toBeGreaterThan(5);
  });

  it('survival does not tick with the paused dt', () => {
    const health = new PlayerHealth();
    const hunger = new PlayerHunger();
    const ticker = new SurvivalTicker();
    health.damage(5, 'generic');
    health.update(simulationDt(true, 60));
    ticker.update(health, hunger, simulationDt(true, 60), { sprinting: false, jumped: false });
    expect(hunger.hunger).toBe(hunger.maxHunger);
    expect(hunger.exhaustion).toBe(0);
    expect(health.health).toBe(health.maxHealth - 5);
  });
});
