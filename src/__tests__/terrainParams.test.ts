import { describe, it, expect } from 'vitest';
import { DEFAULT_NOISE_PARAMS, DEFAULT_CLASSIFY_PARAMS } from '../core/types.ts';

describe('DEFAULT_NOISE_PARAMS', () => {
  it('frequencies increase from continent to detail', () => {
    const p = DEFAULT_NOISE_PARAMS;
    expect(p.mountain_freq).toBeGreaterThan(p.continent_freq);
    expect(p.detail_freq).toBeGreaterThan(p.mountain_freq);
  });

  it('persistence is in (0, 1)', () => {
    expect(DEFAULT_NOISE_PARAMS.continent_persistence).toBeGreaterThan(0);
    expect(DEFAULT_NOISE_PARAMS.continent_persistence).toBeLessThan(1);
  });
});

describe('DEFAULT_CLASSIFY_PARAMS', () => {
  it('height thresholds are in ascending order', () => {
    const p = DEFAULT_CLASSIFY_PARAMS;
    expect(p.water_max).toBeLessThan(p.sand_max);
    expect(p.sand_max).toBeLessThan(p.grass_max);
    expect(p.grass_max).toBeLessThan(p.rock_max);
    expect(p.rock_max).toBeLessThan(1.0);
  });

  it('ore_noise_freq is positive', () => {
    expect(DEFAULT_CLASSIFY_PARAMS.ore_noise_freq).toBeGreaterThan(0);
  });

  it('ore thresholds are in (0.5, 1) and ascending', () => {
    const p = DEFAULT_CLASSIFY_PARAMS;
    expect(p.ore_iron_threshold).toBeGreaterThan(0.5);
    expect(p.ore_rare_threshold).toBeGreaterThan(p.ore_iron_threshold);
    expect(p.ore_rare_threshold).toBeLessThan(1.0);
  });
});
