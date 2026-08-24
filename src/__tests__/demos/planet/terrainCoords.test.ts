import { describe, it, expect } from 'vitest';
import { octEncode, octDecode, octToIndex, OCTA_RESOLUTION } from '../../../demos/planet/utils/octahedral.ts';

describe('octEncode / octDecode round-trip', () => {
  it('north pole (0,1,0) encodes and decodes back', () => {
    const [u, v] = octEncode(0, 1, 0);
    const [x, y, z] = octDecode(u, v);
    expect(Math.abs(x)).toBeLessThan(0.001);
    expect(y).toBeCloseTo(1, 4);
    expect(Math.abs(z)).toBeLessThan(0.001);
  });

  it('south pole (0,-1,0) encodes and decodes back', () => {
    const [u, v] = octEncode(0, -1, 0);
    const [x, y, z] = octDecode(u, v);
    expect(Math.abs(x)).toBeLessThan(0.001);
    expect(y).toBeCloseTo(-1, 4);
    expect(Math.abs(z)).toBeLessThan(0.001);
  });

  it('equator point (1,0,0) round-trips', () => {
    const [u, v] = octEncode(1, 0, 0);
    const [x, y, z] = octDecode(u, v);
    expect(x).toBeCloseTo(1, 4);
    expect(Math.abs(y)).toBeLessThan(0.001);
    expect(Math.abs(z)).toBeLessThan(0.001);
  });

  it('negative z hemisphere round-trips', () => {
    const [u, v] = octEncode(0, 0, -1);
    const [x, y, z] = octDecode(u, v);
    expect(Math.abs(x)).toBeLessThan(0.001);
    expect(Math.abs(y)).toBeLessThan(0.001);
    expect(z).toBeCloseTo(-1, 4);
  });

  it('general direction round-trips within tolerance', () => {
    const tests: [number, number, number][] = [
      [ 0.577,  0.577,  0.577],
      [-0.577,  0.577,  0.577],
      [ 0.577, -0.577,  0.577],
      [ 0.577,  0.577, -0.577],
    ];
    for (const [nx, ny, nz] of tests) {
      const [u, v] = octEncode(nx, ny, nz);
      const [rx, ry, rz] = octDecode(u, v);
      expect(rx).toBeCloseTo(nx, 2);
      expect(ry).toBeCloseTo(ny, 2);
      expect(rz).toBeCloseTo(nz, 2);
    }
  });
});

describe('octToIndex', () => {
  it('returns within buffer bounds for all six axis directions', () => {
    const size = OCTA_RESOLUTION * OCTA_RESOLUTION;
    const dirs: [number, number, number][] = [
      [1,0,0], [-1,0,0], [0,1,0], [0,-1,0], [0,0,1], [0,0,-1],
    ];
    for (const d of dirs) {
      const idx = octToIndex(d[0], d[1], d[2]);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(size);
    }
  });

  it('samples evenly across octahedral UV space', () => {
    const size = OCTA_RESOLUTION * OCTA_RESOLUTION;
    for (let k = 0; k < 20; k++) {
      const idx = octToIndex(
        (k / 19) * 2 - 1,
        ((k * 1.37) % 1) * 2 - 1,
        ((k * 0.73) % 1) * 2 - 1,
      );
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(size);
    }
  });
});
