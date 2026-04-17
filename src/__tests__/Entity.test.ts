import { describe, it, expect } from 'vitest';
import { Entity } from '../ecs/Entity.ts';

class TestComponent {
  value = 42;
}

class OtherComponent {
  label = 'hello';
}

describe('Entity', () => {
  it('has a transform by default', () => {
    const e = new Entity('test');
    expect(e.transform).toBeDefined();
  });

  it('adds and retrieves a component', () => {
    const e = new Entity('test');
    e.addComponent(new TestComponent());
    const c = e.getComponent(TestComponent);
    expect(c).toBeDefined();
    expect(c!.value).toBe(42);
  });

  it('returns undefined for missing component', () => {
    const e = new Entity('test');
    expect(e.getComponent(TestComponent)).toBeUndefined();
  });

  it('overwrites component of same type', () => {
    const e = new Entity('test');
    const c1 = new TestComponent();
    c1.value = 1;
    e.addComponent(c1);
    const c2 = new TestComponent();
    c2.value = 2;
    e.addComponent(c2);
    expect(e.getComponent(TestComponent)!.value).toBe(2);
  });

  it('stores multiple component types independently', () => {
    const e = new Entity('test');
    e.addComponent(new TestComponent());
    e.addComponent(new OtherComponent());
    expect(e.getComponent(TestComponent)).toBeDefined();
    expect(e.getComponent(OtherComponent)).toBeDefined();
  });
});
