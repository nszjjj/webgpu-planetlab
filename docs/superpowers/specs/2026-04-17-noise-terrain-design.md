# Noise Terrain Generation — Design Spec

**Date:** 2026-04-17  
**Phase:** 2 (post basic sphere)  
**Status:** Approved

---

## Overview

Implement procedural terrain generation for the planet using a two-pass Compute Shader pipeline. The system produces a height buffer (for vertex displacement) and a splat mask buffer (for biome/color classification), both consumed by the existing `PlanetRenderNode`.

---

## Noise Stack

Layered FBM with three noise types, sampled in 3D using normalized sphere position (avoids polar distortion):

| Layer | Type | Frequency | Octaves | Weight | Purpose |
|-------|------|-----------|---------|--------|---------|
| Continental | Simplex FBM | 0.8 | 6 | 0.6 | Large landmass vs ocean |
| Mountain | Ridged Multifractal | 3.0 | 4 | 0.3 | Sharp ridges and peaks |
| Detail | Worley / Cellular | 8.0 | — | 0.1 | Rock texture, surface roughness |

All parameters passed via a `NoiseParams` uniform buffer for runtime tuning and preset support.

---

## Buffer Layout

Both buffers use a 512×512 grid mapped to spherical coordinates. Organized by `(θ, φ)` — not vertex index — to decouple height data from mesh topology and preserve future LOD compatibility.

**Coordinate mapping (shared between all nodes):**
```
θ = acos(normalize(pos).y)          // [0, π]
φ = atan2(normalize(pos).z, x)      // [0, 2π]
i = θ / π × 511
j = φ / (2π) × 511
index = i × 512 + j
```

| Buffer Name | Element Type | Size | GPUBufferUsage |
|-------------|-------------|------|----------------|
| `terrain.height` | `f32` | 512×512×4 = 1 MB | STORAGE + COPY_DST |
| `terrain.splat` | `u32` | 512×512×4 = 1 MB | STORAGE + COPY_DST |

---

## Splat Mask Bit Definitions

Each texel in `terrain.splat` is a `u32` where each bit represents a terrain type:

```
bit 0 = water
bit 1 = sand
bit 2 = grass
bit 3 = rock
bit 4 = snow
bit 5 = ore_iron
bit 6 = ore_rare
```

Classification thresholds (tunable via uniform):

| Height Range | Terrain Type |
|-------------|-------------|
| h < 0.35 | water |
| 0.35 ≤ h < 0.40 | sand |
| 0.40 ≤ h < 0.65 | grass |
| 0.65 ≤ h < 0.80 | rock |
| h ≥ 0.80 | snow |
| ore_noise > 0.85 AND (grass OR rock) | ore_iron |
| ore_noise > 0.95 AND rock | ore_rare |

Ore bits use an independent noise layer so distribution is decoupled from height.

`IndustrialOverlayNode` can query the same `terrain.splat` buffer directly — no separate resource map needed.

---

## ComputeNoiseNode — Two-Pass Structure

Single node, two compute pipelines, one `recordPass` call:

### Pass A — `noise_gen.wgsl`

- Dispatch: `(512, 512, 1)`
- Input: `NoiseParams` uniform buffer
- Output: `terrain.height` storage buffer
- Logic: For each texel `(i, j)` → spherical coords → 3D cartesian → FBM noise stack → `clamp(height, 0.0, 1.0)`

### Pass B — `terrain_classify.wgsl`

- Dispatch: `(512, 512, 1)`
- Input: `terrain.height` (read-only storage), `ClassifyParams` uniform buffer
- Output: `terrain.splat` storage buffer
- Logic: Read height → apply threshold table → set bits → write u32 mask

WebGPU guarantees storage buffer write-then-read ordering within the same command encoder, so no explicit barrier is needed between Pass A and Pass B.

---

## PlanetRenderNode — Changes

### Mesh Resolution

Upgrade from 64×64 to 128×128 (rings × segments). Height data is at 512×512 — vertex shader samples by spherical coordinate, not vertex index, so any mesh resolution works.

### Bind Group Layout (updated)

| Binding | Resource | Stage | Type |
|---------|----------|-------|------|
| 0 | `planet.uniform` (viewProj + model + displace_scale) | VERTEX | uniform |
| 1 | `terrain.height` | VERTEX | read-only storage |
| 2 | `terrain.splat` | FRAGMENT | read-only storage |

### Vertex Shader Changes (`planet.wgsl`)

```wgsl
@group(0) @binding(1) var<storage, read> height_buffer: array<f32>;

// Inside vs_main:
let sph      = cartesian_to_spherical(localPos);
let h        = height_buffer[sph.index];
let displaced = localPos * (1.0 + h * uniforms.displace_scale);
```

### Fragment Shader Changes (`planet.wgsl`)

```wgsl
@group(0) @binding(2) var<storage, read> splat_buffer: array<u32>;

// Inside fs_main:
let mask  = splat_buffer[sph.index];
let color = splat_to_color(mask);  // bit-priority color lookup
```

Initial color constants (expandable to texture atlas later):

| Terrain | Color |
|---------|-------|
| water | `(0.10, 0.25, 0.60)` |
| sand | `(0.76, 0.70, 0.50)` |
| grass | `(0.25, 0.55, 0.20)` |
| rock | `(0.45, 0.40, 0.35)` |
| snow | `(0.90, 0.92, 0.95)` |

---

## GraphBuilder — Node Order

```typescript
// Build order (ensures terrain.height/splat exist before PlanetRenderNode binds them)
const noiseNode  = new ComputeNoiseNode(resources, pipelines, noiseParams);
const planetNode = new PlanetRenderNode(scene, resources, pipelines);

noiseNode.build(buildCtx);
planetNode.build(buildCtx);

// Record order (compute before render)
graph.addNode(noiseNode);
graph.addNode(planetNode);
```

---

## New Files

| File | Purpose |
|------|---------|
| `src/shaders/noise_gen.wgsl` | Pass A: FBM noise stack → height buffer |
| `src/shaders/terrain_classify.wgsl` | Pass B: height → splat mask |

## Modified Files

| File | Change |
|------|--------|
| `src/graph/nodes/ComputeNoiseNode.ts` | Full implementation (was stub) |
| `src/graph/nodes/PlanetRenderNode.ts` | Add height/splat buffer bindings, upgrade mesh to 128×128 |
| `src/shaders/planet.wgsl` | Add displacement (vertex) + splat color lookup (fragment) |
| `src/graph/GraphBuilder.ts` | Add ComputeNoiseNode, wire build/record order |
| `src/core/types.ts` | Add NoiseParams and ClassifyParams types |

---

## Future Extension Points

- **Erosion**: Insert a Pass C (`erosion.wgsl`) between Pass A and Pass B in `ComputeNoiseNode.recordPass` without touching other nodes
- **LOD**: Any LOD patch queries `terrain.height` / `terrain.splat` by spherical coordinate — mesh topology is irrelevant
- **New terrain types**: Add bits 7+ to splat mask; `terrain_classify.wgsl` and `splat_to_color()` are the only touch points
- **Texture atlas**: Replace `splat_to_color()` hardcoded constants with a texture sampler — fragment shader interface unchanged
