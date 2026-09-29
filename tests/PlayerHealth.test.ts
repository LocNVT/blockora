import { describe, it, expect } from 'vitest';
import { PlayerHealth } from '../src/player/PlayerHealth';
import { SURVIVAL_CONFIG } from '../src/config/constants';

describe('PlayerHealth', () => {
  it('starts at max health, alive', () => {
    const health = new PlayerHealth();
    expect(health.health).toBe(SURVIVAL_CONFIG.maxHealth);
    expect(health.maxHealth).toBe(SURVIVAL_CONFIG.maxHealth);
    expect(health.isDead).toBe(false);
  });

  it('applies damage and returns the amount applied', () => {
    const health = new PlayerHealth(20);
    const applied = health.damage(5, 'generic');
    expect(applied).toBe(5);
    expect(health.health).toBe(15);
  });

  it('ignores non-positive damage', () => {
    const health = new PlayerHealth(20);
    expect(health.damage(0, 'generic')).toBe(0);
    expect(health.damage(-3, 'generic')).toBe(0);
    expect(health.health).toBe(20);
  });

  it('clamps damage at 0 and marks dead', () => {
    const health = new PlayerHealth(10);
    const applied = health.damage(999, 'generic');
    expect(applied).toBe(10);
    expect(health.health).toBe(0);
    expect(health.isDead).toBe(true);
  });

  it('ignores further damage while dead', () => {
    const health = new PlayerHealth(10);
    health.damage(10, 'generic');
    expect(health.isDead).toBe(true);
    expect(health.damage(5, 'generic')).toBe(0);
    expect(health.health).toBe(0);
  });

  it('invulnerability window blocks a second non-void hit, then expires', () => {
    const health = new PlayerHealth(20);
    expect(health.damage(5, 'generic')).toBe(5);
    // Still within the invulnerability window: ignored.
    expect(health.damage(5, 'generic')).toBe(0);
    expect(health.health).toBe(15);

    health.update(SURVIVAL_CONFIG.damageInvulnerability);
    // Window has fully elapsed: damage applies again.
    expect(health.damage(5, 'generic')).toBe(5);
    expect(health.health).toBe(10);
  });

  it('void damage bypasses invulnerability', () => {
    const health = new PlayerHealth(20);
    health.damage(5, 'generic');
    // Still invulnerable to 'generic', but void ignores it.
    expect(health.damage(3, 'void')).toBe(3);
    expect(health.health).toBe(12);
  });

  it('heal clamps at maxHealth', () => {
    const health = new PlayerHealth(20);
    health.damage(5, 'generic');
    health.heal(999);
    expect(health.health).toBe(20);
  });

  it('heal and damage are no-ops while dead', () => {
    const health = new PlayerHealth(10);
    health.damage(10, 'generic');
    expect(health.isDead).toBe(true);
    health.heal(5);
    expect(health.health).toBe(0);
  });

  it('reset restores full health and clears death', () => {
    const health = new PlayerHealth(10);
    health.damage(10, 'generic');
    expect(health.isDead).toBe(true);
    health.reset();
    expect(health.isDead).toBe(false);
    expect(health.health).toBe(10);
    // Invulnerability window is also cleared: damage applies immediately.
    expect(health.damage(3, 'generic')).toBe(3);
  });

  it('update clamps a negative dt to 0 (never extends the window backwards)', () => {
    const health = new PlayerHealth(20);
    health.damage(5, 'generic');
    health.update(-1);
    // Window should not have advanced (dt clamped to 0), so still invulnerable.
    expect(health.damage(5, 'generic')).toBe(0);
  });
});
