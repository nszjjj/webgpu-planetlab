# Render Graph 与 Node 设计

## 从一个混乱的帧循环开始

假设我们不做任何架构设计，直接在帧循环里按顺序写渲染代码：

```typescript
function render() {
  computeNoise();
  renderPlanet();
  renderAtmosphere();
}
```

这在逻辑简单时能跑起来。但很快就会遇到麻烦：每个函数内部既有"初始化一次"的代码（创建 Buffer、Pipeline），又有"每帧更新"的代码（写 Uniform），还有"录制 GPU 命令"的代码。这三类逻辑的生命周期完全不同，混在一起之后：

- 想单独测试大气渲染，必须先跑完地形生成
- 想调整某个 pass 的参数，得在一堆初始化代码里翻找
- 两个 pass 共用一个 Buffer，找不到谁创建、谁消费

**Render Graph** 是解决这个问题的常见方案：把每个渲染功能封装成独立的 **Node**，由 Graph 统一驱动顺序和生命周期。

## Node 不是一个 Pass，而是一个渲染 Feature

刚接触 Render Graph 时，容易把 Node 理解成"一个 render pass"。实际上，Node 对应的是一个**渲染功能（Feature）**——它内部可以包含任意数量的 pass。

`ComputeNoiseNode` 是一个现成的例子。地形生成需要两步：先用噪声函数算出高度图，再按高度分类地形（水、沙、草、岩石）。这两步在 `recordPass()` 里是两个独立的 compute pass，但对外它们属于同一个 Node：

```typescript
// ComputeNoiseNode.recordPass() 内部
// Pass A：生成高度图
const passA = encoder.beginComputePass();
passA.setPipeline(this._noiseGenPipeline);
passA.setBindGroup(0, this._noiseBindGroup);
passA.dispatchWorkgroups(WG, WG);
passA.end();

// Pass B：地形分类（读取 Pass A 写入的 heightBuffer）
// 根据 WebGPU spec §10.3，结束一个 compute pass 再开新的，自动建立 storage buffer 屏障
const passB = encoder.beginComputePass();
passB.setPipeline(this._classifyPipeline);
passB.setBindGroup(0, this._classifyBindGroup);
passB.dispatchWorkgroups(WG, WG);
passB.end();
```

这种设计的好处是：**pass 内部的顺序由 Node 自己保证，Graph 只需要关心 Node 之间的顺序**。如果未来要实现 SSAO（通常需要三个 pass：几何、遮蔽计算、模糊），只需要建一个 `SSAONode`，Graph 不需要了解它内部有几步。

## Node 的三个方法：build、update、recordPass

Node 对应三件不同的事：**初始化**、**每帧更新 CPU 数据**、**录制 GPU 命令**。`BaseNode` 提供默认的空实现，子类按需 override：

```typescript
abstract class BaseNode {
  build(ctx: BuildContext): void {}      // 初始化，只跑一次
  update(ctx: FrameContext): void {}     // 每帧 CPU 侧更新
  recordPass(encoder, ctx): void {}      // 每帧录制 GPU 命令
}
```

下面依次看这三个方法在做什么。

### build：一次性把 GPU 资源备好

`build()` 在场景启动时调用一次。它的工作是创建所有"一次性"的 GPU 对象——Buffer、Pipeline、BindGroup。这些对象要么创建代价高，要么创建后不可修改，所以统一在这里做，帧循环里不再碰。

一个 Node 在 `build()` 里通常做这几件事：

```
1. 加载 shader → 创建 ShaderModule
2. 通过 PipelineManager 创建并缓存 Pipeline
3. 创建自己需要的 Buffer（通过 ResourceManager）
4. 取出其他 Node 写入的 Buffer（通过 ResourceManager）
5. 用以上资源组装 BindGroup
```

**Shader 从哪来？** WGSL 文件通过 Vite 的 `?raw` 后缀以字符串形式导入，每个 Node 各自 import 自己需要的文件：

```typescript
// AtmosphereNode.ts
import atmosphereSrc from '../../shaders/atmosphere.wgsl?raw';

// ComputeNoiseNode.ts（一个 Node 可以 import 多个 shader）
import noiseGenSrc from '../../shaders/noise_gen.wgsl?raw';
import classifySrc from '../../shaders/terrain_classify.wgsl?raw';
```

在 `build()` 里编译成 `GPUShaderModule`：

```typescript
const shaderModule = device.createShaderModule({ code: atmosphereSrc });
```

`ShaderModule` 只是个本地变量——pipeline 创建好后就不再需要它了（GPU driver 已经编译完毕）。

**Pipeline 怎么管理？** 通过 `BuildContext.pipelines`（`PipelineManager` 实例），按字符串 key 创建和缓存：

```typescript
this._pipeline = this._pipelines.createRenderPipeline('atmosphere', {
  layout: ...,
  vertex:   { module: shaderModule, entryPoint: 'vs_main' },
  fragment: { module: shaderModule, entryPoint: 'fs_main', targets: [...] },
});
```

如果同名 pipeline 已存在，`PipelineManager` 直接返回缓存，不重复创建。Pipeline 对象在 `PipelineManager` 里跟随 engine 全局存活。

### Node 之间怎么传数据：ResourceManager

`build()` 里有一个问题还没解决：**Node A 创建了一个 Buffer，Node B 怎么拿到它？**

Node 之间不能直接互相引用实例——那样就把两个本该独立的功能耦合在一起了。取而代之的是 `ResourceManager`：Node 把自己产出的 Buffer/Texture 按字符串 key 注册进去，其他 Node 按 key 取出来。

生产方（`ComputeNoiseNode.build()`）：

```typescript
const heightBuffer = this._resources.createBuffer('terrain.height', {
  size: BUFFER_SIZE,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
});
// Buffer 注册到 ResourceManager，其他 Node 可以按名字取
```

消费方（`PlanetRenderNode.build()`）：

```typescript
const heightBuffer = this._resources.getBuffer('terrain.height');
if (!heightBuffer) throw new Error('ComputeNoiseNode.build() 必须先跑');
// 拿到后塞进自己的 BindGroup
```

这样两个 Node 之间只有一个字符串约定，没有代码层面的依赖。

**生命周期**：`ResourceManager` 里所有资源都跟随 engine 存活，在 `destroy()` 时统一释放。这意味着就算只有少数几个 Node 用某个 Buffer，它也不会提前释放。对于这个项目来说这完全可以接受——GPU 资源数量有限，简单比精确更重要。如果未来需要动态卸载 Node，再引入引用计数不迟。

有一点值得注意：**只被单个 Node 使用的资源不需要放进 ResourceManager**。比如 `AtmosphereNode` 的 Uniform Buffer 只有它自己读写，直接作为私有成员持有就好，`ResourceManager` 只用于需要跨 Node 共享的资源。

### update：每帧把 CPU 状态推给 GPU

GPU 的 shader 读的是 Uniform Buffer 里的数据，而相机位置、太阳方向、时间这些值每帧都在变。`update()` 的工作就是**从 ECS 读取当前帧的 CPU 状态，打包进 `Float32Array`，通过 `writeBuffer` 上传到 GPU**：

```typescript
// AtmosphereNode.update()（简化）
const camPos = scene.mainCamera.transform.position;
const vp = cam.getVPMatrix(camPos);
mat4.inverse(vp, this._invVPOut);     // 计算 invViewProj，写入预分配的 buffer

data[0] = sunDir[0]; data[1] = sunDir[1]; data[2] = sunDir[2];
data[8] = camPos[0]; data[9] = camPos[1]; data[10] = camPos[2];
data.set(this._invVPOut, 20);

ctx.device.queue.writeBuffer(this._uniformBuffer, 0, data);
```

`this._uniformData` 和 `this._invVPOut` 都是构造时预分配的成员变量，每帧复用，不在帧循环里 `new Float32Array()`，避免 GC 压力。

`update()` 只做数据上传，**不录制任何 GPU 命令**。把这两件事分开，是因为它们的失败方式不同：数据算错了是逻辑 bug，体现为画面异常；命令录制出错会触发 WebGPU 的验证层报错，体现为 GPU 错误。拆开后两类问题不会互相干扰，更容易定位。

### recordPass：录制 GPU 命令，最后统一提交

所有 Node 的 `update()` 完成后，Graph 开始录制 GPU 命令。所有 Node 共用同一个 `GPUCommandEncoder`，最后统一 `submit()`：

```typescript
// RenderGraph.execute()
const encoder = ctx.device.createCommandEncoder();
for (const node of this._nodes) {
  node.recordPass(encoder, ctx);  // 每个 Node 录制自己的 pass
}
ctx.device.queue.submit([encoder.finish()]);  // 一次性提交
```

批量提交比多次 `submit()` 效率更高，GPU driver 也有机会对整批命令做整体优化。

每个 Node 在 `recordPass()` 里调用 `encoder.beginRenderPass` 或 `beginComputePass`，录制完调用 `pass.end()` 结束——之后这段命令就"冻结"在 encoder 里，等待最后的 `submit()`。

## 全局执行顺序与依赖关系

现在把三个 Node 放在一起看：

```
ComputeNoiseNode  →  PlanetRenderNode  →  AtmosphereNode
  (地形生成)           (星球表面)           (大气合成)
```

每一步的输入都依赖上一步的输出：

| Node | 消费 | 产出 |
|---|---|---|
| `ComputeNoiseNode` | 无 | `terrain.height`、`terrain.splat`（Buffer） |
| `PlanetRenderNode` | `terrain.height`、`terrain.splat` | `scene.color`、`scene.depth`（Render Target） |
| `AtmosphereNode` | `scene.color`、`scene.depth` | canvas swapchain（最终输出） |

Buffer 通过 `ResourceManager` 按名字传递；Render Target 纹理则由 `SurfaceResources` 管理，以 View 的形式暴露在 `FrameContext`（`sceneColorView`、`depthView`）里。

只要一个 Node 的输入输出资源名不变，就可以独立替换它的实现，其他 Node 完全不受影响。

## 附：BuildContext 与 FrameContext

两个 context 分别携带"只在初始化时需要"和"每帧都需要"的信息：

**`BuildContext`**（`build()` 阶段）

```typescript
{ device, resources, surfaceRes, surfaceDesc, pipelines, scene }
```

有 `pipelines`（创建 pipeline）、`surfaceRes`（注册 RT 纹理、订阅 resize）、`surfaceDesc`（格式和尺寸描述符，避免硬编码）、`scene`（查询 Entity）。

**`FrameContext`**（`update()` + `recordPass()` 阶段）

```typescript
{ frameIndex, dt, totalTime, device, targetView, sceneColorView, depthView, resources }
```

有时间信息和当前帧的渲染目标 View。`targetView` 每帧都是新对象，由 `CanvasSurfaceManager` 从 canvas context 取出——WebGPU 的 swapchain 工作方式就是这样，每帧你必须主动去取当前帧的纹理，渲染完后自动 present。

注意 `FrameContext` 没有 `pipelines`——帧循环里不应该创建新的 pipeline。
