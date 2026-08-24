// Octahedral mapping: uniform spherical parameterization.
// Replaces latitude/longitude (theta/phi) grids which concentrate samples at poles.
//
// Based on Cigolle et al. 2014 "A Survey of Efficient Representations for Independent Unit Vectors"
// Used in Unreal Engine, Unity, etc. for environment map sampling.

export const OCTA_RESOLUTION = 512;

/** Unit vector → octahedral UV in [0,1]² */
export function octEncode(nx: number, ny: number, nz: number): [number, number] {
  const absSum = Math.abs(nx) + Math.abs(ny) + Math.abs(nz);
  let px = nx / absSum;
  let py = ny / absSum;
  if (nz < 0) {
    const sx = Math.sign(px) || 1;
    const sy = Math.sign(py) || 1;
    const oldPx = px;
    px = (1 - Math.abs(py)) * sx;
    py = (1 - Math.abs(oldPx)) * sy;
  }
  return [px * 0.5 + 0.5, py * 0.5 + 0.5];
}

/** Octahedral UV in [0,1]² → unit vector */
export function octDecode(u: number, v: number): [number, number, number] {
  let px = u * 2 - 1;
  let py = v * 2 - 1;
  const z = 1 - Math.abs(px) - Math.abs(py);
  let nx: number, ny: number, nz: number;
  if (z >= 0) {
    nx = px;
    ny = py;
    nz = z;
  } else {
    const sx = Math.sign(px) || 1;
    const sy = Math.sign(py) || 1;
    nx = (1 - Math.abs(py)) * sx;
    ny = (1 - Math.abs(px)) * sy;
    nz = z;
  }
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  return [nx / len, ny / len, nz / len];
}

/** Unit vector → flat buffer index (i = v * res, j = u * res) */
export function octToIndex(
  nx: number,
  ny: number,
  nz: number,
  resolution = OCTA_RESOLUTION,
): number {
  const [u, v] = octEncode(nx, ny, nz);
  const i = Math.max(0, Math.min(resolution - 1, (v * resolution) | 0));
  const j = Math.max(0, Math.min(resolution - 1, (u * resolution) | 0));
  return i * resolution + j;
}

/** Buffer index (i, j) → unit vector at texel center */
export function indexToOct(i: number, j: number, resolution = OCTA_RESOLUTION): [number, number, number] {
  const u = (j + 0.5) / resolution;
  const v = (i + 0.5) / resolution;
  return octDecode(u, v);
}

// ── WGSL constant for embedding in shaders ─────────────────────────────────

/** Inserts `const OCTA_RES: u32 = 512u;` — use as a shader prelude constant. */
export const WGSL_OCTA_CONST = 'const OCTA_RES: u32 = 512u;';
