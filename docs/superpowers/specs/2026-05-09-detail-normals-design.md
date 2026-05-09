# Detail Normals from Height Buffer — Design Spec

**Date:** 2026-05-09
**Scope:** New `NormalComputeNode` that precomputes displaced-surface normals, replacing smooth sphere normals in `PlanetRenderNode`

## 1. Goal

Replace the current smooth-sphere normals (`normalize(localPos)`) with normals computed from the displaced terrain geometry, so PBR lighting reflects terrain detail (hills, mountains, valleys). The terrain height field is static after frame 1, so normals are precomputed once.

## 2. Architecture

### 2.1 Data flow

```
ComputeNoiseNode (first frame)
  Pass A: noise_gen    → terrain.height
  Pass B: classify     → terrain.splat

NormalComputeNode (first frame)  [NEW — independent Node]
  Pass: normal_gen     → terrain.normal

PlanetRenderNode (every frame)
  vs_main: normal_buffer[oct_to_index(localPos)] → worldNormal
  fs_main: PBR with detail N (no changes)
```

### 2.2 Rationale for independent Node

Each precompute step is a self-contained Node in the Render Graph, consistent with the project's architecture principle: "每个 Node 只负责一个 pass，通过有名字的 GPU 资源传递数据". Future precompute passes (erosion, curvature, AO) follow the same pattern — one Node per pass, inserted in dependency order.

### 2.3 Buffer layout

`terrain.normal` — 512×512 f32 array, 3 floats per texel (xyz), indexed as:
- x = buffer[idx * 3]
- y = buffer[idx * 3 + 1]
- z = buffer[idx * 3 + 2]

Uses `array<f32>` instead of `array<vec3<f32>>` to avoid 16-byte vec3 padding in storage buffers. Total size: 512×512×3×4 = 3,145,728 bytes (~3 MB).

### 2.4 Normals in local space

Normals are computed in local (model) space. The vertex shader transforms them to world space via the model matrix. If `displaceScale` changes in the future, only `NormalComputeNode` needs to re-run (update `terrain.normal` buffer).

## 3. Shader: normal_gen.wgsl (new)

**Input:** `terrain.height` (storage, array<f32>), `displaceScale` uniform
**Output:** `terrain.normal` (storage, array<f32>)
**Dispatch:** 512×512, one thread per texel

**Algorithm (per texel at octahedral coordinate (i, j)):**

1. `oct_decode(i, j)` → unit sphere position `s`
2. Sample height `h_c` at (i,j), `h_l`, `h_r`, `h_d`, `h_u` at neighbors
3. For each neighbor, oct_decode → sphere position, apply displacement: `p = s * (1.0 + h * displaceScale)`
4. Central differences: `dp_du = p_right - p_left`, `dp_dv = p_up - p_down`
5. `normal = normalize(cross(dp_du, dp_dv))` in local space
6. Write to buffer

**Boundary handling:** At edges (i=0, i=511, j=0, j=511), fall back to one-sided difference.

## 4. Shader: planet.wgsl (modify)

### 4.1 New binding

```wgsl
@group(0) @binding(4) var<storage, read> normal_buffer : array<f32>;
```

### 4.2 vs_main change

Replace line 178:

```wgsl
let idx = oct_to_index(localPos) * 3u;
let localNormal = vec3<f32>(
  normal_buffer[idx],
  normal_buffer[idx + 1u],
  normal_buffer[idx + 2u]
);
let worldNormal = normalize((perFrame.model * vec4<f32>(localNormal, 0.0)).xyz);
```

### 4.3 Fragment shader

No changes. `directLight(N, V, L, ...)` already accepts any normal.

## 5. TypeScript changes

### 5.1 NormalComputeNode.ts (new)

- Extends `BaseNode`, name: `'NormalCompute'`
- `build()`: create `terrain.normal` storage buffer, create normal_gen compute pipeline
- `recordPass()`: set pipeline, set bind group (height_buffer + normal_buffer + displaceScale uniform), `dispatchWorkgroups(16, 16)`
- `_firstFrame` guard: runs once, same pattern as `ComputeNoiseNode`

### 5.2 GraphBuilder.ts

Insert `NormalComputeNode` in graph order: after `ComputeNoiseNode`, before `PlanetRenderNode`.

### 5.3 PlanetRenderNode.ts

- In `build()`: add binding 4 to bind group layout → `terrain.normal` storage buffer
- In bind group creation: include normal_buffer resource

## 6. File change list

| File | Change |
|------|--------|
| `src/shaders/normal_gen.wgsl` | New |
| `src/graph/nodes/NormalComputeNode.ts` | New |
| `src/shaders/planet.wgsl` | Add binding 4, modify vs_main normal line |
| `src/graph/nodes/PlanetRenderNode.ts` | Add normal_buffer to bind group (binding 4) |
| `src/graph/GraphBuilder.ts` | Register NormalComputeNode in graph order |

## 7. Deferred

- Runtime `displaceScale` adjustment with normal recompute
- Higher-order normal filtering (Sobel 3×3 vs central difference)
- Normal compression (oct encoding as vec2)
