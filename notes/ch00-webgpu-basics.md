# WebGPU 核心概念

这一章解释项目里反复出现的 WebGPU 术语。不需要提前知道图形学，只需要理解"显卡是一个独立的计算设备，有自己的内存和执行模型"。

## 为什么不用 WebGL

WebGL 是上一代浏览器图形 API，基于 OpenGL ES 2.0 设计（2011年）。WebGPU 是 2023 年正式落地的继任者，主要差异：

- **显式控制**：WebGL 隐藏了大量状态机细节，容易出现驱动行为不一致的问题。WebGPU 的资源绑定、管线状态、内存布局都需要显式声明，换来的是可预测的行为和更好的性能。
- **计算着色器**：WebGL 没有 Compute Shader。本项目的地形生成完全依赖 Compute Shader，在 WebGL 里不可能直接实现。
- **现代 GPU 模型**：WebGPU 的设计更接近 Vulkan/Metal/D3D12，理解 WebGPU 等于理解现代 GPU 编程模型。

## 初始化：Adapter → Device

```typescript
const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
const device  = await adapter.requestDevice();
```

- **Adapter**：代表一块物理 GPU（或软件模拟实现）。`requestAdapter` 是询问"系统上有没有可用的 GPU"。
- **Device**（`GPUDevice`）：从 Adapter 上创建的逻辑设备，是后续所有操作的根对象。可以理解为"和这块 GPU 的一个连接会话"。

`device.lost` 是一个 Promise，在 GPU 设备丢失时（驱动崩溃、设备断开）触发。`WebGPUEngine` 在构造时监听它并打印错误。

## GPU 资源：Buffer 与 Texture

GPU 有独立的显存（VRAM），CPU 不能直接读写。所有数据必须先上传到 GPU 内存中的对象里。

**GPUBuffer** — 线性字节数组，用于：
- 顶点数据（vertex buffer）
- 着色器参数（uniform buffer）
- 计算着色器的输入/输出（storage buffer）

创建时必须声明 `usage`，告诉驱动这块内存会怎么用：

```typescript
device.createBuffer({
  size: 1024,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
});
```

**GPUTexture** — 有格式（如 `rgba8unorm`、`depth32float`）和维度的图像数据，用于渲染目标、深度缓冲、纹理采样。

## 着色器与管线

**着色器**（Shader）是运行在 GPU 上的程序，用 WGSL（WebGPU Shading Language）编写。本项目里有三类：

| 类型 | 作用 | 文件 |
|---|---|---|
| Compute Shader | 并行数值计算，不涉及图形输出 | `noise_gen.wgsl`, `terrain_classify.wgsl` |
| Vertex Shader | 计算每个顶点的屏幕位置 | `planet.wgsl` 的 `vs_main` |
| Fragment Shader | 计算每个像素的颜色 | `atmosphere.wgsl` 的 `fs_main` |

**管线**（`GPURenderPipeline` / `GPUComputePipeline`）是着色器 + 固定状态（混合模式、深度测试、顶点布局等）的组合，创建代价较高，所以由 `PipelineManager` 缓存。

## 资源绑定：BindGroup

着色器需要访问 Buffer 和 Texture，但不能直接引用 TypeScript 对象。绑定是通过 **BindGroup** 声明的：

```typescript
device.createBindGroup({
  layout: bindGroupLayout,
  entries: [
    { binding: 0, resource: { buffer: noiseParamsBuffer } },
    { binding: 1, resource: { buffer: heightBuffer } },
  ],
});
```

着色器代码里用 `@binding(0)`、`@binding(1)` 对应访问。`BindGroupLayout` 是对绑定结构的声明（"位置 0 是一个 uniform buffer"），必须与管线的 layout 匹配，WebGPU 在管线创建时验证。

## 命令录制与提交

WebGPU 不允许直接执行命令，必须先"录制"再"提交"：

```typescript
const encoder = device.createCommandEncoder();
// 录制若干 pass...
device.queue.submit([encoder.finish()]);
```

`GPUCommandEncoder` 是一个命令录制器，`queue.submit()` 把录制好的命令批量发给 GPU 执行。这套设计让驱动可以对命令做整体优化，也让多线程录制成为可能。

**Render Pass** vs **Compute Pass**：

- `encoder.beginRenderPass()` — 开始一个光栅化 pass，有颜色/深度附件（Attachment），输出像素。
- `encoder.beginComputePass()` — 开始一个计算 pass，只有 Buffer/Texture 输入输出，无光栅化。

每个 pass 必须调用 `.end()` 关闭，然后才能开始下一个 pass。

## Queue 与帧循环

`device.queue` 是 GPU 的任务队列。`writeBuffer()` 用于 CPU→GPU 的数据上传（每帧更新 Uniform）：

```typescript
device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([...]));
```

帧循环由浏览器的 `requestAnimationFrame` 驱动，每帧 `WebGPUEngine._tick()` 被调用一次，构造 `FrameContext`，然后触发 RenderGraph 的 `update()` 和 `execute()`。
