// src/ecs/components/SunComponent.ts
export class SunComponent {
  worldPosition: [number, number, number];
  constructor(worldPosition: [number, number, number] = [100, 50, 0]) {
    this.worldPosition = worldPosition;
  }
}
