# Cloud Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a volumetric shell-cloud layer above the planet — HG phase function, Beer-Lambert transmittance, Beer's Powder dark edges, half-resolution rendering composited into AtmosphereNode.

**Architecture:** A `CloudCoverageNode` (compute) writes FBM density to a 512×256 storage buffer each frame; a `CloudRenderNode` (fragment, half-res) ray-marches the spherical shell using that buffer and outputs `rgba16float`; `AtmosphereNode` bilateral-upsamples and alpha-composites the cloud RT on top of the atmospheric colour.

**Tech Stack:** WebGPU, WGSL, TypeScript, wgpu-matrix, Vitest

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/core/types.ts` | Add `CloudParams` interface + `DEFAULT_CLOUD_PARAMS` |
| Create | `src/__tests__/CloudParams.test.ts` | Invariant tests for `DEFAULT_CLOUD_PARAMS` |
| Create | `src/shaders/cloud_coverage.wgsl` | Compute shader — FBM coverage into storage buffer |
| Create | `src/graph/nodes/CloudCoverageNode.ts` | Compute node wrapping coverage shader |
| Create | `src/shaders/cloud_render.wgsl` | Fragment shader — sphere-shell ray march |
| Create | `src/graph/nodes/CloudRenderNode.ts` | Half-res render node wrapping cloud shader |
| Modify | `src/shaders/atmosphere.wgsl` | Add `cloudColor` binding + bilateral upsample composite |
| Modify | `src/graph/nodes/AtmosphereNode.ts` | Add `cloud.color` to bind group layout + rebuild |
| Modify | `src/graph/GraphBuilder.ts` | Wire and build two new nodes in correct order |

---

## Task 1: CloudParams types + invariant tests

**Files:**
- Modify: `src/core/types.ts`
- Create: `src/__tests__/CloudParams.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/CloudParams.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DEFAULT_CLOUD_PARAMS, DEFAULT_ATMOSPHERE_PARAMS } from '../core/types.ts';

describe('DEFAULT_CLOUD_PARAMS', () => {
  it('cloudInnerRadius is above planet surface', () => {
    expect(DEFAULT_CLOUD_PARAMS.cloudInnerRadius).toBeGreaterThan(
      DEFAULT_ATMOSPHERE_PARAMS.planetRadius,
    );
  });
  it('cloudOuterRadius > cloudInnerRadius', () => {
    expect(DEFAULT_CLOUD_PARAMS.cloudOuterRadius).toBeGreaterThan(
      DEFAULT_CLOUD_PARAMS.cloudInnerRadius,
    );
  });
  it('cloudOuterRadius < atmosphereRadius (clouds sit inside atmosphere)', () => {
    expect(DEFAULT_CLOUD_PARAMS.cloudOuterRadius).toBeLessThan(
      DEFAULT_ATMOSPHERE_PARAMS.atmosphereRadius,
    );
  });
  it('scaleHeight > 0', () => {
    expect(DEFAULT_CLOUD_PARAMS.scaleHeight).toBeGreaterThan(0);
  });
  it('extinction > 0', () => {
    expect(DEFAULT_CLOUD_PARAMS.extinction).toBeGreaterThan(0);
  });
  it('scatterAlbedo in (0, 1]', () => {
    expect(DEFAULT_CLOUD_PARAMS.scatterAlbedo).toBeGreaterThan(0);
    expect(DEFAULT_CLOUD_PARAMS.scatterAlbedo).toBeLessThanOrEqual(1);
  });
  it('mieG in (-1, 1)', () => {
    expect(DEFAULT_CLOUD_PARAMS.mieG).toBeGreaterThan(-1);
    expect(DEFAULT_CLOUD_PARAMS.mieG).toBeLessThan(1);
  });
  it('numSteps >= 4', () => {
    expect(DEFAULT_CLOUD_PARAMS.numSteps).toBeGreaterThanOrEqual(4);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/__tests__/CloudParams.test.ts
```

Expected: error — `DEFAULT_CLOUD_PARAMS` is not exported from `types.ts`.

- [ ] **Step 3: Add `CloudParams` to `src/core/types.ts`**

Append after `DEFAULT_ATMOSPHERE_PARAMS`:

```typescript
export interface CloudParams {
  cloudInnerRadius:  number;   // inner shell edge (planet units)
  cloudOuterRadius:  number;   // outer shell edge — extensible to multi-layer in Phase 2
  extinction:        number;   // total attenuation coefficient
  scatterAlbedo:     number;   // scatter / extinction ratio
  mieG:              number;   // Henyey-Greenstein asymmetry parameter
  scaleHeight:       number;   // vertical density falloff within shell [0,1]
  timeOffset:        number;   // FBM time drift for animation (Phase 1 = 0)
  numSteps:          number;   // ray march steps per pixel
  coverageFreq:      number;   // FBM frequency for coverage pattern
  coverageThreshold: number;   // density below this value = no cloud
}

export const DEFAULT_CLOUD_PARAMS: CloudParams = {
  cloudInnerRadius:  1.03,
  cloudOuterRadius:  1.08,
  extinction:        8.0,
  scatterAlbedo:     0.9,
  mieG:              0.6,
  scaleHeight:       0.3,
  timeOffset:        0.0,
  numSteps:          32,
  coverageFreq:      3.0,
  coverageThreshold: 0.45,
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/__tests__/CloudParams.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts src/__tests__/CloudParams.test.ts
git commit -m "feat: add CloudParams types and invariant tests"
```

---

## Task 2: cloud_coverage.wgsl — FBM coverage compute shader

**Files:**
- Create: `src/shaders/cloud_coverage.wgsl`

- [ ] **Step 1: Create the shader**

Create `src/shaders/cloud_coverage.wgsl`:

```wgsl
// src/shaders/cloud_coverage.wgsl
// Compute pass: write FBM cloud coverage into a flat float32 storage buffer.
// Buffer layout: cov[y * W + x] = density in [0, 1].

struct CoverageUniforms {
  time      : f32,  // FBM time offset for drift animation
  frequency : f32,  // noise frequency
  threshold : f32,  // density below threshold = 0
  _pad      : f32,
}

@group(0) @binding(0) var<uniform>             u   : CoverageUniforms;
@group(0) @binding(1) var<storage, read_write> cov : array<f32>;

const W  : u32 = 512u;
const H  : u32 = 256u;
const PI : f32 = 3.14159265358979;

fn hash3(p: vec3<f32>) -> f32 {
  var q = fract(p * 0.1031);
  q += dot(q, q.zyx + 31.32);
  return fract((q.x + q.y) * q.z);
}

fn noise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i),               hash3(i + vec3(1,0,0)), s.x),
        mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), s.x), s.y),
    mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), s.x),
        mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), s.x), s.y),
    s.z);
}

fn fbm5(p: vec3<f32>, freq: f32) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var f = freq;
  for (var i = 0; i < 5; i++) {
    v += a * noise3(p * f);
    a *= 0.5;
    f *= 2.0;
  }
  return v;
}

@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= W || gid.y >= H) { return; }

  let uf    = (f32(gid.x) + 0.5) / f32(W);
  let vf    = (f32(gid.y) + 0.5) / f32(H);
  let theta = vf * PI;
  let phi   = uf * 2.0 * PI;
  let sph   = vec3(sin(theta) * cos(phi), cos(theta), sin(theta) * sin(phi));

  let raw     = fbm5(sph + u.time * 0.05, u.frequency);
  let density = clamp((raw - u.threshold) / max(1.0 - u.threshold, 1e-5), 0.0, 1.0);

  cov[gid.y * W + gid.x] = density;
}
```

- [ ] **Step 2: Verify TypeScript import resolves (no GPU run needed)**

Open `src/graph/nodes/CloudCoverageNode.ts` (which will be created in Task 3) and confirm that Vite's `?raw` import would resolve. No separate test needed — the dev server will catch WGSL syntax errors at compile time.

---

## Task 3: CloudCoverageNode.ts

**Files:**
- Create: `src/graph/nodes/CloudCoverageNode.ts`

- [ ] **Step 1: Create the node**

Create `src/graph/nodes/CloudCoverageNode.ts`:

```typescript
// src/graph/nodes/CloudCoverageNode.ts
import { BaseNode } from './BaseNode.ts';
import type { BuildContext, FrameContext, CloudParams } from '../../core/types.ts';
import { DEFAULT_CLOUD_PARAMS } from '../../core/types.ts';
import type { ResourceManager } from '../../core/ResourceManager.ts';
import type { PipelineManager } from '../../core/PipelineManager.ts';
import cloudCoverageSrc from '../../shaders/cloud_coverage.wgsl?raw';

const COVERAGE_W   = 512;
const COVERAGE_H   = 256;
const UNIFORM_SIZE = 16; // 4 × f32

export class CloudCoverageNode extends BaseNode {
  readonly name = 'CloudCoverage';

  private _resources: ResourceManager;
  private _pipelines: PipelineManager;
  private _params:    CloudParams;

  private _pipeline!:      GPUComputePipeline;
  private _uniformBuffer!: GPUBuffer;
  private _bindGroup!:     GPUBindGroup;

  constructor(
    resources: ResourceManager,
    pipelines: PipelineManager,
    params:    CloudParams = DEFAULT_CLOUD_PARAMS,
  ) {
    super();
    this._resources = resources;
    this._pipelines = pipelines;
    this._params    = params;
  }

  override build(ctx: BuildContext): void {
    const { device } = ctx;

    // Primary coverage buffer: one f32 per texel, read by CloudRenderNode each frame
    this._resources.createBuffer('cloud.coverage', {
      size:  COVERAGE_W * COVERAGE_H * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE,
    });

    // Phase 2 ping-pong placeholder — unused in Phase 1
    this._resources.createBuffer('cloud.coverage.b', {
      size:  COVERAGE_W * COVERAGE_H * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE,
    });

    const shader = device.createShaderModule({ code: cloudCoverageSrc });

    const bgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    this._pipeline = device.createComputePipeline({
      layout:  device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
      compute: { module: shader, entryPoint: 'cs_main' },
    });

    this._uniformBuffer = this._resources.createBuffer('cloud.coverage.uniform', {
      size:  UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const coverageBuffer = this._resources.getBuffer('cloud.coverage')!;
    this._bindGroup = device.createBindGroup({
      layout:  bgl,
      entries: [
        { binding: 0, resource: { buffer: this._uniformBuffer } },
        { binding: 1, resource: { buffer: coverageBuffer } },
      ],
    });
  }

  override update(ctx: FrameContext): void {
    const p = this._params;
    ctx.device.queue.writeBuffer(
      this._uniformBuffer, 0,
      new Float32Array([p.timeOffset, p.coverageFreq, p.coverageThreshold, 0]),
    );
  }

  override recordPass(encoder: GPUCommandEncoder, _ctx: FrameContext): void {
    const pass = encoder.beginComputePass();
    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0, this._bindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(COVERAGE_W / 8),
      Math.ceil(COVERAGE_H / 8),
    );
    pass.end();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/shaders/cloud_coverage.wgsl src/graph/nodes/CloudCoverageNode.ts
git commit -m "feat: CloudCoverageNode — FBM coverage compute pass"
```

---

## Task 4: cloud_render.wgsl — sphere-shell ray march shader

**Files:**
- Create: `src/shaders/cloud_render.wgsl`

- [ ] **Step 1: Create the shader**

Create `src/shaders/cloud_render.wgsl`:

```wgsl
// src/shaders/cloud_render.wgsl
// Half-resolution fragment pass: ray-march spherical cloud shell.
// Outputs rgba16float: RGB = in-scatter colour, A = transmittance (1 = clear, 0 = opaque).

const PI         : f32 = 3.14159265358979;
const COVERAGE_W : u32 = 512u;
const COVERAGE_H : u32 = 256u;

// Uniform buffer layout: 128 bytes
struct CloudUniforms {
  invViewProj      : mat4x4<f32>,  // offset   0 (64 bytes)
  cameraPos        : vec3<f32>,    // offset  64 (12 bytes)
  planetRadius     : f32,          // offset  76
  sunDir           : vec3<f32>,    // offset  80 (12 bytes)
  cloudInnerRadius : f32,          // offset  92
  cloudOuterRadius : f32,          // offset  96
  extinction       : f32,          // offset 100
  scatterAlbedo    : f32,          // offset 104
  mieG             : f32,          // offset 108
  scaleHeight      : f32,          // offset 112
  timeOffset       : f32,          // offset 116
  numSteps         : u32,          // offset 120
  _pad             : f32,          // offset 124
}

@group(0) @binding(0) var<uniform>           u        : CloudUniforms;
@group(0) @binding(1) var<storage, read>     coverage : array<f32>;
@group(0) @binding(2) var                    depthTex : texture_depth_2d;

// --- Vertex shader: full-screen quad (6 vertices, no VBO) ---

const QUAD_POS = array<vec2<f32>, 6>(
  vec2(-1.0,-1.0), vec2(1.0,-1.0), vec2(-1.0,1.0),
  vec2(1.0,-1.0),  vec2(1.0,1.0),  vec2(-1.0,1.0),
);

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0)       uv  : vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
  let p = QUAD_POS[vi];
  return VSOut(vec4(p, 0.0, 1.0), p * vec2(0.5, -0.5) + 0.5);
}

// --- Helpers ---

fn intersect_sphere(orig: vec3<f32>, dir: vec3<f32>, r: f32) -> vec2<f32> {
  let b    = dot(orig, dir);
  let c    = dot(orig, orig) - r * r;
  let disc = b * b - c;
  if (disc < 0.0) { return vec2(-1.0); }
  let s = sqrt(disc);
  return vec2(-b - s, -b + s);
}

fn hg_phase(cosTheta: f32, g: f32) -> f32 {
  let g2    = g * g;
  let denom = max(pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5), 1e-7);
  return (1.0 - g2) / (4.0 * PI * denom);
}

// Nearest-neighbour lookup into the flat coverage buffer.
fn coverage_sample(spherePos: vec3<f32>) -> f32 {
  let n     = normalize(spherePos);
  let theta = acos(clamp(n.y, -1.0, 1.0));
  let phi   = atan2(n.z, n.x) + PI;
  let iu    = u32(clamp(phi   / (2.0 * PI) * f32(COVERAGE_W), 0.0, f32(COVERAGE_W) - 1.0));
  let iv    = u32(clamp(theta / PI         * f32(COVERAGE_H), 0.0, f32(COVERAGE_H) - 1.0));
  return coverage[iv * COVERAGE_W + iu];
}

// Hash-based step jitter — eliminates banding without a blue-noise texture.
// Replace with a blue-noise texture lookup once the PNG is supplied.
fn hash_jitter(px: u32, py: u32) -> f32 {
  var h = px * 1664525u + py * 214013u + 2531011u;
  h ^= h >> 16u;
  h *= 0x45d9f3bu;
  h ^= h >> 16u;
  return f32(h & 0xFFFFu) / 65536.0;
}

// --- Fragment shader ---

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  // Cloud RT is half-resolution; map to full-res depth texel by ×2
  let texel     = vec2<i32>(floor(in.pos.xy));
  let fullTexel = texel * 2;
  let depth     = textureLoad(depthTex, fullTexel, 0);
  let isSky     = depth >= 0.9999;

  // Reconstruct world-space ray direction
  let ndcX     = in.uv.x * 2.0 - 1.0;
  let ndcY     = 1.0 - in.uv.y * 2.0;
  let clip4    = u.invViewProj * vec4(ndcX, ndcY, depth, 1.0);
  let worldPos = clip4.xyz / clip4.w;
  let camPos   = u.cameraPos;
  let rayDir   = normalize(worldPos - camPos);

  // Clip ray to the cloud shell interval
  let outerHit  = intersect_sphere(camPos, rayDir, u.cloudOuterRadius);
  if (outerHit.y < 0.0) { return vec4(0.0, 0.0, 0.0, 1.0); }  // miss: transmittance = 1

  let innerHit  = intersect_sphere(camPos, rayDir, u.cloudInnerRadius);
  let planetHit = intersect_sphere(camPos, rayDir, u.planetRadius);

  var tMin = max(outerHit.x, 0.0);
  var tMax = outerHit.y;
  if (innerHit.x > 0.0 && innerHit.x < tMax) { tMax = innerHit.x; }
  if (planetHit.x > 0.0 && planetHit.x < tMax) { tMax = planetHit.x; }
  if (!isSky) {
    let tDepth = length(worldPos - camPos);
    tMax = min(tMax, tDepth);
  }
  if (tMin >= tMax) { return vec4(0.0, 0.0, 0.0, 1.0); }

  let stepLen  = (tMax - tMin) / f32(u.numSteps);
  let jitter   = hash_jitter(u32(texel.x), u32(texel.y));
  let cosTheta = dot(rayDir, u.sunDir);
  let sunColor = vec3(1.0, 0.95, 0.85);

  var transmittance = 1.0;
  var inScatter     = vec3(0.0);

  var t = tMin + stepLen * jitter;
  for (var i = 0u; i < u.numSteps; i++) {
    let p = camPos + rayDir * t;
    let r = length(p);

    if (r >= u.cloudInnerRadius && r <= u.cloudOuterRadius) {
      let cov     = coverage_sample(p);
      let altFrac = (r - u.cloudInnerRadius) / (u.cloudOuterRadius - u.cloudInnerRadius);
      // optical depth for this step
      let tau     = cov * exp(-altFrac / u.scaleHeight) * stepLen * u.extinction;

      transmittance *= exp(-tau);

      // Planet occlusion test: skip in-scatter if planet body blocks sun
      let planetOcc = intersect_sphere(p, u.sunDir, u.planetRadius);
      if (planetOcc.x <= 0.0 && transmittance > 0.01) {
        let phaseHG    = hg_phase(cosTheta, u.mieG);
        // Beer's Powder: adds dark-edge effect on thick cloud faces
        let beerPowder = 2.0 * exp(-tau) * (1.0 - exp(-2.0 * tau));
        inScatter += tau * u.scatterAlbedo * phaseHG * beerPowder * transmittance * sunColor;
      }
    }

    t += stepLen;
    if (transmittance < 0.01) { break; }
  }

  return vec4(inScatter, transmittance);
}
```

---

## Task 5: CloudRenderNode.ts

**Files:**
- Create: `src/graph/nodes/CloudRenderNode.ts`

- [ ] **Step 1: Create the node**

Create `src/graph/nodes/CloudRenderNode.ts`:

```typescript
// src/graph/nodes/CloudRenderNode.ts
import { mat4 } from 'wgpu-matrix';
import { BaseNode } from './BaseNode.ts';
import type { BuildContext, FrameContext, CloudParams } from '../../core/types.ts';
import { DEFAULT_CLOUD_PARAMS } from '../../core/types.ts';
import type { Scene } from '../../ecs/Scene.ts';
import type { ResourceManager } from '../../core/ResourceManager.ts';
import type { PipelineManager } from '../../core/PipelineManager.ts';
import type { SurfaceResources } from '../../core/SurfaceResources.ts';
import { CameraComponent } from '../../ecs/components/CameraComponent.ts';
import { PlanetComponent } from '../../ecs/components/PlanetComponent.ts';
import { SunComponent } from '../../ecs/components/SunComponent.ts';
import cloudRenderSrc from '../../shaders/cloud_render.wgsl?raw';

const UNIFORM_SIZE = 128; // bytes

export class CloudRenderNode extends BaseNode {
  readonly name = 'CloudRender';

  private _scene:     Scene;
  private _resources: ResourceManager;
  private _pipelines: PipelineManager;
  private _params:    CloudParams;

  private _pipeline!:      GPURenderPipeline;
  private _uniformBuffer!: GPUBuffer;
  private _bindGroup!:     GPUBindGroup;
  private _bgl!:           GPUBindGroupLayout;
  private _surfaceRes!:    SurfaceResources;
  private _device!:        GPUDevice;

  // Pre-allocated scratch buffers — avoid per-frame GC pressure
  private readonly _uniformData = new Float32Array(UNIFORM_SIZE / 4);
  private readonly _invVPOut    = new Float32Array(16);

  constructor(
    scene:     Scene,
    resources: ResourceManager,
    pipelines: PipelineManager,
    params:    CloudParams = DEFAULT_CLOUD_PARAMS,
  ) {
    super();
    this._scene     = scene;
    this._resources = resources;
    this._pipelines = pipelines;
    this._params    = params;
  }

  override build(ctx: BuildContext): void {
    this._device     = ctx.device;
    this._surfaceRes = ctx.surfaceRes;

    // Half-resolution cloud colour RT; resizes with canvas
    ctx.surfaceRes.registerTexture('cloud.color', (w, h) => ({
      size:   [Math.max(1, Math.floor(w / 2)), Math.max(1, Math.floor(h / 2))],
      format: 'rgba16float' as GPUTextureFormat,
      usage:  GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    }));

    const shader = ctx.device.createShaderModule({ code: cloudRenderSrc });

    this._bgl = ctx.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'depth' } },
      ],
    });

    this._pipeline = this._pipelines.createRenderPipeline('cloud.render', {
      layout:    ctx.device.createPipelineLayout({ bindGroupLayouts: [this._bgl] }),
      vertex:    { module: shader, entryPoint: 'vs_main' },
      fragment:  {
        module:     shader,
        entryPoint: 'fs_main',
        targets:    [{ format: 'rgba16float' }],
      },
      primitive: { topology: 'triangle-list' },
    });

    this._uniformBuffer = this._resources.createBuffer('cloud.render.uniform', {
      size:  UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this._rebuildBindGroup();
    ctx.surfaceRes.onChanged(() => this._rebuildBindGroup());
  }

  private _rebuildBindGroup(): void {
    const coverageBuffer = this._resources.getBuffer('cloud.coverage');
    if (!coverageBuffer) throw new Error('CloudRenderNode: cloud.coverage buffer not found — ensure CloudCoverageNode.build() runs first');
    this._bindGroup = this._device.createBindGroup({
      layout:  this._bgl,
      entries: [
        { binding: 0, resource: { buffer: this._uniformBuffer } },
        { binding: 1, resource: { buffer: coverageBuffer } },
        { binding: 2, resource: this._surfaceRes.getView('scene.depth') },
      ],
    });
  }

  override update(ctx: FrameContext): void {
    const cam    = this._scene.mainCamera.getComponent(CameraComponent)!;
    const camPos = this._scene.mainCamera.transform.position;

    const vp = cam.getVPMatrix(camPos);
    mat4.inverse(vp, this._invVPOut);

    const planets      = this._scene.getEntitiesWith(PlanetComponent);
    const planetRadius = planets[0]?.getComponent(PlanetComponent)?.radius ?? 1.0;

    const sunComp    = this._scene.getEntitiesWith(SunComponent)[0]?.getComponent(SunComponent);
    const sunPos     = sunComp?.worldPosition ?? [100, 50, 0];
    const sx = sunPos[0] as number;
    const sy = sunPos[1] as number;
    const sz = sunPos[2] as number;
    const sl = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;

    const data = this._uniformData;
    const dv   = new DataView(data.buffer);
    data.fill(0);

    // Uniform buffer layout (float indices, each float = 4 bytes):
    data.set(this._invVPOut, 0);             // bytes   0–63: mat4 invViewProj
    data[16] = camPos[0]!;                   // bytes  64–67: cameraPos.x
    data[17] = camPos[1]!;                   // bytes  68–71: cameraPos.y
    data[18] = camPos[2]!;                   // bytes  72–75: cameraPos.z
    data[19] = planetRadius;                 // bytes  76–79: planetRadius
    data[20] = sx / sl;                      // bytes  80–83: sunDir.x
    data[21] = sy / sl;                      // bytes  84–87: sunDir.y
    data[22] = sz / sl;                      // bytes  88–91: sunDir.z
    data[23] = this._params.cloudInnerRadius; // bytes  92–95
    data[24] = this._params.cloudOuterRadius; // bytes  96–99
    data[25] = this._params.extinction;       // bytes 100–103
    data[26] = this._params.scatterAlbedo;    // bytes 104–107
    data[27] = this._params.mieG;             // bytes 108–111
    data[28] = this._params.scaleHeight;      // bytes 112–115
    data[29] = this._params.timeOffset;       // bytes 116–119
    dv.setUint32(120, this._params.numSteps, true); // bytes 120–123: numSteps (u32, LE)

    ctx.device.queue.writeBuffer(this._uniformBuffer, 0, data);
  }

  override recordPass(encoder: GPUCommandEncoder, _ctx: FrameContext): void {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view:       this._surfaceRes.getView('cloud.color'),
        loadOp:     'clear',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },  // a=1: transmittance=1 (fully clear)
        storeOp:    'store',
      }],
    });
    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0, this._bindGroup);
    pass.draw(6);
    pass.end();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/shaders/cloud_render.wgsl src/graph/nodes/CloudRenderNode.ts
git commit -m "feat: CloudRenderNode — half-res shell ray march with HG + Beer's Powder"
```

---

## Task 6: Modify atmosphere.wgsl — add cloud composite

**Files:**
- Modify: `src/shaders/atmosphere.wgsl`

- [ ] **Step 1: Add `cloudColor` binding after `sceneDepth`**

In `src/shaders/atmosphere.wgsl`, find:

```wgsl
@group(0) @binding(2) var          sceneDepth : texture_depth_2d;
```

Replace with:

```wgsl
@group(0) @binding(2) var          sceneDepth : texture_depth_2d;
@group(0) @binding(3) var          cloudColor : texture_2d<f32>;
```

- [ ] **Step 2: Add `DEPTH_SIGMA` and `bilateral_cloud` before `fs_main`**

Find the line `// --- Fragment shader ---` and insert before it:

```wgsl
const DEPTH_SIGMA : f32 = 10.0;

// Bilateral upsample: 2×2 cloud texels weighted by depth similarity.
// centerDepth is the full-res depth at the current pixel.
fn bilateral_cloud(cloudTexel: vec2<i32>, centerDepth: f32) -> vec4<f32> {
  let maxCoord  = vec2<i32>(textureDimensions(cloudColor)) - vec2(1, 1);
  var weightSum = 0.0;
  var result    = vec4(0.0);
  for (var dy = 0; dy <= 1; dy++) {
    for (var dx = 0; dx <= 1; dx++) {
      let coord = clamp(cloudTexel + vec2<i32>(dx, dy), vec2(0, 0), maxCoord);
      let d     = textureLoad(sceneDepth, coord * 2, 0);
      let w     = exp(-abs(d - centerDepth) * DEPTH_SIGMA);
      result   += w * textureLoad(cloudColor, coord, 0);
      weightSum += w;
    }
  }
  return result / max(weightSum, 1e-6);
}
```

- [ ] **Step 3: Replace the final `return` in `fs_main`**

Find:

```wgsl
  return vec4<f32>(finalColor, 1.0);
```

Replace with:

```wgsl
  // Bilateral upsample cloud RT and composite on top of atmosphere
  let cloudTexel = texel / 2;
  let cloud      = bilateral_cloud(cloudTexel, depth);
  let composite  = cloud.rgb + finalColor * cloud.a;
  return vec4<f32>(composite, 1.0);
```

---

## Task 7: Modify AtmosphereNode.ts — add cloud.color binding

**Files:**
- Modify: `src/graph/nodes/AtmosphereNode.ts`

- [ ] **Step 1: Add `cloudColor` entry to `_bindGroupLayout`**

Find the `createBindGroupLayout` call in `build()`. Add a fourth entry:

```typescript
    this._bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'depth', viewDimension: '2d' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT,   // cloud colour (rgba16float)
          texture: { sampleType: 'float', viewDimension: '2d' } },
      ],
    });
```

- [ ] **Step 2: Add `cloud.color` to `_rebuildBindGroup`**

Find `_rebuildBindGroup`. Add the fourth entry:

```typescript
  private _rebuildBindGroup(surfaceRes: import('../../core/SurfaceResources.ts').SurfaceResources): void {
    this._bindGroup = this._device.createBindGroup({
      layout: this._bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this._uniformBuffer } },
        { binding: 1, resource: surfaceRes.getView('scene.color') },
        { binding: 2, resource: surfaceRes.getView('scene.depth') },
        { binding: 3, resource: surfaceRes.getView('cloud.color') },
      ],
    });
  }
```

- [ ] **Step 3: Commit Tasks 6 and 7 together**

```bash
git add src/shaders/atmosphere.wgsl src/graph/nodes/AtmosphereNode.ts
git commit -m "feat: AtmosphereNode reads cloud.color and composites with bilateral upsample"
```

---

## Task 8: Wire nodes in GraphBuilder.ts

**Files:**
- Modify: `src/graph/GraphBuilder.ts`

- [ ] **Step 1: Add imports**

Add after the existing node imports:

```typescript
import { CloudCoverageNode }     from './nodes/CloudCoverageNode.ts';
import { CloudRenderNode }       from './nodes/CloudRenderNode.ts';
```

- [ ] **Step 2: Replace the node construction and build block**

Find:

```typescript
    const noiseNode  = new ComputeNoiseNode(resources, pipelines);
    const planetNode = new PlanetRenderNode(scene, resources, pipelines);
    const atmosNode  = new AtmosphereNode(scene, resources, pipelines);

    noiseNode.build(buildCtx);
    planetNode.build(buildCtx);
    atmosNode.build(buildCtx);

    const graph = new RenderGraph(scene);
    graph.addNode(noiseNode);
    graph.addNode(planetNode);
    graph.addNode(atmosNode);
```

Replace with:

```typescript
    const noiseNode         = new ComputeNoiseNode(resources, pipelines);
    const planetNode        = new PlanetRenderNode(scene, resources, pipelines);
    const cloudCoverageNode = new CloudCoverageNode(resources, pipelines);
    const cloudRenderNode   = new CloudRenderNode(scene, resources, pipelines);
    const atmosNode         = new AtmosphereNode(scene, resources, pipelines);

    // Build order matters: cloudRenderNode registers 'cloud.color' which atmosNode reads
    noiseNode.build(buildCtx);
    planetNode.build(buildCtx);
    cloudCoverageNode.build(buildCtx);
    cloudRenderNode.build(buildCtx);
    atmosNode.build(buildCtx);

    const graph = new RenderGraph(scene);
    graph.addNode(noiseNode);
    graph.addNode(planetNode);
    graph.addNode(cloudCoverageNode);
    graph.addNode(cloudRenderNode);
    graph.addNode(atmosNode);
```

- [ ] **Step 3: Start the dev server and visually verify**

```bash
npm run dev
```

Open the browser. Check:
- Planet renders (no regression)
- Atmosphere renders (no regression)
- Patchy white/light-grey cloud regions appear floating above the planet surface
- Cloud regions follow the spherical shell (not clipped to planet disc)
- No WebGPU validation errors in the browser console

If clouds are invisible, check:
- `coverageThreshold` in `DEFAULT_CLOUD_PARAMS` (lower it toward 0.3 for more coverage)
- `extinction` (increase toward 12–16 for denser clouds)

If cloud layer is a solid white band, check:
- `coverageThreshold` is not too low
- `numSteps` is adequate (try 64 for higher quality)

- [ ] **Step 4: Commit**

```bash
git add src/graph/GraphBuilder.ts
git commit -m "feat: wire CloudCoverageNode + CloudRenderNode into render graph"
```

---

## Notes for Phase 2

- **Blue noise texture**: Replace `hash_jitter` in `cloud_render.wgsl` with `textureLoad(blueNoise, texel % noiseSize, 0).r` once the PNG is supplied. Add `@group(0) @binding(3)` for the noise texture, shift `depthTex` to binding 4, update `CloudRenderNode`'s bind group layout accordingly.
- **Ping-pong advection**: Enable `cloud.coverage.b` by making `CloudCoverageNode` alternate write targets each frame; add a wind-advection compute pass.
- **Multi-layer shells**: `cloudInnerRadius`/`cloudOuterRadius` are already uniform fields; a second march loop with `cloudInner2`/`cloudOuter2` adds a high-altitude cirrus layer.
- **TAA**: Once a history buffer is available, store `hit_t` in `cloud.color.a` instead of transmittance, reconstruct world-space hit for reprojection.
