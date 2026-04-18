# Noise Terrain Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a two-pass ComputeNoiseNode that generates a 512×512 height buffer (FBM noise stack) and splat mask buffer (terrain type bits), then wire PlanetRenderNode to use them for vertex displacement and biome coloring.

**Architecture:** ComputeNoiseNode runs once on the first frame — Pass A writes float heights via FBM+Ridged+Worley noise, Pass B reads heights and writes u32 splat masks with terrain-type bits. Both buffers are indexed by spherical coordinates (θ,φ), not vertex index, preserving future LOD compatibility. PlanetRenderNode binds both buffers as read-only storage.

**Tech Stack:** WebGPU (WGSL compute + render shaders), TypeScript, Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-04-17-noise-terrain-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `src/core/types.ts` | Add `NoiseParams`, `ClassifyParams` interfaces + defaults |
| Create | `src/utils/terrainCoords.ts` | `TERRAIN_RESOLUTION`, `sphericalToIndex()` — shared CPU-side mapping |
| Create | `src/__tests__/terrainCoords.test.ts` | Tests for `sphericalToIndex` |
| Create | `src/__tests__/terrainParams.test.ts` | Tests for default param invariants |
| Create | `src/shaders/noise_gen.wgsl` | Pass A: FBM+Ridged+Worley noise → `terrain.height` buffer |
| Create | `src/shaders/terrain_classify.wgsl` | Pass B: height thresholds + ore noise → `terrain.splat` buffer |
| Modify | `src/graph/nodes/ComputeNoiseNode.ts` | Full implementation (was a 3-line stub) |
| Modify | `src/ecs/components/PlanetComponent.ts` | Add `displaceScale`, change default mesh to 128×128 |
| Create | `src/__tests__/PlanetComponent.test.ts` | Tests for new PlanetComponent fields |
| Modify | `src/shaders/planet.wgsl` | Add `displace_scale` uniform, vertex displacement, fragment splat color |
| Modify | `src/graph/nodes/PlanetRenderNode.ts` | Expand uniform buffer to 144 bytes, add height+splat bindings |
| Modify | `src/graph/GraphBuilder.ts` | Register ComputeNoiseNode before PlanetRenderNode |

---

## Task 1: Add `NoiseParams` / `ClassifyParams` types and `sphericalToIndex` utility

**Files:**
- Modify: `src/core/types.ts`
- Create: `src/utils/terrainCoords.ts`
- Create: `src/__tests__/terrainCoords.test.ts`
- Create: `src/__tests__/terrainParams.test.ts`

- [ ] **Step 1: Write failing tests for `sphericalToIndex`**

Create `src/__tests__/terrainCoords.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { sphericalToIndex, TERRAIN_RESOLUTION } from '../utils/terrainCoords.ts';

describe('sphericalToIndex', () => {
  it('maps north pole (θ=0, φ=0) to index 0', () => {
    expect(sphericalToIndex(0, 0)).toBe(0);
  });

  it('maps south pole row (θ=π, φ=0) to index 261632', () => {
    // i = floor(π/π × 511) = 511, j = 0 → 511 * 512 + 0
    expect(sphericalToIndex(Math.PI, 0)).toBe(261632);
  });

  it('maps negative phi to same index as equivalent positive phi', () => {
    // φ = -π and φ = π both normalize to the same grid column
    const a = sphericalToIndex(Math.PI / 2, Math.PI);
    const b = sphericalToIndex(Math.PI / 2, -Math.PI);
    expect(a).toBe(b);
  });

  it('all sampled indices stay within buffer bounds', () => {
    const size = TERRAIN_RESOLUTION * TERRAIN_RESOLUTION;
    for (let k = 0; k < 10; k++) {
      const theta = (k / 9) * Math.PI;
      const phi   = (k / 9) * 2 * Math.PI;
      const idx   = sphericalToIndex(theta, phi);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(size);
    }
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (module not found)**

```
npm test src/__tests__/terrainCoords.test.ts
```
Expected: Error — `Cannot find module '../utils/terrainCoords.ts'`

- [ ] **Step 3: Create `src/utils/terrainCoords.ts`**

```typescript
export const TERRAIN_RESOLUTION = 512;

export function sphericalToIndex(
  theta: number,
  phi: number,
  resolution = TERRAIN_RESOLUTION,
): number {
  const phiNorm = phi < 0 ? phi + 2 * Math.PI : phi;
  const i = Math.max(0, Math.min(resolution - 1, Math.floor((theta / Math.PI) * (resolution - 1))));
  const j = Math.max(0, Math.min(resolution - 1, Math.floor((phiNorm / (2 * Math.PI)) * (resolution - 1))));
  return i * resolution + j;
}
```

- [ ] **Step 4: Run test — expect PASS**

```
npm test src/__tests__/terrainCoords.test.ts
```
Expected: 4 passing

- [ ] **Step 5: Add `NoiseParams` and `ClassifyParams` to `src/core/types.ts`**

Append to the end of `src/core/types.ts` (after the existing `RenderGraph` re-export):

```typescript
export interface NoiseParams {
  continent_freq: number;
  continent_persistence: number;
  mountain_freq: number;
  detail_freq: number;
}

export interface ClassifyParams {
  water_max: number;
  sand_max: number;
  grass_max: number;
  rock_max: number;
  ore_iron_threshold: number;
  ore_rare_threshold: number;
  ore_noise_freq: number;
}

export const DEFAULT_NOISE_PARAMS: NoiseParams = {
  continent_freq: 0.8,
  continent_persistence: 0.5,
  mountain_freq: 3.0,
  detail_freq: 8.0,
};

export const DEFAULT_CLASSIFY_PARAMS: ClassifyParams = {
  water_max: 0.35,
  sand_max: 0.40,
  grass_max: 0.65,
  rock_max: 0.80,
  ore_iron_threshold: 0.85,
  ore_rare_threshold: 0.95,
  ore_noise_freq: 12.0,
};
```

- [ ] **Step 6: Write failing tests for param invariants**

Create `src/__tests__/terrainParams.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DEFAULT_NOISE_PARAMS, DEFAULT_CLASSIFY_PARAMS } from '../core/types.ts';

describe('DEFAULT_NOISE_PARAMS', () => {
  it('frequencies increase from continent to detail', () => {
    const p = DEFAULT_NOISE_PARAMS;
    expect(p.mountain_freq).toBeGreaterThan(p.continent_freq);
    expect(p.detail_freq).toBeGreaterThan(p.mountain_freq);
  });

  it('persistence is in (0, 1)', () => {
    expect(DEFAULT_NOISE_PARAMS.continent_persistence).toBeGreaterThan(0);
    expect(DEFAULT_NOISE_PARAMS.continent_persistence).toBeLessThan(1);
  });
});

describe('DEFAULT_CLASSIFY_PARAMS', () => {
  it('height thresholds are in ascending order', () => {
    const p = DEFAULT_CLASSIFY_PARAMS;
    expect(p.water_max).toBeLessThan(p.sand_max);
    expect(p.sand_max).toBeLessThan(p.grass_max);
    expect(p.grass_max).toBeLessThan(p.rock_max);
    expect(p.rock_max).toBeLessThan(1.0);
  });

  it('ore thresholds are in (0.5, 1) and ascending', () => {
    const p = DEFAULT_CLASSIFY_PARAMS;
    expect(p.ore_iron_threshold).toBeGreaterThan(0.5);
    expect(p.ore_rare_threshold).toBeGreaterThan(p.ore_iron_threshold);
    expect(p.ore_rare_threshold).toBeLessThan(1.0);
  });
});
```

- [ ] **Step 7: Run — expect PASS**

```
npm test src/__tests__/terrainParams.test.ts
```
Expected: 4 passing

- [ ] **Step 8: Run all tests**

```
npm test
```
Expected: all existing + new tests passing

- [ ] **Step 9: Commit**

```bash
git add src/utils/terrainCoords.ts src/__tests__/terrainCoords.test.ts \
        src/__tests__/terrainParams.test.ts src/core/types.ts
git commit -m "feat: add NoiseParams/ClassifyParams types and sphericalToIndex utility"
```

---

## Task 2: Write `noise_gen.wgsl` (Pass A — FBM noise → height buffer)

**Files:**
- Create: `src/shaders/noise_gen.wgsl`

There are no unit tests for WGSL shaders; correctness is verified visually in Task 8.

- [ ] **Step 1: Create `src/shaders/noise_gen.wgsl`**

```wgsl
// Pass A: FBM + Ridged + Worley noise → terrain.height storage buffer
// Indexed by (i=θ-row, j=φ-col), same mapping as sphericalToIndex() on the CPU.

const PI         : f32 = 3.14159265358979323846;
const RESOLUTION : u32 = 512u;

struct NoiseParams {
  continent_freq        : f32,
  continent_persistence : f32,
  mountain_freq         : f32,
  detail_freq           : f32,
}

@group(0) @binding(0) var<uniform>           params        : NoiseParams;
@group(0) @binding(1) var<storage, read_write> height_buffer : array<f32>;

// ── Value noise helpers ───────────────────────────────────────────────────────

fn hash(p: f32) -> f32 {
  return fract(sin(p) * 43758.5453123);
}

fn noise3(p: vec3<f32>) -> f32 {
  let ip = floor(p);
  let fp = fract(p);
  let u  = fp * fp * (3.0 - 2.0 * fp);
  let n  = ip.x + ip.y * 157.0 + ip.z * 113.0;
  return mix(
    mix(mix(hash(n +   0.0), hash(n +   1.0), u.x),
        mix(hash(n + 157.0), hash(n + 158.0), u.x), u.y),
    mix(mix(hash(n + 113.0), hash(n + 114.0), u.x),
        mix(hash(n + 270.0), hash(n + 271.0), u.x), u.y),
    u.z,
  );
}

// ── Noise stack ───────────────────────────────────────────────────────────────

fn fbm(p: vec3<f32>, freq: f32, octaves: i32, persistence: f32) -> f32 {
  var value          = 0.0;
  var amplitude      = 1.0;
  var total_amplitude = 0.0;
  var f              = freq;
  for (var i = 0; i < octaves; i++) {
    value           += noise3(p * f) * amplitude;
    total_amplitude += amplitude;
    amplitude       *= persistence;
    f               *= 2.0;
  }
  return value / total_amplitude;
}

fn ridged(p: vec3<f32>, freq: f32, octaves: i32) -> f32 {
  var value     = 0.0;
  var amplitude = 0.5;
  var f         = freq;
  for (var i = 0; i < octaves; i++) {
    let n  = 1.0 - abs(noise3(p * f) * 2.0 - 1.0);
    value     += n * n * amplitude;
    amplitude *= 0.5;
    f         *= 2.0;
  }
  return value;
}

fn worley(p: vec3<f32>, freq: f32) -> f32 {
  let scaled   = p * freq;
  let fp       = fract(scaled);
  let ip       = floor(scaled);
  var min_dist = 1.0;
  for (var x = -1; x <= 1; x++) {
    for (var y = -1; y <= 1; y++) {
      for (var z = -1; z <= 1; z++) {
        let offset  = vec3<f32>(f32(x), f32(y), f32(z));
        let nb      = ip + offset;
        let feature = offset + vec3<f32>(
          hash(dot(nb, vec3<f32>( 1.0, 57.0, 21.0))),
          hash(dot(nb, vec3<f32>(31.0,  7.0, 41.0))),
          hash(dot(nb, vec3<f32>(13.0, 97.0,  3.0))),
        );
        min_dist = min(min_dist, length(fp - feature));
      }
    }
  }
  return min_dist;
}

// ── Main ──────────────────────────────────────────────────────────────────────

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= RESOLUTION || gid.y >= RESOLUTION) { return; }

  // (gid.x = i = θ-row, gid.y = j = φ-col) — matches sphericalToIndex()
  let theta = f32(gid.x) / f32(RESOLUTION - 1u) * PI;
  let phi   = f32(gid.y) / f32(RESOLUTION - 1u) * 2.0 * PI;
  let pos   = vec3<f32>(sin(theta) * cos(phi), cos(theta), sin(theta) * sin(phi));

  let continent = fbm(pos,    params.continent_freq, 6, params.continent_persistence);
  let mountain  = ridged(pos, params.mountain_freq,  4);
  let detail    = worley(pos, params.detail_freq);

  // detail is a distance field [0,1]; invert so high values = rougher surface
  let h = clamp(continent * 0.6 + mountain * 0.3 + (1.0 - detail) * 0.1, 0.0, 1.0);

  height_buffer[gid.x * RESOLUTION + gid.y] = h;
}
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```
npx tsc --noEmit
```
Expected: 0 errors (WGSL is imported as raw string, no TS impact yet)

- [ ] **Step 3: Commit**

```bash
git add src/shaders/noise_gen.wgsl
git commit -m "feat: add noise_gen.wgsl — FBM+Ridged+Worley height buffer"
```

---

## Task 3: Write `terrain_classify.wgsl` (Pass B — height → splat mask)

**Files:**
- Create: `src/shaders/terrain_classify.wgsl`

- [ ] **Step 1: Create `src/shaders/terrain_classify.wgsl`**

```wgsl
// Pass B: read terrain.height → write terrain.splat (u32 bit-mask per texel)
// Bit layout: 0=water 1=sand 2=grass 3=rock 4=snow 5=ore_iron 6=ore_rare

const PI         : f32 = 3.14159265358979323846;
const RESOLUTION : u32 = 512u;

struct ClassifyParams {
  water_max          : f32,
  sand_max           : f32,
  grass_max          : f32,
  rock_max           : f32,
  ore_iron_threshold : f32,
  ore_rare_threshold : f32,
  ore_noise_freq     : f32,
  _pad0              : f32,
}

@group(0) @binding(0) var<uniform>             params        : ClassifyParams;
@group(0) @binding(1) var<storage, read>       height_buffer : array<f32>;
@group(0) @binding(2) var<storage, read_write> splat_buffer  : array<u32>;

fn hash(p: f32) -> f32 {
  return fract(sin(p) * 43758.5453123);
}

fn noise3(p: vec3<f32>) -> f32 {
  let ip = floor(p);
  let fp = fract(p);
  let u  = fp * fp * (3.0 - 2.0 * fp);
  let n  = ip.x + ip.y * 157.0 + ip.z * 113.0;
  return mix(
    mix(mix(hash(n +   0.0), hash(n +   1.0), u.x),
        mix(hash(n + 157.0), hash(n + 158.0), u.x), u.y),
    mix(mix(hash(n + 113.0), hash(n + 114.0), u.x),
        mix(hash(n + 270.0), hash(n + 271.0), u.x), u.y),
    u.z,
  );
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= RESOLUTION || gid.y >= RESOLUTION) { return; }

  let index = gid.x * RESOLUTION + gid.y;
  let h     = height_buffer[index];

  var mask: u32 = 0u;

  // Base terrain: exactly one bit set per texel
  if (h < params.water_max) {
    mask |= 1u;        // bit 0: water
  } else if (h < params.sand_max) {
    mask |= 2u;        // bit 1: sand
  } else if (h < params.grass_max) {
    mask |= 4u;        // bit 2: grass
  } else if (h < params.rock_max) {
    mask |= 8u;        // bit 3: rock
  } else {
    mask |= 16u;       // bit 4: snow
  }

  // Ore: independent high-frequency noise; only in grass (4) or rock (8) areas
  let theta = f32(gid.x) / f32(RESOLUTION - 1u) * PI;
  let phi   = f32(gid.y) / f32(RESOLUTION - 1u) * 2.0 * PI;
  let pos   = vec3<f32>(sin(theta) * cos(phi), cos(theta), sin(theta) * sin(phi));
  let ore_n = noise3(pos * params.ore_noise_freq);

  if (ore_n > params.ore_iron_threshold && (mask & 12u) != 0u) {
    mask |= 32u;       // bit 5: ore_iron  (12 = grass | rock)
  }
  if (ore_n > params.ore_rare_threshold && (mask & 8u) != 0u) {
    mask |= 64u;       // bit 6: ore_rare  (rock only)
  }

  splat_buffer[index] = mask;
}
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/shaders/terrain_classify.wgsl
git commit -m "feat: add terrain_classify.wgsl — height thresholds + ore bits"
```

---

## Task 4: Implement `ComputeNoiseNode`

**Files:**
- Modify: `src/graph/nodes/ComputeNoiseNode.ts`

- [ ] **Step 1: Replace stub with full implementation**

Overwrite `src/graph/nodes/ComputeNoiseNode.ts`:

```typescript
// src/graph/nodes/ComputeNoiseNode.ts
import { BaseNode } from './BaseNode.ts';
import type { BuildContext, FrameContext, NoiseParams, ClassifyParams } from '../../core/types.ts';
import { DEFAULT_NOISE_PARAMS, DEFAULT_CLASSIFY_PARAMS } from '../../core/types.ts';
import type { ResourceManager } from '../../core/ResourceManager.ts';
import type { PipelineManager } from '../../core/PipelineManager.ts';
import { TERRAIN_RESOLUTION } from '../../utils/terrainCoords.ts';
import noiseGenSrc from '../../shaders/noise_gen.wgsl?raw';
import classifySrc from '../../shaders/terrain_classify.wgsl?raw';

export class ComputeNoiseNode extends BaseNode {
  readonly name = 'ComputeNoise';

  private _resources: ResourceManager;
  private _pipelines: PipelineManager;
  private _noiseParams: NoiseParams;
  private _classifyParams: ClassifyParams;

  private _noiseGenPipeline!: GPUComputePipeline;
  private _classifyPipeline!: GPUComputePipeline;
  private _noiseBindGroup!: GPUBindGroup;
  private _classifyBindGroup!: GPUBindGroup;

  // Terrain is static — generate once on the first frame, then skip.
  private _generated = false;

  constructor(
    resources: ResourceManager,
    pipelines: PipelineManager,
    noiseParams: NoiseParams = DEFAULT_NOISE_PARAMS,
    classifyParams: ClassifyParams = DEFAULT_CLASSIFY_PARAMS,
  ) {
    super();
    this._resources = resources;
    this._pipelines = pipelines;
    this._noiseParams = noiseParams;
    this._classifyParams = classifyParams;
  }

  override build(ctx: BuildContext): void {
    const BUFFER_SIZE = TERRAIN_RESOLUTION * TERRAIN_RESOLUTION * 4; // f32 or u32 = 4 bytes each

    // ── Shared terrain buffers (consumed by PlanetRenderNode) ──────────────────
    const heightBuffer = this._resources.createBuffer('terrain.height', {
      size: BUFFER_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const splatBuffer = this._resources.createBuffer('terrain.splat', {
      size: BUFFER_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // ── NoiseParams uniform: 4 × f32 = 16 bytes ───────────────────────────────
    const noiseParamsBuffer = this._resources.createBuffer('noise.params', {
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    ctx.device.queue.writeBuffer(noiseParamsBuffer, 0, new Float32Array([
      this._noiseParams.continent_freq,
      this._noiseParams.continent_persistence,
      this._noiseParams.mountain_freq,
      this._noiseParams.detail_freq,
    ]));

    // ── ClassifyParams uniform: 7 × f32 + 1 pad = 32 bytes ────────────────────
    const classifyParamsBuffer = this._resources.createBuffer('noise.classify_params', {
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    ctx.device.queue.writeBuffer(classifyParamsBuffer, 0, new Float32Array([
      this._classifyParams.water_max,
      this._classifyParams.sand_max,
      this._classifyParams.grass_max,
      this._classifyParams.rock_max,
      this._classifyParams.ore_iron_threshold,
      this._classifyParams.ore_rare_threshold,
      this._classifyParams.ore_noise_freq,
      0, // _pad0
    ]));

    // ── Pass A: noise_gen pipeline ─────────────────────────────────────────────
    const noiseGenModule = ctx.device.createShaderModule({ code: noiseGenSrc });
    const noiseGenBGL = ctx.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    this._noiseGenPipeline = this._pipelines.createComputePipeline('terrain.noise_gen', {
      layout: ctx.device.createPipelineLayout({ bindGroupLayouts: [noiseGenBGL] }),
      compute: { module: noiseGenModule, entryPoint: 'main' },
    });
    this._noiseBindGroup = ctx.device.createBindGroup({
      layout: noiseGenBGL,
      entries: [
        { binding: 0, resource: { buffer: noiseParamsBuffer } },
        { binding: 1, resource: { buffer: heightBuffer } },
      ],
    });

    // ── Pass B: terrain_classify pipeline ─────────────────────────────────────
    const classifyModule = ctx.device.createShaderModule({ code: classifySrc });
    const classifyBGL = ctx.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    this._classifyPipeline = this._pipelines.createComputePipeline('terrain.classify', {
      layout: ctx.device.createPipelineLayout({ bindGroupLayouts: [classifyBGL] }),
      compute: { module: classifyModule, entryPoint: 'main' },
    });
    this._classifyBindGroup = ctx.device.createBindGroup({
      layout: classifyBGL,
      entries: [
        { binding: 0, resource: { buffer: classifyParamsBuffer } },
        { binding: 1, resource: { buffer: heightBuffer } },
        { binding: 2, resource: { buffer: splatBuffer } },
      ],
    });
  }

  override recordPass(encoder: GPUCommandEncoder, _ctx: FrameContext): void {
    if (this._generated) return;
    this._generated = true;

    const WG = Math.ceil(TERRAIN_RESOLUTION / 8); // 64 workgroups per axis

    // Pass A: generate height
    const passA = encoder.beginComputePass();
    passA.setPipeline(this._noiseGenPipeline);
    passA.setBindGroup(0, this._noiseBindGroup);
    passA.dispatchWorkgroups(WG, WG);
    passA.end();

    // Pass B: classify terrain (WebGPU guarantees storage write ordering within the encoder)
    const passB = encoder.beginComputePass();
    passB.setPipeline(this._classifyPipeline);
    passB.setBindGroup(0, this._classifyBindGroup);
    passB.dispatchWorkgroups(WG, WG);
    passB.end();
  }
}
```

- [ ] **Step 2: Run all tests (no GPU code in tests, just confirm no TS regressions)**

```
npm test
```
Expected: all tests passing

- [ ] **Step 3: Verify TypeScript compiles**

```
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add src/graph/nodes/ComputeNoiseNode.ts
git commit -m "feat: implement ComputeNoiseNode — two-pass terrain generation"
```

---

## Task 5: Update `PlanetComponent` — add `displaceScale`, default mesh to 128×128

**Files:**
- Modify: `src/ecs/components/PlanetComponent.ts`
- Create: `src/__tests__/PlanetComponent.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/PlanetComponent.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { PlanetComponent } from '../ecs/components/PlanetComponent.ts';

describe('PlanetComponent', () => {
  it('defaults rings and segments to 128', () => {
    const c = new PlanetComponent();
    expect(c.rings).toBe(128);
    expect(c.segments).toBe(128);
  });

  it('defaults displaceScale to 0.15', () => {
    const c = new PlanetComponent();
    expect(c.displaceScale).toBe(0.15);
  });

  it('accepts custom radius, rings, segments, displaceScale', () => {
    const c = new PlanetComponent(2.0, 64, 64, 0.25);
    expect(c.radius).toBe(2.0);
    expect(c.rings).toBe(64);
    expect(c.segments).toBe(64);
    expect(c.displaceScale).toBe(0.25);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```
npm test src/__tests__/PlanetComponent.test.ts
```
Expected: FAIL — `rings` is 64, `displaceScale` is undefined

- [ ] **Step 3: Update `src/ecs/components/PlanetComponent.ts`**

```typescript
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
```

- [ ] **Step 4: Run — expect PASS**

```
npm test src/__tests__/PlanetComponent.test.ts
```
Expected: 3 passing

- [ ] **Step 5: Run all tests**

```
npm test
```
Expected: all passing

- [ ] **Step 6: Commit**

```bash
git add src/ecs/components/PlanetComponent.ts src/__tests__/PlanetComponent.test.ts
git commit -m "feat: PlanetComponent — add displaceScale, default mesh 128x128"
```

---

## Task 6: Update `planet.wgsl` and `PlanetRenderNode` — displacement + splat color + new bindings

**Files:**
- Modify: `src/shaders/planet.wgsl`
- Modify: `src/graph/nodes/PlanetRenderNode.ts`

These two files must change together — the shader defines the bind group layout that the TypeScript code creates.

- [ ] **Step 1: Overwrite `src/shaders/planet.wgsl`**

```wgsl
// Planet render shader — vertex displacement via height_buffer, fragment color via splat_buffer.
// Uniform layout: viewProj (64) + model (64) + displace_scale (4) + pad×3 (12) = 144 bytes.

const PI              : f32 = 3.14159265358979323846;
const TERRAIN_RES     : u32 = 512u;

override rings    : u32 = 128u;
override segments : u32 = 128u;

struct Uniforms {
  viewProj       : mat4x4<f32>,
  model          : mat4x4<f32>,
  displace_scale : f32,
  _pad0          : f32,
  _pad1          : f32,
  _pad2          : f32,
}

@group(0) @binding(0) var<uniform>       uniforms      : Uniforms;
@group(0) @binding(1) var<storage, read> height_buffer : array<f32>;
@group(0) @binding(2) var<storage, read> splat_buffer  : array<u32>;

struct VertexOut {
  @builtin(position) clipPosition : vec4<f32>,
  @location(0)       normal       : vec3<f32>,
  @location(1)       spherePos    : vec3<f32>,  // original unit-sphere pos for terrain lookup
}

fn sphere_pos_to_index(p: vec3<f32>) -> u32 {
  let n     = normalize(p);
  let theta = acos(clamp(n.y, -1.0, 1.0));
  var phi   = atan2(n.z, n.x);
  if (phi < 0.0) { phi += 2.0 * PI; }
  let i = u32(clamp(theta / PI * f32(TERRAIN_RES - 1u), 0.0, f32(TERRAIN_RES - 1u)));
  let j = u32(clamp(phi / (2.0 * PI) * f32(TERRAIN_RES - 1u), 0.0, f32(TERRAIN_RES - 1u)));
  return i * TERRAIN_RES + j;
}

fn splat_to_color(mask: u32) -> vec3<f32> {
  if ((mask & (1u << 4u)) != 0u) { return vec3<f32>(0.90, 0.92, 0.95); } // snow
  if ((mask & (1u << 3u)) != 0u) { return vec3<f32>(0.45, 0.40, 0.35); } // rock
  if ((mask & (1u << 2u)) != 0u) { return vec3<f32>(0.25, 0.55, 0.20); } // grass
  if ((mask & (1u << 1u)) != 0u) { return vec3<f32>(0.76, 0.70, 0.50); } // sand
  return vec3<f32>(0.10, 0.25, 0.60);                                       // water
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  let cols = segments + 1u;
  let i    = vertexIndex / cols;
  let j    = vertexIndex % cols;

  let theta = f32(i) / f32(rings)    * PI;
  let phi   = f32(j) / f32(segments) * 2.0 * PI;

  let localPos = vec3<f32>(
    sin(theta) * cos(phi),
    cos(theta),
    sin(theta) * sin(phi),
  );

  // Displace vertex outward by height
  let h         = height_buffer[sphere_pos_to_index(localPos)];
  let displaced = localPos * (1.0 + h * uniforms.displace_scale);

  // Normal computed from original (un-displaced) sphere position
  let worldNormal = normalize((uniforms.model * vec4<f32>(localPos, 0.0)).xyz);
  let worldPos    = (uniforms.model * vec4<f32>(displaced, 1.0)).xyz;

  var out: VertexOut;
  out.clipPosition = uniforms.viewProj * vec4<f32>(worldPos, 1.0);
  out.normal       = worldNormal;
  out.spherePos    = localPos;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let mask = splat_buffer[sphere_pos_to_index(in.spherePos)];
  return vec4<f32>(splat_to_color(mask), 1.0);
}
```

- [ ] **Step 2: Update `src/graph/nodes/PlanetRenderNode.ts`**

Replace the entire file:

```typescript
// src/graph/nodes/PlanetRenderNode.ts
import { BaseNode } from './BaseNode.ts';
import type { BuildContext, FrameContext } from '../../core/types.ts';
import type { Scene } from '../../ecs/Scene.ts';
import type { ResourceManager } from '../../core/ResourceManager.ts';
import type { PipelineManager } from '../../core/PipelineManager.ts';
import { PlanetComponent } from '../../ecs/components/PlanetComponent.ts';
import { CameraComponent } from '../../ecs/components/CameraComponent.ts';
import planetShaderSrc from '../../shaders/planet.wgsl?raw';

export class PlanetRenderNode extends BaseNode {
  readonly name = 'PlanetRender';

  private _scene: Scene;
  private _resources: ResourceManager;
  private _pipelines: PipelineManager;

  private _pipeline!: GPURenderPipeline;
  private _uniformBuffer!: GPUBuffer;
  private _bindGroup!: GPUBindGroup;
  private _indexBuffer!: GPUBuffer;
  private _indexCount = 0;

  constructor(scene: Scene, resources: ResourceManager, pipelines: PipelineManager) {
    super();
    this._scene = scene;
    this._resources = resources;
    this._pipelines = pipelines;
  }

  override build(ctx: BuildContext): void {
    const planets = this._scene.getEntitiesWith(PlanetComponent);
    const planet = planets[0]!.getComponent(PlanetComponent)!;

    const shaderModule = ctx.device.createShaderModule({ code: planetShaderSrc });

    // ── Bind group layout ──────────────────────────────────────────────────────
    // slot 0: viewProj + model + displace_scale (uniform, vertex)
    // slot 1: terrain.height (read-only storage, vertex)
    // slot 2: terrain.splat  (read-only storage, fragment)
    const bindGroupLayout = ctx.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'read-only-storage' },
        },
      ],
    });

    // ── Render pipeline ────────────────────────────────────────────────────────
    this._pipeline = this._pipelines.createRenderPipeline('planet', {
      layout: ctx.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        constants: {
          rings: planet.rings,
          segments: planet.segments,
        },
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    // ── Uniform buffer: viewProj(64) + model(64) + displace_scale(4) + pad(12) = 144 bytes ──
    this._uniformBuffer = this._resources.createBuffer('planet.uniform', {
      size: 144,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // ── Terrain buffers (created by ComputeNoiseNode.build() before this) ──────
    const heightBuffer = this._resources.getBuffer('terrain.height')!;
    const splatBuffer  = this._resources.getBuffer('terrain.splat')!;

    // ── Bind group ─────────────────────────────────────────────────────────────
    this._bindGroup = ctx.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this._uniformBuffer } },
        { binding: 1, resource: { buffer: heightBuffer } },
        { binding: 2, resource: { buffer: splatBuffer } },
      ],
    });

    // ── Index buffer ───────────────────────────────────────────────────────────
    const indices = buildSphereIndices(planet.rings, planet.segments);
    this._indexCount = indices.length;
    this._indexBuffer = this._resources.createBuffer('planet.index', {
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint32Array(this._indexBuffer.getMappedRange()).set(indices);
    this._indexBuffer.unmap();
  }

  override update(ctx: FrameContext): void {
    const planets = this._scene.getEntitiesWith(PlanetComponent);
    if (planets.length === 0) return;

    const cam = this._scene.mainCamera.getComponent(CameraComponent)!;
    const vp  = cam.getVPMatrix(this._scene.mainCamera.transform.position);
    ctx.device.queue.writeBuffer(this._uniformBuffer, 0, vp);

    const planet     = planets[0]!;
    const planetComp = planet.getComponent(PlanetComponent)!;

    const model = planet.transform.getWorldMatrix();
    const scaledModel = new Float32Array(16);
    scaledModel.set(model);
    scaledModel[0]  *= planetComp.radius;
    scaledModel[5]  *= planetComp.radius;
    scaledModel[10] *= planetComp.radius;
    ctx.device.queue.writeBuffer(this._uniformBuffer, 64, scaledModel);

    // displace_scale + 3 padding floats at offset 128
    ctx.device.queue.writeBuffer(
      this._uniformBuffer,
      128,
      new Float32Array([planetComp.displaceScale, 0, 0, 0]),
    );
  }

  override recordPass(encoder: GPUCommandEncoder, ctx: FrameContext): void {
    const planets = this._scene.getEntitiesWith(PlanetComponent);
    if (planets.length === 0) return;

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: ctx.targetView,
        clearValue: { r: 0.02, g: 0.02, b: 0.05, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: ctx.depthView,
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0, this._bindGroup);
    pass.setIndexBuffer(this._indexBuffer, 'uint32');
    pass.drawIndexed(this._indexCount);
    pass.end();
  }
}

function buildSphereIndices(rings: number, segments: number): Uint32Array {
  const cols    = segments + 1;
  const indices = new Uint32Array(rings * segments * 6);
  let idx = 0;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * cols + j;
      const b = (i + 1) * cols + j;
      const c = i * cols + j + 1;
      const d = (i + 1) * cols + j + 1;
      indices[idx++] = a; indices[idx++] = b; indices[idx++] = c;
      indices[idx++] = b; indices[idx++] = d; indices[idx++] = c;
    }
  }
  return indices;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 4: Run all tests**

```
npm test
```
Expected: all passing

- [ ] **Step 5: Commit**

```bash
git add src/shaders/planet.wgsl src/graph/nodes/PlanetRenderNode.ts
git commit -m "feat: PlanetRenderNode — vertex displacement + splat biome color"
```

---

## Task 7: Wire `GraphBuilder` — register `ComputeNoiseNode` before `PlanetRenderNode`

**Files:**
- Modify: `src/graph/GraphBuilder.ts`

- [ ] **Step 1: Update `src/graph/GraphBuilder.ts`**

```typescript
// src/graph/GraphBuilder.ts
import { RenderGraph } from '../core/RenderGraph.ts';
import { ResourceManager } from '../core/ResourceManager.ts';
import { PipelineManager } from '../core/PipelineManager.ts';
import { Scene } from '../ecs/Scene.ts';
import { Entity } from '../ecs/Entity.ts';
import { CameraComponent } from '../ecs/components/CameraComponent.ts';
import { PlanetComponent } from '../ecs/components/PlanetComponent.ts';
import { ComputeNoiseNode } from './nodes/ComputeNoiseNode.ts';
import { PlanetRenderNode } from './nodes/PlanetRenderNode.ts';
import { OrbitCameraController } from '../controllers/OrbitCameraController.ts';
import type { BuildContext } from '../core/types.ts';

export interface BuiltGraph {
  graph: RenderGraph;
  orbitController: OrbitCameraController;
}

export class GraphBuilder {
  static build(device: GPUDevice, canvas: HTMLCanvasElement): BuiltGraph {
    const resources = new ResourceManager(device);
    const pipelines = new PipelineManager(device);
    const scene     = new Scene();

    // ── Planet entity ──────────────────────────────────────────────────────────
    const planet = new Entity('planet');
    planet.transform.setPosition(0, 0, 0);
    planet.addComponent(new PlanetComponent(1.0, 128, 128));
    scene.addEntity(planet);

    // ── Camera entity ──────────────────────────────────────────────────────────
    const camera = new Entity('camera');
    camera.addComponent(
      new CameraComponent(Math.PI / 4, canvas.width / canvas.height, 0.1, 100),
    );
    scene.addEntity(camera);
    scene.mainCamera = camera;

    // ── Orbit controller ───────────────────────────────────────────────────────
    const orbitController = new OrbitCameraController(scene, canvas);

    // ── Render graph ───────────────────────────────────────────────────────────
    const graph      = new RenderGraph(scene);
    const buildCtx: BuildContext = { device, resources, pipelines, scene };

    // ComputeNoiseNode must build() before PlanetRenderNode so terrain buffers exist.
    // ComputeNoiseNode must addNode() before PlanetRenderNode so compute runs before render.
    const noiseNode  = new ComputeNoiseNode(resources, pipelines);
    const planetNode = new PlanetRenderNode(scene, resources, pipelines);

    noiseNode.build(buildCtx);
    planetNode.build(buildCtx);

    graph.addNode(noiseNode);
    graph.addNode(planetNode);

    return { graph, orbitController };
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Run all tests**

```
npm test
```
Expected: all passing

- [ ] **Step 4: Start dev server and verify visually**

```
npm run dev
```

Open the browser URL printed by Vite (typically `http://localhost:5173`).

Expected visual results:
- Planet is visible with biome colors (blue oceans, yellow beaches, green grassland, grey rock, white snow caps)
- Planet surface has visible terrain displacement (not a perfect sphere)
- Camera orbit (click + drag) still works
- No WebGPU validation errors in the browser console (open DevTools → Console)

- [ ] **Step 5: Commit**

```bash
git add src/graph/GraphBuilder.ts
git commit -m "feat: wire ComputeNoiseNode into GraphBuilder — terrain generation active"
```
