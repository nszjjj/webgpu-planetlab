import { describe, it, expect } from 'vitest';
import { sphericalToIndex, TERRAIN_RESOLUTION } from '../utils/terrainCoords.ts';

describe('sphericalToIndex', () => {
  it('maps north pole (θ=0, φ=0) to index 0', () => {
    expect(sphericalToIndex(0, 0)).toBe(0);
  });

  it('maps south pole row (θ=π, φ=0) to index 261632', () => {
    // i = floor(π/π × 511) = 511, j = 0 → 511 * 512 + 0
    expect(sphericalToIndex(Math.PI, 0)).toBe(261632);
  });

  it('maps negative phi to same index as equivalent positive phi', () => {
    // φ = -π and φ = π both normalize to the same grid column
    const a = sphericalToIndex(Math.PI / 2, Math.PI);
    const b = sphericalToIndex(Math.PI / 2, -Math.PI);
    expect(a).toBe(b);
  });

  it('wraps phi values outside [-π, π] correctly', () => {
    // -3π/2 is the same angle as π/2
    const a = sphericalToIndex(Math.PI / 2, Math.PI / 2);
    const b = sphericalToIndex(Math.PI / 2, -3 * Math.PI / 2);
    expect(a).toBe(b);
  });

  it('all sampled indices stay within buffer bounds', () => {
    const size = TERRAIN_RESOLUTION * TERRAIN_RESOLUTION;
    for (let k = 0; k < 10; k++) {
      const theta = (k / 9) * Math.PI;
      const phi   = (k / 9) * 2 * Math.PI;
      const idx   = sphericalToIndex(theta, phi);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(size);
    }
  });
});
