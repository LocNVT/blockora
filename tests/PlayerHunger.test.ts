import { describe, it, expect } from 'vitest';
import { PlayerHunger, SurvivalTicker } from '../src/player/PlayerHunger';
import { PlayerHealth } from '../src/player/PlayerHealth';
import { SURVIVAL_CONFIG } from '../src/config/constants';

describe('PlayerHunger', () => {
  it('starts at max hunger', () => {
    const hunger = new PlayerHunger();
    expect(hunger.hunger).toBe(SURVIVAL_CONFIG.maxHunger);
    expect(hunger.exhaustion).toBe(0);
  });

  it('addExhaustion converts exactly exhaustionPerHungerPoint into 1 lost hunger point', () => {
    const hunger = new PlayerHunger();
    hunger.addExhaustion(SURVIVAL_CONFIG.exhaustionPerHungerPoint);
    expect(hunger.hunger).toBe(SURVIVAL_CONFIG.maxHunger - 1);
    expect(hunger.exhaustion).toBeCloseTo(0, 9);
  });

  it('addExhaustion below the conversion threshold only banks exhaustion', () => {
    const hunger = new PlayerHunger();
    const half = SURVIVAL_CONFIG.exhaustionPerHungerPoint / 2;
    hunger.addExhaustion(half);
    expect(hunger.hunger).toBe(SURVIVAL_CONFIG.maxHunger);
    expect(hunger.exhaustion).toBeCloseTo(half, 9);
  });

  it('addExhaustion carries over leftover past a conversion', () => {
    const hunger = new PlayerHunger();
    const perPoint = SURVIVAL_CONFIG.exhaustionPerHungerPoint;
    hunger.addExhaustion(perPoint * 1.5);
    expect(hunger.hunger).toBe(SURVIVAL_CONFIG.maxHunger - 1);
    expect(hunger.exhaustion).toBeCloseTo(perPoint * 0.5, 9);
  });

  it('addExhaustion can trigger multiple conversions in one call', () => {
    const hunger = new PlayerHunger();
    const perPoint = SURVIVAL_CONFIG.exhaustionPerHungerPoint;
    hunger.addExhaustion(perPoint * 3);
    expect(hunger.hunger).toBe(SURVIVAL_CONFIG.maxHunger - 3);
  });

  it('addExhaustion clamps hunger at 0 (never negative)', () => {
    const hunger = new PlayerHunger(5);
    hunger.addExhaustion(SURVIVAL_CONFIG.exhaustionPerHungerPoint * 999);
    expect(hunger.hunger).toBe(0);
  });

  it('addExhaustion ignores non-positive amounts', () => {
    const hunger = new PlayerHunger();
    hunger.addExhaustion(0);
    hunger.addExhaustion(-5);
    expect(hunger.hunger).toBe(SURVIVAL_CONFIG.maxHunger);
    expect(hunger.exhaustion).toBe(0);
  });

  it('eat clamps at maxHunger', () => {
    const hunger = new PlayerHunger();
    hunger.addExhaustion(SURVIVAL_CONFIG.exhaustionPerHungerPoint * 2); // hunger = max - 2
    hunger.eat(999);
    expect(hunger.hunger).toBe(SURVIVAL_CONFIG.maxHunger);
  });

  it('eat restores the exact food points given (under max)', () => {
    const hunger = new PlayerHunger();
    hunger.addExhaustion(SURVIVAL_CONFIG.exhaustionPerHungerPoint * 5); // hunger = max - 5
    hunger.eat(3);
    expect(hunger.hunger).toBe(SURVIVAL_CONFIG.maxHunger - 2);
  });

  it('eat ignores non-positive amounts', () => {
    const hunger = new PlayerHunger();
    hunger.addExhaustion(SURVIVAL_CONFIG.exhaustionPerHungerPoint * 2);
    const before = hunger.hunger;
    hunger.eat(0);
    hunger.eat(-1);
    expect(hunger.hunger).toBe(before);
  });

  it('canEat is true below max, false at max', () => {
    const hunger = new PlayerHunger();
    expect(hunger.canEat()).toBe(false);
    hunger.addExhaustion(SURVIVAL_CONFIG.exhaustionPerHungerPoint);
    expect(hunger.canEat()).toBe(true);
  });

  it('canSprint is true above sprintMinHunger, false at or below it', () => {
    const hunger = new PlayerHunger();
    expect(hunger.canSprint()).toBe(true);

    const perPoint = SURVIVAL_CONFIG.exhaustionPerHungerPoint;
    const pointsToLose = SURVIVAL_CONFIG.maxHunger - SURVIVAL_CONFIG.sprintMinHunger;
    hunger.addExhaustion(perPoint * pointsToLose);
    expect(hunger.hunger).toBe(SURVIVAL_CONFIG.sprintMinHunger);
    expect(hunger.canSprint()).toBe(false);

    hunger.addExhaustion(perPoint); // one more point lost
    expect(hunger.canSprint()).toBe(false);
  });

  it('reset restores full hunger and clears exhaustion', () => {
    const hunger = new PlayerHunger();
    hunger.addExhaustion(SURVIVAL_CONFIG.exhaustionPerHungerPoint * 2 + 1);
    hunger.reset();
    expect(hunger.hunger).toBe(SURVIVAL_CONFIG.maxHunger);
    expect(hunger.exhaustion).toBe(0);
  });
});

describe('SurvivalTicker: idle/sprint/jump exhaustion', () => {
  it('idle drains hunger at the configured per-second rate over simulated time', () => {
    const health = new PlayerHealth();
    const hunger = new PlayerHunger();
    const ticker = new SurvivalTicker();

    const perPoint = SURVIVAL_CONFIG.exhaustionPerHungerPoint;
    const secondsFor1Point = perPoint / SURVIVAL_CONFIG.idleExhaustionPerSecond;

    // Step in small increments so we don't accidentally cross a regen tick
    // (regen only fires when hunger >= regenHungerThreshold and health < max,
    // and health starts at max, so it won't fire here anyway).
    const steps = 100;
    const dtPerStep = secondsFor1Point / steps;
    for (let i = 0; i < steps; i += 1) {
      ticker.update(health, hunger, dtPerStep, { sprinting: false, jumped: false });
    }

    expect(hunger.hunger).toBe(SURVIVAL_CONFIG.maxHunger - 1);
  });

  it('sprinting drains hunger faster than idle over the same duration', () => {
    const healthIdle = new PlayerHealth();
    const hungerIdle = new PlayerHunger();
    const tickerIdle = new SurvivalTicker();

    const healthSprint = new PlayerHealth();
    const hungerSprint = new PlayerHunger();
    const tickerSprint = new SurvivalTicker();

    const duration = 5; // seconds
    tickerIdle.update(healthIdle, hungerIdle, duration, { sprinting: false, jumped: false });
    tickerSprint.update(healthSprint, hungerSprint, duration, { sprinting: true, jumped: false });

    expect(hungerSprint.exhaustion + (SURVIVAL_CONFIG.maxHunger - hungerSprint.hunger) * SURVIVAL_CONFIG.exhaustionPerHungerPoint).toBeGreaterThan(
      hungerIdle.exhaustion + (SURVIVAL_CONFIG.maxHunger - hungerIdle.hunger) * SURVIVAL_CONFIG.exhaustionPerHungerPoint,
    );
  });

  it('jump adds a fixed exhaustion amount on the frame it happens', () => {
    const health = new PlayerHealth();
    const hunger = new PlayerHunger();
    const ticker = new SurvivalTicker();

    // dt=0 isolates the jump's fixed exhaustion from idle/sprint per-second drain.
    ticker.update(health, hunger, 0, { sprinting: false, jumped: true });
    expect(hunger.exhaustion).toBeCloseTo(SURVIVAL_CONFIG.jumpExhaustion, 9);
  });

  it('nothing happens while dead', () => {
    const health = new PlayerHealth(1);
    health.damage(1, 'generic');
    expect(health.isDead).toBe(true);
    const hunger = new PlayerHunger();
    const ticker = new SurvivalTicker();

    ticker.update(health, hunger, 100, { sprinting: true, jumped: true });
    expect(hunger.hunger).toBe(SURVIVAL_CONFIG.maxHunger);
    expect(hunger.exhaustion).toBe(0);
  });
});

describe('SurvivalTicker: regeneration', () => {
  it('heals 1 HP per regenInterval while hunger >= threshold and health < max, and costs exhaustion', () => {
    const health = new PlayerHealth();
    health.damage(5, 'generic');
    const hunger = new PlayerHunger();
    const ticker = new SurvivalTicker();

    ticker.update(health, hunger, SURVIVAL_CONFIG.regenInterval, { sprinting: false, jumped: false });

    expect(health.health).toBe(SURVIVAL_CONFIG.maxHealth - 5 + 1);
    // Exhaustion charged for the heal (idle drain over the interval is tiny
    // and may have already converted into <1 hunger point, but the regen
    // exhaustion itself must show up).
    const idleExhaustion = SURVIVAL_CONFIG.idleExhaustionPerSecond * SURVIVAL_CONFIG.regenInterval;
    const totalExpected = idleExhaustion + SURVIVAL_CONFIG.regenExhaustion;
    const perPoint = SURVIVAL_CONFIG.exhaustionPerHungerPoint;
    const expectedHungerLoss = Math.floor(totalExpected / perPoint);
    expect(hunger.hunger).toBe(SURVIVAL_CONFIG.maxHunger - expectedHungerLoss);
  });

  it('does not regenerate below the hunger threshold', () => {
    const health = new PlayerHealth();
    health.damage(5, 'generic');
    const hunger = new PlayerHunger();
    const perPoint = SURVIVAL_CONFIG.exhaustionPerHungerPoint;
    const pointsBelowThreshold = SURVIVAL_CONFIG.maxHunger - SURVIVAL_CONFIG.regenHungerThreshold + 1;
    hunger.addExhaustion(perPoint * pointsBelowThreshold);
    expect(hunger.hunger).toBeLessThan(SURVIVAL_CONFIG.regenHungerThreshold);

    const ticker = new SurvivalTicker();
    ticker.update(health, hunger, SURVIVAL_CONFIG.regenInterval * 3, { sprinting: false, jumped: false });

    expect(health.health).toBe(SURVIVAL_CONFIG.maxHealth - 5);
  });

  it('does not regenerate at max health', () => {
    const health = new PlayerHealth();
    const hunger = new PlayerHunger();
    const ticker = new SurvivalTicker();

    ticker.update(health, hunger, SURVIVAL_CONFIG.regenInterval * 3, { sprinting: false, jumped: false });

    expect(health.health).toBe(SURVIVAL_CONFIG.maxHealth);
  });

  it('regen timer does not advance while below threshold, and resumes once above it', () => {
    const health = new PlayerHealth();
    health.damage(3, 'generic');
    const hunger = new PlayerHunger();
    hunger.addExhaustion(
      SURVIVAL_CONFIG.exhaustionPerHungerPoint *
        (SURVIVAL_CONFIG.maxHunger - (SURVIVAL_CONFIG.regenHungerThreshold - 1)),
    );
    expect(hunger.hunger).toBe(SURVIVAL_CONFIG.regenHungerThreshold - 1);
    const ticker = new SurvivalTicker();

    // Below threshold: timer held at 0, no heal even after a long time.
    ticker.update(health, hunger, SURVIVAL_CONFIG.regenInterval * 2, { sprinting: false, jumped: false });
    expect(health.health).toBe(SURVIVAL_CONFIG.maxHealth - 3);

    // Feed hunger back above threshold, then a fresh full interval should heal.
    hunger.eat(SURVIVAL_CONFIG.maxHunger);
    ticker.update(health, hunger, SURVIVAL_CONFIG.regenInterval, { sprinting: false, jumped: false });
    expect(health.health).toBe(SURVIVAL_CONFIG.maxHealth - 3 + 1);
  });
});

describe('SurvivalTicker: starvation', () => {
  it('damages 1 HP per starvationInterval while hunger is 0', () => {
    const health = new PlayerHealth();
    const hunger = new PlayerHunger(0);
    const ticker = new SurvivalTicker();

    ticker.update(health, hunger, SURVIVAL_CONFIG.starvationInterval, { sprinting: false, jumped: false });
    expect(health.health).toBe(SURVIVAL_CONFIG.maxHealth - 1);
  });

  it('stops damaging at starvationMinHealth (never kills via starvation alone)', () => {
    const health = new PlayerHealth(SURVIVAL_CONFIG.starvationMinHealth);
    const hunger = new PlayerHunger(0);
    const ticker = new SurvivalTicker();

    ticker.update(health, hunger, SURVIVAL_CONFIG.starvationInterval * 50, { sprinting: false, jumped: false });

    expect(health.health).toBe(SURVIVAL_CONFIG.starvationMinHealth);
    expect(health.isDead).toBe(false);
  });

  it('never brings health below starvationMinHealth even starting just above it', () => {
    const health = new PlayerHealth(SURVIVAL_CONFIG.starvationMinHealth + 1);
    const hunger = new PlayerHunger(0);
    const ticker = new SurvivalTicker();

    ticker.update(health, hunger, SURVIVAL_CONFIG.starvationInterval * 50, { sprinting: false, jumped: false });

    expect(health.health).toBe(SURVIVAL_CONFIG.starvationMinHealth);
  });

  it('does not damage above hunger 0', () => {
    const health = new PlayerHealth();
    const hunger = new PlayerHunger(1);
    const ticker = new SurvivalTicker();

    ticker.update(health, hunger, SURVIVAL_CONFIG.starvationInterval * 3, { sprinting: false, jumped: false });
    expect(health.health).toBe(SURVIVAL_CONFIG.maxHealth);
  });
});

describe('SurvivalTicker: determinism', () => {
  it('many small dt steps produce the same result as few large dt steps (within tolerance)', () => {
    const healthA = new PlayerHealth();
    healthA.damage(10, 'generic');
    const hungerA = new PlayerHunger();
    const tickerA = new SurvivalTicker();

    const healthB = new PlayerHealth();
    healthB.damage(10, 'generic');
    const hungerB = new PlayerHunger();
    const tickerB = new SurvivalTicker();

    const totalTime = SURVIVAL_CONFIG.regenInterval * 10;

    // A: few large steps.
    const largeSteps = 5;
    for (let i = 0; i < largeSteps; i += 1) {
      tickerA.update(healthA, hungerA, totalTime / largeSteps, { sprinting: false, jumped: false });
    }

    // B: many small steps.
    const smallSteps = 5000;
    for (let i = 0; i < smallSteps; i += 1) {
      tickerB.update(healthB, hungerB, totalTime / smallSteps, { sprinting: false, jumped: false });
    }

    expect(healthA.health).toBe(healthB.health);
    expect(hungerA.hunger).toBe(hungerB.hunger);
  });

  it('clamps a negative dt to 0 (no reverse effects)', () => {
    const health = new PlayerHealth();
    const hunger = new PlayerHunger();
    const ticker = new SurvivalTicker();

    ticker.update(health, hunger, -100, { sprinting: true, jumped: true });
    // Jump exhaustion still applies (it's a fixed per-call amount, not
    // dt-scaled), but no per-second drain from the negative dt.
    expect(hunger.exhaustion).toBeCloseTo(SURVIVAL_CONFIG.jumpExhaustion, 9);
    expect(health.health).toBe(SURVIVAL_CONFIG.maxHealth);
  });
});
