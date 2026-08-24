import { describe, it, expect } from 'vitest';
import { PlanetComponent } from '../../../demos/planet/components/PlanetComponent.ts';

describe('PlanetComponent', () => {
  it('defaults subdivisions to 5', () => {
    const c = new PlanetComponent();
    expect(c.subdivisions).toBe(5);
  });

  it('defaults displaceScale to 0.15', () => {
    const c = new PlanetComponent();
    expect(c.displaceScale).toBe(0.15);
  });

  it('accepts custom radius, subdivisions, displaceScale', () => {
    const c = new PlanetComponent(2.0, 6, 0.25);
    expect(c.radius).toBe(2.0);
    expect(c.subdivisions).toBe(6);
    expect(c.displaceScale).toBe(0.25);
  });
});
