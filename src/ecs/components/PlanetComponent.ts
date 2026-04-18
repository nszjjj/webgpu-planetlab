export class PlanetComponent {
  radius: number;
  rings: number;
  segments: number;
  displaceScale: number;

  constructor(radius = 1.0, rings = 128, segments = 128, displaceScale = 0.15) {
    this.radius = radius;
    this.rings = rings;
    this.segments = segments;
    this.displaceScale = displaceScale;
  }
}
