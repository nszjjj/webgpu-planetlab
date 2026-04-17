import type { Entity } from './Entity.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Constructor<T> = new (...args: any[]) => T;

export class Scene {
  private _entities: Entity[] = [];
  mainCamera!: Entity;

  addEntity(entity: Entity): void {
    this._entities.push(entity);
  }

  getEntitiesWith<T>(type: Constructor<T>): Entity[] {
    return this._entities.filter(e => e.getComponent(type) !== undefined);
  }
}
