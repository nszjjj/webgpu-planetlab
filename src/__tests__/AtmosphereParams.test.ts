import { describe, it, expect } from 'vitest';
import { DEFAULT_ATMOSPHERE_PARAMS } from '../core/types.ts';

describe('DEFAULT_ATMOSPHERE_PARAMS', () => {
  it('atmosphereRadius is greater than planetRadius', () => {
    const p = DEFAULT_ATMOSPHERE_PARAMS;
    expect(p.atmosphereRadius).toBeGreaterThan(p.planetRadius);
  });

  it('betaR channels are all positive', () => {
    for (const v of DEFAULT_ATMOSPHERE_PARAMS.betaR) {
      expect(v).toBeGreaterThan(0);
    }
  });

  it('betaR is physically ordered: blue > green > red', () => {
    const [r, g, b] = DEFAULT_ATMOSPHERE_PARAMS.betaR;
    expect(g).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  it('mieG is in the open interval (-1, 1)', () => {
    const g = DEFAULT_ATMOSPHERE_PARAMS.mieG;
    expect(g).toBeGreaterThan(-1);
    expect(g).toBeLessThan(1);
  });

  it('numSamples and numLightSamples are at least 1', () => {
    const p = DEFAULT_ATMOSPHERE_PARAMS;
    expect(p.numSamples).toBeGreaterThanOrEqual(1);
    expect(p.numLightSamples).toBeGreaterThanOrEqual(1);
  });
});
