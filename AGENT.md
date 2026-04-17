# WebGPULab AGENT.md

## 项目目标
构建一个基于 WebGPU + GitHub Pages 的现代渲染技术展示项目，主方向为 DSP（戴森球计划）风格的程序化星球。支持多种星球类型（草原/海洋风格、冰封星球、气态星球等），并逐步添加工业元素（如地基铺设、工厂网格）。最终形成一个完整、可交互、可拓展的 WebGPU 渲染 Demo。

核心要求：
- 高度可拓展性（后续轻松添加新星球类型、新渲染效果）
- 浏览器端高性能（最小化 JS GC 压力，充分利用 WebGPU）
- 代码结构清晰、模块化，便于维护和逐步迭代

## 采用的架构
**Modern Render Graph（显式帧图）架构**

这是当前浏览器 WebGPU 下性能与可拓展性的最优方案。核心理念是：
- 一帧 = 一个显式有向无环图（DAG）
- 所有渲染/计算逻辑都封装为独立的 **Graph Node**
- 每帧通过一次性 CommandEncoder 录制所有 Pass，避免 JS 侧频繁对象创建和全局状态

与传统 API 差异：
- 避免 OpenGL/WebGL 的状态机问题
- 避免 Unity URP 的隐式 Feature 顺序依赖和历史包袱
- 充分利用 WebGPU Pipeline 不可变、Bind Group 显式、资源自动 barrier 的设计哲学

## 文件夹结构（必须严格遵循）

```
webgpulab/
├── index.html
├── style.css
├── vite.config.ts
├── package.json
├── tsconfig.json
├── main.ts                          ← 项目入口
│
├── src/
│   ├── core/                        ← 引擎核心框架（尽量保持稳定）
│   │   ├── WebGPUEngine.ts          ← Device、Queue、CanvasContext、帧循环
│   │   ├── RenderGraph.ts           ← Render Graph 核心：节点管理、依赖构建、Pass 录制
│   │   ├── ResourceManager.ts       ← 统一管理所有 Buffer、Texture
│   │   ├── PipelineManager.ts       ← 缓存所有 RenderPipeline 和 ComputePipeline
│   │   └── types.ts                 ← 全局类型定义
│   │
│   ├── graph/                       ← ★ 所有可拓展功能的核心区域
│   │   ├── nodes/                   ← 每个 Node 一个文件
│   │   │   ├── BaseNode.ts          ← 所有 Node 的抽象基类
│   │   │   ├── ComputeNoiseNode.ts
│   │   │   ├── PlanetRenderNode.ts  ← 当前重点：PBR 球体渲染
│   │   │   ├── AtmosphereNode.ts
│   │   │   ├── SSAONode.ts
│   │   │   ├── IndustrialOverlayNode.ts
│   │   │   ├── IceBiomeNode.ts
│   │   │   └── GasPlanetNode.ts
│   │   │
│   │   ├── GraphBuilder.ts          ← 定义默认 Graph，注册并排序所有 Node
│   │   └── GraphDebugUI.ts          ← 调试面板（显示 Node 顺序、GPU 时间等）
│   │
│   ├── shaders/                     ← 所有 WGSL Shader（模块化复用）
│   │   ├── pbr_common.wgsl
│   │   ├── planet_vertex.wgsl
│   │   ├── planet_fragment.wgsl
│   │   ├── compute_noise.wgsl
│   │   ├── atmosphere.wgsl
│   │   └── ssao.wgsl
│   │
│   ├── resources/                   ← 静态资源和配置
│   │   ├── textures/                ← IBL cubemap 等
│   │   └── presets/                 ← 不同星球类型的 JSON 参数（DSP prairie / ice / gas 等）
│   │
│   └── utils/                       ← 相机、输入控制等工具
│
├── dist/                            ← Vite 打包输出（GitHub Pages 使用）
└── README.md
```

## 各模块职责（简要）

- **core/**：WebGPU 初始化、Render Graph 执行引擎、资源与 Pipeline 管理。**原则上只修改 bug，不随意新增逻辑**。
- **graph/nodes/**：项目所有功能都在这里。每个新效果（大气、SSAO、工业地基、新星球类型）都新增一个 Node 文件。
- **GraphBuilder.ts**：负责把所有 Node 按正确依赖顺序组装成 Graph。
- **shaders/**：存放 WGSL 代码，强调模块化（pbr_common.wgsl 被多个 Node 复用）。
- **resources/presets/**：存放不同星球的配置参数，便于快速切换 DSP 风格、冰封、气态等。

## 开发原则

1. **Node 设计规范**
   - 每个 Node 继承 `BaseNode`
   - 必须实现 `build(graph)`（声明输入输出资源）
   - 必须实现 `recordPass(encoder)`（录制 Compute/Render Pass）
   - 可选实现 `update(dt)`（每帧逻辑更新）

2. **性能优先**
   - 每帧尽量减少 JS 对象分配
   - Pipeline 必须通过 PipelineManager 提前创建并缓存
   - 资源通过 ResourceManager 统一管理，避免重复创建

3. **可拓展性优先**
   - 新增功能时，只需在 `graph/nodes/` 新建 Node，并在 `GraphBuilder.ts` 中注册
   - 不要修改已有 Node 的核心逻辑，除非必要

4. **当前开发阶段**
   - 第一阶段目标：实现一个带 PBR 材质 + IBL + 简单光照 + 可旋转的基本球体（仅使用 `PlanetRenderNode`）
   - 后续阶段将逐步插入 `ComputeNoiseNode`、`AtmosphereNode` 等，逐步实现完整 DSP 风格程序化星球

5. **调试支持**
   - 使用 `GraphDebugUI.ts` 显示当前 Node 顺序和 Pass 执行时间
   - 不需要实现可视化拖拽节点编辑器，仅提供列表式顺序调整和时间显示

## 与用户交互规则
- 所有实现细节（具体 WGSL 写法、Buffer 布局、Node 内部逻辑等）在实际开发时与用户商定
- 每次推进前，先确认当前阶段目标，再给出具体代码或修改建议
- 严格保持文件夹结构和架构原则

当前首要任务：基于 Render Graph 架构，先实现可运行的 PBR 球体（PlanetRenderNode）。

后续将按计划逐步添加 Compute 噪声生成、大气散射、SSAO、工业元素及多星球支持。