# WebGPUEngine Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 重构 WebGPUEngine 及周边层，消除双重资源所有权，引入 `ISurface` 抽象层支持 Resize 与 OffScreen 渲染。

**Architecture:** 新增 `ISurface` 接口 + `CanvasSurfaceManager` + `SurfaceResources` 三个类，将 surface-dependent RT（scene.color / scene.depth）从 `ResourceManager` 剥离。`WebGPUEngine` 瘦身为纯帧循环驱动，`GraphBuilder.build(engine)` 作为场景组装入口，`main.ts` 退化为 7 行组合根。

**Tech Stack:** TypeScript, WebGPU, Vitest

---

## 文件结构

| 操作 | 路径 | 职责 |
|------|------|------|
| 新增 | `src/core/ISurface.ts` | Surface 接口（getTargetView / width / height / onResize） |
| 新增 | `src/core/SurfaceResources.ts` | 单 Surface 的 RT 管理（registerTexture / getView / onSurfaceChanged / onChanged） |
| 新增 | `src/core/CanvasSurfaceManager.ts` | ISurface canvas 实现（DPR + ResizeObserver） |
| 新增 | `src/core/initWebGPU.ts` | adapter/device 初始化 + device.lost 处理 |
| 修改 | `src/core/types.ts` | FrameContext 加 resources；新增 SurfaceDescriptor；BuildContext 加 surfaceRes + surfaceDesc |
| 修改 | `src/core/WebGPUEngine.ts` | 删除 View 缓存字段；接收 ISurface；addSurface()；setGraph()；持有 PipelineManager |
| 修改 | `src/core/ResourceManager.ts` | 无结构变动（scene.color/depth 改由 SurfaceResources 管理，ResourceManager 不再需要改动） |
| 修改 | `src/graph/GraphBuilder.ts` | 签名改为 build(engine)；注册 surface 纹理；构造 BuildContext 含 surfaceRes + surfaceDesc |
| 修改 | `src/graph/nodes/AtmosphereNode.ts` | 从 BuildContext.surfaceRes 获取 RT；订阅 onChanged 重建 bindGroup |
| 修改 | `src/graph/nodes/PlanetRenderNode.ts` | 从 BuildContext.surfaceDesc 读取 colorFormat / depthFormat，不再硬编码 |
| 修改 | `src/main.ts` | 纯组合根 |
| 新增 | `src/__tests__/SurfaceResources.test.ts` | SurfaceResources 缓存与重建逻辑的单元测试 |

---

## Task 1: `ISurface` 接口

**Files:**
- Create: `src/core/ISurface.ts`

- [x] **Step 1: 创建文件**

```typescript
// src/core/ISurface.ts

export interface ISurface {
  readonly width: number;
  readonly height: number;
  /** 返回当前帧的渲染目标 View。CanvasSurfaceManager 每帧从 swapchain 取；OffscreenSurfaceManager 返回固定纹理 View。 */
  getTargetView(): GPUTextureView;
  /** 注册 resize 回调。回调在 surface 尺寸实际改变后触发，传入新的像素尺寸（已乘 DPR）。 */
  onResize(cb: (width: number, height: number) => void): void;
}
```

- [x] **Step 2: 确认 TypeScript 无报错**

```bash
npx tsc --noEmit
```
Expected: 无错误（新文件尚未被引用，无影响）

---

## Task 2: `SurfaceResources` + 单元测试

**Files:**
- Create: `src/core/SurfaceResources.ts`
- Create: `src/__tests__/SurfaceResources.test.ts`

- [x] **Step 1: 写失败测试**

```typescript
// src/__tests__/SurfaceResources.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SurfaceResources } from '../core/SurfaceResources.ts';

function makeMockDevice() {
  return {
    createTexture: vi.fn(() => ({
      destroy: vi.fn(),
      createView: vi.fn(() => ({ _tag: 'view_' + Math.random() })),
    })),
  } as unknown as GPUDevice;
}

describe('SurfaceResources', () => {
  let device: GPUDevice;
  let sr: SurfaceResources;

  beforeEach(() => {
    device = makeMockDevice();
    sr = new SurfaceResources(device, 800, 600);
  });

  it('registerTexture 立即创建纹理', () => {
    sr.registerTexture('scene.color', (w, h) => ({
      size: [w, h], format: 'rgba8unorm' as GPUTextureFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    }));
    expect((device.createTexture as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    const call = (device.createTexture as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.size).toEqual([800, 600]);
  });

  it('getView 返回缓存 View（同一引用）', () => {
    sr.registerTexture('scene.color', (w, h) => ({
      size: [w, h], format: 'rgba8unorm' as GPUTextureFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    }));
    const v1 = sr.getView('scene.color');
    const v2 = sr.getView('scene.color');
    expect(v1).toBe(v2);
  });

  it('onSurfaceChanged 销毁旧纹理、重建、使 View 缓存失效', () => {
    const factory = vi.fn((w: number, h: number) => ({
      size: [w, h], format: 'rgba8unorm' as GPUTextureFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    }));
    sr.registerTexture('scene.color', factory);

    const v1 = sr.getView('scene.color');
    sr.onSurfaceChanged(1280, 720);

    // 旧纹理被销毁
    const firstTex = (device.createTexture as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(firstTex.destroy).toHaveBeenCalled();

    // 新纹理用新尺寸
    expect(factory.mock.calls[1]).toEqual([1280, 720]);

    // View 缓存失效：getView 返回新引用
    const v2 = sr.getView('scene.color');
    expect(v2).not.toBe(v1);
  });

  it('onChanged 回调在 onSurfaceChanged 后触发', () => {
    sr.registerTexture('scene.color', (w, h) => ({
      size: [w, h], format: 'rgba8unorm' as GPUTextureFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    }));
    const cb = vi.fn();
    sr.onChanged(cb);
    sr.onSurfaceChanged(1280, 720);
    expect(cb).toHaveBeenCalledOnce();
  });
});
```

- [x] **Step 2: 运行测试，确认失败**

```bash
npm test -- SurfaceResources
```
Expected: FAIL（`SurfaceResources` 尚未实现）

- [x] **Step 3: 实现 `SurfaceResources`**

```typescript
// src/core/SurfaceResources.ts

export class SurfaceResources {
  private _device: GPUDevice;
  private _textures  = new Map<string, GPUTexture>();
  private _views     = new Map<string, GPUTextureView>();
  private _factories = new Map<string, (w: number, h: number) => GPUTextureDescriptor>();
  private _callbacks: Array<() => void> = [];

  constructor(device: GPUDevice, width: number, height: number) {
    this._device = device;
    // width/height 供 registerTexture 在初始化时立即创建纹理
    this._width  = width;
    this._height = height;
  }

  private _width: number;
  private _height: number;

  registerTexture(name: string, factory: (w: number, h: number) => GPUTextureDescriptor): void {
    this._factories.set(name, factory);
    const tex = this._device.createTexture(factory(this._width, this._height));
    this._textures.set(name, tex);
  }

  getView(name: string): GPUTextureView {
    if (!this._views.has(name)) {
      const tex = this._textures.get(name);
      if (!tex) throw new Error(`SurfaceResources: texture "${name}" not registered`);
      this._views.set(name, tex.createView());
    }
    return this._views.get(name)!;
  }

  onSurfaceChanged(width: number, height: number): void {
    this._width  = width;
    this._height = height;
    for (const [name, factory] of this._factories) {
      this._textures.get(name)?.destroy();
      this._textures.set(name, this._device.createTexture(factory(width, height)));
      this._views.delete(name);
    }
    for (const cb of this._callbacks) cb();
  }

  /** 注册在纹理重建后触发的回调（供 AtmosphereNode 等重建 bind group）。 */
  onChanged(cb: () => void): void {
    this._callbacks.push(cb);
  }

  destroy(): void {
    this._textures.forEach(t => t.destroy());
    this._textures.clear();
    this._views.clear();
    this._factories.clear();
    this._callbacks.length = 0;
  }
}
```

- [x] **Step 4: 运行测试，确认通过**

```bash
npm test -- SurfaceResources
```
Expected: PASS（4 tests）

---

## Task 3: `CanvasSurfaceManager`

**Files:**
- Create: `src/core/CanvasSurfaceManager.ts`

- [x] **Step 1: 创建文件**

```typescript
// src/core/CanvasSurfaceManager.ts
import type { ISurface } from './ISurface.ts';

export class CanvasSurfaceManager implements ISurface {
  private _canvas:  HTMLCanvasElement;
  private _context: GPUCanvasContext;
  private _device:  GPUDevice;
  private _width:   number;
  private _height:  number;

  constructor(canvas: HTMLCanvasElement, device: GPUDevice) {
    this._canvas  = canvas;
    this._device  = device;
    this._width   = Math.round(canvas.clientWidth  * devicePixelRatio);
    this._height  = Math.round(canvas.clientHeight * devicePixelRatio);
    canvas.width  = this._width;
    canvas.height = this._height;
    this._context = canvas.getContext('webgpu') as GPUCanvasContext;
    this._configure();
  }

  get width()  { return this._width; }
  get height() { return this._height; }

  getTargetView(): GPUTextureView {
    return this._context.getCurrentTexture().createView();
  }

  /** Engine 在 resize 回调里调用，重新配置 context。 */
  reconfigure(device: GPUDevice, width: number, height: number): void {
    this._device  = device;
    this._width   = width;
    this._height  = height;
    this._canvas.width  = width;
    this._canvas.height = height;
    this._configure();
  }

  onResize(cb: (w: number, h: number) => void): void {
    new ResizeObserver(entries => {
      const e = entries[0];
      if (!e) return;
      const w = Math.round(e.contentRect.width  * devicePixelRatio);
      const h = Math.round(e.contentRect.height * devicePixelRatio);
      if (w > 0 && h > 0) cb(w, h);
    }).observe(this._canvas);
  }

  private _configure(): void {
    this._context.configure({
      device: this._device,
      format: navigator.gpu.getPreferredCanvasFormat(),
    });
  }
}
```

- [x] **Step 2: 确认 TypeScript 无报错**

```bash
npx tsc --noEmit
```

---

## Task 4: `initWebGPU`

**Files:**
- Create: `src/core/initWebGPU.ts`

- [x] **Step 1: 创建文件**

```typescript
// src/core/initWebGPU.ts

/**
 * 请求 GPU adapter 和 device。
 * 如果浏览器不支持 WebGPU 或找不到 adapter，抛出 Error。
 * device.lost 由调用方处理（通常在 WebGPUEngine 里）。
 */
export async function initWebGPU(): Promise<GPUDevice> {
  if (!navigator.gpu) {
    throw new Error('WebGPU is not supported in this browser.');
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    throw new Error('No GPU adapter found.');
  }
  const device = await adapter.requestDevice();
  return device;
}
```

- [x] **Step 2: 确认 TypeScript 无报错**

```bash
npx tsc --noEmit
```

---

## Task 5: 更新 `types.ts`

**Files:**
- Modify: `src/core/types.ts`

- [x] **Step 1: 新增 `SurfaceDescriptor`，更新 `FrameContext`，更新 `BuildContext`**

将 `src/core/types.ts` 中的 `FrameContext` 和 `BuildContext` 替换为以下内容（其余类型不变）：

```typescript
// 在文件顶部，补充 import
import type { SurfaceResources } from './SurfaceResources.ts';

// 替换 FrameContext
export interface FrameContext {
  frameIndex: number;
  dt: number;
  totalTime: number;
  device: GPUDevice;
  targetView: GPUTextureView;
  sceneColorView: GPUTextureView;
  depthView: GPUTextureView;
  resources: ResourceManager;        // ← 新增：共享资源，Node 可按需查询 terrain buffer 等
}

// 新增 SurfaceDescriptor
export interface SurfaceDescriptor {
  width: number;
  height: number;
  colorFormat: GPUTextureFormat;
  depthFormat: GPUTextureFormat;
  sampleCount: number;
}

// 替换 BuildContext
export interface BuildContext {
  device: GPUDevice;
  resources: ResourceManager;
  surfaceRes: SurfaceResources;      // ← 新增：surface RT 管理（scene.color / scene.depth）
  surfaceDesc: SurfaceDescriptor;    // ← 新增：format / size 描述符，避免硬编码
  pipelines: PipelineManager;
  scene: Scene;
}
```

- [x] **Step 2: 确认 TypeScript 无报错**

```bash
npx tsc --noEmit
```
Expected: 可能有若干 `BuildContext` 使用处报错（Task 7/8 会修复）

---

## Task 6: 重写 `WebGPUEngine`

**Files:**
- Modify: `src/core/WebGPUEngine.ts`

- [x] **Step 1: 完整替换文件内容**

```typescript
// src/core/WebGPUEngine.ts
import { RenderGraph }        from './RenderGraph.ts';
import { ResourceManager }    from './ResourceManager.ts';
import { PipelineManager }    from './PipelineManager.ts';
import { SurfaceResources }   from './SurfaceResources.ts';
import type { ISurface }      from './ISurface.ts';
import { CanvasSurfaceManager } from './CanvasSurfaceManager.ts';
import type { FrameContext, SurfaceDescriptor } from './types.ts';

interface SurfacePair {
  surface:    ISurface;
  surfaceRes: SurfaceResources;
}

export class WebGPUEngine {
  private _device:    GPUDevice;
  private _resources: ResourceManager;
  private _pipelines: PipelineManager;
  private _surfaces:  SurfacePair[] = [];
  private _graph?:    RenderGraph;

  private _frameIndex = 0;
  private _lastTime   = 0;
  private _totalTime  = 0;

  constructor(device: GPUDevice) {
    this._device    = device;
    this._resources = new ResourceManager(device);
    this._pipelines = new PipelineManager(device);

    // device.lost: log and stop the loop (caller may re-init)
    device.lost.then((info) => {
      console.error('WebGPU device lost:', info.message);
    });
  }

  get device()    { return this._device; }
  get resources() { return this._resources; }
  get pipelines() { return this._pipelines; }

  /** Surface 的格式描述符，供 GraphBuilder 构造 BuildContext 时使用。 */
  get surfaceDescriptor(): SurfaceDescriptor {
    const { surface } = this._surfaces[0]!;
    return {
      width:       surface.width,
      height:      surface.height,
      colorFormat: 'rgba8unorm',
      depthFormat: 'depth32float',
      sampleCount: 1,
    };
  }

  /**
   * 注册一个 Surface。内部创建对应的 SurfaceResources，绑定 resize 回调。
   * 返回 SurfaceResources 供 GraphBuilder 注册 RT 纹理。
   */
  addSurface(surface: ISurface): SurfaceResources {
    const surfaceRes = new SurfaceResources(this._device, surface.width, surface.height);
    this._surfaces.push({ surface, surfaceRes });

    surface.onResize((w, h) => {
      // CanvasSurfaceManager 需要重配 context；OffscreenSurface 可跳过
      if (surface instanceof CanvasSurfaceManager) {
        surface.reconfigure(this._device, w, h);
      }
      surfaceRes.onSurfaceChanged(w, h);
    });

    return surfaceRes;
  }

  /** 取第 index 个 Surface 的 SurfaceResources（GraphBuilder 使用）。 */
  getSurfaceResources(index: number): SurfaceResources {
    return this._surfaces[index]!.surfaceRes;
  }

  /** GraphBuilder 构造完 RenderGraph 后调用，注入 graph。 */
  setGraph(graph: RenderGraph): void {
    this._graph = graph;
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

    const { surface, surfaceRes } = this._surfaces[0]!;
    const ctx: FrameContext = {
      frameIndex:     this._frameIndex,
      dt,
      totalTime:      this._totalTime,
      device:         this._device,
      targetView:     surface.getTargetView(),
      sceneColorView: surfaceRes.getView('scene.color'),
      depthView:      surfaceRes.getView('scene.depth'),
      resources:      this._resources,
    };

    this._graph!.update(ctx);
    this._graph!.execute(ctx);

    requestAnimationFrame(this._tick.bind(this));
  }
}
```

- [x] **Step 2: 确认 TypeScript 无报错**

```bash
npx tsc --noEmit
```

---

## Task 7: 重写 `GraphBuilder`

**Files:**
- Modify: `src/graph/GraphBuilder.ts`

- [x] **Step 1: 完整替换文件内容**

```typescript
// src/graph/GraphBuilder.ts
import { RenderGraph }          from '../core/RenderGraph.ts';
import { Scene }                from '../ecs/Scene.ts';
import { Entity }               from '../ecs/Entity.ts';
import { CameraComponent }      from '../ecs/components/CameraComponent.ts';
import { PlanetComponent }      from '../ecs/components/PlanetComponent.ts';
import { SunComponent }         from '../ecs/components/SunComponent.ts';
import { ComputeNoiseNode }     from './nodes/ComputeNoiseNode.ts';
import { PlanetRenderNode }     from './nodes/PlanetRenderNode.ts';
import { AtmosphereNode }       from './nodes/AtmosphereNode.ts';
import { OrbitCameraController } from '../controllers/OrbitCameraController.ts';
import type { BuildContext }    from '../core/types.ts';
import type { WebGPUEngine }    from '../core/WebGPUEngine.ts';

export class GraphBuilder {
  static build(engine: WebGPUEngine, canvas: HTMLCanvasElement): void {
    const { device, resources, pipelines } = engine;
    const surfaceRes = engine.getSurfaceResources(0);
    const surfaceDesc = engine.surfaceDescriptor;

    // ── Surface-dependent RTs ──────────────────────────────────────────────────
    surfaceRes.registerTexture('scene.color', (w, h) => ({
      size: [w, h],
      format: surfaceDesc.colorFormat,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    }));
    surfaceRes.registerTexture('scene.depth', (w, h) => ({
      size: [w, h],
      format: surfaceDesc.depthFormat,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    }));

    // ── Scene ──────────────────────────────────────────────────────────────────
    const scene = new Scene();

    const planet = new Entity('planet');
    planet.transform.setPosition(0, 0, 0);
    planet.addComponent(new PlanetComponent(1.0, 128, 128));
    scene.addEntity(planet);

    const camera = new Entity('camera');
    camera.addComponent(
      new CameraComponent(Math.PI / 4, canvas.width / canvas.height, 0.1, 100),
    );
    scene.addEntity(camera);
    scene.mainCamera = camera;

    const sun = new Entity('sun');
    sun.addComponent(new SunComponent());
    scene.addEntity(sun);

    // OrbitController — canvas event listeners kept alive by closure in graph
    new OrbitCameraController(scene, canvas);

    // ── Build context ──────────────────────────────────────────────────────────
    const buildCtx: BuildContext = { device, resources, surfaceRes, surfaceDesc, pipelines, scene };

    // ── Nodes ─────────────────────────────────────────────────────────────────
    // Node order: ComputeNoise → PlanetRender (needs terrain) → Atmosphere (needs scene RT)
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

    engine.setGraph(graph);
  }
}
```

- [x] **Step 2: 确认 TypeScript 无报错**

```bash
npx tsc --noEmit
```

---

## Task 8: 更新 `AtmosphereNode` — 使用 surfaceRes + resize 重建 bindGroup

**Files:**
- Modify: `src/graph/nodes/AtmosphereNode.ts`

AtmosphereNode 目前在 `build()` 里从 `this._resources.getTexture('scene.color/depth')` 取纹理，创建固定 bind group。Resize 后纹理被重建，bind group 持有旧 View 会导致渲染错误。修改为：从 `ctx.surfaceRes.getView()` 取 View，并订阅 `onChanged` 重建 bind group。

- [x] **Step 1: 在 `build()` 里保存 bindGroupLayout + device 引用，提取 `_rebuildBindGroup()` 方法**

将 `build()` 方法和新增私有字段替换为：

```typescript
// 新增私有字段（在 class 顶部）
private _bindGroupLayout!: GPUBindGroupLayout;
private _device!: GPUDevice;

override build(ctx: BuildContext): void {
  const { device } = ctx;
  this._device = device;

  const shaderModule = device.createShaderModule({ code: atmosphereSrc });

  this._bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'float', viewDimension: '2d' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'depth', viewDimension: '2d' } },
    ],
  });

  this._pipeline = this._pipelines.createRenderPipeline('atmosphere', {
    layout: device.createPipelineLayout({ bindGroupLayouts: [this._bindGroupLayout] }),
    vertex:   { module: shaderModule, entryPoint: 'vs_main' },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs_main',
      targets: [{ format: ctx.surfaceDesc.colorFormat }],
    },
    primitive: { topology: 'triangle-list' },
  });

  this._uniformBuffer = this._resources.createBuffer('atmosphere.uniform', {
    size: UNIFORM_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // 初始构建 bindGroup
  this._rebuildBindGroup(ctx.surfaceRes);

  // resize 时纹理重建后重新构建 bindGroup
  ctx.surfaceRes.onChanged(() => this._rebuildBindGroup(ctx.surfaceRes));

  this._cachedSunEntity    = this._scene.getEntitiesWith(SunComponent)[0];
  this._cachedPlanetEntity = this._scene.getEntitiesWith(PlanetComponent)[0];
}

private _rebuildBindGroup(surfaceRes: import('../core/SurfaceResources.ts').SurfaceResources): void {
  this._bindGroup = this._device.createBindGroup({
    layout: this._bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: this._uniformBuffer } },
      { binding: 1, resource: surfaceRes.getView('scene.color') },
      { binding: 2, resource: surfaceRes.getView('scene.depth') },
    ],
  });
}
```

同时**删除** `build()` 中原有的 `this._resources.getTexture('scene.color')` 相关代码（已被上面替换）。

- [x] **Step 2: 确认 TypeScript 无报错**

```bash
npx tsc --noEmit
```

---

## Task 9: 更新 `PlanetRenderNode` — 使用 surfaceDesc 格式

**Files:**
- Modify: `src/graph/nodes/PlanetRenderNode.ts`

`build()` 中 pipeline 的 `targets[0].format` 和 `depthStencil.format` 目前硬编码，改为从 `ctx.surfaceDesc` 读取。

- [x] **Step 1: 替换 pipeline 创建中的硬编码格式**

将 `build()` 中以下片段：

```typescript
// 原来
fragment: {
  module: shaderModule,
  entryPoint: 'fs_main',
  targets: [{ format: 'rgba8unorm' }],
},
...
depthStencil: {
  format: 'depth32float',
  depthWriteEnabled: true,
  depthCompare: 'less',
},
```

替换为：

```typescript
// 修改后
fragment: {
  module: shaderModule,
  entryPoint: 'fs_main',
  targets: [{ format: ctx.surfaceDesc.colorFormat }],
},
...
depthStencil: {
  format: ctx.surfaceDesc.depthFormat,
  depthWriteEnabled: true,
  depthCompare: 'less',
},
```

- [x] **Step 2: 确认 TypeScript 无报错**

```bash
npx tsc --noEmit
```

---

## Task 10: 更新 `main.ts`

**Files:**
- Modify: `src/main.ts`

- [x] **Step 1: 完整替换文件内容**

```typescript
// src/main.ts
import { initWebGPU }           from './core/initWebGPU.ts';
import { CanvasSurfaceManager } from './core/CanvasSurfaceManager.ts';
import { WebGPUEngine }         from './core/WebGPUEngine.ts';
import { GraphBuilder }         from './graph/GraphBuilder.ts';

async function main(): Promise<void> {
  const canvas  = document.getElementById('webgpu-canvas') as HTMLCanvasElement;
  const device  = await initWebGPU();
  const surface = new CanvasSurfaceManager(canvas, device);
  const engine  = new WebGPUEngine(device);
  engine.addSurface(surface);
  GraphBuilder.build(engine, canvas);
  engine.start();
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  document.body.innerHTML = `<pre style="color:red;padding:1rem;">${msg}</pre>`;
});
```

- [x] **Step 2: 全量类型检查**

```bash
npx tsc --noEmit
```
Expected: 无报错

- [x] **Step 3: 运行全部测试**

```bash
npm test
```
Expected: 全部 PASS

- [x] **Step 4: 启动 dev server，目视确认星球正常渲染**

```bash
npm run dev
```
Expected: 浏览器打开后显示星球 + 大气层效果，无控制台报错

---

## 自检结果

- **Spec 覆盖**：ISurface ✅ CanvasSurfaceManager ✅ SurfaceResources ✅ initWebGPU ✅ Engine 重写 ✅ GraphBuilder 重写 ✅ AtmosphereNode resize 重建 ✅ PlanetRenderNode 格式解耦 ✅ main.ts 组合根 ✅
- **类型一致性**：`surfaceRes: SurfaceResources` 在 BuildContext、Task 7 GraphBuilder、Task 8 AtmosphereNode 中一致；`surfaceDesc: SurfaceDescriptor` 同理
- **遗留注意**：`OrbitCameraController` 在 GraphBuilder 里构造后不再被任何字段持有——其事件监听器通过闭包绑定在 canvas 上，GC 不会回收，无内存泄漏风险
