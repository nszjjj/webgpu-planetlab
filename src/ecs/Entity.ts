import { Transform } from './Transform.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Constructor<T> = new (...args: any[]) => T;

export class Entity {
  readonly id: string;
  readonly transform: Transform;
  private _components: Map<Constructor<unknown>, unknown> = new Map();

  constructor(id: string) {
    this.id = id;
    this.transform = new Transform();
  }

  addComponent<T>(component: T): void {
    const constructor = (component as object).constructor as Constructor<T>;
    this._components.set(constructor, component);
  }

  getComponent<T>(type: Constructor<T>): T | undefined {
    return this._components.get(type) as T | undefined;
  }
}
