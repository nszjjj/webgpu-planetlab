# Framework / Business 分层重构设计文档

**日期：** 2026-08-24
**目标：** 把当前混在一起的"通用 WebGPU 渲染基础设施"与"planet 领域逻辑"物理隔离，使非 planet 类型的新 demo（流体 / 粒子 / 后处理 / 体积渲染）能复用框架而不是拷贝改造。

---

## 一、背景与问题

`src/` 目前是"planet 项目"而非"渲染框架 + planet demo"。评估结论：

- **通用性 4/10**：核心引擎（Engine / RenderGraph / ECS）本身干净，但业务耦合渗到框架层
- **要做另一 demo 大约需改动 60% 文件**

三条最痛的耦合：

1. **`GraphBuilder.ts` 硬编码 8 步 pipeline**（`src/graph/GraphBuilder.ts:22-104`），无扩展点
2. **Node 直接从 Scene 拉业务组件**（`PlanetRenderNode.ts:49-50`、`AtmosphereNode.ts:40-41`）—— `scene.getEntitiesWith(PlanetComponent)`
3. **`FrameContext` / `ResourceManager` 用字符串键约定**（`'terrain.height'` / `'scene.color'`），且 `WebGPUEngine._tick()` 直接把 `sceneColorView` / `depthView` 塞进 `FrameContext`（`WebGPUEngine.ts:99-100`）—— 框架内核知道业务纹理名

此外：`DebugHUD.ts` 混合 DOM 原子与 planet 面板；`OrbitCameraController` 假设绕原点；`core/types.ts` 混放 framework 类型（`FrameContext`）与业务参数（`CloudParams` / `MaterialParams` / `LUT_PRESETS`）；`engine.start()` 无对应 `stop()`，HMR 会漏循环。

---

## 二、目标架构

### 二分（+ 三层）

```
src/
├── framework/                         ← demo-agnostic
│   ├── core/                          （相当于 UE 的 RHI + RenderCore）
│   │   ├── WebGPUContext.ts           （原 WebGPUEngine 改名 + 瘦身，无 start()、无 _graph）
│   │   ├── FrameLoop.ts               （新：极简 RAF 封装）
│   │   ├── initWebGPU.ts
│   │   ├── ISurface.ts / CanvasSurfaceManager.ts / SurfaceResources.ts
│   │   ├── ResourceManager.ts / PipelineManager.ts
│   │   └── RenderGraph.ts             （无 scene 字段，runFrame(encoder, ctx) 单一方法）
│   ├── graph/
│   │   ├── BaseNode.ts                （新契约：泛型 <Inputs, Outputs>，无 Scene 访问）
│   │   ├── handles.ts                 （新：BufferHandle<T> / TextureHandle<T>）
│   │   └── types.ts                   （FrameContext / BuildContext / SurfaceDescriptor）
│   ├── ecs/                           （通用 ECS）
│   │   ├── Scene.ts / Entity.ts / Transform.ts
│   │   └── components/CameraComponent.ts
│   ├── renderer3d/                    ← 中间层：3D demo 约定，非核心（相当于 UE Renderer 模块）
│   │   └── SceneTargets.ts            （create3DSceneTargets(context) → 注册 scene.color/depth）
│   └── ui/                            ← HTML HUD 原子工具箱
│       ├── HUDPanel.ts / HUDSection.ts / HUDSlider.ts / HUDToggle.ts
│       └── GraphDebugUI.ts            （原样搬来）
│
├── demos/
│   └── planet/
│       ├── index.ts                   （export bootstrap(context, canvas) → PlanetDemoHandle）
│       ├── components/                （PlanetComponent, SunComponent）
│       ├── controllers/OrbitCameraController.ts
│       ├── nodes/                     （8 个 Node，全部新契约）
│       ├── shaders/                   （10 个 wgsl）
│       ├── utils/icosphere.ts
│       ├── params.ts                  （CloudParams / MaterialParams / AtmosphereParams / LUT_PRESETS / NoiseParams / ClassifyParams）
│       ├── graph.ts                   （buildPlanetGraph → { graph, params, debugState, bridgeInputs }）
│       └── ui/PlanetHUD.ts            （用 framework/ui 原子拼装）
│
├── main.ts                            （只做：init context → bootstrap('planet' demo)）
└── __tests__/
    ├── framework/                     （Scene / Entity / Transform / SurfaceResources）
    └── demos/planet/                  （PlanetComponent / Cloud / Atmosphere / terrain）
```

### 三层依赖规则

```
demos/planet/     ─────┐
                       │ import 允许
                       ▼
framework/renderer3d/  ← 3D 场景约定（可选依赖，非 3D demo 可不用）
                       │
                       ▼
framework/core+ecs+graph+ui  ← 最内核，不认识 SceneTargets/Planet
```

**硬约束：** `framework/` 里任何文件不得 `import` `demos/`；`framework/core/` 不得 `import` `framework/renderer3d/`。

---

## 三、Node 新契约

### 3.1 Handle 类型

```typescript
// framework/graph/handles.ts
export interface BufferHandle<Tag extends string = string> {
  readonly __tag: Tag;
  readonly key: string;   // 底层 ResourceManager key，仅 framework 内部使用
}
export interface TextureHandle<Tag extends string = string> {
  readonly __tag: Tag;
  readonly key: string;
}
```

`__tag` 为 phantom type，编译期防止不同语义的 buffer 相互误接。

`ResourceManager` 补充 typed API：

```typescript
createBuffer<Tag extends string>(tag: Tag, desc: GPUBufferDescriptor): BufferHandle<Tag>;
createTexture<Tag extends string>(tag: Tag, desc: GPUTextureDescriptor): TextureHandle<Tag>;
resolveBuffer(h: BufferHandle): GPUBuffer;
resolveTexture(h: TextureHandle): GPUTexture;
```

字符串 `key` 内部生成（可用 tag 直接充当 key），外部代码不再使用字符串查询。

### 3.2 新 BaseNode

```typescript
// framework/graph/BaseNode.ts
export interface NodeInputs  { [k: string]: unknown }
export interface NodeOutputs { [k: string]: BufferHandle | TextureHandle }

export abstract class BaseNode<
  I extends NodeInputs  = {},
  O extends NodeOutputs = {},
> {
  abstract readonly name: string;

  protected _inputs!:  I;
  protected _outputs!: O;

  setInputs(inputs: I): this { this._inputs = inputs; return this; }
  get outputs(): O { return this._outputs; }

  abstract build(ctx: BuildContext): void;
  update(_ctx: FrameContext): void {}
  recordPass(_encoder: GPUCommandEncoder, _ctx: FrameContext): void {}
}
```

**契约变化：**
- `BuildContext` 不再含 `scene`
- `FrameContext` 不再含 `sceneColorView` / `depthView` / `resources`
- Node **禁止** 在 update/recordPass 里访问 Scene 或全局 ResourceManager
- Node 通过 `this._inputs` 读所有帧数据

### 3.3 瘦身后的 Context 类型

```typescript
// framework/graph/types.ts
export interface FrameContext {
  device:     GPUDevice;
  frameIndex: number;
  dt:         number;
  totalTime:  number;
}

export interface BuildContext {
  device:      GPUDevice;
  resources:   ResourceManager;    // 仍然可用于 build 时创建自己的 buffer
  pipelines:   PipelineManager;
  surfaceDesc: SurfaceDescriptor;
}
```

Surface 相关的 RT 由 demo 层通过 `SceneTargets` 注册并作为 handle 传给节点。

---

## 四、Engine / Loop 拆分

### 4.1 `WebGPUContext`（替代 `WebGPUEngine`）

只持有：
- `device: GPUDevice`
- `resources: ResourceManager`
- `pipelines: PipelineManager`
- `surfaces: SurfacePair[]`（含 `addSurface()` / `getSurfaceResources(i)`）
- `surfaceDescriptor: SurfaceDescriptor`

**移除：** `_graph`、`_frameIndex`、`_lastTime`、`_totalTime`、`_tick()`、`setGraph()`、`start()`

### 4.2 `FrameLoop`

```typescript
// framework/core/FrameLoop.ts
export class FrameLoop {
  private _tick: (frame: FrameContext) => void;
  private _running = false;
  private _rafId = 0;
  private _lastTime = 0;
  private _frameIndex = 0;
  private _totalTime = 0;

  constructor(tick: (frame: FrameContext) => void, private _device: GPUDevice) {
    this._tick = tick;
  }

  start(): void { /* 起 RAF，构造 FrameContext 传给 tick */ }
  stop():  void { /* cancelAnimationFrame + _running = false */ }
  get running(): boolean { return this._running; }
}
```

### 4.3 `RenderGraph` 瘦身

```typescript
export class RenderGraph {
  private _nodes: BaseNode[] = [];
  addNode(node: BaseNode): void { this._nodes.push(node); }
  runFrame(encoder: GPUCommandEncoder, ctx: FrameContext): void {
    for (const n of this._nodes) n.update(ctx);
    for (const n of this._nodes) n.recordPass(encoder, ctx);
  }
}
```

移除 `scene` 字段和 `update`/`execute` 二分方法。

### 4.4 `SceneTargets`（framework/renderer3d/）

```typescript
// framework/renderer3d/SceneTargets.ts
export interface SceneTargets {
  color: TextureHandle<'scene.color'>;
  depth: TextureHandle<'scene.depth'>;
}
export function create3DSceneTargets(context: WebGPUContext, surfaceIndex = 0): SceneTargets {
  const surfaceRes = context.getSurfaceResources(surfaceIndex);
  const desc = context.surfaceDescriptor;
  surfaceRes.registerTexture('scene.color', (w, h) => ({
    size: [w, h], format: desc.colorFormat,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  }));
  surfaceRes.registerTexture('scene.depth', (w, h) => ({
    size: [w, h], format: desc.depthFormat,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  }));
  return {
    color: { __tag: 'scene.color', key: 'scene.color' },
    depth: { __tag: 'scene.depth', key: 'scene.depth' },
  };
}
```

**非 3D demo 不 import 此文件即可，完全不受该约定影响。**

---

## 五、Demo Bootstrap 形态

### 5.1 `main.ts`

```typescript
// src/main.ts —— 唯一保留在 src/ 根
import { initWebGPU }           from './framework/core/initWebGPU.ts';
import { CanvasSurfaceManager } from './framework/core/CanvasSurfaceManager.ts';
import { WebGPUContext }        from './framework/core/WebGPUContext.ts';
import { bootstrap }            from './demos/planet/index.ts';   // ← 换 demo 只改这一行

async function main(): Promise<void> {
  const canvas  = document.getElementById('webgpu-canvas') as HTMLCanvasElement;
  const device  = await initWebGPU();
  const context = new WebGPUContext(device);
  context.addSurface(new CanvasSurfaceManager(canvas, device));
  bootstrap(context, canvas);
}

main().catch((err) => { document.body.innerHTML = `<pre>${String(err)}</pre>`; });
```

零 planet 词汇。

### 5.2 `demos/planet/index.ts`

```typescript
export interface PlanetDemoHandle {
  dispose(): void;
}

export function bootstrap(context: WebGPUContext, canvas: HTMLCanvasElement): PlanetDemoHandle {
  const { graph, params, debugState, bridgeInputs } = buildPlanetGraph(context, canvas);

  const loop = new FrameLoop((frame) => {
    bridgeInputs(frame);
    const encoder = context.device.createCommandEncoder();
    graph.runFrame(encoder, frame);
    context.device.queue.submit([encoder.finish()]);
  }, context.device);
  loop.start();

  const hud = import.meta.env.DEV ? new PlanetHUD(params, debugState) : undefined;

  return { dispose() { loop.stop(); hud?.dispose(); } };
}
```

### 5.3 `demos/planet/graph.ts`（缩写）

```typescript
export function buildPlanetGraph(context, canvas) {
  const targets = create3DSceneTargets(context);         // 使用 3D 约定

  const scene = new Scene();
  const planet = new Entity('planet').addComponent(new PlanetComponent(1.0, 5));
  const sun    = new Entity('sun').addComponent(new SunComponent());
  const camera = new Entity('camera').addComponent(new CameraComponent(...));
  scene.addEntity(planet); scene.addEntity(sun); scene.addEntity(camera);
  scene.mainCamera = camera;
  new OrbitCameraController(scene, canvas);

  const noise    = new ComputeNoiseNode();
  const normal   = new NormalComputeNode();
  const planetN  = new PlanetRenderNode();
  // ... 6 个其他 node

  const buildCtx = { device: context.device, resources: context.resources,
                     pipelines: context.pipelines, surfaceDesc: context.surfaceDescriptor };
  [noise, normal, planetN, /* ... */].forEach(n => n.build(buildCtx));

  const params = { cloud: { ...DEFAULT_CLOUD_PARAMS }, material: { ...DEFAULT_MATERIAL_PARAMS } };
  const debugState = { wireframe: wire.toggle };

  const bridgeInputs = (frame: FrameContext) => {
    const p = planet.getComponent(PlanetComponent)!;
    const s = sun.getComponent(SunComponent)!;
    const cam = camera.getComponent(CameraComponent)!;
    const vp = cam.getVPMatrix(camera.transform.position);
    const sunDir = normalize(s.worldPosition);

    noise.setInputs({ subdivisions: p.subdivisions, /* ... */ });
    normal.setInputs({ heightBuffer: noise.outputs.heightBuffer, /* ... */ });
    planetN.setInputs({
      heightBuffer: noise.outputs.heightBuffer,
      splatBuffer:  noise.outputs.splatBuffer,
      normalBuffer: normal.outputs.normalBuffer,
      colorTarget:  targets.color,
      depthTarget:  targets.depth,
      vpMatrix: vp, modelMatrix: planet.transform.getWorldMatrix(),
      cameraPos: camera.transform.position, sunDir,
      displaceScale: p.displaceScale,
      materialParams: params.material,
    });
    // ... 其他节点桥接
  };

  const graph = new RenderGraph();
  [noise, normal, planetN, /* ... */].forEach(n => graph.addNode(n));

  return { graph, params, debugState, bridgeInputs };
}
```

**Node 内部只读 `this._inputs.xxx`，完全不感知 Scene。桥接函数是"planet demo 特有的粘合层"。**

---

## 六、UI Kit 拆分

### 6.1 Framework 原子（framework/ui/）

| 文件 | 责任 | 从哪来 |
|-----|-----|-------|
| `HUDPanel.ts` | 浮层容器，`new HUDPanel({ title, position })` | 现 `DebugHUD._buildPanel()` |
| `HUDSection.ts` | 可折叠段落，`new HUDSection(title, expanded)` | 现 `_buildSectionHeader()` |
| `HUDSlider.ts` | 带 label / value 显示的 range 输入 | 现 `_buildGenericSlider()` |
| `HUDToggle.ts` | 复选框行，可选 `keybindHint` + `bindKey`（自建 keydown 监听） | 现 `_buildWireframeRow()` + `_bindKeys()` |

保留现有配色 / 字体 / 尺寸，不引入主题系统。

### 6.2 Demo 面板（demos/planet/ui/PlanetHUD.ts）

```typescript
const TERRAIN_LABELS = ['Water', 'Sand', 'Grass', 'Rock', 'Snow']; // planet 独有

export class PlanetHUD {
  private _panel: HUDPanel;
  constructor(params: { cloud: CloudParams; material: MaterialParams },
              debug:  { wireframe: { enabled: boolean } }) {
    this._panel = new HUDPanel({ title: 'Debug', position: 'top-right' });
    this._panel.append(new HUDToggle({
      label: 'Wireframe', keybindHint: 'W', bindKey: 'w',
      value: debug.wireframe.enabled,
      onChange: (v) => { debug.wireframe.enabled = v; },
    }).el);
    // Cloud / PBR sections 用 HUDSection + 循环 HUDSlider 拼
  }
  dispose(): void { this._panel.dispose(); }
}
```

规模：planet 独有 HUD 约 60 行；framework/ui 加起来约 150 行。

---

## 七、测试分层

搬位置 + 改 import 路径，**不改测试逻辑，不新增测试**。

**`__tests__/framework/`**：`Scene.test.ts`、`Entity.test.ts`、`Transform.test.ts`、`SurfaceResources.test.ts`

**`__tests__/demos/planet/`**：`PlanetComponent.test.ts`、`CloudParams.test.ts`、`CloudNodeSharedRef.test.ts`、`AtmosphereParams.test.ts`、`AtmosphereLUT.test.ts`、`terrainCoords.test.ts`、`terrainParams.test.ts`

Vitest 自动发现 `**/*.test.ts`，配置无需更改。

---

## 八、迁移执行顺序

### Phase A — 目录搬家 & 类型拆分（低风险）

1. 建 `framework/` 和 `demos/planet/` 空目录
2. 搬 `core/*` → `framework/core/`
3. 搬 `ecs/*` → `framework/ecs/`（`CameraComponent` 留框架；`PlanetComponent`/`SunComponent` 挪到 `demos/planet/components/`）
4. 拆分 `core/types.ts`：generic → `framework/graph/types.ts`；planet 参数 → `demos/planet/params.ts`
5. 搬 `graph/GraphDebugUI.ts` → `framework/ui/`
6. 搬 `shaders/*` → `demos/planet/shaders/`
7. 搬 `utils/icosphere.ts` → `demos/planet/utils/`
8. 搬测试文件到对应位置
9. 跑测试 + 启 dev server 视觉验证
10. Commit：`refactor: reorganize files into framework/ and demos/planet/`

### Phase B — Engine 拆分 & Loop 反转

11. `WebGPUEngine` 改名 `WebGPUContext`，删除 `_graph`/`_tick`/`start`/时间字段
12. 新增 `FrameLoop.ts`
13. `FrameContext` 只删 `resources` 字段（`sceneColorView` / `depthView` **暂时保留**，避免与未迁移的 Node 冲突；这两项在 Phase C 与 Node 迁移一起清理）
14. `RenderGraph` 删除 `scene` 字段，合并 `update`+`execute` → `runFrame`
15. 新增 `framework/renderer3d/SceneTargets.ts`
16. `main.ts` 迁移到新形状
17. planet demo `bootstrap` 补上 `FrameLoop` + `SceneTargets` 使用（Node 契约暂未换；`bootstrap` 内的 tick 函数仍然把 `sceneColorView` / `depthView` 塞进 `FrameContext` 兼容旧 Node）
18. 跑测试 + 视觉验证
19. Commit：`refactor: extract FrameLoop, slim WebGPUContext, add SceneTargets`

### Phase C — Handle 系统 & Node 新契约（最大改动）

20. 新增 `framework/graph/handles.ts`
21. `ResourceManager` 补 `createBuffer<Tag>`/`createTexture<Tag>` 返回 typed handle 的 API（旧字符串 API 保留，允许过渡）
22. 重写 `BaseNode`：泛型 `<Inputs, Outputs>` + `setInputs` + `outputs` getter
23. 逐个 Node 迁移，每迁一个 commit 一次（顺序按依赖从简到繁）：
    - `ComputeNoiseNode` → `NormalComputeNode` → `AtmosphereLUTNode` → `CloudCoverageNode` → `DebugWireframeNode` → `PlanetRenderNode` → `CloudRenderNode` → `AtmosphereNode`
24. 完善 `demos/planet/graph.ts::bridgeInputs`
25. 每 Node 迁完跑一次视觉验证
26. 全部完成后收尾：
    - 从 `FrameContext` 移除 `sceneColorView` / `depthView`（Phase B 遗留兼容项）
    - `bootstrap` 的 tick 函数移除对这两个字段的写入
    - 清理 `ResourceManager` 的字符串 API（如果不再被引用）
    - 检查 Node 中残留的 `scene.getEntitiesWith(...)` / `scene.mainCamera`，全部下线

### Phase D — UI 拆分（可与 C 并行）

27. 新增 `framework/ui/HUDPanel|HUDSection|HUDSlider|HUDToggle`
28. 重写 `PlanetHUD.ts` 用新原子
29. `bootstrap` 里挂上
30. 视觉像素对比：面板外观应保持一致
31. Commit：`refactor: split DebugHUD into framework HUD kit + PlanetHUD`

### Phase E — 收尾 & 加护栏

32. 加 CI/lint 规则：`framework/` 里禁止 `import from '../demos/'`（可用 `eslint-plugin-import/no-restricted-paths` 或简单脚本）
33. 更新 `AGENT.md` / `README.md` 说明新分层
34. Commit：`chore: enforce framework/demo import boundary`

**总估：** 15–20 个 commit，一个下午到一天。

---

## 九、验证标准

重构完成后应满足：

1. **功能不变**：planet demo 视觉与重构前逐帧一致；11 个现有测试全绿
2. **导入方向**：`grep -r "from.*demos/" src/framework/` 无输出
3. **Node 隔离**：`grep -rE "scene\.(getEntitiesWith|mainCamera)" src/demos/planet/nodes/` 无输出
4. **Context 干净**：`FrameContext` 定义中不出现 `sceneColorView` / `depthView` / `resources` 字段
5. **Engine 干净**：`WebGPUContext` 无 `_graph` / `_tick` / `start` 成员
6. **HMR 无泄漏**：Vite dev server 保存文件后不出现叠加的 RAF 循环（浏览器 devtools performance 检查）
7. **换 demo 只需改 `main.ts` 一行 import**

---

## 十、Non-goals（本次不做）

- 不做自动拓扑排序 / 自动 barrier 的 framegraph 系统（用户明确选择手写连接）
- 不引入响应式绑定（HUD 直接写 params，Node 每帧读，与现有一致）
- 不引入 dat.GUI / tweakpane（保留自绘 HUD）
- 不建 demo registry / demo 切换 UI（用户没要求，`main.ts` 一行 import 已足够）
- 不引入 UI 主题系统 / 布局系统
- 不为 Handle / FrameLoop / HUD 新增单元测试（现有回归测试足够）
- 不改任何 planet 视觉行为
