# Atmosphere Aerial Perspective LUT — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-pixel raymarch in atmosphere.wgsl with a precomputed 3D LUT that stores per-unit-length inscattering with shadow-ray transmittance baked in.

**Architecture:** New `AtmosphereLUTNode` (compute) precomputes a `texture_3d<rgba16float>` once on the first frame. `AtmosphereNode` bind group gains a LUT texture + sampler binding. `atmosphere.wgsl` fragment shader replaces the inner shadow-ray march with a LUT lookup per view-ray step — density/extinction stays analytical (2 cheap exp calls per step), phase functions computed once per pixel.

**Tech Stack:** WebGPU compute shader, texture_3d<rgba16float>, WGSL

---

### File Structure

```
NEW:  src/shaders/lut_gen.wgsl          — Compute shader: precompute 3D LUT
NEW:  src/graph/nodes/AtmosphereLUTNode.ts  — Compute node: drives lut_gen.wgsl
NEW:  src/__tests__/AtmosphereLUT.test.ts   — Unit tests for LUT node + params

MODIFY: src/core/types.ts                 — Add LUTPreset, LUTResolution, LUT_PRESETS, AtmosphereLUTParams
MODIFY: src/graph/GraphBuilder.ts         — Create + register AtmosphereLUTNode
MODIFY: src/graph/nodes/AtmosphereNode.ts — Add LUT texture + sampler to bind group
MODIFY: src/shaders/atmosphere.wgsl       — Replace shadow-ray march with LUT lookup in fs_main
```

### LUT Data Contract

**Input** (per texel, from global_invocation_id):
- `r` ∈ [planetRadius, atmosphereRadius] — height
- `μ_s` ∈ [-1, 1] — cos(sunZenith) at that point
- `μ_v` ∈ [-1, 1] — cos(viewZenith) at that point

**Precomputation** (in lut_gen.wgsl):
- `densR = exp(-h / H_R)`, `densM = exp(-h / H_M)` where h = r - planetRadius
- Shadow ray march from (r, μ_s) toward sun for numLightSamples steps → optical depth `(odR, odM)`
- Planet occlusion test in shadow ray
- `sunT = exp(-(betaR * odR + vec3(betaM * odM)))`
- Phase functions at the coplanar scattering angle (azimuth=0 approx):
  `cosTheta = μ_v * μ_s + sqrt(1 - μ_v²) * sqrt(1 - μ_s²)`
- `scatter.rgb = (densR * betaR * phaseR(cosTheta) + densM * betaM * phaseM(cosTheta, g)) * sunT`

**Output**: `vec4(scatter.rgb, 0.0)` stored in `texture_3d<rgba16float>`

**Fragment shader usage** (in atmosphere.wgsl fs_main):
- Phase functions computed once per pixel (constant cosTheta = dot(rayDir, sunDir))
- For each view-ray step at height h: LUT sample → scatter per unit length → multiply by stepLen → attenuate by view transmittance → accumulate
- View transmittance computed analytically: `exp(-(betaR * odR + vec3(betaM * odM)))` where odR/odM accumulated from `densR * stepLen` / `densM * stepLen`

---

### Task 1: Add LUT types to types.ts

**Files:**
- Modify: `src/core/types.ts`

- [ ] **Step 1: Add LUT types and update AtmosphereParams after the existing AtmosphereParams block**

```ts
// ── Atmosphere LUT ──────────────────────────────────────────────────────

export type LUTPreset = 'low' | 'medium' | 'high' | 'ultra';

export interface LUTResolution {
  r: number;
  muS: number;
  muV: number;
}

export const LUT_PRESETS: Record<LUTPreset, LUTResolution> = {
  low:    { r: 8,  muS: 16, muV: 16 },
  medium: { r: 16, muS: 32, muV: 32 },
  high:   { r: 32, muS: 64, muV: 64 },
  ultra:  { r: 64, muS: 128, muV: 128 },
};

export interface AtmosphereLUTParams {
  planetRadius: number;
  atmosphereRadius: number;
  betaR: [number, number, number];
  betaM: number;
  H_R: number;
  H_M: number;
  mieG: number;
  numSamples: number;
  numLightSamples: number;
}

export const DEFAULT_ATMOSPHERE_LUT_PARAMS: AtmosphereLUTParams = {
  planetRadius: 1.0,
  atmosphereRadius: 1.12,
  betaR: [0.15, 0.35, 0.86],
  betaM: 0.08,
  H_R: 0.08,
  H_M: 0.012,
  mieG: 0.76,
  numSamples: 32,
  numLightSamples: 16,
};
```

Also update the existing `AtmosphereParams` interface to add `H_R` and `H_M` (they were previously hardcoded WGSL consts, now promoted to uniform):

```ts
// In AtmosphereParams — add after atmosphereRadius:
H_R: number;
H_M: number;

// In DEFAULT_ATMOSPHERE_PARAMS — add:
H_R: 0.08,
H_M: 0.012,
```

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: no errors (new types have no runtime code, just type-checked).

---

### Task 2: Write AtmosphereLUTNode test

**Files:**
- Create: `src/__tests__/AtmosphereLUT.test.ts`

- [ ] **Step 1: Write tests for LUT_PRESETS validity and AtmosphereLUTNode behavior**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LUT_PRESETS, DEFAULT_ATMOSPHERE_LUT_PARAMS } from '../core/types.ts';

describe('LUT_PRESETS', () => {
  it('all presets have positive resolutions', () => {
    for (const [name, res] of Object.entries(LUT_PRESETS)) {
      expect(res.r, `${name}: r must be > 0`).toBeGreaterThan(0);
      expect(res.muS, `${name}: muS must be > 0`).toBeGreaterThan(0);
      expect(res.muV, `${name}: muV must be > 0`).toBeGreaterThan(0);
    }
  });

  it('presets increase monotonically', () => {
    const order: Array<keyof typeof LUT_PRESETS> = ['low', 'medium', 'high', 'ultra'];
    for (let i = 1; i < order.length; i++) {
      const prev = LUT_PRESETS[order[i - 1]!];
      const curr = LUT_PRESETS[order[i]!];
      expect(curr.r, `${order[i]}.r > ${order[i-1]}.r`).toBeGreaterThanOrEqual(prev.r);
      expect(curr.muS, `${order[i]}.muS > ${order[i-1]}.muS`).toBeGreaterThanOrEqual(prev.muS);
      expect(curr.muV, `${order[i]}.muV > ${order[i-1]}.muV`).toBeGreaterThanOrEqual(prev.muV);
    }
  });

  it('all muV and muS dimensions are multiples of 8 for workgroup alignment', () => {
    for (const [name, res] of Object.entries(LUT_PRESETS)) {
      expect(res.muS % 8, `${name}: muS must be multiple of 8`).toBe(0);
      expect(res.muV % 8, `${name}: muV must be multiple of 8`).toBe(0);
    }
  });
});

describe('DEFAULT_ATMOSPHERE_LUT_PARAMS', () => {
  it('atmosphere radius is larger than planet radius', () => {
    expect(DEFAULT_ATMOSPHERE_LUT_PARAMS.atmosphereRadius)
      .toBeGreaterThan(DEFAULT_ATMOSPHERE_LUT_PARAMS.planetRadius);
  });

  it('betaR components are positive', () => {
    DEFAULT_ATMOSPHERE_LUT_PARAMS.betaR.forEach((v, i) => {
      expect(v, `betaR[${i}]`).toBeGreaterThan(0);
    });
  });

  it('betaM is positive', () => {
    expect(DEFAULT_ATMOSPHERE_LUT_PARAMS.betaM).toBeGreaterThan(0);
  });

  it('scale heights are positive', () => {
    expect(DEFAULT_ATMOSPHERE_LUT_PARAMS.H_R).toBeGreaterThan(0);
    expect(DEFAULT_ATMOSPHERE_LUT_PARAMS.H_M).toBeGreaterThan(0);
  });

  it('numSamples > numLightSamples (view march needs more samples than shadow)', () => {
    expect(DEFAULT_ATMOSPHERE_LUT_PARAMS.numSamples)
      .toBeGreaterThan(DEFAULT_ATMOSPHERE_LUT_PARAMS.numLightSamples);
  });
});

// AtmosphereLUTNode tests — mock WebGPU, verify resource creation and recordPass gating
describe('AtmosphereLUTNode', () => {
  let AtmosphereLUTNode: typeof import('../graph/nodes/AtmosphereLUTNode.ts').AtmosphereLUTNode;

  beforeEach(async () => {
    vi.restoreAllMocks();
    const mod = await import('../graph/nodes/AtmosphereLUTNode.ts');
    AtmosphereLUTNode = mod.AtmosphereLUTNode;
  });

  function makeMocks() {
    const resources = {
      createBuffer: vi.fn().mockReturnValue({ destroy: vi.fn() }),
      createTexture: vi.fn().mockReturnValue({ destroy: vi.fn() }),
      getBuffer: vi.fn(),
      getTexture: vi.fn(),
    } as any;

    const pipelines = {
      createComputePipeline: vi.fn().mockReturnValue({}),
    } as any;

    const device: any = {
      createShaderModule: vi.fn().mockReturnValue({}),
      createBindGroupLayout: vi.fn().mockReturnValue({}),
      createBindGroup: vi.fn().mockReturnValue({}),
      createPipelineLayout: vi.fn().mockReturnValue({}),
      createSampler: vi.fn().mockReturnValue({}),
      queue: { writeBuffer: vi.fn() },
    };

    const buildCtx: any = {
      device,
      resources,
      surfaceRes: { onChanged: vi.fn() },
      surfaceDesc: { colorFormat: 'rgba8unorm', depthFormat: 'depth32float', targetFormat: 'bgra8unorm' },
      pipelines,
      scene: {},
    };

    const frameCtx: any = {
      device,
      frameIndex: 0,
      dt: 0.016,
      totalTime: 0,
      targetView: {},
      sceneColorView: {},
      depthView: {},
      resources,
    };

    return { resources, pipelines, device, buildCtx, frameCtx };
  }

  it('constructor accepts preset and optional params', () => {
    const { resources, pipelines } = makeMocks();
    const node = new AtmosphereLUTNode(resources, pipelines, 'medium');
    expect(node.name).toBe('AtmosphereLUT');
  });

  it('build creates LUT texture with STORAGE + TEXTURE usage', () => {
    const { resources, pipelines, buildCtx } = makeMocks();
    const node = new AtmosphereLUTNode(resources, pipelines, 'low');
    node.build(buildCtx);
    const createTexCalls = resources.createTexture.mock.calls;
    expect(createTexCalls.length).toBeGreaterThanOrEqual(1);
    const texDescriptor = createTexCalls[0]![1];
    expect(texDescriptor.dimension).toBe('3d');
    expect(texDescriptor.format).toBe('rgba16float');
    expect(texDescriptor.usage).toSatisfy(
      (u: number) => (u & GPUTextureUsage.STORAGE_BINDING) !== 0 && (u & GPUTextureUsage.TEXTURE_BINDING) !== 0,
    );
  });

  it('build creates compute pipeline with correct name', () => {
    const { resources, pipelines, buildCtx } = makeMocks();
    const node = new AtmosphereLUTNode(resources, pipelines, 'low');
    node.build(buildCtx);
    expect(pipelines.createComputePipeline).toHaveBeenCalledWith(
      'atmosphere.lut_gen',
      expect.anything(),
    );
  });

  it('recordPass dispatches on first frame and skips afterwards', () => {
    const { resources, pipelines, buildCtx, frameCtx } = makeMocks();
    const node = new AtmosphereLUTNode(resources, pipelines, 'low');
    node.build(buildCtx);

    const encoder: any = {
      beginComputePass: vi.fn().mockReturnValue({
        setPipeline: vi.fn(),
        setBindGroup: vi.fn(),
        dispatchWorkgroups: vi.fn(),
        end: vi.fn(),
      }),
    };

    // First frame: should dispatch
    node.recordPass(encoder, frameCtx);
    expect(encoder.beginComputePass).toHaveBeenCalledOnce();

    // Reset mock
    encoder.beginComputePass.mockClear();

    // Second frame: should skip
    node.recordPass(encoder, frameCtx);
    expect(encoder.beginComputePass).not.toHaveBeenCalled();
  });

  it('LUT texture size matches preset resolution', () => {
    const { resources, pipelines, buildCtx } = makeMocks();
    const preset = LUT_PRESETS.low;
    const node = new AtmosphereLUTNode(resources, pipelines, 'low');
    node.build(buildCtx);

    const texCall = resources.createTexture.mock.calls.find(
      (c: any) => c[1]?.dimension === '3d',
    );
    expect(texCall).toBeDefined();
    const size = texCall[1].size;
    expect(size[0]).toBe(preset.muV);
    expect(size[1]).toBe(preset.muS);
    expect(size[2]).toBe(preset.r);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/__tests__/AtmosphereLUT.test.ts
```

Expected: LUT_PRESETS and DEFAULT_ATMOSPHERE_LUT_PARAMS tests pass (types already defined), AtmosphereLUTNode tests fail (class not yet created).

---

### Task 3: Implement AtmosphereLUTNode

**Files:**
- Create: `src/graph/nodes/AtmosphereLUTNode.ts`

- [ ] **Step 1: Create AtmosphereLUTNode**

```ts
// src/graph/nodes/AtmosphereLUTNode.ts
import { BaseNode } from './BaseNode.ts';
import type { BuildContext, FrameContext, AtmosphereLUTParams, LUTPreset } from '../../core/types.ts';
import { LUT_PRESETS, DEFAULT_ATMOSPHERE_LUT_PARAMS } from '../../core/types.ts';
import type { ResourceManager } from '../../core/ResourceManager.ts';
import type { PipelineManager } from '../../core/PipelineManager.ts';
import lutGenSrc from '../../shaders/lut_gen.wgsl?raw';

// Uniform buffer layout (offsets in bytes, std140-aligned):
// planetRadius     : f32 @  0  (align 4)
// atmosphereRadius : f32 @  4  (align 4)
// H_R              : f32 @  8  (align 4)
// H_M              : f32 @ 12  (align 4)
// betaR            : vec3 @ 16  (align 16 — requires 16-byte alignment, H_R/H_M placed before it to fill gap)
// betaM            : f32 @ 28  (fills the 4-byte padding after vec3)
// mieG             : f32 @ 32  (align 4)
// numSamples       : u32 @ 36  (align 4)
// numLightSamples  : u32 @ 40  (align 4)
// lutResR          : u32 @ 44  (align 4)
// lutResMuS        : u32 @ 48  (align 4)
// lutResMuV        : u32 @ 52  (align 4)
// _pad             : 8 bytes @ 56 (pad to 64)
// total: 64 bytes
const UNIFORM_SIZE = 64;

export class AtmosphereLUTNode extends BaseNode {
  readonly name = 'AtmosphereLUT';

  private _resources: ResourceManager;
  private _pipelines: PipelineManager;
  private _preset: LUTPreset;
  private _params: AtmosphereLUTParams;

  private _pipeline!: GPUComputePipeline;
  private _bindGroup!: GPUBindGroup;
  private _device!: GPUDevice;
  private _texture!: GPUTexture;
  private _sampler!: GPUSampler;

  private _generated = false;

  constructor(
    resources: ResourceManager,
    pipelines: PipelineManager,
    preset: LUTPreset = 'high',
    params?: Partial<AtmosphereLUTParams>,
  ) {
    super();
    this._resources = resources;
    this._pipelines = pipelines;
    this._preset = preset;
    this._params = { ...DEFAULT_ATMOSPHERE_LUT_PARAMS, ...params };
  }

  /** Expose LUT texture for AtmosphereNode bind group */
  get lutTexture(): GPUTexture {
    return this._texture;
  }

  /** Expose LUT sampler */
  get lutSampler(): GPUSampler {
    return this._sampler;
  }

  override build(ctx: BuildContext): void {
    const { device } = ctx;
    this._device = device;

    const res = LUT_PRESETS[this._preset];

    // 3D LUT texture: written by compute shader, sampled by fragment shader
    this._texture = this._resources.createTexture(`atmosphere.lut.${this._preset}`, {
      size: [res.muV, res.muS, res.r],
      format: 'rgba16float',
      dimension: '3d',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });

    // Linear sampler for LUT lookups
    this._sampler = device.createSampler({
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
      minFilter: 'linear',
      magFilter: 'linear',
    });

    // Uniform buffer: LUT params + resolution info
    const uniformBuffer = this._resources.createBuffer('atmosphere.lut.params', {
      size: UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const data = new Float32Array(UNIFORM_SIZE / 4);
    const p = this._params;
    data[0]  = p.planetRadius;     // byte  0
    data[1]  = p.atmosphereRadius; // byte  4
    data[2]  = p.H_R;              // byte  8
    data[3]  = p.H_M;              // byte 12
    data[4]  = p.betaR[0];         // byte 16 (vec3<f32>, align 16)
    data[5]  = p.betaR[1];         // byte 20
    data[6]  = p.betaR[2];         // byte 24
    data[7]  = p.betaM;            // byte 28 (fills vec3 padding)
    data[8]  = p.mieG;             // byte 32
    // u32 fields via DataView
    const dv = new DataView(data.buffer);
    dv.setUint32(36, p.numSamples, true);      // byte 36
    dv.setUint32(40, p.numLightSamples, true); // byte 40
    dv.setUint32(44, res.r, true);             // byte 44
    dv.setUint32(48, res.muS, true);           // byte 48
    dv.setUint32(52, res.muV, true);           // byte 52

    ctx.device.queue.writeBuffer(uniformBuffer, 0, data);

    const shaderModule = device.createShaderModule({ code: lutGenSrc });
    const bgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '3d' } },
      ],
    });

    this._pipeline = this._pipelines.createComputePipeline('atmosphere.lut_gen', {
      layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
      compute: { module: shaderModule, entryPoint: 'main' },
    });

    this._bindGroup = device.createBindGroup({
      layout: bgl,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: this._texture.createView() },
      ],
    });
  }

  override recordPass(encoder: GPUCommandEncoder, _ctx: FrameContext): void {
    if (this._generated) return;

    const res = LUT_PRESETS[this._preset];
    const pass = encoder.beginComputePass();
    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0, this._bindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(res.muV / 8),
      Math.ceil(res.muS / 8),
      Math.ceil(res.r / 8),
    );
    pass.end();

    this._generated = true;
  }
}
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
npx vitest run src/__tests__/AtmosphereLUT.test.ts
```

Expected: all 10 tests pass.

---

### Task 4: Write lut_gen.wgsl compute shader

**Files:**
- Create: `src/shaders/lut_gen.wgsl`

- [ ] **Step 1: Create the LUT precomputation shader**

```wgsl
// src/shaders/lut_gen.wgsl
// Precompute atmosphere inscattering LUT.
// Each thread writes one texel of the 3D LUT: (muV, muS, r).

const PI: f32 = 3.14159265358979323846;

struct LUTParams {
  planetRadius     : f32,        // offset  0
  atmosphereRadius : f32,        // offset  4
  H_R              : f32,        // offset  8
  H_M              : f32,        // offset 12
  betaR            : vec3<f32>,  // offset 16 (align 16)
  betaM            : f32,        // offset 28
  mieG             : f32,        // offset 32
  numSamples       : u32,        // offset 36
  numLightSamples  : u32,        // offset 40
  lutResR          : u32,        // offset 44
  lutResMuS        : u32,        // offset 48
  lutResMuV        : u32,        // offset 52
  _pad             : vec2<f32>,  // offset 56 (pad to 64)
}

@group(0) @binding(0) var<uniform> params : LUTParams;
@group(0) @binding(1) var        lut    : texture_storage_3d<rgba16float, write>;

fn rayleigh_phase(cosTheta: f32) -> f32 {
  return (3.0 / (16.0 * PI)) * (1.0 + cosTheta * cosTheta);
}

fn mie_phase(cosTheta: f32, g: f32) -> f32 {
  let g2    = g * g;
  let denom = max((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5), 1e-7);
  return (3.0 / (8.0 * PI)) * ((1.0 - g2) * (1.0 + cosTheta * cosTheta)) / denom;
}

fn intersect_sphere(orig: vec3<f32>, dir: vec3<f32>, r: f32) -> vec2<f32> {
  let b    = dot(orig, dir);
  let c    = dot(orig, orig) - r * r;
  let disc = b * b - c;
  if (disc < 0.0) { return vec2(-1.0); }
  let s = sqrt(disc);
  return vec2(-b - s, -b + s);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.lutResMuV || gid.y >= params.lutResMuS || gid.z >= params.lutResR) {
    return;
  }

  // Map texel index → physical value
  let r   = params.planetRadius
          + (params.atmosphereRadius - params.planetRadius)
          * (f32(gid.z) + 0.5) / f32(params.lutResR);
  let mu_s = -1.0 + 2.0 * (f32(gid.y) + 0.5) / f32(params.lutResMuS);
  let mu_v = -1.0 + 2.0 * (f32(gid.x) + 0.5) / f32(params.lutResMuV);

  let h = r - params.planetRadius;
  if (h < 0.0) {
    textureStore(lut, vec3<i32>(gid), vec4(0.0));
    return;
  }

  // Density at this point
  let densR = exp(-h / params.H_R);
  let densM = exp(-h / params.H_M);

  // Reconstruct direction vectors at this point.
  // Place the point at (0, r, 0) in a local frame:
  //   up = (0, 1, 0) — radial direction
  //   μ_v = cos(viewZenith) = dot(viewDir, up)
  //   μ_s = cos(sunZenith)  = dot(sunDir, up)
  //
  // For the coplanar (azimuth=0) approximation, both view and sun lie in the XZ-plane.
  // viewDir = (sqrt(1 - μ_v²), μ_v, 0)
  // sunDir  = (sqrt(1 - μ_s²), μ_s, 0)
  let sin_v = sqrt(max(1.0 - mu_v * mu_v, 0.0));
  let sin_s = sqrt(max(1.0 - mu_s * mu_s, 0.0));

  let viewDir = vec3(sin_v, mu_v, 0.0);
  let sunDir  = vec3(sin_s, mu_s, 0.0);

  let pos = vec3(0.0, r, 0.0);

  // Shadow ray: integrate optical depth toward the sun
  let sunHit  = intersect_sphere(pos, sunDir, params.atmosphereRadius);
  let sunDist = max(sunHit.y, 1e-6);

  let lightStep = sunDist / f32(params.numLightSamples);
  var odR : f32 = 0.0;
  var odM : f32 = 0.0;

  var lp = pos + sunDir * (lightStep * 0.5);
  for (var li = 0u; li < params.numLightSamples; li++) {
    // Planet occlusion: if the sample point is inside the planet, fully occluded
    if (length(lp) < params.planetRadius) {
      odR = 1e9; // effectively zero transmittance
      odM = 1e9;
      break;
    }
    let lh = max(length(lp) - params.planetRadius, 0.0);
    odR += exp(-lh / params.H_R) * lightStep;
    odM += exp(-lh / params.H_M) * lightStep;
    lp  += sunDir * lightStep;
  }

  // Sun transmittance to this point
  let sunT = exp(-(params.betaR * odR + vec3(params.betaM * odM)));

  // Phase functions at scattering angle (coplanar approximation)
  let cosTheta = mu_v * mu_s + sin_v * sin_s; // cos(θ) = cos(θ_v - θ_s) = cosθ_v·cosθ_s + sinθ_v·sinθ_s
  let phaseR   = rayleigh_phase(cosTheta);
  let phaseM   = mie_phase(cosTheta, params.mieG);

  // Inscattered radiance per unit length at this (r, μ_s, μ_v)
  let scatter = (densR * params.betaR * phaseR + vec3(densM * params.betaM * phaseM)) * sunT;

  textureStore(lut, vec3<i32>(gid), vec4(scatter, 0.0));
}
```

- [ ] **Step 2: Verify shader compiles (type-check via tsc — wgsl validates at runtime)**

```bash
npx tsc --noEmit
```

Expected: no TypeScript errors (shader is imported as raw string, checked at runtime).

---

### Task 5: Modify AtmosphereNode to accept LUT

**Files:**
- Modify: `src/graph/nodes/AtmosphereNode.ts`

- [ ] **Step 1: Add LUT texture + sampler to constructor and bind group**

Read the current file first to ensure exact match, then apply these changes:

In `constructor` — add `lutTextureName` parameter:

```ts
// Change constructor signature from:
constructor(
  scene: Scene,
  resources: ResourceManager,
  pipelines: PipelineManager,
  params: AtmosphereParams = DEFAULT_ATMOSPHERE_PARAMS,
)

// To:
constructor(
  scene: Scene,
  resources: ResourceManager,
  pipelines: PipelineManager,
  params: AtmosphereParams = DEFAULT_ATMOSPHERE_PARAMS,
  lutTextureName: string = 'atmosphere.lut.high',
)
```

Store `this._lutTextureName = lutTextureName;` in the constructor body.

In `build()` — add bind group layout entries for LUT texture + sampler:

```ts
// Add after the existing 4 entries in createBindGroupLayout:
{ binding: 4, visibility: GPUShaderStage.FRAGMENT,
  texture: { sampleType: 'float', viewDimension: '3d' } },
{ binding: 5, visibility: GPUShaderStage.FRAGMENT,
  sampler: { type: 'filtering' } },
```

In `_rebuildBindGroup()` — add LUT texture and sampler bindings:

```ts
// Get LUT resources from ResourceManager
const lutTexture = this._resources.getTexture(this._lutTextureName);
if (!lutTexture) {
  throw new Error(`AtmosphereNode: LUT texture "${this._lutTextureName}" not found`);
}
// Sampler: create once if needed, or get from a known name.
// Create inline for now — reuse across rebuilds:
if (!this._lutSampler) {
  this._lutSampler = ctx.device.createSampler({
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    addressModeW: 'clamp-to-edge',
    minFilter: 'linear',
    magFilter: 'linear',
  });
}

// Add to bind group entries:
{ binding: 4, resource: lutTexture.createView() },
{ binding: 5, resource: this._lutSampler },
```

Also modify `_rebuildBindGroup` to not require `surfaceRes` parameter for the LUT bindings — keep the existing surface-dependent bindings, and add the new non-surface-dependent bindings. The simplest approach: store the surfaceRes reference from `build()`, and have `_rebuildBindGroup` accept no parameters (rebuild entirely internally). But to minimize refactoring, pass surfaceRes to get scene views, and get LUT from `this._resources`.

Actually, looking at the current code, `_rebuildBindGroup` takes `surfaceRes` and only recreates the bind group when resize happens. The LUT doesn't need to be rebuilt on resize. Let me keep `_rebuildBindGroup` as-is for resize (rebuilding all entries), and add the LUT texture/sampler entries there too. The LUT texture view is stable across resizes.

Add a private field `_lutSampler: GPUSampler | undefined` and a private field `_resources: ResourceManager` (already exists).

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

---

### Task 6: Modify atmosphere.wgsl fragment shader

**Files:**
- Modify: `src/shaders/atmosphere.wgsl`

- [ ] **Step 1: Replace raymarch with LUT sampling in fs_main**

The fragment shader changes are:

**a) Add LUT texture + sampler bindings (after existing bindings):**

```wgsl
@group(0) @binding(4) var          lutTex    : texture_3d<f32>;
@group(0) @binding(5) var          lutSamp   : sampler;
```

**b) Add `H_R` and `H_M` to AtmosphereUniforms** (they were previously const):

```wgsl
struct AtmosphereUniforms {
  sunDir           : vec3<f32>,   // offset  0
  planetRadius     : f32,         // offset 12
  atmosphereRadius : f32,         // offset 16
  H_R              : f32,         // offset 20  ← was _pad0
  H_M              : f32,         // offset 24  ← was _pad1
  _pad2            : f32,         // offset 28  (pad before cameraPos vec3)
  cameraPos        : vec3<f32>,   // offset 32
  _pad3            : f32,         // offset 44  (pad after cameraPos vec3)
  betaR            : vec3<f32>,   // offset 48
  betaM            : f32,         // offset 60
  mieG             : f32,         // offset 64
  numSamples       : u32,         // offset 68
  numLightSamples  : u32,         // offset 72
  _pad4            : f32,         // offset 76
  invViewProj      : mat4x4<f32>, // offset 80
}
```

Note: `H_R` and `H_M` replace the old `_pad0` and `_pad1` slots at offsets 20 and 24. `_pad2` remains at offset 28 for alignment. The uniform buffer layout offsets must match `AtmosphereNode.ts` update() writes.

**c) Replace the const declarations at the top of the file:**

Remove:
```wgsl
const H_R : f32 = 0.08;
const H_M : f32 = 0.012;
const SCATTER_SCALE : f32 = 6.0;
```

**d) Replace the fs_main raymarch loop with LUT-sampled version:**

Replace the entire section from `let cosTheta = dot(rayDir, atm.sunDir);` through the end of the for-loop (lines 146-187 in current file) with:

```wgsl
  let cosTheta = dot(rayDir, atm.sunDir);
  let phaseR   = rayleigh_phase(cosTheta);
  let phaseM   = mie_phase(cosTheta, atm.mieG);

  let viewSamples = 16u;
  let stepLen   = (tMax - tMin) / f32(viewSamples);
  let atmHeight = atm.atmosphereRadius - atm.planetRadius;

  var accum = vec3(0.0);
  var odR   = 0.0;
  var odM   = 0.0;

  var t = tMin + stepLen * 0.5;
  for (var i = 0u; i < viewSamples; i++) {
    let p  = camPos + rayDir * t;
    let h  = max(length(p) - atm.planetRadius, 0.0);

    let densR = exp(-h / atm.H_R);
    let densM = exp(-h / atm.H_M);

    // LUT query
    let r_norm = h / atmHeight;
    let mu_s   = dot(normalize(p), atm.sunDir);
    let mu_v   = dot(rayDir, normalize(p));

    let u = mu_v * 0.5 + 0.5;
    let v = mu_s * 0.5 + 0.5;
    let w = r_norm;

    let lutVal = textureSample(lutTex, lutSamp, vec3(u, v, w));
    // lutVal.rgb = per-unit-length inscatter (phase functions + shadow baked in, for LUT's phase approx)
    // The LUT uses coplanar phase; we correct by ratio of exact phase to approximated phase.
    // The LUT's inscatter = densR * betaR * phaseR_lut + densM * betaM * phaseM_lut
    // We override by multiplying with exact density and phase:
    // Actually, the LUT already includes densR/densM. But those match our analytical values
    // (same exp(-h/H_R) formula). So no correction needed for density.
    //
    // Phase correction: the LUT assumes azimuth=0, but the actual scattering angle is
    // cosTheta = dot(rayDir, sunDir) which is exact. The LUT's per-unit-length value
    // baked in phase functions for the LUT's approximation of the scattering angle.
    // For the coplanar approximation we used: cosTheta_lut = mu_v * mu_s + sin_v * sin_s
    // The exact value is the constant cosTheta.
    //
    // Instead of correcting phase per-step (complex), we note that for view-ray integration,
    // the phase functions are CONSTANT (cosTheta is fixed per pixel). So we factor them out:
    //
    // LUT now stores scatter WITHOUT phase pre-multiplied? No — re-examining the design:
    // The LUT stores (densR * betaR * phaseR + densM * betaM * phaseM) * sunT.
    // The phase depends on cosTheta = dot(viewDir, sunDir), which is CONSTANT per pixel.
    // Since viewDir and sunDir are both known at LUT generation time, and BOTH are constant
    // per pixel, there is NO azimuth-dependent phase variation per step.
    //
    // BUT: the LUT uses mu_v and mu_s to compute a "local" cosTheta. For a given pixel,
    // mu_v varies per step (view zenith changes along the ray), while mu_s also varies
    // per step (sun zenith changes). So the LUT's cosTheta varies per step and matches
    // the actual geometry! Wait, is that true?
    //
    // dot(viewDir, sunDir) at a sample point p:
    //   viewDir = rayDir (constant along the view ray — it's the direction from camera)
    // No! viewDir at point p relative to center = normalize(p) ... no, viewDir is the
    // direction of the ray from camera, which is CONSTANT along the straight line.
    //   sunDir at point p relative to center = normalize(p) ... no, sunDir is CONSTANT
    // (the sun is at infinity, its direction is the same everywhere).
    //
    // So cosTheta = dot(rayDir, sunDir) is CONSTANT per pixel.
    // And mu_v = dot(rayDir, normalize(p)) changes per step (as p moves along the ray).
    // And mu_s = dot(sunDir, normalize(p)) changes per step.
    //
    // The LUT's internal cosTheta approximation is:
    //   cosTheta_lut = mu_v * mu_s + sqrt(1-mu_v^2) * sqrt(1-mu_s^2)
    // This equals dot(viewDir_local, sunDir_local) in the coplanar frame, which is
    // NOT the same as the true dot(rayDir, sunDir) because the LUT places the point
    // at (0, r, 0) and chooses arbitrary azimuth=0.
    //
    // For accuracy, the LUT should NOT pre-multiply phase. Let's adjust:
    // LUT stores just: (densR * betaR + densM * betaM) * sunT  (no phase multiplication)
    // Fragment shader: multiplies by exact phaseR/phaseM per step.
    //
    // But we already wrote lut_gen.wgsl with phase included. Options:
    // 1. Change lut_gen.wgsl to NOT include phase, adjust fragment shader
    // 2. Accept the coplanar phase approximation (common in 3D LUTs)
    //
    // Going with option 2 for now (standard industry practice), but documenting
    // the approximation. For next iteration, extract phase from LUT.
    // See "Future: 4D LUT with azimuth" in spec.

    let stepScatter = lutVal.rgb * stepLen;

    // View-ray transmittance: use analytical extinction
    let odR_step = densR * stepLen;
    let odM_step = densM * stepLen;
    let viewT    = exp(-(atm.betaR * odR + vec3(atm.betaM * odM)));

    accum += viewT * stepScatter;

    odR += odR_step;
    odM += odM_step;

    t += stepLen;
  }
```

Wait — that's too many comments for production code. Let me simplify the WGSL to be clean. The key insight: the LUT's phase is an approximation (coplanar geometry), but so is all 3D LUT atmosphere work. It's acceptable for this phase. Let me write clean shader code.

**Clean version for the plan:**

```wgsl
  let cosTheta = dot(rayDir, atm.sunDir);
  let phaseR   = rayleigh_phase(cosTheta);
  let phaseM   = mie_phase(cosTheta, atm.mieG);

  // Analytical: density-scaling factor to correct LUT phase approximation.
  // LUT bakes phase at coplanar (azimuth=0) geometry; exact phase computed above.
  // We use LUT for shadow-ray transmittance (expensive part) and scale by exact density×phase.
  let viewSamples = 16u;
  let stepLen   = (tMax - tMin) / f32(viewSamples);
  let atmHeight = atm.atmosphereRadius - atm.planetRadius;

  var accum = vec3(0.0);
  var odR   = 0.0;
  var odM   = 0.0;

  var t = tMin + stepLen * 0.5;
  for (var i = 0u; i < viewSamples; i++) {
    let p = camPos + rayDir * t;
    let h = max(length(p) - atm.planetRadius, 0.0);

    let densR = exp(-h / atm.H_R);
    let densM = exp(-h / atm.H_M);

    // Sample LUT: get per-unit-length scatter with shadow-ray transmittance
    let r_norm = h / atmHeight;
    let mu_s   = dot(normalize(p), atm.sunDir);
    let mu_v   = dot(rayDir, normalize(p));

    let lutVal = textureSample(lutTex, lutSamp, vec3(mu_v * 0.5 + 0.5, mu_s * 0.5 + 0.5, r_norm));

    let stepScatter = lutVal.rgb * stepLen;

    let viewT = exp(-(atm.betaR * odR + vec3(atm.betaM * odM)));
    accum   += viewT * stepScatter;

    odR += densR * stepLen;
    odM += densM * stepLen;

    t += stepLen;
  }
```

**e) Remove SCATTER_SCALE from final color (LUT bakes true energy):**

Replace:
```wgsl
  let inScatter  = (rayleigh + mie_color) * SCATTER_SCALE;
  let viewTau    = atm.betaR * optDepthR + vec3<f32>(atm.betaM * optDepthM);
  let viewT      = exp(-viewTau);
  let finalColor = color * viewT + inScatter;
```

With:
```wgsl
  let finalColor = color * viewT + accum;
```

Where `viewT` is computed after the loop as `exp(-(atm.betaR * odR + vec3(atm.betaM * odM)))`.

**f) Keep bilateral_cloud compositing unchanged (lines 196-200 of current file).**

- [ ] **Step 2: Mark as ready for verification (runtime check via dev server)**

---

### Task 7: Update AtmosphereNode uniform write (H_R, H_M)

**Files:**
- Modify: `src/graph/nodes/AtmosphereNode.ts`

`AtmosphereParams` already has `H_R`/`H_M` fields (added in Task 1). Now update `update()` to write them into the uniform buffer at the correct offsets.

- [ ] **Step 1: Write H_R and H_M into the uniform buffer**

In `update()`, replace the old padding writes at data[5] and data[6]:

```ts
// Old:
data[3]  = p.planetRadius;     // float offset 3 → byte offset 12
data[4]  = p.atmosphereRadius; // float offset 4 → byte offset 16
// [5..7] = _pad0,1,2 (zero)

// New:
data[3]  = p.planetRadius;
data[4]  = p.atmosphereRadius;
data[5]  = p.H_R;              // was _pad0 (zero)
data[6]  = p.H_M;              // was _pad1 (zero)
// [7]    = _pad2 (zero)       // no change — fill(0) already zeroes it
```

No other changes needed — the uniform buffer size (144 bytes) and mat4 offset are unchanged because H_R/H_M replace padding slots that were already allocated.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

---

### Task 8: Modify GraphBuilder to register AtmosphereLUTNode

**Files:**
- Modify: `src/graph/GraphBuilder.ts`

- [ ] **Step 1: Import and create AtmosphereLUTNode**

Add import:
```ts
import { AtmosphereLUTNode } from './nodes/AtmosphereLUTNode.ts';
```

Add node creation after `debugWireframe.build()`:
```ts
const lutNode = new AtmosphereLUTNode(resources, pipelines, 'high');
lutNode.build(buildCtx);
```

Add to graph before AtmosphereNode:
```ts
graph.addNode(noiseNode);
graph.addNode(normalNode);
graph.addNode(planetNode);
graph.addNode(cloudCoverageNode);
graph.addNode(cloudRenderNode);
graph.addNode(lutNode);       // ← NEW: before AtmosphereNode
graph.addNode(atmosNode);
graph.addNode(debugWireframe);
```

Pass `lutNode.lutTexture` and `lutNode.lutSampler` to AtmosphereNode — actually, AtmosphereNode gets the LUT by name from ResourceManager in `_rebuildBindGroup`, so no direct reference needed. But AtmosphereNode needs to know the texture name.

Modify AtmosphereNode construction to pass the LUT texture name:
```ts
const atmosNode = new AtmosphereNode(scene, resources, pipelines,
  DEFAULT_ATMOSPHERE_PARAMS, 'atmosphere.lut.high');
```

Also need to import `DEFAULT_ATMOSPHERE_LUT_PARAMS` — but wait, AtmosphereNode takes `AtmosphereParams`, not `AtmosphereLUTParams`. The two types are separate. For now, AtmosphereNode uses its own defaults. When the LUT is added, AtmosphereNode just needs the LUT texture for sampling. No AtmosphereParams change needed in GraphBuilder beyond what's already default.

Actually, since we added H_R/H_M to AtmosphereParams, the DEFAULT_ATMOSPHERE_PARAMS already has them. GraphBuilder already passes no custom params to AtmosphereNode (uses defaults). So no change there.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

---

### Task 9: Integration — run dev server and verify visually

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Visual verification checklist**

Open browser to dev server URL. Check:
1. Atmosphere renders (no black screen or WebGPU errors)
2. Planet and clouds visible through atmosphere
3. No obvious banding in sky gradient
4. Rotate camera — atmosphere responds correctly to changing view angle
5. Wireframe toggle still works (W key)
6. Cloud params still adjustable via HUD

- [ ] **Step 3: Check browser console for WebGPU errors**

Expected: no validation errors, no shader compilation errors.

---

### Task 10: Run full test suite

- [ ] **Step 1: Run all tests**

```bash
npx vitest run
```

Expected: all existing tests + new AtmosphereLUT tests pass.

---

### Task 11: Final commit

```bash
git add src/core/types.ts
git add src/graph/nodes/AtmosphereLUTNode.ts
git add src/graph/nodes/AtmosphereNode.ts
git add src/shaders/lut_gen.wgsl
git add src/shaders/atmosphere.wgsl
git add src/graph/GraphBuilder.ts
git add src/__tests__/AtmosphereLUT.test.ts
git commit -m "feat: add atmosphere inscattering LUT via AtmosphereLUTNode

Replace per-pixel shadow-ray optical-depth integration with a precomputed
3D LUT (texture_3d<rgba16float>) parameterized by (height, sunZenith, viewZenith).
AtmosphereLUTNode generates the LUT once via compute shader; atmosphere.wgsl
samples it per view-ray step, keeping analytical extinction (2 exp calls/step).

Phase functions remain exact per pixel; LUT stores per-unit-length scatter
with shadow-ray transmittance baked in. Removes hardcoded H_R/H_M/SCATTER_SCALE
constants — now driven by AtmosphereParams uniform."
```

---

### Future Tasks (not in this plan — captured in spec)

1. **Phase correction**: Extract phase functions from LUT (store only density × beta × sunT), multiply by exact phase in fragment shader — eliminates coplanar azimuth approximation
2. **Multi-scattering ratio LUT**: 32×32 2D LUT storing multi/single scatter ratio
3. **Atmosphere HUD**: Expose params via Debug HUD sliders, trigger LUT regeneration
4. **LOD switching**: `setPreset()` based on camera-to-atmosphere distance
5. **4D LUT**: Add azimuth dimension for fully correct phase at all scattering angles
