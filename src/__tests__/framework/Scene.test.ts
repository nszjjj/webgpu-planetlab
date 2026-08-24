import { describe, it, expect } from 'vitest';
import { Scene } from '../../framework/ecs/Scene.ts';
import { Entity } from '../../framework/ecs/Entity.ts';

class TagA {}
class TagB {}

describe('Scene', () => {
  it('adds entities and retrieves by component', () => {
    const scene = new Scene();
    const e1 = new Entity('e1');
    e1.addComponent(new TagA());
    const e2 = new Entity('e2');
    e2.addComponent(new TagB());
    scene.addEntity(e1);
    scene.addEntity(e2);

    const withA = scene.getEntitiesWith(TagA);
    expect(withA).toHaveLength(1);
    expect(withA[0].id).toBe('e1');
  });

  it('returns empty array when no match', () => {
    const scene = new Scene();
    scene.addEntity(new Entity('e1'));
    expect(scene.getEntitiesWith(TagA)).toHaveLength(0);
  });

  it('returns multiple matching entities', () => {
    const scene = new Scene();
    const e1 = new Entity('e1');
    e1.addComponent(new TagA());
    const e2 = new Entity('e2');
    e2.addComponent(new TagA());
    scene.addEntity(e1);
    scene.addEntity(e2);
    expect(scene.getEntitiesWith(TagA)).toHaveLength(2);
  });
});
