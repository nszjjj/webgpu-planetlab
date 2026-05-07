# PBR Direct Lighting — Design Spec

**Date:** 2026-05-07  
**Scope:** PlanetRenderNode fragment shader upgrade from Lambert diffuse to Cook-Torrance PBR (direct lighting only)

## 1. Goal

Replace the current Lambert `ambient + NdotL * diffuse` with a Physically Based Rendering Metallic-Roughness workflow, using Cook-Torrance BRDF with GGX distribution and Smith geometry. Direct lighting only — IBL is deferred to a subsequent phase.

## 2. Architecture

### 2.1 Shader files

| File | Action | Purpose |
|------|--------|---------|
| `src/shaders/pbr_common.wgsl` | **New** | BRDF functions: GGX, Smith, Fresnel-Schlick, Cook-Torrance, tone map |
| `src/shaders/planet.wgsl` | **Modify** | Fragment uses `pbr_common` directLight(); vertex shader unchanged |

### 2.2 Uniform layout (update-frequency split)

**Buffer 0 — PerFrame** (~224 bytes, written every frame):

| Offset | Field | Size | Align |
|--------|-------|------|-------|
| 0 | viewProj | 64 (mat4x4) | 8 |
| 64 | model | 64 (mat4x4) | 8 |
| 128 | displaceScale | 4 (f32) | 4 |
| 132 | _pad[3] | 12 | 4 |
| 144 | sunDir | 12 (vec3) | 16 |
| 156 | _pad | 4 | 4 |
| 160 | cameraPos | 12 (vec3) | 16 |
| 172 | _pad | 4 | 4 |
| 176 | lightColor | 12 (vec3) | 16 |
| 188 | lightIntensity | 4 (f32) | 4 |
| 192 | _pad[2] | 8 | 4 |

Total: 200 bytes, padded to 208 for alignment. Binding slot: 0 (no change).

**Buffer 1 — MaterialParams** (~160 bytes, written on HUD slider change):

| Offset | Field |
|--------|-------|
| 0 | materials[0] — water: roughness + metallic + _pad[2] |
| 16 | materials[1] — sand |
| 32 | materials[2] — grass |
| 48 | materials[3] — rock |
| 64 | materials[4] — snow |
| 80-144 | Reserved slots 5-9 for future terrain types |

Each material slot: `roughness(f32) + metallic(f32) + _pad[2](f32*2)` = 16 bytes.
Binding slot: 3 (new).

Bind group layout becomes:
- binding 0: PerFrame uniform (existed)
- binding 1: terrain.height read-only storage (existed)
- binding 2: terrain.splat read-only storage (existed)
- binding 3: MaterialParams uniform (new)

### 2.3 Render pipeline

No structural change. PlanetRenderNode still:
1. `build()` — create pipelines, buffers, bind groups
2. `update()` — write PerFrame buffer (every frame), write MaterialParams buffer (on dirty)
3. `recordPass()` — beginRenderPass on `scene.color` RT, draw indexed sphere

AtmosphereNode (`atmosphere.wgsl`) reads `scene.color` and composites. PBR HDR output is mathematically compatible — `color * viewT + inScatter` works for linear HDR input. Tone mapping is applied in `pbr_common` fragment before output to keep colors within [0,1] for the `rgba8unorm` RT.

### 2.4 Material lookup

Fragment shader identifies terrain type from `splat_buffer` bit flags (same as current), then indexes into `materials[]` uniform array:

```
let splat = splat_buffer[idx];
let mat = select_material(splat);  // finds highest-priority bit set
let albedo = splat_to_color(splat); // existing color mapping
let result = directLight(N, V, L, albedo, mat.metallic, mat.roughness, ...);
```

Priority order (same as current splat_to_color): snow > rock > grass > sand > water.

## 3. TypeScript types

```ts
export interface MaterialParam {
  roughness: number;
  metallic: number;
}

export interface MaterialParams {
  materials: [MaterialParam, ...MaterialParam[]];
  lightColor: [number, number, number];
  lightIntensity: number;
}

export const DEFAULT_MATERIAL_PARAMS: MaterialParams = {
  materials: [
    { roughness: 0.20, metallic: 0.30 }, // water
    { roughness: 0.70, metallic: 0.00 }, // sand
    { roughness: 0.80, metallic: 0.00 }, // grass
    { roughness: 0.55, metallic: 0.05 }, // rock
    { roughness: 0.45, metallic: 0.00 }, // snow
  ],
  lightColor: [1.0, 0.95, 0.85],
  lightIntensity: 2.0,
};
```

## 4. Debug HUD

New collapsible "PBR" section in the existing HUD panel, below Cloud:

- 5 terrain types × 2 sliders each (roughness, metallic) = 10 sliders
- 3 sliders for light: R, G, B (or single intensity slider + color picker)
- On change → write to material buffer directly (DEV only, tree-shaken in release)

## 5. File change list

| File | Change |
|------|--------|
| `src/shaders/pbr_common.wgsl` | New |
| `src/shaders/planet.wgsl` | Modify fragment shader |
| `src/core/types.ts` | Add MaterialParam, MaterialParams, DEFAULT_MATERIAL_PARAMS |
| `src/graph/nodes/PlanetRenderNode.ts` | Add material buffer, cameraPos, light params |
| `src/graph/GraphBuilder.ts` | Pass material params to PlanetRenderNode |
| `src/ui/DebugHUD.ts` | Add PBR slider section |

## 6. Explicitly deferred

- IBL (diffuse irradiance, prefiltered specular cubemap, BRDF LUT)
- Detail normal from height buffer (finite difference)
- New terrain types beyond the current 5
- Dedicated post-processing / tone-mapping pass
- Shadow mapping
