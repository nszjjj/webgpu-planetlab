# Cloud Phase 1 Design — Volumetric Shell Clouds

**Date:** 2026-04-29  
**Status:** Approved  
**Scope:** Phase 1 — single cloud shell, static FBM coverage, bilateral upsample composite  
**Phase 2 (future):** advection simulation, ping-pong coverage, multi-layer shells, TAA

---

## Architecture & Data Flow

```
ComputeNoiseNode         → terrain.height / terrain.splat
PlanetRenderNode         → scene.color (rgba8unorm) + scene.depth (depth32float)
CloudCoverageNode  [new] → cloud.coverage.a (rgba8unorm 512×256)
CloudRenderNode    [new] → cloud.color (rgba16float, w/2 × h/2)
AtmosphereNode     [mod] → canvas (targetView)
                            reads scene.color + scene.depth + cloud.color
```

### Node Responsibilities

**CloudCoverageNode** — compute pass  
Writes a 512×256 longitude-latitude coverage map using 3D FBM. Each texel stores:
- R = cloud density [0, 1]
- G, B, A = reserved (Phase 2: cloud type, height gradient, wetness)

The texture pair `cloud.coverage.a` / `cloud.coverage.b` is designed for Phase 2 ping-pong advection. Phase 1 only writes `.a`; `.b` is allocated but unused.

**CloudRenderNode** — fragment pass (half-resolution fullscreen quad)  
Ray marches through a single spherical shell `[cloudInner, cloudOuter]`. Samples the coverage texture. Applies HG phase function, Beer-Lambert transmittance, and Beer's Powder for dark cloud edges. Blue noise step jitter breaks up banding. Outputs `rgba16float`: RGB = in-scatter color, A = transmittance (1 = fully clear, 0 = fully opaque).

**AtmosphereNode** — modified  
Adds two new bindings: `cloud.color` texture + sampler. After computing atmospheric scattering, bilateral-upsamples the half-resolution cloud RT (weighted by scene depth), then composites:

```wgsl
let cloud = bilateral_sample(cloud_color, uv, texel_size, scene_depth);
let finalColor = cloud.rgb + atmosphereColor * cloud.a;
```

---

## Textures

| Name | Format | Size | Usage | Notes |
|------|--------|------|-------|-------|
| `cloud.coverage.a` | `rgba8unorm` | 512 × 256 (fixed) | STORAGE_BINDING \| TEXTURE_BINDING | Phase 1 active coverage |
| `cloud.coverage.b` | `rgba8unorm` | 512 × 256 (fixed) | STORAGE_BINDING \| TEXTURE_BINDING | Phase 2 ping-pong placeholder |
| `cloud.color` | `rgba16float` | w/2 × h/2 | RENDER_ATTACHMENT \| TEXTURE_BINDING | Resizes with canvas |
| `blue.noise` | `r8unorm` | 64×64 or 128×128 | TEXTURE_BINDING | User-supplied PNG |

`cloud.color` is registered in SurfaceResources (auto-resizes). Coverage textures are fixed-size (content-driven, not screen resolution). Blue noise is loaded once as a static resource.

---

## Uniform Buffers

### CloudUniforms (cloud_render.wgsl) — 128 bytes

```
offset   0 : mat4x4<f32>  invViewProj       // 64 bytes
offset  64 : vec3<f32>    cameraPos         // 12
offset  76 : f32          planetRadius      // 4
offset  80 : vec3<f32>    sunDir            // 12
offset  92 : f32          cloudInnerRadius  // e.g. 1.03
offset  96 : f32          cloudOuterRadius  // e.g. 1.08 — parameterised for future multi-layer
offset 100 : f32          extinction        // total attenuation coefficient
offset 104 : f32          scatterAlbedo     // scatter / extinction ratio
offset 108 : f32          mieG              // HG asymmetry parameter
offset 112 : f32          scaleHeight       // vertical density falloff
offset 116 : f32          timeOffset        // FBM animation drift (Phase 1 = 0)
offset 120 : u32          numSteps          // ray march steps (e.g. 32)
offset 124 : f32          _pad
// UNIFORM_SIZE = 128
```

### CoverageUniforms (cloud_coverage.wgsl) — 16 bytes

```
offset  0 : f32  time        // FBM time offset (Phase 1 = 0)
offset  4 : f32  frequency   // coverage noise frequency
offset  8 : f32  threshold   // density cutoff below which = no cloud
offset 12 : f32  _pad
// UNIFORM_SIZE = 16
```

---

## Shader Logic

### cloud_coverage.wgsl (compute)

```
@workgroup_size(8, 8)
dispatch: (512/8, 256/8) = (64, 32)

per invocation (x, y):
  (u, v) = (x/512, y/256)
  p = spherical_to_cartesian(u * 2π, v * π)  // unit sphere point
  raw = fbm(p * frequency + time, ...)        // reuses noise3() from noise_gen.wgsl
  density = max(raw - threshold, 0) / (1 - threshold)  // remap above threshold
  write density → cloud.coverage.a[x, y].r
```

### cloud_render.wgsl (fragment, half-resolution fullscreen quad)

```
per pixel:
  1. Reconstruct ray: NDC → invViewProj (same pattern as AtmosphereNode)
  2. Sphere intersections:
       outer shell: intersect_sphere(cam, dir, cloudOuter) → tEntry
       inner shell: intersect_sphere(cam, dir, cloudInner) → tInner
       planet body: intersect_sphere(cam, dir, planetRadius) → tPlanet
       depth buffer: reconstruct tDepth from scene.depth
       tMin = max(tEntry.x, 0)
       tMax = min(tEntry.y, tPlanet.x or ∞, tDepth)
  3. Blue noise jitter: sample blue.noise at (pixel % noiseSize) → offset tMin by ±0.5 stepLen
  4. Ray march [tMin, tMax]:
       for each step at point p = cam + dir * t:
         if length(p) not in [cloudInner, cloudOuter]: skip
         sphereUV = cartesian_to_uv(normalize(p))
         coverage = textureSample(cloud_coverage, samp, sphereUV).r
         altFrac = (length(p) - cloudInner) / (cloudOuter - cloudInner)
         density = coverage * exp(-altFrac / scaleHeight) * stepLen * extinction
         transmittance *= exp(-density)
         planet occlusion test (same as AtmosphereNode)
         if not occluded:
           cosTheta = dot(dir, sunDir)
           phaseHG = henyey_greenstein(cosTheta, mieG)
           beerPowder = 2 * exp(-density) * (1 - exp(-2 * density))
           lighting = phaseHG * beerPowder
           inScatter += coverage * scatterAlbedo * lighting * transmittance * sunColor
  5. output: rgba16float(inScatter.rgb, transmittance)
```

### AtmosphereNode changes (fs_main)

New bindings:
- `@binding(3)` — `cloud_color : texture_2d<f32>`
- `@binding(4)` — `cloud_sampler : sampler`

At the end of `fs_main`, replace the `return` with:

```wgsl
// Bilateral upsample: 2×2 neighbourhood weighted by depth similarity
// weight_i = exp(-|depth_i - depth_center| * DEPTH_SIGMA), DEPTH_SIGMA = 10.0
// final cloud = Σ(cloud_i * weight_i) / Σ(weight_i)
let cloud = bilateral_sample(cloud_color, cloud_sampler, in.uv, texel_size, depth);
let finalColor = cloud.rgb + (color * viewT + inScatter) * cloud.a;
return vec4<f32>(finalColor, 1.0);
```

---

## Default Parameters

```typescript
export interface CloudParams {
  cloudInnerRadius : number;   // planet surface + thin air gap
  cloudOuterRadius : number;   // outer edge of cloud shell
  extinction       : number;
  scatterAlbedo    : number;
  mieG             : number;
  scaleHeight      : number;
  timeOffset       : number;
  numSteps         : number;
  coverageFreq     : number;
  coverageThreshold: number;
}

export const DEFAULT_CLOUD_PARAMS: CloudParams = {
  cloudInnerRadius : 1.03,
  cloudOuterRadius : 1.08,   // extensible to multi-layer in Phase 2
  extinction       : 8.0,
  scatterAlbedo    : 0.9,
  mieG             : 0.6,
  scaleHeight      : 0.3,
  timeOffset       : 0.0,
  numSteps         : 32,
  coverageFreq     : 3.0,
  coverageThreshold: 0.45,
};
```

---

## Test Plan

**`src/__tests__/CloudParams.test.ts`** — parameter invariants (no GPU required):

```typescript
cloudInnerRadius > params.planetRadius
cloudOuterRadius > cloudInnerRadius
cloudOuterRadius < atmosphereRadius     // clouds sit inside atmosphere
scaleHeight > 0
extinction > 0
scatterAlbedo > 0 && scatterAlbedo <= 1
mieG > -1 && mieG < 1
numSteps >= 4
```

---

## Phase 2 Extension Notes

- **Multi-layer shells**: `cloudOuterRadius` is already a uniform; adding a second shell pair requires adding `cloudInner2 / cloudOuter2` to the uniform and a second march loop.
- **Advection**: enable ping-pong by making CloudCoverageNode read `.a` and write `.b` on even frames, swapped on odd frames. Add a wind-advection compute kernel.
- **TAA**: store `hit_t` in cloud.color.a (instead of transmittance) once history buffer is available; reconstruct world-space hit for reprojection.
- **Blue noise**: user will supply a PNG; integrate as a static resource loaded once during build.
