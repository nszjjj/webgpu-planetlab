// Icosphere mesh generator.
// Produces a nearly-uniform triangle mesh by subdividing a regular icosahedron
// and projecting onto the unit sphere. No polar pinching like UV spheres.

export interface IcosphereMesh {
  vertices: Float32Array;  // [x,y,z, x,y,z, ...]  length = vertexCount * 3
  indices:  Uint32Array;   // triangle list, CCW winding
}

/**
 * Generate an icosphere with the given subdivision level.
 *
 * Vertex / index counts by subdivision:
 *   0:     12 verts,      60 indices
 *   1:     42 verts,     240 indices
 *   2:    162 verts,     960 indices
 *   3:    642 verts,   3,840 indices
 *   4:  2,562 verts,  15,360 indices
 *   5: 10,242 verts,  61,440 indices
 *   6: 40,962 verts, 245,760 indices
 */
export function generateIcosphere(subdivisions: number): IcosphereMesh {
  const { vertices, faces } = buildBaseIcosahedron();
  subdivide(vertices, faces, subdivisions);
  return flatten(vertices, faces);
}

// ── Base icosahedron ──────────────────────────────────────────────────────

function buildBaseIcosahedron(): { vertices: number[][]; faces: number[][] } {
  const t   = (1 + Math.sqrt(5)) / 2;
  const len = Math.sqrt(1 + t * t);

  const raw: number[][] = [
    [-1,  t,  0], [ 1,  t,  0], [-1, -t,  0], [ 1, -t,  0],
    [ 0, -1,  t], [ 0,  1,  t], [ 0, -1, -t], [ 0,  1, -t],
    [ t,  0, -1], [ t,  0,  1], [-t,  0, -1], [-t,  0,  1],
  ];

  const vertices = raw.map(([x, y, z]) => [x / len, y / len, z / len]);

  // Adjacency via dot product threshold: cos(edge_angle) = 1/√5 ≈ 0.447
  const neighbors: number[][] = Array.from({ length: 12 }, () => []);
  for (let i = 0; i < 12; i++) {
    for (let j = i + 1; j < 12; j++) {
      const dot = vertices[i][0] * vertices[j][0]
                + vertices[i][1] * vertices[j][1]
                + vertices[i][2] * vertices[j][2];
      if (dot > 0.4) {
        neighbors[i].push(j);
        neighbors[j].push(i);
      }
    }
  }

  // Walk adjacency to build faces (each vertex + adjacent pair → face)
  const faceSet = new Set<string>();
  const faces: number[][] = [];

  for (let v = 0; v < 12; v++) {
    const nbrs = neighbors[v];
    for (let a = 0; a < nbrs.length; a++) {
      for (let b = a + 1; b < nbrs.length; b++) {
        const na = nbrs[a];
        const nb = nbrs[b];
        if (!neighbors[na].includes(nb)) continue;

        const sorted = [v, na, nb].sort((x, y) => x - y);
        const key = sorted.join(',');
        if (faceSet.has(key)) continue;
        faceSet.add(key);

        // Ensure CCW winding: normal should point outward from origin
        const v0 = vertices[v];
        const v1 = vertices[na];
        const v2 = vertices[nb];
        const ex = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
        const ey = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
        const nx = ex[1] * ey[2] - ex[2] * ey[1];
        const ny = ex[2] * ey[0] - ex[0] * ey[2];
        const nz = ex[0] * ey[1] - ex[1] * ey[0];
        const outward = nx * v0[0] + ny * v0[1] + nz * v0[2] > 0;
        faces.push(outward ? [v, na, nb] : [v, nb, na]);
      }
    }
  }

  return { vertices, faces };
}

// ── Subdivision ───────────────────────────────────────────────────────────

function subdivide(
  vertices: number[][],
  faces: number[][],
  levels: number,
): void {
  const midCache = new Map<string, number>();

  function getMid(i: number, j: number): number {
    const key = i < j ? `${i},${j}` : `${j},${i}`;
    const cached = midCache.get(key);
    if (cached !== undefined) return cached;

    const vi = vertices[i];
    const vj = vertices[j];
    const mx = (vi[0] + vj[0]) / 2;
    const my = (vi[1] + vj[1]) / 2;
    const mz = (vi[2] + vj[2]) / 2;
    const il = 1 / Math.sqrt(mx * mx + my * my + mz * mz);
    vertices.push([mx * il, my * il, mz * il]);
    const idx = vertices.length - 1;
    midCache.set(key, idx);
    return idx;
  }

  for (let level = 0; level < levels; level++) {
    midCache.clear();
    const newFaces: number[][] = [];
    for (const [a, b, c] of faces) {
      const ab = getMid(a, b);
      const bc = getMid(b, c);
      const ca = getMid(c, a);
      newFaces.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
    }
    faces.length = 0;
    faces.push(...newFaces);
  }
}

// ── Flatten to typed arrays ──────────────────────────────────────────────

function flatten(
  vertices: number[][],
  faces: number[][],
): IcosphereMesh {
  const vCount = vertices.length;
  const verts  = new Float32Array(vCount * 3);
  for (let i = 0; i < vCount; i++) {
    const v = vertices[i];
    verts[i * 3]     = v[0];
    verts[i * 3 + 1] = v[1];
    verts[i * 3 + 2] = v[2];
  }

  const indices = new Uint32Array(faces.length * 3);
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    indices[i * 3]     = f[0];
    indices[i * 3 + 1] = f[1];
    indices[i * 3 + 2] = f[2];
  }

  return { vertices: verts, indices };
}
