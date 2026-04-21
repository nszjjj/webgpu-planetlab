# AtmosphereNode Design Spec

**Date:** 2026-04-20
**Phase:** 3 — Atmospheric Scattering
**Technique:** Nishita (1993) single-scattering raymarching

---

## Goal

Implement a physically-based atmospheric scattering effect (DSP realistic style) as a full-screen post-process pass. The planet surface renders to an intermediate texture; AtmosphereNode composites the atmosphere on top and writes to the canvas.

This phase also establishes the offline render target (RT) infrastructure required by future effects (SSAO, bloom, etc.).

---

## Approach

**Nishita single-scattering raymarching** (Approach A). Primary ray steps through the atmosphere; at each step a secondary shadow ray integrates optical depth toward the sun. Rayleigh + Mie scattering are accumulated with Beer-Lambert transmittance. 16 primary / 8 light samples per pixel — sufficient quality on desktop WebGPU.

**Deferred optimization:** Precomputed transmittance LUT (Approach B) is noted for future performance work but not included here.

---

## Sun Model

The sun is a **directional light** (parallel rays, infinitely far). Energy attenuation over path length is handled by Beer-Lambert optical depth integration — not by point-light distance falloff.

**Forward compatibility:** A minimal `SunComponent` stores `worldPosition: vec3`. AtmosphereNode derives `sunDir = normalize(sunPos - planetPos)` each frame. When the sun is later rendered as an object, only the position value changes — shaders are unaffected.

Without a SunEntity, fallback position is `(100, 50, 0)`.

PlanetRenderNode's existing hardcoded light direction is replaced by the same SunComponent lookup.

---

## Section 1: Offline RT Infrastructure

### Changes to `WebGPUEngine.ts`
- Depth format: `depth24plus` → `depth32float` (enables shader sampling)
- Create `scene.color` texture via `ResourceManager.createTexture('scene.color', ...)`: `rgba8unorm`, usage `TEXTURE_BINDING | RENDER_ATTACHMENT`, same size as canvas
- Create depth texture via `ResourceManager.createTexture('scene.depth', ...)` with same change
- Expose `sceneColorView` in `FrameContext` (view of `scene.color` texture)
- Recreate both textures on canvas resize (via ResourceManager)

### Changes to `src/core/types.ts`
```typescript
export interface FrameContext {
  frameIndex: number;
  dt: number;
  totalTime: number;
  device: GPUDevice;
  targetView: GPUTextureView;       // canvas swapchain — final output
  sceneColorView: GPUTextureView;   // intermediate color RT
  depthView: GPUTextureView;        // depth32float — readable in shaders
}
```

### Changes to `PlanetRenderNode.ts`
- `colorAttachment.view` → `ctx.sceneColorView` (was `ctx.targetView`)
- `depthStencil.format` → `depth32float`

---

## Section 2: AtmosphereNode Architecture

### `src/ecs/components/SunComponent.ts` (new)
```typescript
export class SunComponent {
  constructor(public worldPosition: [number, number, number] = [100, 50, 0]) {}
}
```

### `AtmosphereParams` interface (add to `types.ts`)
```typescript
export interface AtmosphereParams {
  planetRadius: number;        // must match PlanetComponent.radius
  atmosphereRadius: number;    // > planetRadius; typically planetRadius * 1.03–1.05
  betaR: [number, number, number]; // Rayleigh scattering coefficients (per channel)
  betaM: number;               // Mie scattering coefficient
  mieG: number;                // Mie phase asymmetry factor, g ∈ (-1, 1)
  numSamples: number;          // primary ray steps (default 16)
  numLightSamples: number;     // shadow ray steps per primary sample (default 8)
}

export const DEFAULT_ATMOSPHERE_PARAMS: AtmosphereParams = {
  planetRadius: 1.0,
  atmosphereRadius: 1.04,
  betaR: [5.8e-6, 13.5e-6, 33.1e-6],
  betaM: 21e-6,
  mieG: 0.76,
  numSamples: 16,
  numLightSamples: 8,
};
```

Extensibility: `IceBiomeNode` / `GasPlanetNode` pass a custom `AtmosphereParams` to the `AtmosphereNode` constructor. The node and shader are reused unchanged.

### Uniform buffer layout (112 bytes)
```
offset  0: sunDir          vec3<f32>   12
offset 12: planetRadius    f32          4
offset 16: atmosphereRadius f32         4
offset 20: _pad            f32×3       12
offset 32: cameraPos       vec3<f32>   12
offset 44: _pad            f32          4
offset 48: betaR           vec3<f32>   12
offset 60: _pad            f32          4
offset 64: betaM           f32          4
offset 68: mieG            f32          4
offset 72: numSamples      u32          4
offset 76: numLightSamples u32          4
offset 80: invViewProj     mat4x4<f32> 64   ← for depth reconstruction
total: 144 bytes
```

### `AtmosphereNode` class (`src/graph/nodes/AtmosphereNode.ts`)
- Constructor: `(scene, resources, pipelines, params = DEFAULT_ATMOSPHERE_PARAMS)`
- `build(ctx)`: retrieve `scene.color` and `scene.depth` textures from `ctx.resources`; create uniform buffer, sampler, bind group layout, bind group, pipeline
- `update(ctx)`: write uniform buffer (sunDir from SunComponent or fallback, cameraPos, invViewProj)
- `recordPass(encoder, ctx)`: full-screen Render Pass reading `scene.color` + `scene.depth`, writing `ctx.targetView`

> `scene.color` and `scene.depth` are created by `WebGPUEngine` via `ResourceManager` before `GraphBuilder.build()` is called, so they are guaranteed to exist when `AtmosphereNode.build()` runs.

---

## Section 3: atmosphere.wgsl

### Bindings
```wgsl
@group(0) @binding(0) var<uniform> atm        : AtmosphereUniforms;
@group(0) @binding(1) var          sceneColor : texture_2d<f32>;
@group(0) @binding(2) var          sceneDepth : texture_depth_2d;
@group(0) @binding(3) var          smp        : sampler;
```

### Vertex shader
`vertex_index` → two triangles covering NDC clip space. No vertex buffer needed.

### Fragment shader logic
1. **Depth sample** — `textureLoad(sceneDepth, texel, 0)` at pixel coord
2. **World position reconstruct** — `invViewProj * vec4(ndcXY, depth, 1)`, divide by w
3. **View ray** — `normalize(worldPos - cameraPos)` (or toward far plane for sky pixels)
4. **Ray-atmosphere sphere intersection** — analytic ray-sphere test against `atmosphereRadius`; clamp near end to `planetRadius` intersection or reconstructed surface depth
5. **Primary ray march** (`numSamples` steps):
   - Sample altitude → Rayleigh density `exp(-h / H_R)`, Mie density `exp(-h / H_M)`
   - Shadow ray march toward `sunDir` (`numLightSamples` steps) → optical depth `τ_sun`
   - Transmittance along view ray so far → `T_view = exp(-τ_view)`
   - Accumulate: `scatter += density × phase × beta × exp(-τ_sun) × T_view × stepLen`
6. **Phase functions**:
   - Rayleigh: `(3 / 16π) × (1 + cos²θ)`
   - Mie (Henyey-Greenstein): `(1 - g²) / (4π × (1 + g² - 2g·cosθ)^(3/2))`
7. **Composite output**:
   - `finalColor = sceneColor.rgb × T_view + scatter`
   - Sky pixels (depth == 1.0): `sceneColor` contribution → 0, pure scatter color

### Scale constants (atmosphere shader)
Scene unit convention: planet radius = 1.0. Scale heights are expressed as fractions of planet radius, matching physical Earth ratios:
```wgsl
const H_R : f32 = 0.008;   // Rayleigh scale height (~8 km / 1000 km planet radius)
const H_M : f32 = 0.0012;  // Mie scale height (~1.2 km / 1000 km)
```
These are dimensionless ratios. No runtime normalization needed.

---

## Section 4: GraphBuilder & Data Flow

### New wiring in `GraphBuilder.ts`
```typescript
// Sun entity
const sun = new Entity('sun');
sun.addComponent(new SunComponent([100, 50, 0]));
scene.addEntity(sun);

// Node order
const noiseNode  = new ComputeNoiseNode(resources, pipelines);
const planetNode = new PlanetRenderNode(scene, resources, pipelines);
const atmosNode  = new AtmosphereNode(scene, resources, pipelines);

noiseNode.build(buildCtx);
planetNode.build(buildCtx);
atmosNode.build(buildCtx);

graph.addNode(noiseNode);
graph.addNode(planetNode);
graph.addNode(atmosNode);
```

### Frame data flow
```
ComputeNoiseNode  →  terrain.height / terrain.splat   (compute, first frame only)
PlanetRenderNode  →  scene.color, scene.depth          (render pass)
AtmosphereNode    →  ctx.targetView (canvas)            (full-screen render pass)
```

---

## Testing

### Unit tests (`src/__tests__/AtmosphereParams.test.ts`)
- `atmosphereRadius > planetRadius`
- `betaR` all positive; blue channel > green > red (physically correct)
- `mieG ∈ (-1, 1)`
- `numSamples >= 1`, `numLightSamples >= 1`

### Visual verification
Correct result indicators:
- Blue-white limb glow visible against dark background
- Sunset/sunrise orange-red tint when sun is near horizon angle
- Planet surface color unchanged at nadir (straight-down view)
- No dark halo artifact at atmosphere/space boundary
