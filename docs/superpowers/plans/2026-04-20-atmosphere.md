# AtmosphereNode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement Nishita single-scattering atmospheric rendering as a full-screen post-process pass, including the offline render target infrastructure required by future effects.

**Architecture:** PlanetRenderNode writes to an intermediate `scene.color` texture; AtmosphereNode does a full-screen raymarching pass that reads `scene.color` + `scene.depth` and composites the result to the canvas. Sun direction is derived from a `SunComponent` on a `SunEntity`.

**Tech Stack:** WebGPU (WGSL render shader), TypeScript, wgpu-matrix, Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-04-20-atmosphere-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/core/types.ts` | Add `AtmosphereParams`, `DEFAULT_ATMOSPHERE_PARAMS`; add `sceneColorView` to `FrameContext` |
| Create | `src/__tests__/AtmosphereParams.test.ts` | Unit tests for `AtmosphereParams` invariants |
| Create | `src/ecs/components/SunComponent.ts` | Stores sun world position; AtmosphereNode derives `sunDir` from it |
| Modify | `src/graph/GraphBuilder.ts` | Create `scene.color` / `scene.depth` RT textures; expose `resources` in `BuiltGraph`; add `SunEntity`; register `AtmosphereNode` |
| Modify | `src/core/WebGPUEngine.ts` | Get textures from `resources`; drop inline depth texture; add `sceneColorView` to `FrameContext` |
| Modify | `src/graph/nodes/PlanetRenderNode.ts` | Render to `ctx.sceneColorView`; use `depth32float`; target format `rgba8unorm` |
| Create | `src/shaders/atmosphere.wgsl` | Full-screen Nishita raymarching shader |
| Modify | `src/graph/nodes/AtmosphereNode.ts` | Full node implementation |

---

## Task 1: AtmosphereParams types + unit tests

**Files:**
- Modify: `src/core/types.ts`
- Create: `src/__tests__/AtmosphereParams.test.ts`

- [x] **Step 1: Write failing test**

Create `src/__tests__/AtmosphereParams.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DEFAULT_ATMOSPHERE_PARAMS } from '../core/types.ts';

describe('DEFAULT_ATMOSPHERE_PARAMS', () => {
  it('atmosphereRadius is greater than planetRadius', () => {
    const p = DEFAULT_ATMOSPHERE_PARAMS;
    expect(p.atmosphereRadius).toBeGreaterThan(p.planetRadius);
  });

  it('betaR channels are all positive', () => {
    for (const v of DEFAULT_ATMOSPHERE_PARAMS.betaR) {
      expect(v).toBeGreaterThan(0);
    }
  });

  it('betaR is physically ordered: blue > green > red', () => {
    const [r, g, b] = DEFAULT_ATMOSPHERE_PARAMS.betaR;
    expect(g).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  it('mieG is in the open interval (-1, 1)', () => {
    const g = DEFAULT_ATMOSPHERE_PARAMS.mieG;
    expect(g).toBeGreaterThan(-1);
    expect(g).toBeLessThan(1);
  });

  it('numSamples and numLightSamples are at least 1', () => {
    const p = DEFAULT_ATMOSPHERE_PARAMS;
    expect(p.numSamples).toBeGreaterThanOrEqual(1);
    expect(p.numLightSamples).toBeGreaterThanOrEqual(1);
  });
});
```

- [x] **Step 2: Run — expect FAIL (module not found)**

```
npm test src/__tests__/AtmosphereParams.test.ts
```
Expected: Error — `DEFAULT_ATMOSPHERE_PARAMS` not found.

- [x] **Step 3: Add `AtmosphereParams` to `src/core/types.ts`**

Append after the existing `DEFAULT_CLASSIFY_PARAMS` block:

```typescript
export interface AtmosphereParams {
  planetRadius: number;
  atmosphereRadius: number;
  betaR: [number, number, number];
  betaM: number;
  mieG: number;
  numSamples: number;
  numLightSamples: number;
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

- [x] **Step 4: Run — expect PASS**

```
npm test src/__tests__/AtmosphereParams.test.ts
```
Expected: 5 tests passing.

- [x] **Step 5: Also add `sceneColorView` to `FrameContext` in `src/core/types.ts`**

Change the `FrameContext` interface from:
```typescript
export interface FrameContext {
  frameIndex: number;
  dt: number;
  totalTime: number;
  device: GPUDevice;
  targetView: GPUTextureView;
  depthView: GPUTextureView;
}
```
to:
```typescript
export interface FrameContext {
  frameIndex: number;
  dt: number;
  totalTime: number;
  device: GPUDevice;
  targetView: GPUTextureView;
  sceneColorView: GPUTextureView;
  depthView: GPUTextureView;
}
```

- [x] **Step 6: Run all tests — expect PASS**

```
npm test
```
Expected: all tests pass (TypeScript errors will be fixed in Task 3).

- [x] **Step 7: Commit**

```bash
git add src/core/types.ts src/__tests__/AtmosphereParams.test.ts
git commit -m "feat: add AtmosphereParams types and unit tests"
```

---

## Task 2: SunComponent

**Files:**
- Create: `src/ecs/components/SunComponent.ts`

- [x] **Step 1: Create `src/ecs/components/SunComponent.ts`**

```typescript
// src/ecs/components/SunComponent.ts
export class SunComponent {
  constructor(
    public worldPosition: [number, number, number] = [100, 50, 0],
  ) {}
}
```

- [x] **Step 2: Run all tests — expect PASS**

```
npm test
```

- [x] **Step 3: Commit**

```bash
git add src/ecs/components/SunComponent.ts
git commit -m "feat: add SunComponent for sun world position"
```

---

## Task 3: Offline RT infrastructure

This task wires up the intermediate render targets so PlanetRenderNode writes to `scene.color`/`scene.depth`, and both are available to AtmosphereNode. It touches `GraphBuilder`, `WebGPUEngine`, and `PlanetRenderNode`.

**Files:**
- Modify: `src/graph/GraphBuilder.ts`
- Modify: `src/core/WebGPUEngine.ts`
- Modify: `src/graph/nodes/PlanetRenderNode.ts`

- [x] **Step 1: Modify `src/graph/GraphBuilder.ts`**

Add `ResourceManager` to the `BuiltGraph` return type, create the RT textures before building nodes, and import `ResourceManager`:

Replace the entire file with:

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
  resources: ResourceManager;
  orbitController: OrbitCameraController;
}

export class GraphBuilder {
  static build(device: GPUDevice, canvas: HTMLCanvasElement): BuiltGraph {
    const resources = new ResourceManager(device);
    const pipelines = new PipelineManager(device);
    const scene     = new Scene();

    // ── Intermediate render targets (created before any node.build()) ──────────
    resources.createTexture('scene.color', {
      size: [canvas.width, canvas.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    resources.createTexture('scene.depth', {
      size: [canvas.width, canvas.height],
      format: 'depth32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });

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

    const noiseNode  = new ComputeNoiseNode(resources, pipelines);
    const planetNode = new PlanetRenderNode(scene, resources, pipelines);

    noiseNode.build(buildCtx);
    planetNode.build(buildCtx);

    graph.addNode(noiseNode);
    graph.addNode(planetNode);

    return { graph, resources, orbitController };
  }
}
```

- [x] **Step 2: Modify `src/core/WebGPUEngine.ts`**

Replace the entire file:

```typescript
// src/core/WebGPUEngine.ts
import type { RenderGraph } from './RenderGraph.ts';
import type { ResourceManager } from './ResourceManager.ts';
import type { FrameContext } from './types.ts';
import { GraphBuilder } from '../graph/GraphBuilder.ts';

export class WebGPUEngine {
  private _device!: GPUDevice;
  private _context!: GPUCanvasContext;
  private _sceneColorView!: GPUTextureView;
  private _depthView!: GPUTextureView;
  private _graph!: RenderGraph;
  private _resources!: ResourceManager;
  // Held to keep event listeners alive
  private _orbitController!: ReturnType<typeof GraphBuilder.build>['orbitController'];
  private _canvas!: HTMLCanvasElement;
  private _frameIndex = 0;
  private _lastTime = 0;
  private _totalTime = 0;

  async init(): Promise<void> {
    if (!navigator.gpu) {
      throw new Error('WebGPU is not supported in this browser.');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No GPU adapter found.');

    this._device = await adapter.requestDevice();

    this._canvas = document.getElementById('webgpu-canvas') as HTMLCanvasElement;
    this._canvas.width = window.innerWidth;
    this._canvas.height = window.innerHeight;

    this._context = this._canvas.getContext('webgpu') as GPUCanvasContext;
    const format = navigator.gpu.getPreferredCanvasFormat();
    this._context.configure({ device: this._device, format });

    const { graph, resources, orbitController } = GraphBuilder.build(this._device, this._canvas);
    this._graph = graph;
    this._resources = resources;
    this._orbitController = orbitController;
    void this._orbitController;
    void this._resources; // held for texture lifetime

    this._sceneColorView = resources.getTexture('scene.color')!.createView();
    this._depthView      = resources.getTexture('scene.depth')!.createView();
  }

  start(): void {
    this._lastTime = performance.now();
    requestAnimationFrame(this._tick.bind(this));
  }

  private _tick(timestamp: number): void {
    const dt = Math.min((timestamp - this._lastTime) / 1000, 0.1);
    this._lastTime = timestamp;
    this._totalTime += dt;
    this._frameIndex++;

    const ctx: FrameContext = {
      frameIndex: this._frameIndex,
      dt,
      totalTime: this._totalTime,
      device: this._device,
      targetView:     this._context.getCurrentTexture().createView(),
      sceneColorView: this._sceneColorView,
      depthView:      this._depthView,
    };

    this._graph.update(ctx);
    this._graph.execute(ctx);

    requestAnimationFrame(this._tick.bind(this));
  }
}
```

- [x] **Step 3: Modify `src/graph/nodes/PlanetRenderNode.ts`**

Three changes: (a) pipeline target format `rgba8unorm`, (b) depthStencil format `depth32float`, (c) render pass color attachment uses `ctx.sceneColorView`.

In `build()`, change the render pipeline fragment targets:
```typescript
// FROM:
targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }],
// TO:
targets: [{ format: 'rgba8unorm' }],
```

In `build()`, change the depthStencil format:
```typescript
// FROM:
depthStencil: {
  format: 'depth24plus',
  depthWriteEnabled: true,
  depthCompare: 'less',
},
// TO:
depthStencil: {
  format: 'depth32float',
  depthWriteEnabled: true,
  depthCompare: 'less',
},
```

In `recordPass()`, change the color attachment view:
```typescript
// FROM:
colorAttachments: [{
  view: ctx.targetView,
// TO:
colorAttachments: [{
  view: ctx.sceneColorView,
```

- [x] **Step 4: Run all tests — expect PASS**

```
npm test
```
Expected: all tests pass.

- [x] **Step 5: Commit**

```bash
git add src/graph/GraphBuilder.ts src/core/WebGPUEngine.ts src/graph/nodes/PlanetRenderNode.ts
git commit -m "feat: add offline RT infrastructure (scene.color + depth32float)"
```

---

## Task 4: atmosphere.wgsl shader

**Files:**
- Create: `src/shaders/atmosphere.wgsl`

No unit tests for WGSL; correctness verified visually in Task 7.

- [x] **Step 1: Create `src/shaders/atmosphere.wgsl`**

```wgsl
// src/shaders/atmosphere.wgsl
// Nishita (1993) single-scattering atmosphere.
// Planet is centered at world origin. Planet radius = 1.0 scene unit.

const PI  : f32 = 3.14159265358979323846;
const H_R : f32 = 0.008;   // Rayleigh scale height (fraction of planet radius)
const H_M : f32 = 0.0012;  // Mie scale height

struct AtmosphereUniforms {
  sunDir           : vec3<f32>,   // offset  0
  planetRadius     : f32,         // offset 12
  atmosphereRadius : f32,         // offset 16
  _pad0            : f32,         // offset 20
  _pad1            : f32,         // offset 24
  _pad2            : f32,         // offset 28
  cameraPos        : vec3<f32>,   // offset 32
  _pad3            : f32,         // offset 44
  betaR            : vec3<f32>,   // offset 48
  betaM            : f32,         // offset 60
  mieG             : f32,         // offset 64
  numSamples       : u32,         // offset 68
  numLightSamples  : u32,         // offset 72
  _pad4            : f32,         // offset 76
  invViewProj      : mat4x4<f32>, // offset 80
}

@group(0) @binding(0) var<uniform> atm        : AtmosphereUniforms;
@group(0) @binding(1) var          sceneColor : texture_2d<f32>;
@group(0) @binding(2) var          sceneDepth : texture_depth_2d;

// --- Vertex shader: full-screen quad (6 vertices, no VBO) ---

const QUAD_POS = array<vec2<f32>, 6>(
  vec2(-1.0, -1.0), vec2( 1.0, -1.0), vec2(-1.0,  1.0),
  vec2( 1.0, -1.0), vec2( 1.0,  1.0), vec2(-1.0,  1.0),
);

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0)       uv  : vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
  let p = QUAD_POS[vi];
  var out: VSOut;
  out.pos = vec4<f32>(p, 0.0, 1.0);
  out.uv  = p * vec2(0.5, -0.5) + vec2(0.5); // NDC→UV: x:[−1,1]→[0,1], y flipped
  return out;
}

// --- Helper functions ---

// Analytic ray-sphere intersection. Sphere centered at origin.
// Returns vec2(tNear, tFar). Returns vec2(-1.0) on miss or behind camera.
fn intersect_sphere(orig: vec3<f32>, dir: vec3<f32>, r: f32) -> vec2<f32> {
  let b    = dot(orig, dir);
  let c    = dot(orig, orig) - r * r;
  let disc = b * b - c;
  if (disc < 0.0) { return vec2(-1.0); }
  let s = sqrt(disc);
  return vec2(-b - s, -b + s);
}

fn rayleigh_phase(cosTheta: f32) -> f32 {
  return (3.0 / (16.0 * PI)) * (1.0 + cosTheta * cosTheta);
}

fn mie_phase(cosTheta: f32, g: f32) -> f32 {
  let g2 = g * g;
  return (3.0 / (8.0 * PI)) *
    ((1.0 - g2) * (1.0 + cosTheta * cosTheta)) /
    ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
}

// Integrate optical depth from `pos` toward `dir` for `maxDist` distance.
// Returns vec2(Rayleigh depth, Mie depth).
fn optical_depth(pos: vec3<f32>, dir: vec3<f32>, maxDist: f32, steps: u32) -> vec2<f32> {
  let stepLen = maxDist / f32(steps);
  var depth   = vec2(0.0);
  var p       = pos + dir * (stepLen * 0.5);
  for (var i = 0u; i < steps; i++) {
    let h = max(length(p) - atm.planetRadius, 0.0);
    depth += vec2(exp(-h / H_R), exp(-h / H_M)) * stepLen;
    p     += dir * stepLen;
  }
  return depth;
}

// --- Fragment shader ---

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let texel = vec2<i32>(floor(in.pos.xy));
  let depth = textureLoad(sceneDepth, texel, 0);
  let color = textureLoad(sceneColor, texel, 0).rgb;
  let isSky = depth >= 0.9999;

  // Reconstruct world position from depth
  let ndcX     = in.uv.x * 2.0 - 1.0;
  let ndcY     = 1.0 - in.uv.y * 2.0;
  let clipPos4 = atm.invViewProj * vec4<f32>(ndcX, ndcY, depth, 1.0);
  let worldPos = clipPos4.xyz / clipPos4.w;

  let camPos = atm.cameraPos;
  let rayDir = normalize(worldPos - camPos);

  // Atmosphere intersection
  let atmHit = intersect_sphere(camPos, rayDir, atm.atmosphereRadius);
  if (atmHit.y < 0.0) {
    // Ray entirely misses atmosphere
    return vec4<f32>(color, 1.0);
  }

  let tMin = max(atmHit.x, 0.0);
  var tMax = atmHit.y;
  if (!isSky) {
    tMax = min(tMax, length(worldPos - camPos));
  }
  if (tMin >= tMax) {
    return vec4<f32>(color, 1.0);
  }

  let cosTheta = dot(rayDir, atm.sunDir);
  let phaseR   = rayleigh_phase(cosTheta);
  let phaseM   = mie_phase(cosTheta, atm.mieG);

  let stepLen   = (tMax - tMin) / f32(atm.numSamples);
  var sumR      = vec3(0.0);
  var sumM      = 0.0;
  var optDepthR = 0.0;
  var optDepthM = 0.0;

  var t = tMin + stepLen * 0.5;
  for (var i = 0u; i < atm.numSamples; i++) {
    let p  = camPos + rayDir * t;
    let h  = max(length(p) - atm.planetRadius, 0.0);

    let densR = exp(-h / H_R) * stepLen;
    let densM = exp(-h / H_M) * stepLen;
    optDepthR += densR;
    optDepthM += densM;

    // Shadow ray toward sun
    let sunHit  = intersect_sphere(p, atm.sunDir, atm.atmosphereRadius);
    let sunDist = max(sunHit.y, 0.0);
    let odSun   = optical_depth(p, atm.sunDir, sunDist, atm.numLightSamples);

    // vec3 + vec3: cast betaM scalar to vec3 for uniform add
    let tau           = atm.betaR * (optDepthR + odSun.x)
                      + vec3<f32>(atm.betaM * (optDepthM + odSun.y));
    let transmittance = exp(-tau);

    sumR += densR * transmittance;
    sumM += densM * dot(transmittance, vec3<f32>(1.0 / 3.0)); // average over RGB

    t += stepLen;
  }

  let rayleigh   = sumR * atm.betaR * phaseR;
  let mie_color  = vec3<f32>(sumM * atm.betaM * phaseM);
  let inScatter  = (rayleigh + mie_color) * 22.0;
  let viewTau    = atm.betaR * optDepthR + vec3<f32>(atm.betaM * optDepthM);
  let viewT      = exp(-viewTau);
  let finalColor = color * viewT + inScatter;

  return vec4<f32>(finalColor, 1.0);
}
```

- [x] **Step 2: Run all tests — expect PASS**

```
npm test
```

- [x] **Step 3: Commit**

```bash
git add src/shaders/atmosphere.wgsl
git commit -m "feat: add Nishita single-scattering atmosphere.wgsl"
```

---

## Task 5: AtmosphereNode implementation

**Files:**
- Modify: `src/graph/nodes/AtmosphereNode.ts`

- [x] **Step 1: Replace `AtmosphereNode.ts` with full implementation**

```typescript
// src/graph/nodes/AtmosphereNode.ts
import { mat4 } from 'wgpu-matrix';
import { BaseNode } from './BaseNode.ts';
import type { BuildContext, FrameContext, AtmosphereParams } from '../../core/types.ts';
import { DEFAULT_ATMOSPHERE_PARAMS } from '../../core/types.ts';
import type { Scene } from '../../ecs/Scene.ts';
import type { ResourceManager } from '../../core/ResourceManager.ts';
import type { PipelineManager } from '../../core/PipelineManager.ts';
import { CameraComponent } from '../../ecs/components/CameraComponent.ts';
import { PlanetComponent } from '../../ecs/components/PlanetComponent.ts';
import { SunComponent } from '../../ecs/components/SunComponent.ts';
import atmosphereSrc from '../../shaders/atmosphere.wgsl?raw';

// Uniform buffer layout: 144 bytes (see spec)
const UNIFORM_SIZE = 144;

// Default sun position used when no SunEntity exists in the scene
const DEFAULT_SUN_POS: [number, number, number] = [100, 50, 0];

export class AtmosphereNode extends BaseNode {
  readonly name = 'Atmosphere';

  private _scene: Scene;
  private _resources: ResourceManager;
  private _pipelines: PipelineManager;
  private _params: AtmosphereParams;

  private _pipeline!: GPURenderPipeline;
  private _uniformBuffer!: GPUBuffer;
  private _bindGroup!: GPUBindGroup;

  constructor(
    scene: Scene,
    resources: ResourceManager,
    pipelines: PipelineManager,
    params: AtmosphereParams = DEFAULT_ATMOSPHERE_PARAMS,
  ) {
    super();
    this._scene     = scene;
    this._resources = resources;
    this._pipelines = pipelines;
    this._params    = params;
  }

  override build(ctx: BuildContext): void {
    const { device } = ctx;

    const shaderModule = device.createShaderModule({ code: atmosphereSrc });

    // ── Bind group layout ──────────────────────────────────────────────────────
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'depth', viewDimension: '2d' } },
      ],
    });

    // ── Pipeline ───────────────────────────────────────────────────────────────
    this._pipeline = this._pipelines.createRenderPipeline('atmosphere', {
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex:   { module: shaderModule, entryPoint: 'vs_main' },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }],
      },
      primitive: { topology: 'triangle-list' },
    });

    // ── Uniform buffer ─────────────────────────────────────────────────────────
    this._uniformBuffer = this._resources.createBuffer('atmosphere.uniform', {
      size: UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // ── Bind group ─────────────────────────────────────────────────────────────
    const colorTex = this._resources.getTexture('scene.color');
    const depthTex = this._resources.getTexture('scene.depth');
    if (!colorTex || !depthTex) {
      throw new Error('AtmosphereNode.build(): scene.color / scene.depth not found — ensure GraphBuilder creates them before build()');
    }

    this._bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this._uniformBuffer } },
        { binding: 1, resource: colorTex.createView() },
        { binding: 2, resource: depthTex.createView() },
      ],
    });
  }

  override update(ctx: FrameContext): void {
    const cam    = this._scene.mainCamera.getComponent(CameraComponent)!;
    const camPos = this._scene.mainCamera.transform.position;

    // Sun direction: prefer SunComponent, fall back to default position
    let sunPos: [number, number, number] = DEFAULT_SUN_POS;
    const suns = this._scene.getEntitiesWith(SunComponent);
    if (suns.length > 0) {
      sunPos = suns[0]!.getComponent(SunComponent)!.worldPosition;
    }

    // Planet position (first entity with PlanetComponent)
    let planetPos: [number, number, number] = [0, 0, 0];
    const planets = this._scene.getEntitiesWith(PlanetComponent);
    if (planets.length > 0) {
      const p = planets[0]!.transform.position;
      planetPos = [p[0]!, p[1]!, p[2]!];
    }

    const dx  = sunPos[0] - planetPos[0];
    const dy  = sunPos[1] - planetPos[1];
    const dz  = sunPos[2] - planetPos[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const sunDir = new Float32Array([dx / len, dy / len, dz / len]);

    // Compute inverse view-projection matrix
    const vp    = cam.getVPMatrix(camPos);
    const invVP = mat4.inverse(vp);

    const p = this._params;
    const data = new Float32Array(UNIFORM_SIZE / 4);

    // Layout matches AtmosphereUniforms struct in atmosphere.wgsl (offsets in floats):
    data[0]  = sunDir[0]!;             // sunDir.x      (float offset 0)
    data[1]  = sunDir[1]!;             // sunDir.y
    data[2]  = sunDir[2]!;             // sunDir.z
    data[3]  = p.planetRadius;         // planetRadius  (float offset 3)
    data[4]  = p.atmosphereRadius;     // atmosphereRadius
    // data[5..7] = _pad0,1,2
    data[8]  = camPos[0]!;             // cameraPos.x   (float offset 8)
    data[9]  = camPos[1]!;
    data[10] = camPos[2]!;
    // data[11] = _pad3
    data[12] = p.betaR[0];            // betaR.x       (float offset 12)
    data[13] = p.betaR[1];
    data[14] = p.betaR[2];
    data[15] = p.betaM;               // betaM         (float offset 15)
    data[16] = p.mieG;                // mieG          (float offset 16)
    // u32 fields — write as uint into the same buffer region
    const u32view = new Uint32Array(data.buffer);
    u32view[17] = p.numSamples;       // numSamples    (float offset 17)
    u32view[18] = p.numLightSamples;  // numLightSamples
    // data[19] = _pad4
    // invViewProj at float offset 20 (byte offset 80)
    for (let i = 0; i < 16; i++) {
      data[20 + i] = (invVP as Float32Array)[i]!;
    }

    ctx.device.queue.writeBuffer(this._uniformBuffer, 0, data);
  }

  override recordPass(encoder: GPUCommandEncoder, ctx: FrameContext): void {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view:       ctx.targetView,
        loadOp:     'clear',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        storeOp:    'store',
      }],
    });

    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0, this._bindGroup);
    pass.draw(6); // 6 vertices = 2 triangles = full-screen quad
    pass.end();
  }
}
```

- [x] **Step 2: Run all tests — expect PASS**

```
npm test
```

- [x] **Step 3: Commit**

```bash
git add src/graph/nodes/AtmosphereNode.ts
git commit -m "feat: implement AtmosphereNode (Nishita single-scattering)"
```

---

## Task 6: Wire into GraphBuilder + SunEntity

**Files:**
- Modify: `src/graph/GraphBuilder.ts`

- [x] **Step 1: Add SunEntity and AtmosphereNode to `GraphBuilder.ts`**

Add imports at the top of the existing imports block:

```typescript
import { SunComponent } from '../ecs/components/SunComponent.ts';
import { AtmosphereNode } from './nodes/AtmosphereNode.ts';
```

After the camera entity block and before the orbit controller, add:

```typescript
// ── Sun entity ─────────────────────────────────────────────────────────────
const sun = new Entity('sun');
sun.addComponent(new SunComponent([100, 50, 0]));
scene.addEntity(sun);
```

After `planetNode.build(buildCtx)`, add:

```typescript
const atmosNode = new AtmosphereNode(scene, resources, pipelines);
atmosNode.build(buildCtx);
```

After `graph.addNode(planetNode)`, add:

```typescript
graph.addNode(atmosNode);
```

The final graph section in `GraphBuilder.build()` should look like:

```typescript
const noiseNode  = new ComputeNoiseNode(resources, pipelines);
const planetNode = new PlanetRenderNode(scene, resources, pipelines);
const atmosNode  = new AtmosphereNode(scene, resources, pipelines);

noiseNode.build(buildCtx);
planetNode.build(buildCtx);
atmosNode.build(buildCtx);

graph.addNode(noiseNode);
graph.addNode(planetNode);
graph.addNode(atmosNode);

return { graph, resources, orbitController };
```

- [x] **Step 2: Run all tests — expect PASS**

```
npm test
```

- [x] **Step 3: Commit**

```bash
git add src/graph/GraphBuilder.ts
git commit -m "feat: wire AtmosphereNode and SunEntity into RenderGraph"
```

---

## Task 7: Visual verification

No automated tests for visual output. Launch the dev server and verify in browser.

- [x] **Step 1: Start dev server**

```
npm run dev
```

Open the URL shown (typically `http://localhost:5173`).

- [x] **Step 2: Verify checklist**

Check each of the following in the browser:

| Check | Expected |
|-------|----------|
| Planet visible | Terrain-colored sphere still renders with correct biome colors |
| Limb glow | Blue-white glow visible around the planet edge against the dark background |
| Sky scattering | Dark sky near the anti-sun side; blue tint near sun side |
| Sun proximity tint | Orange-red tint visible when sun direction is near the horizon (rotate view) |
| No black halo | No dark band at the atmosphere/space boundary |
| No full-screen black | Background is not entirely black — atmosphere color fills sky pixels |

- [x] **Step 3: If visually broken, common fixes**

- **Entirely black screen:** Check that `scene.color` has correct usage flags; check `recordPass` `loadOp: 'clear'` vs `loadOp: 'load'` in `PlanetRenderNode`
- **No atmosphere glow:** Verify `sceneDepth` is bound as `texture_depth_2d`; verify `depth32float` format is set in both `GraphBuilder` and `PlanetRenderNode`
- **Very faint / invisible atmosphere:** Increase the scale factor `22.0` in `atmosphere.wgsl` line `let inScatter = ... * 22.0`
- **Halo artifact:** The `invViewProj` matrix may have incorrect values — add `console.log(invVP)` in `AtmosphereNode.update()` to verify it's not identity or NaN

- [x] **Step 4: Final test run**

```
npm test
```
Expected: all tests pass.

- [x] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: atmospheric scattering complete (phase 3)"
```
