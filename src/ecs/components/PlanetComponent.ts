export class PlanetComponent {
  radius: number;
  rings: number;
  segments: number;

  constructor(radius = 1.0, rings = 64, segments = 64) {
    this.radius = radius;
    this.rings = rings;
    this.segments = segments;
  }
}
