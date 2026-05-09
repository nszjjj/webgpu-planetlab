# Detail Normals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Precompute displaced-surface normals in a `NormalComputeNode` compute pass, replacing smooth sphere normals in `PlanetRenderNode` vs_main.

**Architecture:** New independent `NormalComputeNode` runs once (first frame), reads `terrain.height`, writes `terrain.normal` buffer (512×512×3 f32). `PlanetRenderNode` vs_main samples normal_buffer at binding 4 instead of using `normalize(localPos)`. PBR fragment shader unchanged.

**Tech Stack:** WebGPU WGSL compute shader, TypeScript Render Graph Node

---

### Task 1: Create normal_gen.wgsl compute shader

**Files:**
- Create: `src/shaders/normal_gen.wgsl`

- [ ] **Step 1: Write the shader**

```wgsl
// src/shaders/normal_gen.wgsl
// Compute shader: height_buffer → normal_buffer via central differences.
// One thread per texel, 512×512 dispatch, runs once.

const OCTA_RES: u32 = 512u;

struct DisplaceParams {
  scale : f32,
  _pad0 : f32,
  _pad1 : f32,
  _pad2 : f32,
}

@group(0) @binding(0) var<uniform>                  displace_params : DisplaceParams;
@group(0) @binding(1) var<storage, read>            height_buffer   : array<f32>;
@group(0) @binding(2) var<storage, read_write>      normal_buffer   : array<f32>;

fn oct_decode(uv: vec2<f32>) -> vec3<f32> {
  let p = uv * 2.0 - 1.0;
  let z = 1.0 - abs(p.x) - abs(p.y);
  var n: vec3<f32>;
  if (z >= 0.0) {
    n = vec3<f32>(p.x, p.y, z);
  } else {
    n = vec3<f32>(
      (1.0 - abs(p.y)) * select(-1.0, 1.0, p.x >= 0.0),
      (1.0 - abs(p.x)) * select(-1.0, 1.0, p.y >= 0.0),
      z,
    );
  }
  return normalize(n);
}

fn get_height(i: u32, j: u32) -> f32 {
  return height_buffer[i * OCTA_RES + j];
}

fn uv_at(i: u32, j: u32) -> vec2<f32> {
  return vec2<f32>((f32(j) + 0.5) / f32(OCTA_RES), (f32(i) + 0.5) / f32(OCTA_RES));
}

fn displaced_position(i: u32, j: u32, d: f32) -> vec3<f32> {
  let s = oct_decode(uv_at(i, j));
  let h = get_height(i, j);
  return s * (1.0 + h * d);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= OCTA_RES || gid.y >= OCTA_RES) { return; }

  let i = gid.x;
  let j = gid.y;
  let d = displace_params.scale;

  let i_left  = select(i - 1u, 0u, i == 0u);
  let i_right = select(i + 1u, OCTA_RES - 1u, i == OCTA_RES - 1u);
  let j_down  = select(j - 1u, 0u, j == 0u);
  let j_up    = select(j + 1u, OCTA_RES - 1u, j == OCTA_RES - 1u);

  let p_left  = displaced_position(i_left,  j,       d);
  let p_right = displaced_position(i_right, j,       d);
  let p_down  = displaced_position(i,       j_down,  d);
  let p_up    = displaced_position(i,       j_up,    d);

  let n = normalize(cross(p_right - p_left, p_up - p_down));

  let idx = (i * OCTA_RES + j) * 3u;
  normal_buffer[idx]     = n.x;
  normal_buffer[idx + 1u] = n.y;
  normal_buffer[idx + 2u] = n.z;
}
```

- [ ] **Step 2: Verify file exists and is syntactically valid WGSL**

No build step for `.wgsl` files — imported as raw strings by Vite (`?raw`). TypeScript compilation will catch import errors.

---

### Task 2: Create NormalComputeNode.ts

**Files:**
- Create: `src/graph/nodes/NormalComputeNode.ts`

- [ ] **Step 1: Write the Node class**

```typescript
// src/graph/nodes/NormalComputeNode.ts
import { BaseNode } from './BaseNode.ts';
import type { BuildContext, FrameContext } from '../../core/types.ts';
import type { ResourceManager } from '../../core/ResourceManager.ts';
import type { PipelineManager } from '../../core/PipelineManager.ts';
import { OCTA_RESOLUTION } from '../../utils/octahedral.ts';
import normalGenSrc from '../../shaders/normal_gen.wgsl?raw';

export class NormalComputeNode extends BaseNode {
  readonly name = 'NormalCompute';

  private _resources: ResourceManager;
  private _pipelines: PipelineManager;
  private _displaceScale: number;

  private _pipeline!:   GPUComputePipeline;
  private _bindGroup!:  GPUBindGroup;

  private _generated = false;

  constructor(
    resources: ResourceManager,
    pipelines: PipelineManager,
    displaceScale = 0.15,
  ) {
    super();
    this._resources = resources;
    this._pipelines = pipelines;
    this._displaceScale = displaceScale;
  }

  override build(ctx: BuildContext): void {
    const BUFFER_SIZE = OCTA_RESOLUTION * OCTA_RESOLUTION * 3 * 4; // 512*512*3 f32

    const normalBuffer = this._resources.createBuffer('terrain.normal', {
      size:  BUFFER_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const displaceBuffer = this._resources.createBuffer('normal.displaceParams', {
      size:  16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    ctx.device.queue.writeBuffer(displaceBuffer, 0, new Float32Array([
      this._displaceScale, 0, 0, 0,
    ]));

    const heightBuffer = this._resources.getBuffer('terrain.height');
    if (!heightBuffer) {
      throw new Error('NormalComputeNode.build(): terrain.height not found');
    }

    const shaderModule = ctx.device.createShaderModule({ code: normalGenSrc });
    const bindGroupLayout = ctx.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    this._pipeline = this._pipelines.createComputePipeline('terrain.normal_gen', {
      layout: ctx.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      compute: { module: shaderModule, entryPoint: 'main' },
    });

    this._bindGroup = ctx.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: displaceBuffer } },
        { binding: 1, resource: { buffer: heightBuffer } },
        { binding: 2, resource: { buffer: normalBuffer } },
      ],
    });
  }

  override recordPass(encoder: GPUCommandEncoder, _ctx: FrameContext): void {
    if (this._generated) return;

    const WG = Math.ceil(OCTA_RESOLUTION / 8); // 64 workgroups
    const pass = encoder.beginComputePass();
    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0, this._bindGroup);
    pass.dispatchWorkgroups(WG, WG);
    pass.end();

    this._generated = true;
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors related to NormalComputeNode.

---

### Task 3: Modify planet.wgsl — add normal_buffer binding and update vs_main

**Files:**
- Modify: `src/shaders/planet.wgsl`

- [ ] **Step 1: Add binding 4 declaration**

Insert after line 121 (after `@group(0) @binding(3)`):
```wgsl
@group(0) @binding(4) var<storage, read> normal_buffer : array<f32>;
```

- [ ] **Step 2: Replace vs_main normal computation**

Replace lines 178-179:
```wgsl
  let worldNormal = normalize((perFrame.model * vec4<f32>(localPos, 0.0)).xyz);
  let worldPos    = (perFrame.model * vec4<f32>(displaced, 1.0)).xyz;
```

With:
```wgsl
  let normalIdx   = oct_to_index(localPos) * 3u;
  let localNormal = vec3<f32>(
    normal_buffer[normalIdx],
    normal_buffer[normalIdx + 1u],
    normal_buffer[normalIdx + 2u],
  );
  let worldNormal = normalize((perFrame.model * vec4<f32>(localNormal, 0.0)).xyz);
  let worldPos    = (perFrame.model * vec4<f32>(displaced, 1.0)).xyz;
```

---

### Task 4: Modify PlanetRenderNode.ts — add binding 4 to bind group

**Files:**
- Modify: `src/graph/nodes/PlanetRenderNode.ts`

- [ ] **Step 1: Add binding 4 to bind group layout entries**

Insert after the binding 3 entry (after line 75 in the bindGroupLayout entries array):
```typescript
        {
          binding: 4,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' },
        },
```

- [ ] **Step 2: Get normal_buffer and add to bind group entries**

Insert after `const splatBuffer = ...` (after line 121):
```typescript
    const normalBuffer = this._resources.getBuffer('terrain.normal');
    if (!normalBuffer) {
      throw new Error('PlanetRenderNode.build(): terrain.normal not found');
    }
```

Insert into bindGroup entries array (after the binding 3 entry):
```typescript
        { binding: 4, resource: { buffer: normalBuffer } },
```

---

### Task 5: Modify GraphBuilder.ts — register NormalComputeNode

**Files:**
- Modify: `src/graph/GraphBuilder.ts`

- [ ] **Step 1: Add import**

Insert after the `ComputeNoiseNode` import (line 8):
```typescript
import { NormalComputeNode }     from './nodes/NormalComputeNode.ts';
```

- [ ] **Step 2: Create, build, and add NormalComputeNode**

Insert after `const noiseNode = ...` (line 72):
```typescript
    const normalNode       = new NormalComputeNode(resources, pipelines);
```

Insert after `noiseNode.build(buildCtx);` (line 79):
```typescript
    normalNode.build(buildCtx);
```

Insert after `graph.addNode(noiseNode);` (line 87):
```typescript
    graph.addNode(normalNode);
```

---

### Task 6: Build and visual verification

- [ ] **Step 1: Build the project**

Run: `npx vite build`
Expected: Build succeeds with no errors.

- [ ] **Step 2: Start dev server and visually verify**

Run: `npx vite --host 0.0.0.0`

Open the page and verify:
- Planet renders with visible terrain detail in lighting (mountains catch light, valleys are darker)
- Rotating the planet shows the lighting responds to terrain bumps
- No visual artifacts at terrain type boundaries
- Atmosphere still composites correctly

- [ ] **Step 3: Commit**

```bash
git add src/shaders/normal_gen.wgsl \
        src/graph/nodes/NormalComputeNode.ts \
        src/shaders/planet.wgsl \
        src/graph/nodes/PlanetRenderNode.ts \
        src/graph/GraphBuilder.ts
git commit -m "feat: add detail normals from height buffer via NormalComputeNode

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```
