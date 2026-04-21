# WebGPU PlanetLab 架构笔记

记录关键的架构决策、职责划分依据，以及重构过程中得出的结论。

---

## 一、WebGPUEngine 重构结论（2026-04-21）

### 重构前的问题

原始 `WebGPUEngine` 存在两个结构性问题：

**1. 双重资源所有权**

`_sceneColorView` 和 `_depthView` 字段直接缓存在 Engine 里，而底层 `GPUTexture` 由 `ResourceManager` 持有。两者都对同一份资源有"半个所有权"：

- Resize 时必须同时更新 Engine 的 View 缓存和 ResourceManager 的 Texture，两处必须同步，极易遗漏
- Node 想读 `scene.color` 必须通过 `resources.getTexture()` 重新创建 View，或者依赖 Engine 内部字段——无论哪种方式都是耦合

**2. 场景组装耦合**

Engine 内部调用 `GraphBuilder.build()`，意味着 Engine 同时负责：
- GPU 基础设施（device、资源、帧循环）
- "渲染什么"（创建 Entity、Node、挂载 Graph）

这两件事的变化频率完全不同，混在一起导致无法独立测试或复用 Engine。

---

### 重构后的职责划分

| 类 | 职责 | 不负责 |
|---|---|---|
| `initWebGPU()` | adapter → device，`powerPreference`，`device.lost` | 一切与 canvas 相关的事情 |
| `CanvasSurfaceManager` | canvas 尺寸（DPR）、GPUCanvasContext 配置、ResizeObserver | GPU 资源的生命周期 |
| `WebGPUEngine` | device 持有、Surface 注册、帧循环驱动 | 知道场景里有什么、知道 canvas 的存在 |
| `SurfaceResources` | 单个 Surface 的附属 RT（scene.color、scene.depth） | 共享资源（terrain buffer 等） |
| `ResourceManager` | 共享 GPU 资源（terrain buffer、noise buffer、pipeline 等） | surface 尺寸感知 |
| `PipelineManager` | 渲染/计算管线的创建与缓存 | 资源数据 |
| `GraphBuilder` | 场景组装（Entity、Node、Graph） | 帧循环、GPU 基础设施 |
| `main.ts` | 纯组合根：按顺序创建并连接上述对象 | 任何业务逻辑 |

---

### 为什么要抽出 CanvasSurfaceManager

`WebGPUEngine` 不应该知道"有一个 HTMLCanvasElement"。原因：

1. **OffScreen 渲染**：未来 WebWorker 或多窗口场景里，渲染目标是一个 `OffscreenCanvas` 甚至纯 GPU Texture，而不是 DOM 节点。如果 Engine 硬编码依赖 canvas，就无法复用。

2. **DPR 和 ResizeObserver 是 DOM 概念**：`devicePixelRatio`、`ResizeObserver`、`canvas.clientWidth` 都属于浏览器 layout 层。把它们包在 `CanvasSurfaceManager` 里，Engine 和 Node 永远不会看到这些 API。

3. **接口替换**：只要实现 `ISurface`（三个方法：`width`、`height`、`getTargetView()`、`onResize()`），任何渲染目标都可以注入 Engine，不改一行 Engine 代码。

```
// OffScreen 只需实现这个接口
class OffscreenSurfaceManager implements ISurface {
  getTargetView() { return this._texture.createView(); }
  onResize(_cb: any) { /* no-op */ }
}
```

---

### 为什么要抽出 SurfaceResources

原本 `scene.color` 和 `scene.depth` 纹理在 `ResourceManager` 里，但它们的尺寸与 Surface 绑定——canvas 变大时它们必须重建，而 `terrain.height` 这类 buffer 和尺寸无关，不需要重建。

把 surface 相关的 RT 单独放进 `SurfaceResources`，可以：

1. **Resize 路径清晰**：`SurfaceResources.onSurfaceChanged()` 只销毁重建 surface RT，不会误触 terrain buffer
2. **多 Surface 隔离**：每个 Surface 有自己的 `SurfaceResources` 实例，共享资源仍在全局 `ResourceManager`
3. **View 懒重建**：旧 `GPUTextureView` 在纹理销毁后自动失效；`SurfaceResources.getView()` 在 View 缓存失效后下一次调用时重新创建，Engine 不需要感知这个细节

---

### Resize 数据流

```
ResizeObserver（CanvasSurfaceManager）
  → CanvasSurfaceManager.reconfigure(device, w, h)   # 更新 canvas 尺寸、重配 context
  → SurfaceResources.onSurfaceChanged(w, h)           # 销毁旧 RT，按新尺寸重建
  → 触发 onChanged() 回调
      → AtmosphereNode._rebuildBindGroup()            # 重新绑定新的 scene.color/depth View
  → 下一帧 Engine._tick() 自动拿到新 targetView 和新 sceneColorView
```

AtmosphereNode 在 `build()` 时通过 `surfaceRes.onChanged()` 订阅回调，resize 发生时自动重建 BindGroup。这比"每帧检查尺寸是否变化"更高效，也比"Engine 通知每个 Node"更低耦合。

---

### main.ts 作为组合根

重构后 `main.ts` 只有 7 行实质内容，**不含任何业务逻辑**：

```typescript
const canvas  = document.getElementById('webgpu-canvas') as HTMLCanvasElement;
const device  = await initWebGPU();
const surface = new CanvasSurfaceManager(canvas, device);
const engine  = new WebGPUEngine(device);
engine.addSurface(surface);
GraphBuilder.build(engine, canvas);
engine.start();
```

组合根模式的好处：每个类都不知道其他类的存在（只知道接口），`main.ts` 是唯一知道全局拓扑的地方。要替换任何一个组件（换一个 SurfaceManager 实现、换一个 GraphBuilder），只改 `main.ts`，其他代码不动。

---

### targetFormat 与 colorFormat 的区别

两个格式字段容易混淆：

| 字段 | 值 | 用于 |
|---|---|---|
| `colorFormat` | `rgba8unorm` | scene RT（中间渲染目标），PlanetRenderNode 输出到这里 |
| `targetFormat` | `bgra8unorm`（或平台首选格式） | canvas swapchain，AtmosphereNode 最终合成后输出到这里 |

AtmosphereNode 的 fragment pipeline target 必须用 `targetFormat`，而不是 `colorFormat`。两者格式不同（主要差异是 byte order），用错会导致 WebGPU 验证失败，canvas 显示黑屏。

---

## 二、渲染管线三阶段设计

详见 [render-pipeline-design.md](render-pipeline-design.md)。

核心原则：每个 Node 只负责一个 pass，通过有名字的 GPU 资源（`terrain.height`、`scene.color` 等）传递数据，Node 之间不直接引用彼此。

---

## 三、ECS + Render Graph 分层

```
ECS（Scene / Entity / Component）  ← 数据层，纯 CPU
Render Graph（IGraphNode）          ← 渲染 System，读 ECS 数据，写 GPU 资源
Core（Engine / ResourceManager）    ← GPU 基础设施，无业务语义
```

Node 是 ECS System 和 Render Pass 的结合体：`update()` 读 Component 数据写 Uniform，`recordPass()` 录制 GPU 命令。两段职责分开，方便单独测试 CPU 侧逻辑。
