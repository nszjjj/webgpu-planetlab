# Intro

这是一个基于 WebGPU 的星球渲染器，在浏览器中实时渲染一颗带地形、大气层和光照的球形星球。项目目标是在真实浏览器环境中验证几个现代图形技术的落地方式：GPU 计算生成地形、物理大气散射、以及基于 Render Graph 的渲染管线组织。

整体的实现架构可以在 [architecture-notes](../docs/architecture-notes.md) 中看到。代码文件的推荐阅读顺序是：

1. `src/main.ts` — 组合根，7 行把所有模块连接起来，是理解整体拓扑的起点
2. `src/core/initWebGPU.ts` — 初始化 WebGPU device（适配器协商、能力检测）
3. `src/core/ISurface.ts` — 理解"渲染目标"抽象的核心接口，`CanvasSurfaceManager` 是其 canvas 实现
4. `src/core/WebGPUEngine.ts` + `src/core/ResourceManager.ts` — Engine 驱动帧循环，每帧构造一个 `FrameContext` 并显式传入 RenderGraph；ResourceManager 管理跨帧共享的 GPU 资源（buffer、pipeline 等）
5. `src/ecs/` — Entity/Component/Scene 数据层，纯 CPU，不含 GPU 逻辑
6. `src/graph/GraphBuilder.ts` — 场景组装：创建 Entity、注册 Render Targets、挂载 Nodes
7. `src/graph/nodes/ComputeNoiseNode.ts` → `PlanetRenderNode.ts` → `AtmosphereNode.ts` — 渲染管线的三个阶段，依次阅读

重点关注 `ISurface` 的设计目的（让 Engine 与 canvas DOM 解耦），以及 `ResourceManager` 与 `SurfaceResources` 的职责边界（共享资源 vs. 跟随 Surface 尺寸变化的资源）。这几处设计决策的来龙去脉在下一节展开。

# 核心设计解析

## ISurface：把 Engine 和 canvas 隔开

`ISurface` 只暴露三件事：当前宽高、`getTargetView()`、以及 resize 回调注册。Engine 帧循环里只调这个接口，不碰任何 canvas DOM API。这样 Engine 的测试或未来适配非 canvas 渲染目标（比如 offscreen）时，只需换一个 ISurface 实现，帧循环代码不动。

`CanvasSurfaceManager` 是目前唯一的实现，它把 canvas 的 `ResizeObserver` 和 WebGPU swap chain 的 `configure()` 封装在内部。

## SurfaceResources vs. ResourceManager：两种资源的生命周期不同

`ResourceManager` 管的是跨帧、跨 Surface 都不变的资源——顶点 buffer、计算管线、uniform buffer 等。它们只创建一次，随 Engine 存活。

`SurfaceResources` 管的是必须跟着 Surface 尺寸变化的资源——`scene.color`（离屏颜色纹理）和 `scene.depth`（深度纹理）。分辨率一变，这两张纹理就得重建。把它们单独放在 `SurfaceResources` 里，resize 时只需调 `onSurfaceChanged(w, h)`，不影响 ResourceManager 里的任何东西。

## Engine 为什么持有 Surface 相关方法

resize 时需要同时做两件事：

```
surface.reconfigure(device, w, h)   // canvas 侧：重新配置 swap chain
surfaceRes.onSurfaceChanged(w, h)   // GPU 侧：重建尺寸相关纹理
```

两件事都依赖 `device`，而 device 在 Engine 手里。Engine 是唯一同时持有 device、surface、surfaceRes 三者的地方，所以 resize 协调放在 Engine 的 `addSurface` 回调里最自然。如果把这个职责交给 `CanvasSurfaceManager`，它就得反向持有 device，职责边界反而更乱。

## FrameContext：帧级依赖的显式注入

每帧 `_tick` 构造一个 `FrameContext`，把这一帧所有 Node 可能需要的"外部事实"打包进去——时间、device、渲染目标视图、ResourceManager——然后作为参数传给 `graph.update()` 和 `graph.execute()`。

另一种做法是让每个 Node 自己去某个全局对象里取这些值。问题在于这样 Node 之间就有了隐式依赖：你不清楚哪个 Node 在什么时机读了什么，执行顺序一旦调整就可能出错，测试也变得困难。

`FrameContext` 是只读结构，Node 只能读不能改。哪个 Node 用了哪些字段，函数签名一目了然。Graph 本身因此保持无状态——它不存时间、不存 device，只描述节点拓扑和执行顺序。

# 用到的技术

渲染结果由三项核心技术支撑，各自对应一个 Render Graph Node，后续章节会分别详细展开。

## 球体坐标

星球是一个细分球（Sphere Mesh），顶点位置由 UV 坐标通过球面参数方程计算得出。同一套 UV 坐标也用于采样地形高度，将顶点沿法线方向凸起形成地形起伏。详见 **ch03**。

## 噪声与SplatMap

地形高度图由 GPU Compute Shader 在首帧并行生成（`ComputeNoiseNode`），通过多层 FBM 噪声叠加产生大陆、山脉、细节三个频率的起伏。高度图随后经过第二个 Compute Pass 分类为水/沙/草/岩石/矿石，结果存入 SplatMap 供渲染时着色。详见 **ch04**。

## 大气散射

大气效果通过全屏后处理 pass 实现（`AtmosphereNode`），基于 Rayleigh 和 Mie 散射的物理模型，对每个像素沿视线方向做 Ray Marching，模拟光线穿越大气层时的颜色变化。详见 **ch05**。

## 水蚀模拟（计划中）

在 `ComputeNoiseNode` 的噪声生成之后增加一个水蚀 Compute Pass，迭代模拟雨水冲刷地形的过程，让山脉侧面出现侵蚀沟壑、低地沉积堆积，使地形更自然。详见 **ch06**（待写）。

## SSAO（计划中）

屏幕空间环境光遮蔽（Screen Space Ambient Occlusion），在 `PlanetRenderNode` 和 `AtmosphereNode` 之间插入一个新 Node，读取 `scene.depth` 估算每个像素周围的遮蔽程度，让凹陷处（山谷、坑洞）变暗，增加立体感。详见 **ch07**（待写）。

## PBR 材质（计划中）

基于物理的渲染（Physically Based Rendering），将地形的光照模型从简单 Lambertian 漫反射升级为 Cook-Torrance BRDF，参数化每种地形类型的粗糙度和金属度，使岩石、水面等材质表现出符合物理规律的高光响应。详见 **ch08**（待写）。

## 程序化内容生成（计划中）

在现有噪声地形基础上，通过规则驱动的方式生成更丰富的星球特征：火山口、极地冰盖、生物群系分布等。PCG 逻辑作为独立的 Compute Pass 接入 Graph，产出额外的 SplatMap 通道供渲染节点使用。详见 **ch09**（待写）。
