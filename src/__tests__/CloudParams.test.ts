import { describe, it, expect } from 'vitest';
import { DEFAULT_CLOUD_PARAMS, DEFAULT_ATMOSPHERE_PARAMS } from '../core/types.ts';

describe('DEFAULT_CLOUD_PARAMS', () => {
  it('cloudInnerRadius is above planet surface', () => {
    expect(DEFAULT_CLOUD_PARAMS.cloudInnerRadius).toBeGreaterThan(
      DEFAULT_ATMOSPHERE_PARAMS.planetRadius,
    );
  });
  it('cloudOuterRadius > cloudInnerRadius', () => {
    expect(DEFAULT_CLOUD_PARAMS.cloudOuterRadius).toBeGreaterThan(
      DEFAULT_CLOUD_PARAMS.cloudInnerRadius,
    );
  });
  it('cloudOuterRadius < atmosphereRadius (clouds sit inside atmosphere)', () => {
    expect(DEFAULT_CLOUD_PARAMS.cloudOuterRadius).toBeLessThan(
      DEFAULT_ATMOSPHERE_PARAMS.atmosphereRadius,
    );
  });
  it('scaleHeight > 0', () => {
    expect(DEFAULT_CLOUD_PARAMS.scaleHeight).toBeGreaterThan(0);
  });
  it('extinction > 0', () => {
    expect(DEFAULT_CLOUD_PARAMS.extinction).toBeGreaterThan(0);
  });
  it('scatterAlbedo in (0, 1]', () => {
    expect(DEFAULT_CLOUD_PARAMS.scatterAlbedo).toBeGreaterThan(0);
    expect(DEFAULT_CLOUD_PARAMS.scatterAlbedo).toBeLessThanOrEqual(1);
  });
  it('mieG in (-1, 1)', () => {
    expect(DEFAULT_CLOUD_PARAMS.mieG).toBeGreaterThan(-1);
    expect(DEFAULT_CLOUD_PARAMS.mieG).toBeLessThan(1);
  });
  it('numSteps >= 4', () => {
    expect(DEFAULT_CLOUD_PARAMS.numSteps).toBeGreaterThanOrEqual(4);
  });
  it('coverageFreq > 0', () => {
    expect(DEFAULT_CLOUD_PARAMS.coverageFreq).toBeGreaterThan(0);
  });
  it('coverageThreshold in (0, 1)', () => {
    expect(DEFAULT_CLOUD_PARAMS.coverageThreshold).toBeGreaterThan(0);
    expect(DEFAULT_CLOUD_PARAMS.coverageThreshold).toBeLessThan(1);
  });
});
