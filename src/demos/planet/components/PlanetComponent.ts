export class PlanetComponent {
  radius: number;
  subdivisions: number;   // icosphere subdivision level (5 ≈ 10K verts)
  displaceScale: number;

  constructor(radius = 1.0, subdivisions = 5, displaceScale = 0.15) {
    this.radius = radius;
    this.subdivisions = subdivisions;
    this.displaceScale = displaceScale;
  }
}
