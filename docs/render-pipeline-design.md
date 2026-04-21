# WebGPU PlanetLab 渲染管线设计

## 整体架构

```
main.ts
  └─ WebGPUEngine.init()
       └─ GraphBuilder.build()   ← 注册所有 Node
            └─ WebGPUEngine.start()
                 └─ rAF 帧循环
                      ├─ FrameContext 构造
                      ├─ RenderGraph.update(ctx)
                      └─ RenderGraph.execute(ctx)
```

核心理念是 **Render Graph**：所有渲染工作拆成独立的 Node，按顺序在 GraphBuilder 里组装，帧循环只负责驱动 Graph，不知道具体渲染逻辑。

---

## 三个阶段，三类 Node

**帧内执行顺序：**

```
ComputeNoiseNode  →  PlanetRenderNode  →  AtmosphereNode
     ↓                    ↓                    ↓
terrain.height        scene.color           canvas
terrain.splat         scene.depth          (swapchain)
```

### Phase 1 — ComputeNoiseNode（Compute Pass）

- 两趟 Compute Shader：
  - **Pass A `noise_gen.wgsl`**：FBM 噪声栈 → `terrain.height` buffer（512×512 f32）
  - **Pass B `terrain_classify.wgsl`**：height → `terrain.splat` buffer（512×512 u32，按 bit 存地形类型）
- 第一帧生成，后续帧不重算（地形是静态的）
- 噪声栈分三层：Simplex FBM（大陆）+ Ridged Multifractal（山脉）+ Worley（细节纹理）

### Phase 2 — PlanetRenderNode（Render Pass）

- **输入**：`terrain.height`（顶点位移）、`terrain.splat`（片元着色）
- **输出**：`scene.color`（中间 RT，`rgba8unorm`）、`scene.depth`（`depth32float`，可供后续着色器采样）
- Vertex shader 通过球坐标采样 height buffer 做顶点位移，无顶点位置 CPU buffer，全由 `vertex_index` 参数化计算
- Fragment shader 读 splat mask，按 bit 优先级查表输出地形颜色

### Phase 3 — AtmosphereNode（Full-Screen Post-Process Pass）

- **输入**：`scene.color` + `scene.depth`（读中间 RT）
- **输出**：`ctx.targetView`（直接写 canvas swapchain）
- 算法：**Nishita 1993 单次散射 Raymarching**
  - 16 primary ray steps × 8 shadow ray steps/pixel
  - Rayleigh（波长相关蓝色散射）+ Mie（Henyey-Greenstein 相位，雾霾/白光）
  - Beer-Lambert 透射率累积
  - 从 `scene.depth` 重建世界坐标（用 `invViewProj`），区分星球表面像素与天空像素

---

## 关键设计决策

| 决策 | 说明 |
|------|------|
| 中间 RT | PlanetRenderNode 不直接写 canvas，写 `scene.color`；AtmosphereNode 做合成后再写 canvas。这套 RT 基础设施未来 SSAO、Bloom 等 Pass 直接复用 |
| depth32float | 从 `depth24plus` 升级，使 shader 可采样深度用于世界坐标重建 |
| 球坐标索引 | `terrain.height/splat` 按 `(θ, φ)` 组织，与顶点拓扑解耦，任意 LOD 分辨率均可查询 |
| SunComponent | 太阳作为 ECS Entity 存在，AtmosphereNode 每帧从 Scene 查询 `sunDir`；后续渲染太阳几何体只改数据，shader 不用动 |
| IGraphNode 接口 | `build / update / recordPass` 三段式：build 在启动时分配 GPU 资源，update 写 uniform，recordPass 录制命令 |

---

## 未来扩展规划

| 功能 | 接入方式 |
|------|---------|
| Atmosphere HUD | 把 `H_R`、`H_M`、`SCATTER_SCALE` 从 WGSL `const` 移到 uniform，加 HTML slider 覆盖层 |
| 水蚀模拟 | ComputeNoiseNode 加 Pass C (`erosion.wgsl`)，其他 Node 不感知 |
| SSAO / Bloom | 新 Node 读 `scene.color`/`scene.depth`，在 AtmosphereNode 之前插入 Graph |
| 多星球 | Scene 添加多个 PlanetComponent Entity，PlanetRenderNode 遍历渲染 |
| 传输 LUT 优化 | 用预计算透射率 LUT 替换 AtmosphereNode 的逐像素积分，shader 接口不变 |

---

整体是一个非常干净的 **ECS + Render Graph 分层架构**：ECS 管数据，Graph Node 充当 System 兼渲染 Pass，Core 层管 GPU 资源生命周期。三个阶段的 Node 通过有名字的 GPU buffer/texture 传递数据，耦合只发生在资源名字上，不在 Node 之间直接引用。
