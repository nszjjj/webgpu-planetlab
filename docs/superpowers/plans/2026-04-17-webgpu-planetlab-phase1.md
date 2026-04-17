# WebGPU PlanetLab Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Render Graph + ECS framework skeleton and render a normal-visualized UV sphere with Orbit Camera in the browser.

**Architecture:** Pure ECS (Component = data, Graph Node = System) layered over a Render Graph (each frame: update → recordPass → submit). WebGPUEngine owns the rAF loop and passes a FrameContext each tick. OrbitCameraController manipulates the Camera entity's Transform; PlanetRenderNode queries Scene for planets and drives GPU rendering.

**Tech Stack:** TypeScript 6, Vite 8, WebGPU (`@webgpu/types`), `wgpu-matrix`, Vitest

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `package.json` | Modify | Add `wgpu-matrix` dep, `vitest` devDep, `test` script |
| `vite.config.ts` | Create | Vitest config |
| `tsconfig.json` | Modify | Add `@webgpu/types` to `types` array |
| `index.html` | Modify | Replace Vite template with full-screen canvas |
| `src/main.ts` | Replace | Engine init entry point |
| `src/core/types.ts` | Create | `FrameContext`, `BuildContext`, `IGraphNode` |
| `src/ecs/Transform.ts` | Create | position/rotation/scale, dirty-flag `getWorldMatrix()` |
| `src/ecs/Entity.ts` | Create | id + component map |
| `src/ecs/Scene.ts` | Create | entity list, `mainCamera`, `getEntitiesWith<T>()` |
| `src/ecs/components/CameraComponent.ts` | Create | fov/near/far/aspect, `getVPMatrix(pos)` |
| `src/ecs/components/PlanetComponent.ts` | Create | radius/rings/segments marker |
| `src/core/ResourceManager.ts` | Create | Named buffer/texture cache |
| `src/core/PipelineManager.ts` | Create | Named pipeline cache |
| `src/core/RenderGraph.ts` | Create | Node list, `update`/`execute` per frame |
| `src/core/WebGPUEngine.ts` | Create | device/queue/context, rAF loop |
| `src/graph/nodes/BaseNode.ts` | Create | `IGraphNode` with no-op defaults |
| `src/graph/nodes/PlanetRenderNode.ts` | Create | Sphere index buffer, uniform buffer, draw call |
| `src/graph/nodes/ComputeNoiseNode.ts` | Create | Stub |
| `src/graph/nodes/AtmosphereNode.ts` | Create | Stub |
| `src/graph/nodes/SSAONode.ts` | Create | Stub |
| `src/graph/nodes/IndustrialOverlayNode.ts` | Create | Stub |
| `src/graph/nodes/IceBiomeNode.ts` | Create | Stub |
| `src/graph/nodes/GasPlanetNode.ts` | Create | Stub |
| `src/graph/GraphBuilder.ts` | Create | Assemble scene + nodes |
| `src/graph/GraphDebugUI.ts` | Create | Stub |
| `src/shaders/planet.wgsl` | Create | Combined vertex + fragment shader |
| `src/controllers/OrbitCameraController.ts` | Create | phi/theta/radius → camera transform |
| `src/__tests__/Transform.test.ts` | Create | Dirty flag + matrix tests |
| `src/__tests__/Entity.test.ts` | Create | Component add/get tests |
| `src/__tests__/Scene.test.ts` | Create | `getEntitiesWith` tests |

---

## Task 1: Project Setup

**Files:**
- Modify: `package.json`
- Create: `vite.config.ts`
- Modify: `tsconfig.json`
- Modify: `index.html`

- [ ] **Step 1: Install dependencies**

```bash
npm install wgpu-matrix
npm install --save-dev vitest
```

- [ ] **Step 2: Update `package.json` scripts**

Add `"test"` and `"test:watch"` to the `scripts` section:

```json
{
  "name": "webgpu-planetlab",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "wgpu-matrix": "^0.10.0"
  },
  "devDependencies": {
    "@webgpu/types": "^0.1.69",
    "typescript": "~6.0.2",
    "vite": "^8.0.4",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 3: Create `vite.config.ts`**

```typescript
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Update `tsconfig.json` — add `@webgpu/types`**

Change the `types` array:

```json
"types": ["vite/client", "@webgpu/types"],
```

- [ ] **Step 5: Replace `index.html` with canvas-only layout**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>WebGPU PlanetLab</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { background: #000; overflow: hidden; }
      canvas { display: block; width: 100vw; height: 100vh; }
    </style>
  </head>
  <body>
    <canvas id="webgpu-canvas"></canvas>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 6: Verify TypeScript compiles with no errors**

```bash
npx tsc --noEmit
```

Expected: no errors (src/main.ts still imports old stuff, ignore for now — we replace it in Task 16)

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vite.config.ts tsconfig.json index.html
git commit -m "chore: setup wgpu-matrix, vitest, canvas-only index.html"
```

---

## Task 2: `src/core/types.ts`

**Files:**
- Create: `src/core/types.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/core/types.ts
import type { ResourceManager } from './ResourceManager.ts';
import type { PipelineManager } from './PipelineManager.ts';
import type { Scene } from '../ecs/Scene.ts';
import type { RenderGraph } from './RenderGraph.ts';

export interface FrameContext {
  frameIndex: number;
  dt: number;
  totalTime: number;
  device: GPUDevice;
  targetView: GPUTextureView;
  depthView: GPUTextureView;
}

export interface BuildContext {
  device: GPUDevice;
  resources: ResourceManager;
  pipelines: PipelineManager;
  scene: Scene;
}

export interface IGraphNode {
  readonly name: string;
  build(ctx: BuildContext): void;
  update(ctx: FrameContext): void;
  recordPass(encoder: GPUCommandEncoder, ctx: FrameContext): void;
}

// Re-export RenderGraph type for use in nodes
export type { RenderGraph };
```

- [ ] **Step 2: Commit**

```bash
git add src/core/types.ts
git commit -m "feat(core): add FrameContext, BuildContext, IGraphNode types"
```

---

## Task 3: `src/ecs/Transform.ts`

**Files:**
- Create: `src/ecs/Transform.ts`
- Create: `src/__tests__/Transform.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/__tests__/Transform.test.ts
import { describe, it, expect } from 'vitest';
import { Transform } from '../ecs/Transform.ts';

describe('Transform', () => {
  it('starts with identity world matrix', () => {
    const t = new Transform();
    const m = t.getWorldMatrix();
    // identity diagonal
    expect(m[0]).toBeCloseTo(1);
    expect(m[5]).toBeCloseTo(1);
    expect(m[10]).toBeCloseTo(1);
    expect(m[15]).toBeCloseTo(1);
    // off-diagonal zeros
    expect(m[1]).toBeCloseTo(0);
    expect(m[4]).toBeCloseTo(0);
  });

  it('marks dirty when position changes', () => {
    const t = new Transform();
    t.getWorldMatrix(); // clears dirty
    t.setPosition(1, 2, 3);
    // worldMatrix should reflect new position (translation in column 3)
    const m = t.getWorldMatrix();
    expect(m[12]).toBeCloseTo(1); // tx
    expect(m[13]).toBeCloseTo(2); // ty
    expect(m[14]).toBeCloseTo(3); // tz
  });

  it('caches matrix when not dirty', () => {
    const t = new Transform();
    const m1 = t.getWorldMatrix();
    const m2 = t.getWorldMatrix();
    expect(m1).toBe(m2); // same reference — no reallocation
  });

  it('applies scale', () => {
    const t = new Transform();
    t.setScale(2, 2, 2);
    const m = t.getWorldMatrix();
    expect(m[0]).toBeCloseTo(2);  // sx
    expect(m[5]).toBeCloseTo(2);  // sy
    expect(m[10]).toBeCloseTo(2); // sz
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
npm test
```

Expected: FAIL — `Transform` module not found

- [ ] **Step 3: Implement `src/ecs/Transform.ts`**

```typescript
// src/ecs/Transform.ts
import { mat4, quat, vec3 } from 'wgpu-matrix';
import type { Mat4, Quat, Vec3 } from 'wgpu-matrix';

export class Transform {
  private _position: Vec3 = vec3.create(0, 0, 0);
  private _rotation: Quat = quat.identity();
  private _scale: Vec3 = vec3.create(1, 1, 1);
  private _worldMatrix: Mat4 = mat4.identity();
  private _dirty = true;

  get position(): Vec3 {
    return this._position;
  }

  setPosition(x: number, y: number, z: number): void {
    vec3.set(x, y, z, this._position);
    this._dirty = true;
  }

  setRotation(q: Quat): void {
    quat.copy(q, this._rotation);
    this._dirty = true;
  }

  setScale(x: number, y: number, z: number): void {
    vec3.set(x, y, z, this._scale);
    this._dirty = true;
  }

  getWorldMatrix(): Mat4 {
    if (this._dirty) {
      const t = mat4.translation(this._position);
      const r = mat4.fromQuat(this._rotation);
      const s = mat4.scaling(this._scale);
      mat4.multiply(mat4.multiply(t, r), s, this._worldMatrix);
      this._dirty = false;
    }
    return this._worldMatrix;
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/ecs/Transform.ts src/__tests__/Transform.test.ts
git commit -m "feat(ecs): Transform with dirty-flag world matrix caching"
```

---

## Task 4: `src/ecs/Entity.ts`

**Files:**
- Create: `src/ecs/Entity.ts`
- Create: `src/__tests__/Entity.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/__tests__/Entity.test.ts
import { describe, it, expect } from 'vitest';
import { Entity } from '../ecs/Entity.ts';

class TestComponent {
  value = 42;
}

class OtherComponent {
  label = 'hello';
}

describe('Entity', () => {
  it('has a transform by default', () => {
    const e = new Entity('test');
    expect(e.transform).toBeDefined();
  });

  it('adds and retrieves a component', () => {
    const e = new Entity('test');
    e.addComponent(new TestComponent());
    const c = e.getComponent(TestComponent);
    expect(c).toBeDefined();
    expect(c!.value).toBe(42);
  });

  it('returns undefined for missing component', () => {
    const e = new Entity('test');
    expect(e.getComponent(TestComponent)).toBeUndefined();
  });

  it('overwrites component of same type', () => {
    const e = new Entity('test');
    const c1 = new TestComponent();
    c1.value = 1;
    e.addComponent(c1);
    const c2 = new TestComponent();
    c2.value = 2;
    e.addComponent(c2);
    expect(e.getComponent(TestComponent)!.value).toBe(2);
  });

  it('stores multiple component types independently', () => {
    const e = new Entity('test');
    e.addComponent(new TestComponent());
    e.addComponent(new OtherComponent());
    expect(e.getComponent(TestComponent)).toBeDefined();
    expect(e.getComponent(OtherComponent)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
npm test
```

Expected: FAIL — `Entity` module not found

- [ ] **Step 3: Implement `src/ecs/Entity.ts`**

```typescript
// src/ecs/Entity.ts
import { Transform } from './Transform.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Constructor<T> = new (...args: any[]) => T;

export class Entity {
  readonly id: string;
  readonly transform: Transform;
  private _components = new Map<Constructor<unknown>, unknown>();

  constructor(id: string) {
    this.id = id;
    this.transform = new Transform();
  }

  addComponent<T extends object>(component: T): void {
    this._components.set(
      component.constructor as Constructor<T>,
      component,
    );
  }

  getComponent<T>(type: Constructor<T>): T | undefined {
    return this._components.get(type) as T | undefined;
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test
```

Expected: PASS (all Entity + Transform tests)

- [ ] **Step 5: Commit**

```bash
git add src/ecs/Entity.ts src/__tests__/Entity.test.ts
git commit -m "feat(ecs): Entity with typed component map"
```

---

## Task 5: `src/ecs/Scene.ts`

**Files:**
- Create: `src/ecs/Scene.ts`
- Create: `src/__tests__/Scene.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/__tests__/Scene.test.ts
import { describe, it, expect } from 'vitest';
import { Scene } from '../ecs/Scene.ts';
import { Entity } from '../ecs/Entity.ts';

class TagA {}
class TagB {}

describe('Scene', () => {
  it('adds entities and retrieves by component', () => {
    const scene = new Scene();
    const e1 = new Entity('e1');
    e1.addComponent(new TagA());
    const e2 = new Entity('e2');
    e2.addComponent(new TagB());
    scene.addEntity(e1);
    scene.addEntity(e2);

    const withA = scene.getEntitiesWith(TagA);
    expect(withA).toHaveLength(1);
    expect(withA[0].id).toBe('e1');
  });

  it('returns empty array when no match', () => {
    const scene = new Scene();
    scene.addEntity(new Entity('e1'));
    expect(scene.getEntitiesWith(TagA)).toHaveLength(0);
  });

  it('returns multiple matching entities', () => {
    const scene = new Scene();
    const e1 = new Entity('e1');
    e1.addComponent(new TagA());
    const e2 = new Entity('e2');
    e2.addComponent(new TagA());
    scene.addEntity(e1);
    scene.addEntity(e2);
    expect(scene.getEntitiesWith(TagA)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
npm test
```

Expected: FAIL — `Scene` module not found

- [ ] **Step 3: Implement `src/ecs/Scene.ts`**

```typescript
// src/ecs/Scene.ts
import type { Entity } from './Entity.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Constructor<T> = new (...args: any[]) => T;

export class Scene {
  private _entities: Entity[] = [];
  mainCamera!: Entity;

  addEntity(entity: Entity): void {
    this._entities.push(entity);
  }

  getEntitiesWith<T>(type: Constructor<T>): Entity[] {
    return this._entities.filter(e => e.getComponent(type) !== undefined);
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test
```

Expected: PASS (all Transform + Entity + Scene tests)

- [ ] **Step 5: Commit**

```bash
git add src/ecs/Scene.ts src/__tests__/Scene.test.ts
git commit -m "feat(ecs): Scene with getEntitiesWith query"
```

---

## Task 6: ECS Components

**Files:**
- Create: `src/ecs/components/CameraComponent.ts`
- Create: `src/ecs/components/PlanetComponent.ts`

- [ ] **Step 1: Create `src/ecs/components/CameraComponent.ts`**

```typescript
// src/ecs/components/CameraComponent.ts
import { mat4, vec3 } from 'wgpu-matrix';
import type { Mat4, Vec3 } from 'wgpu-matrix';

export class CameraComponent {
  fov: number;
  near: number;
  far: number;
  aspect: number;

  // Camera looks at this point (world space)
  target: Vec3 = vec3.create(0, 0, 0);
  up: Vec3 = vec3.create(0, 1, 0);

  private _vp: Mat4 = mat4.identity();

  constructor(fov: number, aspect: number, near: number, far: number) {
    this.fov = fov;
    this.aspect = aspect;
    this.near = near;
    this.far = far;
  }

  /** Compute VP matrix from camera world position. Call each frame after Transform updates. */
  getVPMatrix(position: Vec3): Mat4 {
    const view = mat4.lookAt(position, this.target, this.up);
    const proj = mat4.perspective(this.fov, this.aspect, this.near, this.far);
    mat4.multiply(proj, view, this._vp);
    return this._vp;
  }
}
```

- [ ] **Step 2: Create `src/ecs/components/PlanetComponent.ts`**

```typescript
// src/ecs/components/PlanetComponent.ts
export class PlanetComponent {
  radius: number;
  rings: number;
  segments: number;

  constructor(radius = 1.0, rings = 64, segments = 64) {
    this.radius = radius;
    this.rings = rings;
    this.segments = segments;
  }
}
```

- [ ] **Step 3: Run tests to make sure nothing broke**

```bash
npm test
```

Expected: PASS (all previous tests still pass)

- [ ] **Step 4: Commit**

```bash
git add src/ecs/components/
git commit -m "feat(ecs): CameraComponent and PlanetComponent"
```

---

## Task 7: `src/core/ResourceManager.ts`

**Files:**
- Create: `src/core/ResourceManager.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/core/ResourceManager.ts
export class ResourceManager {
  private _device: GPUDevice;
  private _buffers = new Map<string, GPUBuffer>();
  private _textures = new Map<string, GPUTexture>();

  constructor(device: GPUDevice) {
    this._device = device;
  }

  createBuffer(name: string, descriptor: GPUBufferDescriptor): GPUBuffer {
    if (this._buffers.has(name)) {
      console.warn(`ResourceManager: buffer "${name}" already exists, returning cached.`);
      return this._buffers.get(name)!;
    }
    const buf = this._device.createBuffer(descriptor);
    this._buffers.set(name, buf);
    return buf;
  }

  getBuffer(name: string): GPUBuffer | undefined {
    return this._buffers.get(name);
  }

  createTexture(name: string, descriptor: GPUTextureDescriptor): GPUTexture {
    if (this._textures.has(name)) {
      console.warn(`ResourceManager: texture "${name}" already exists, returning cached.`);
      return this._textures.get(name)!;
    }
    const tex = this._device.createTexture(descriptor);
    this._textures.set(name, tex);
    return tex;
  }

  getTexture(name: string): GPUTexture | undefined {
    return this._textures.get(name);
  }

  destroy(): void {
    this._buffers.forEach(b => b.destroy());
    this._textures.forEach(t => t.destroy());
    this._buffers.clear();
    this._textures.clear();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/ResourceManager.ts
git commit -m "feat(core): ResourceManager with named buffer/texture cache"
```

---

## Task 8: `src/core/PipelineManager.ts`

**Files:**
- Create: `src/core/PipelineManager.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/core/PipelineManager.ts
export class PipelineManager {
  private _device: GPUDevice;
  private _renderPipelines = new Map<string, GPURenderPipeline>();
  private _computePipelines = new Map<string, GPUComputePipeline>();

  constructor(device: GPUDevice) {
    this._device = device;
  }

  createRenderPipeline(
    name: string,
    descriptor: GPURenderPipelineDescriptor,
  ): GPURenderPipeline {
    if (this._renderPipelines.has(name)) {
      console.warn(`PipelineManager: render pipeline "${name}" already exists, returning cached.`);
      return this._renderPipelines.get(name)!;
    }
    const pipeline = this._device.createRenderPipeline(descriptor);
    this._renderPipelines.set(name, pipeline);
    return pipeline;
  }

  getRenderPipeline(name: string): GPURenderPipeline | undefined {
    return this._renderPipelines.get(name);
  }

  createComputePipeline(
    name: string,
    descriptor: GPUComputePipelineDescriptor,
  ): GPUComputePipeline {
    if (this._computePipelines.has(name)) {
      console.warn(`PipelineManager: compute pipeline "${name}" already exists, returning cached.`);
      return this._computePipelines.get(name)!;
    }
    const pipeline = this._device.createComputePipeline(descriptor);
    this._computePipelines.set(name, pipeline);
    return pipeline;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/PipelineManager.ts
git commit -m "feat(core): PipelineManager with named pipeline cache"
```

---

## Task 9: `src/core/RenderGraph.ts`

**Files:**
- Create: `src/core/RenderGraph.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/core/RenderGraph.ts
import type { IGraphNode, FrameContext } from './types.ts';
import type { Scene } from '../ecs/Scene.ts';

export class RenderGraph {
  readonly scene: Scene;
  private _nodes: IGraphNode[] = [];

  constructor(scene: Scene) {
    this.scene = scene;
  }

  addNode(node: IGraphNode): void {
    this._nodes.push(node);
  }

  /** Call once per frame: runs all node update() in registration order. */
  update(ctx: FrameContext): void {
    for (const node of this._nodes) {
      node.update(ctx);
    }
  }

  /** Call once per frame after update(): records all passes and submits. */
  execute(ctx: FrameContext): void {
    const encoder = ctx.device.createCommandEncoder();
    for (const node of this._nodes) {
      node.recordPass(encoder, ctx);
    }
    ctx.device.queue.submit([encoder.finish()]);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/RenderGraph.ts
git commit -m "feat(core): RenderGraph — node list, update/execute per frame"
```

---

## Task 10: `src/core/WebGPUEngine.ts`

**Files:**
- Create: `src/core/WebGPUEngine.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/core/WebGPUEngine.ts
import type { RenderGraph } from './RenderGraph.ts';
import type { FrameContext } from './types.ts';
import { GraphBuilder } from '../graph/GraphBuilder.ts';

export class WebGPUEngine {
  private _device!: GPUDevice;
  private _context!: GPUCanvasContext;
  private _depthTexture!: GPUTexture;
  private _graph!: RenderGraph;
  // Held to keep event listeners alive (not read after construction)
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

    this._depthTexture = this._device.createTexture({
      size: [this._canvas.width, this._canvas.height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const { graph, orbitController } = GraphBuilder.build(this._device, this._canvas);
    this._graph = graph;
    this._orbitController = orbitController;
  }

  start(): void {
    this._lastTime = performance.now();
    requestAnimationFrame(this._tick.bind(this));
  }

  private _tick(timestamp: number): void {
    const dt = Math.min((timestamp - this._lastTime) / 1000, 0.1); // cap at 100ms
    this._lastTime = timestamp;
    this._totalTime += dt;
    this._frameIndex++;

    const ctx: FrameContext = {
      frameIndex: this._frameIndex,
      dt,
      totalTime: this._totalTime,
      device: this._device,
      targetView: this._context.getCurrentTexture().createView(),
      depthView: this._depthTexture.createView(),
    };

    this._graph.update(ctx);
    this._graph.execute(ctx);

    requestAnimationFrame(this._tick.bind(this));
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/WebGPUEngine.ts
git commit -m "feat(core): WebGPUEngine — init, rAF loop, FrameContext"
```

---

## Task 11: BaseNode + Stub Nodes

**Files:**
- Create: `src/graph/nodes/BaseNode.ts`
- Create: `src/graph/nodes/ComputeNoiseNode.ts`
- Create: `src/graph/nodes/AtmosphereNode.ts`
- Create: `src/graph/nodes/SSAONode.ts`
- Create: `src/graph/nodes/IndustrialOverlayNode.ts`
- Create: `src/graph/nodes/IceBiomeNode.ts`
- Create: `src/graph/nodes/GasPlanetNode.ts`

- [ ] **Step 1: Create `src/graph/nodes/BaseNode.ts`**

```typescript
// src/graph/nodes/BaseNode.ts
import type { IGraphNode, BuildContext, FrameContext } from '../../core/types.ts';

export abstract class BaseNode implements IGraphNode {
  abstract readonly name: string;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  build(_ctx: BuildContext): void {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  update(_ctx: FrameContext): void {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  recordPass(_encoder: GPUCommandEncoder, _ctx: FrameContext): void {}
}
```

- [ ] **Step 2: Create stub nodes**

Each stub has the same shape. Create these 6 files:

```typescript
// src/graph/nodes/ComputeNoiseNode.ts
import { BaseNode } from './BaseNode.ts';
export class ComputeNoiseNode extends BaseNode {
  readonly name = 'ComputeNoise';
  // TODO: Phase 2 — generate noise texture via compute shader
}
```

```typescript
// src/graph/nodes/AtmosphereNode.ts
import { BaseNode } from './BaseNode.ts';
export class AtmosphereNode extends BaseNode {
  readonly name = 'Atmosphere';
  // TODO: Phase 3 — atmospheric scattering
}
```

```typescript
// src/graph/nodes/SSAONode.ts
import { BaseNode } from './BaseNode.ts';
export class SSAONode extends BaseNode {
  readonly name = 'SSAO';
  // TODO: Phase 4 — screen-space ambient occlusion
}
```

```typescript
// src/graph/nodes/IndustrialOverlayNode.ts
import { BaseNode } from './BaseNode.ts';
export class IndustrialOverlayNode extends BaseNode {
  readonly name = 'IndustrialOverlay';
  // TODO: Phase 5 — DSP-style industrial structures
}
```

```typescript
// src/graph/nodes/IceBiomeNode.ts
import { BaseNode } from './BaseNode.ts';
export class IceBiomeNode extends BaseNode {
  readonly name = 'IceBiome';
  // TODO: Phase 5 — ice planet biome rendering
}
```

```typescript
// src/graph/nodes/GasPlanetNode.ts
import { BaseNode } from './BaseNode.ts';
export class GasPlanetNode extends BaseNode {
  readonly name = 'GasPlanet';
  // TODO: Phase 5 — gas giant rendering
}
```

- [ ] **Step 3: Commit**

```bash
git add src/graph/nodes/
git commit -m "feat(graph): BaseNode and stub nodes scaffold"
```

---

## Task 12: WGSL Shader

**Files:**
- Create: `src/shaders/planet.wgsl`

- [ ] **Step 1: Create `src/shaders/planet.wgsl`**

```wgsl
const PI: f32 = 3.14159265358979323846;

// Pipeline-overridable constants — set at pipeline creation from PlanetComponent
override rings: u32 = 64u;
override segments: u32 = 64u;

struct Uniforms {
  viewProj : mat4x4<f32>,
  model    : mat4x4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexOut {
  @builtin(position) clipPosition : vec4<f32>,
  @location(0)       normal       : vec3<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  let cols  = segments + 1u;
  let i     = vertexIndex / cols;
  let j     = vertexIndex % cols;

  let theta = f32(i) / f32(rings)    * PI;
  let phi   = f32(j) / f32(segments) * 2.0 * PI;

  // Unit sphere in local space — radius applied via model matrix scale
  let localPos = vec3<f32>(
    sin(theta) * cos(phi),
    cos(theta),
    sin(theta) * sin(phi),
  );

  let worldPos    = (uniforms.model * vec4<f32>(localPos, 1.0)).xyz;
  let worldNormal = normalize((uniforms.model * vec4<f32>(localPos, 0.0)).xyz);

  var out: VertexOut;
  out.clipPosition = uniforms.viewProj * vec4<f32>(worldPos, 1.0);
  out.normal       = worldNormal;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  // Normal visualization: map [-1,1] → [0,1]
  return vec4<f32>(in.normal * 0.5 + 0.5, 1.0);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/shaders/planet.wgsl
git commit -m "feat(shaders): planet combined vertex+fragment — normal visualization"
```

---

## Task 13: `src/graph/nodes/PlanetRenderNode.ts`

**Files:**
- Create: `src/graph/nodes/PlanetRenderNode.ts`

- [ ] **Step 1: Create the file**

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
  private _device!: GPUDevice;

  constructor(scene: Scene, resources: ResourceManager, pipelines: PipelineManager) {
    super();
    this._scene = scene;
    this._resources = resources;
    this._pipelines = pipelines;
  }

  override build(ctx: BuildContext): void {
    this._device = ctx.device;

    // Use first planet's component for pipeline constants (one pipeline covers all planets of same resolution)
    const planets = this._scene.getEntitiesWith(PlanetComponent);
    const planet = planets[0]!.getComponent(PlanetComponent)!;

    // ── Shader module ──────────────────────────────────────────────────────────
    const shaderModule = ctx.device.createShaderModule({ code: planetShaderSrc });

    // ── Bind group layout: slot 0 = uniform buffer ─────────────────────────────
    const bindGroupLayout = ctx.device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'uniform' },
      }],
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

    // ── Uniform buffer: viewProj (64) + model (64) = 128 bytes ─────────────────
    this._uniformBuffer = this._resources.createBuffer('planet.uniform', {
      size: 128,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // ── Bind group ─────────────────────────────────────────────────────────────
    this._bindGroup = ctx.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this._uniformBuffer } }],
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
    const vp = cam.getVPMatrix(this._scene.mainCamera.transform.position);
    ctx.device.queue.writeBuffer(this._uniformBuffer, 0, vp);

    // Use first planet's model matrix (extend to per-draw in a future task)
    const planet = planets[0]!;
    const planetComp = planet.getComponent(PlanetComponent)!;
    // Scale model matrix by radius; planet transform drives position/rotation
    const model = planet.transform.getWorldMatrix();
    // Apply uniform scale for radius on top of transform
    const scaledModel = new Float32Array(16);
    scaledModel.set(model);
    scaledModel[0] *= planetComp.radius;
    scaledModel[5] *= planetComp.radius;
    scaledModel[10] *= planetComp.radius;
    ctx.device.queue.writeBuffer(this._uniformBuffer, 64, scaledModel);
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

/** Generate index buffer for a UV sphere grid (rings × segments quads → 2 triangles each). */
function buildSphereIndices(rings: number, segments: number): Uint32Array {
  const cols = segments + 1;
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

- [ ] **Step 2: Run tests to make sure nothing broke**

```bash
npm test
```

Expected: PASS (all previous tests)

- [ ] **Step 3: Commit**

```bash
git add src/graph/nodes/PlanetRenderNode.ts
git commit -m "feat(graph): PlanetRenderNode — sphere index buffer, uniform buffer, draw"
```

---

## Task 14: `src/controllers/OrbitCameraController.ts`

**Files:**
- Create: `src/controllers/OrbitCameraController.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/controllers/OrbitCameraController.ts
import type { Scene } from '../ecs/Scene.ts';

export class OrbitCameraController {
  private _scene: Scene;
  private _canvas: HTMLCanvasElement;

  // Spherical coordinates (camera around origin)
  private _theta = Math.PI / 3;   // polar angle from Y-axis [0.05, PI-0.05]
  private _phi = 0;               // azimuthal angle
  private _radius = 4;            // distance from origin

  private _isDragging = false;
  private _lastX = 0;
  private _lastY = 0;

  constructor(scene: Scene, canvas: HTMLCanvasElement) {
    this._scene = scene;
    this._canvas = canvas;
    this._bindEvents();
    this._applyToCamera();
  }

  private _bindEvents(): void {
    this._canvas.addEventListener('mousedown', (e) => {
      this._isDragging = true;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
    });

    window.addEventListener('mouseup', () => {
      this._isDragging = false;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this._isDragging) return;
      const dx = e.clientX - this._lastX;
      const dy = e.clientY - this._lastY;
      this._lastX = e.clientX;
      this._lastY = e.clientY;

      this._phi   -= dx * 0.005;
      this._theta -= dy * 0.005;
      this._theta  = Math.max(0.05, Math.min(Math.PI - 0.05, this._theta));

      this._applyToCamera();
    });

    this._canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._radius += e.deltaY * 0.01;
      this._radius  = Math.max(1.5, Math.min(20, this._radius));
      this._applyToCamera();
    }, { passive: false });
  }

  private _applyToCamera(): void {
    const x = this._radius * Math.sin(this._theta) * Math.cos(this._phi);
    const y = this._radius * Math.cos(this._theta);
    const z = this._radius * Math.sin(this._theta) * Math.sin(this._phi);
    this._scene.mainCamera.transform.setPosition(x, y, z);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/controllers/OrbitCameraController.ts
git commit -m "feat(controllers): OrbitCameraController — mouse drag + scroll zoom"
```

---

## Task 15: `src/graph/GraphBuilder.ts` + `GraphDebugUI.ts`

**Files:**
- Create: `src/graph/GraphBuilder.ts`
- Create: `src/graph/GraphDebugUI.ts`

- [ ] **Step 1: Create `src/graph/GraphBuilder.ts`**

```typescript
// src/graph/GraphBuilder.ts
import { RenderGraph } from '../core/RenderGraph.ts';
import { ResourceManager } from '../core/ResourceManager.ts';
import { PipelineManager } from '../core/PipelineManager.ts';
import { Scene } from '../ecs/Scene.ts';
import { Entity } from '../ecs/Entity.ts';
import { CameraComponent } from '../ecs/components/CameraComponent.ts';
import { PlanetComponent } from '../ecs/components/PlanetComponent.ts';
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
    const scene = new Scene();

    // ── Planet entity ──────────────────────────────────────────────────────────
    const planet = new Entity('planet');
    planet.transform.setPosition(0, 0, 0);
    planet.addComponent(new PlanetComponent(1.0, 64, 64));
    scene.addEntity(planet);

    // ── Camera entity ──────────────────────────────────────────────────────────
    const camera = new Entity('camera');
    camera.addComponent(
      new CameraComponent(Math.PI / 4, canvas.width / canvas.height, 0.1, 100),
    );
    scene.addEntity(camera);
    scene.mainCamera = camera;

    // ── Orbit controller (sets initial camera position) ────────────────────────
    const orbitController = new OrbitCameraController(scene, canvas);

    // ── Render graph ───────────────────────────────────────────────────────────
    const graph = new RenderGraph(scene);

    const buildCtx: BuildContext = { device, resources, pipelines, scene };

    const planetNode = new PlanetRenderNode(scene, resources, pipelines);
    planetNode.build(buildCtx);
    graph.addNode(planetNode);

    return { graph, orbitController };
  }
}
```

- [ ] **Step 2: Create `src/graph/GraphDebugUI.ts` (stub)**

```typescript
// src/graph/GraphDebugUI.ts
// TODO: Phase 2 — display node list and per-node GPU timing in an overlay panel
export class GraphDebugUI {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_container: HTMLElement) {}
}
```

- [ ] **Step 3: Commit**

```bash
git add src/graph/GraphBuilder.ts src/graph/GraphDebugUI.ts
git commit -m "feat(graph): GraphBuilder assembles scene + nodes; GraphDebugUI stub"
```

---

## Task 16: `src/main.ts` Wiring

**Files:**
- Replace: `src/main.ts`

- [ ] **Step 1: Replace `src/main.ts`**

```typescript
// src/main.ts
import { WebGPUEngine } from './core/WebGPUEngine.ts';

const engine = new WebGPUEngine();

engine.init().then(() => {
  engine.start();
}).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  document.body.innerHTML = `<pre style="color:red;padding:1rem;">${msg}</pre>`;
});
```

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: PASS (all Transform + Entity + Scene tests)

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat: wire WebGPUEngine in main.ts — phase 1 complete"
```

---

## Task 17: Visual Verification

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

Expected: Vite prints a local URL (e.g. `http://localhost:5173`)

- [ ] **Step 2: Open in a WebGPU-enabled browser**

Open the URL in Chrome 113+ or Edge 113+. (Firefox requires a flag; Safari 18+ on macOS.)

**Expected result:** A sphere rendered with normal-color visualization — RGB colors shifting across the surface as you look at it from different angles.

- [ ] **Step 3: Test Orbit Camera**

- **Left-drag** on the canvas → sphere should rotate around the origin
- **Scroll wheel** → zoom in/out (radius clamps to [1.5, 20])

**Expected:** Smooth orbit; sphere stays centered; no visual artifacts or console errors.

- [ ] **Step 4: Check browser console**

Open DevTools → Console. No red errors expected. WebGPU validation errors will appear here if shaders or pipeline descriptors are wrong.

If there are errors, common fixes:
- `"pipeline overridable constant 'rings' not found"` → check that `override rings: u32` is in the WGSL and the constants object key matches exactly
- `"Bind group layout mismatch"` → verify `createBindGroupLayout` entries match what the shader declares at `@group(0) @binding(0)`
- Black screen with no errors → check `clearValue` color and that `targetView` is valid

- [ ] **Step 5: Clean up old Vite template assets (optional)**

The old Vite template assets are no longer referenced but still exist. Remove them if desired:

```bash
git rm src/counter.ts src/style.css src/assets/hero.png src/assets/typescript.svg src/assets/vite.svg
git rm public/favicon.svg public/icons.svg
git commit -m "chore: remove unused Vite template assets"
```

---

## Summary

After all 17 tasks are complete, the project will have:

- Full directory structure matching AGENT.md
- ECS layer: `Transform`, `Entity`, `Scene`, `CameraComponent`, `PlanetComponent`
- Core: `WebGPUEngine`, `RenderGraph`, `ResourceManager`, `PipelineManager`
- A working `PlanetRenderNode` rendering a 64×64 UV sphere with normal-visualization shading
- Orbit camera via mouse drag + scroll
- Unit-tested ECS layer (Transform, Entity, Scene)
- 6 stub nodes ready for Phase 2 implementation
