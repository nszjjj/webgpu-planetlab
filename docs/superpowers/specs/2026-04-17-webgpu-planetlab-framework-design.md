# WebGPU PlanetLab — 第一阶段框架设计文档

日期：2026-04-17

## 目标

在现有 Vite + TypeScript 空项目基础上，按照 AGENT.md 定义的 Render Graph 架构，搭建完整骨架并实现第一个可运行效果：**一个法线可视化的 UV 球体，支持鼠标 Orbit 相机控制**。

---

## 一、架构总览

```
main.ts
  └─ WebGPUEngine.init()
       └─ GraphBuilder.build()   ← 创建 Scene、注册 Node
            └─ WebGPUEngine.start()
                 └─ rAF tick（内部，外部不可见）
                      ├─ 构造 FrameContext
                      ├─ RenderGraph.update(ctx)
                      └─ RenderGraph.execute(ctx)
```

### 帧循环

rAF 完全封装在 `WebGPUEngine` 内部，外部只感知"引擎在 tick"。每帧构造一个 `FrameContext`：

```typescript
interface FrameContext {
  frameIndex: number        // 帧计数
  dt: number                // 当帧 delta（秒）
  totalTime: number         // 运行总时间
  device: GPUDevice
  targetView: GPUTextureView  // 当帧 swapchain 纹理
}
```

逻辑帧 = 物理帧（rAF 同步），不使用固定步长 accumulator。架构上 update / recordPass 分离，未来需要时可在 update 侧独立加固定步长。

---

## 二、ECS 层

采用**纯 ECS 思想**：Component 是数据容器，无 `update()` 生命周期。所有逻辑在 Graph Node（即 System）里。

### Entity

```typescript
class Entity {
  id: string
  transform: Transform
  components: Map<Constructor, Component>
  addComponent<T>(component: T): void
  getComponent<T>(type: Constructor<T>): T | undefined
}
```

### Transform（纯计算属性，无行为）

```typescript
class Transform {
  position: Vec3
  rotation: Quat
  scale: Vec3
  // setter 写入时标记 _dirty = true
  getWorldMatrix(): Mat4   // 脏则重算，否则返回缓存
}
```

### Scene

```typescript
class Scene {
  entities: Entity[]
  mainCamera: Entity
  addEntity(entity: Entity): void
  getEntitiesWith<T>(type: Constructor<T>): Entity[]
}
```

### 本阶段 Component

| Component | 数据字段 |
|---|---|
| `CameraComponent` | fov, near, far, aspect；`getVPMatrix()` 纯计算属性 |
| `PlanetComponent` | radius, rings, segments（默认 64）；标记星球实体 |

---

## 三、Core 层

| 文件 | 职责 |
|---|---|
| `core/types.ts` | `FrameContext`、`IGraphNode` 接口 |
| `core/WebGPUEngine.ts` | device / queue / context 初始化，rAF 帧循环 |
| `core/RenderGraph.ts` | Node 注册，按顺序调用 update / recordPass，提交 CommandBuffer |
| `core/ResourceManager.ts` | Buffer / Texture 按名缓存，封装 `device.createBuffer` 等 |
| `core/PipelineManager.ts` | RenderPipeline / ComputePipeline 按 key 缓存 |

### IGraphNode 接口

```typescript
interface IGraphNode {
  name: string
  build(graph: RenderGraph): void
  update(ctx: FrameContext): void
  recordPass(encoder: GPUCommandEncoder, ctx: FrameContext): void
}
```

---

## 四、Graph Node 层

### BaseNode

实现 `IGraphNode`，`update` 和 `recordPass` 默认为空实现，子类按需 override。

### PlanetRenderNode（本阶段唯一实体 Node）

**build()：**
- 通过 `PipelineManager` 创建并缓存 RenderPipeline（planet_vertex + planet_fragment）
- 通过 `ResourceManager` 创建 uniform buffer（128 bytes：viewProj mat4 + model mat4）
- 生成球体 index buffer（CPU 侧，一次性上传）

**update(ctx)：**
- 从 `scene.getEntitiesWith(PlanetComponent)` 获取星球实体
- 读取 `scene.mainCamera` 的 `CameraComponent.getVPMatrix()`
- `device.queue.writeBuffer` 更新 uniform buffer

**recordPass(encoder, ctx)：**
- beginRenderPass（colorAttachment = ctx.targetView，depthAttachment = depth texture）
- setPipeline / setBindGroup / setIndexBuffer
- drawIndexed
- end

### Stub Nodes（空文件，仅占位）

`ComputeNoiseNode` / `AtmosphereNode` / `SSAONode` / `IndustrialOverlayNode` / `IceBiomeNode` / `GasPlanetNode`

---

## 五、控制器层

`OrbitCameraController`（非 ECS Component，独立控制器类）：
- 持有 `scene.mainCamera` 引用
- 监听 canvas mousemove / wheel / mousedown 事件
- 维护 `phi / theta / radius` 轨道参数
- 事件触发时修改 `cameraEntity.transform.setPosition(...)`，脏标记自动传播

---

## 六、Shader 设计

### 球体生成

不使用 CPU 顶点 buffer，vertex shader 通过 `@builtin(vertex_index)` + 球坐标参数化生成顶点位置和法线：

```wgsl
let i = vertex_index / (segments + 1u);
let j = vertex_index % (segments + 1u);
let theta = f32(i) / f32(rings) * PI;
let phi   = f32(j) / f32(segments) * 2.0 * PI;
let pos   = vec3(sin(theta)*cos(phi), cos(theta), sin(theta)*sin(phi)) * radius;
let normal = normalize(pos);
```

Index buffer 在 CPU 侧 `build()` 阶段生成并上传。

### Uniform Buffer 布局

```
offset  0 (64 bytes): mat4x4<f32> viewProj
offset 64 (64 bytes): mat4x4<f32> model
```

### Fragment Shader

法线可视化：

```wgsl
return vec4(in.normal * 0.5 + 0.5, 1.0);
```

Depth Test 开启（`depth24plus`），防止自遮挡穿帮。

---

## 七、可扩展性说明

| 未来功能 | 接入方式 |
|---|---|
| 顶点位移（凸凹） | ComputeNoiseNode 输出 noise texture → PlanetRenderNode vertex shader 采样位移 |
| 水体/生物群系 | fragment shader 按 noise 高度阈值分支，PlanetComponent 携带 waterLevel 参数 |
| PBR 光照 | 替换 fragment shader，向 PlanetComponent 添加材质参数 |
| 大气散射 | 新增 AtmosphereNode，在 PlanetRenderNode 之后注册到 GraphBuilder |
| 多星球 | Scene 添加多个带 PlanetComponent 的 Entity，PlanetRenderNode 遍历渲染 |

---

## 八、完整文件结构

```
src/
├── core/
│   ├── types.ts
│   ├── WebGPUEngine.ts
│   ├── RenderGraph.ts
│   ├── ResourceManager.ts
│   └── PipelineManager.ts
├── ecs/
│   ├── Entity.ts
│   ├── Transform.ts
│   ├── Scene.ts
│   └── components/
│       ├── CameraComponent.ts
│       └── PlanetComponent.ts
├── graph/
│   ├── nodes/
│   │   ├── BaseNode.ts
│   │   ├── PlanetRenderNode.ts
│   │   ├── ComputeNoiseNode.ts   (stub)
│   │   ├── AtmosphereNode.ts     (stub)
│   │   ├── SSAONode.ts           (stub)
│   │   ├── IndustrialOverlayNode.ts (stub)
│   │   ├── IceBiomeNode.ts       (stub)
│   │   └── GasPlanetNode.ts      (stub)
│   ├── GraphBuilder.ts
│   └── GraphDebugUI.ts
├── controllers/
│   └── OrbitCameraController.ts
├── shaders/
│   ├── planet_vertex.wgsl
│   └── planet_fragment.wgsl
└── main.ts
```
