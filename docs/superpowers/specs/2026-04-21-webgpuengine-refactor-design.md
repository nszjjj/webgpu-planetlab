# WebGPUEngine 重构设计文档

**日期：** 2026-04-21
**目标：** 分清职责，消除 Engine 缓存 View 的设计矛盾，建立支持 Resize 与 OffScreen 的 Surface 抽象层

---

## 一、背景与问题

当前 `WebGPUEngine` 存在两个职责混乱点：

1. **双重资源所有权**：`_sceneColorView` / `_depthView` 字段缓存在 Engine 里，而底层纹理由 `ResourceManager` 持有。两者都对同一份资源有"半个所有权"，resize 时两处都必须同步更新，极易遗漏。
2. **场景组装耦合**：Engine 内部调用 `GraphBuilder.build()`，导致 Engine 同时负责 GPU 基础设施和"渲染什么"，无法独立测试或复用。

---

## 二、架构总览

```
main.ts (Composition Root)
  └── initWebGPU()                      ← adapter/device 初始化 + device.lost 处理
  └── new CanvasSurfaceManager(canvas, device)
  └── new WebGPUEngine(device)
  └── engine.addSurface(surface)        ← 内部创建 SurfaceResources，绑定 resize
  └── GraphBuilder.build(engine)        ← 从 engine 取 descriptor，注入 graph
  └── engine.start()
```

### 职责边界

| 类 | 职责 |
|---|---|
| `initWebGPU()` | adapter → device，`powerPreference`，`device.lost` 恢复 |
| `CanvasSurfaceManager` | canvas + context + configure + DPR + ResizeObserver |
| `ISurface` | 接口：`getTargetView()` / `width` / `height` / `onResize()` |
| `WebGPUEngine` | device + surfaces 管理 + 帧循环驱动 |
| `ResourceManager` | 共享 GPU 资源（terrain buffer、noise buffer、pipeline 等），无 surface 感知 |
| `SurfaceResources` | 单 Surface 的附属 RT（scene.color、scene.depth），随 Surface 生死 |
| `GraphBuilder` | 场景组装（entities + nodes），接收 engine descriptor，注入 graph |
| `main.ts` | 纯组合根：获取 device → 创建 Engine/Surface → start |

---

## 三、新增类

### `ISurface` 接口

```typescript
// src/core/ISurface.ts
export interface ISurface {
  readonly width: number;
  readonly height: number;
  getTargetView(): GPUTextureView;
  onResize(cb: (width: number, height: number) => void): void;
}
```

`reconfigure()` 不在接口上——它是 `CanvasSurfaceManager` 的具体方法，Engine 通过具体类型调用，`ISurface` 只暴露渲染侧所需的三个方法。

### `CanvasSurfaceManager`

```typescript
// src/core/CanvasSurfaceManager.ts
export class CanvasSurfaceManager implements ISurface {
  private _context: GPUCanvasContext;
  private _width: number;
  private _height: number;

  constructor(canvas: HTMLCanvasElement, device: GPUDevice) {
    // DPR-aware 尺寸计算
    this._width  = Math.round(canvas.clientWidth  * devicePixelRatio);
    this._height = Math.round(canvas.clientHeight * devicePixelRatio);
    canvas.width  = this._width;
    canvas.height = this._height;
    this._context = canvas.getContext('webgpu') as GPUCanvasContext;
    this._configure(device);
  }

  get width()  { return this._width; }
  get height() { return this._height; }

  getTargetView(): GPUTextureView {
    return this._context.getCurrentTexture().createView();
  }

  reconfigure(device: GPUDevice, width: number, height: number): void {
    this._width  = width;
    this._height = height;
    this._configure(device);
  }

  onResize(cb: (w: number, h: number) => void): void {
    new ResizeObserver(entries => {
      const e = entries[0];
      const w = Math.round(e.contentRect.width  * devicePixelRatio);
      const h = Math.round(e.contentRect.height * devicePixelRatio);
      cb(w, h);
    }).observe(/* canvas */);
  }

  private _configure(device: GPUDevice): void {
    this._context.configure({
      device,
      format: navigator.gpu.getPreferredCanvasFormat(),
    });
  }
}
```

### `SurfaceResources`

持有单个 Surface 的尺寸相关 RT，由 `engine.addSurface()` 内部创建，外部不直接构造。

```typescript
// src/core/SurfaceResources.ts
export class SurfaceResources {
  private _device: GPUDevice;
  private _textures = new Map<string, GPUTexture>();
  private _views    = new Map<string, GPUTextureView>();
  private _factories = new Map<string, (w: number, h: number) => GPUTextureDescriptor>();

  constructor(device: GPUDevice, width: number, height: number) { ... }

  registerTexture(name: string, factory: (w: number, h: number) => GPUTextureDescriptor): void {
    this._factories.set(name, factory);
    // 立即创建初始纹理
  }

  getView(name: string): GPUTextureView {
    if (!this._views.has(name)) {
      this._views.set(name, this._textures.get(name)!.createView());
    }
    return this._views.get(name)!;
  }

  onSurfaceChanged(width: number, height: number): void {
    for (const [name, factory] of this._factories) {
      this._textures.get(name)?.destroy();
      this._textures.set(name, this._device.createTexture(factory(width, height)));
      this._views.delete(name);   // 使旧 View 缓存失效，下一帧懒重建
    }
  }

  destroy(): void { ... }
}
```

---

## 四、修改类

### `WebGPUEngine`

**删除：** `_sceneColorView`、`_depthView`、`_resources` 字段，内部 `GraphBuilder.build()` 调用

**新增：** `_surfaces` pair 列表，`addSurface()` 方法，内部创建 SurfaceResources

```typescript
export class WebGPUEngine {
  private _device: GPUDevice;
  private _graph?: RenderGraph;
  private _resources: ResourceManager;
  private _surfaces: Array<{ surface: ISurface; surfaceRes: SurfaceResources }> = [];

  constructor(device: GPUDevice) {
    this._device    = device;
    this._resources = new ResourceManager(device);
  }

  get device()    { return this._device; }
  get resources() { return this._resources; }
  get surfaceDescriptor(): SurfaceDescriptor {
    // 供 GraphBuilder 读取当前 surface 的 format/size/sampleCount
    const { surface } = this._surfaces[0];
    return {
      width:       surface.width,
      height:      surface.height,
      colorFormat: navigator.gpu.getPreferredCanvasFormat(),
      depthFormat: 'depth32float',
      sampleCount: 1,
    };
  }

  addSurface(surface: ISurface): SurfaceResources {
    const surfaceRes = new SurfaceResources(this._device, surface.width, surface.height);
    this._surfaces.push({ surface, surfaceRes });

    surface.onResize((w, h) => {
      (surface as CanvasSurfaceManager).reconfigure(this._device, w, h);
      surfaceRes.onSurfaceChanged(w, h);
    });

    return surfaceRes;
  }

  setGraph(graph: RenderGraph): void {
    this._graph = graph;
  }

  start(): void { ... }

  private _tick(timestamp: number): void {
    const { surface, surfaceRes } = this._surfaces[0];
    const ctx: FrameContext = {
      frameIndex: ...,
      dt:         ...,
      totalTime:  ...,
      device:     this._device,
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

### `ResourceManager`

移除 `onSurfaceChanged()`、surface 纹理注册逻辑（迁移至 `SurfaceResources`）。只保留共享资源管理：createBuffer / getBuffer / createTexture / getTexture / destroy。

### `types.ts` — `FrameContext`

新增 `resources` 字段，Node 可按需查询共享资源（terrain buffer 等），不再需要在 build 时注入：

```typescript
export interface FrameContext {
  frameIndex: number;
  dt: number;
  totalTime: number;
  device: GPUDevice;
  targetView: GPUTextureView;
  sceneColorView: GPUTextureView;
  depthView: GPUTextureView;
  resources: ResourceManager;        // ← 新增
}
```

新增 `SurfaceDescriptor` 类型，供 GraphBuilder 使用，与 DOM 解耦：

```typescript
export interface SurfaceDescriptor {
  width: number;
  height: number;
  colorFormat: GPUTextureFormat;
  depthFormat: GPUTextureFormat;
  sampleCount: number;
}
```

### `GraphBuilder`

签名从 `build(device, canvas, resources, pipelines)` 改为 `build(engine)`：

```typescript
static build(engine: WebGPUEngine): void {
  const { device, resources } = engine;
  const desc     = engine.surfaceDescriptor;
  const surfaceRes = engine.getSurfaceResources(0); // 取第一个 surface 的 RT

  // 注册 surface-dependent 纹理
  surfaceRes.registerTexture('scene.color', (w, h) => ({
    size: [w, h], format: desc.colorFormat,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  }));
  surfaceRes.registerTexture('scene.depth', (w, h) => ({
    size: [w, h], format: desc.depthFormat,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  }));

  // ... 创建 entities、nodes、graph，最后
  engine.setGraph(graph);
}
```

---

## 五、`main.ts` 最终形态

```typescript
async function main() {
  const canvas  = document.getElementById('webgpu-canvas') as HTMLCanvasElement;
  const device  = await initWebGPU();           // adapter + device + device.lost
  const surface = new CanvasSurfaceManager(canvas, device);
  const engine  = new WebGPUEngine(device);
  engine.addSurface(surface);                   // 内部创建 SurfaceResources，绑定 resize
  GraphBuilder.build(engine);                   // 场景组装，注入 graph
  engine.start();
}
```

---

## 六、帧数据流（重构后）

```
CanvasSurfaceManager.getTargetView()         → FrameContext.targetView
SurfaceResources.getView('scene.color')      → FrameContext.sceneColorView
SurfaceResources.getView('scene.depth')      → FrameContext.depthView
ResourceManager                              → FrameContext.resources（按需查询）
```

Resize 路径：

```
ResizeObserver (CanvasSurfaceManager)
  → CanvasSurfaceManager.reconfigure(device, w, h)   # 重配 context
  → SurfaceResources.onSurfaceChanged(w, h)           # 销毁旧 RT，重建
  → 下一帧自动拿到新 View（懒重建）
```

---

## 七、新增 / 修改文件汇总

| 操作 | 路径 | 说明 |
|------|------|------|
| 新增 | `src/core/ISurface.ts` | Surface 接口 |
| 新增 | `src/core/CanvasSurfaceManager.ts` | ISurface 的 canvas 实现，含 DPR + resize |
| 新增 | `src/core/SurfaceResources.ts` | 单 Surface 的 RT 管理 |
| 新增 | `src/core/initWebGPU.ts` | adapter/device 初始化工具函数 |
| 修改 | `src/core/WebGPUEngine.ts` | 删除 View 缓存字段，接收 ISurface 注入，addSurface() |
| 修改 | `src/core/ResourceManager.ts` | 移除 surface 相关逻辑，保留共享资源管理 |
| 修改 | `src/core/types.ts` | FrameContext 加 resources，新增 SurfaceDescriptor |
| 修改 | `src/graph/GraphBuilder.ts` | 签名改为 build(engine)，注册 surface 纹理 |
| 修改 | `src/main.ts` | 纯组合根，7 行 |

---

## 八、OffScreen 扩展路径

未来需要 OffScreen 渲染时，只需实现 `ISurface`：

```typescript
class OffscreenSurfaceManager implements ISurface {
  private _texture: GPUTexture;
  getTargetView() { return this._texture.createView(); }
  onResize(_cb: any) { /* no-op */ }
}
```

`engine.addSurface(offscreenSurface)` 即可，Engine 和 GraphBuilder 无需任何修改。
