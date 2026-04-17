import { describe, it, expect } from 'vitest';
import { Transform } from '../ecs/Transform.ts';

describe('Transform', () => {
  it('starts with identity world matrix', () => {
    const t = new Transform();
    const m = t.getWorldMatrix();
    // identity diagonal
    expect(m[0]).toBeCloseTo(1);
    expect(m[5]).toBeCloseTo(1);
    expect(m[10]).toBeCloseTo(1);
    expect(m[15]).toBeCloseTo(1);
    // off-diagonal zeros
    expect(m[1]).toBeCloseTo(0);
    expect(m[4]).toBeCloseTo(0);
  });

  it('marks dirty when position changes', () => {
    const t = new Transform();
    t.getWorldMatrix(); // clears dirty
    t.setPosition(1, 2, 3);
    // worldMatrix should reflect new position (translation in column 3)
    const m = t.getWorldMatrix();
    expect(m[12]).toBeCloseTo(1); // tx
    expect(m[13]).toBeCloseTo(2); // ty
    expect(m[14]).toBeCloseTo(3); // tz
  });

  it('caches matrix when not dirty', () => {
    const t = new Transform();
    const m1 = t.getWorldMatrix();
    const m2 = t.getWorldMatrix();
    expect(m1).toBe(m2); // same reference — no reallocation
  });

  it('applies scale', () => {
    const t = new Transform();
    t.setScale(2, 2, 2);
    const m = t.getWorldMatrix();
    expect(m[0]).toBeCloseTo(2);  // sx
    expect(m[5]).toBeCloseTo(2);  // sy
    expect(m[10]).toBeCloseTo(2); // sz
  });
});
