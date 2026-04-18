import { describe, it, expect } from 'vitest';
import { PlanetComponent } from '../ecs/components/PlanetComponent.ts';

describe('PlanetComponent', () => {
  it('defaults rings and segments to 128', () => {
    const c = new PlanetComponent();
    expect(c.rings).toBe(128);
    expect(c.segments).toBe(128);
  });

  it('defaults displaceScale to 0.15', () => {
    const c = new PlanetComponent();
    expect(c.displaceScale).toBe(0.15);
  });

  it('accepts custom radius, rings, segments, displaceScale', () => {
    const c = new PlanetComponent(2.0, 64, 64, 0.25);
    expect(c.radius).toBe(2.0);
    expect(c.rings).toBe(64);
    expect(c.segments).toBe(64);
    expect(c.displaceScale).toBe(0.25);
  });
});
