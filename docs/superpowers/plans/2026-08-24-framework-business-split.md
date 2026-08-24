# Framework / Business Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `src/` 从"planet 项目"重构为"通用 WebGPU 渲染框架 + planet demo"，使框架能被非 planet 类型的新 demo（流体 / 粒子 / 后处理 / 体积渲染）复用。

**Architecture:** 二分为 `src/framework/`（demo-agnostic：core + ecs + graph + renderer3d 中间层 + ui）和 `src/demos/planet/`（业务层：components + nodes + shaders + graph 装配 + HUD）。Node 契约改为严格 typed handle input/output，Node 不再访问 Scene；Engine 拆成 `WebGPUContext` + `FrameLoop`；HUD 拆成 framework 原子 + demo 拼装。

**Tech Stack:** TypeScript 6, WebGPU, Vite 8, Vitest 3, wgpu-matrix。

**Spec:** `docs/superpowers/specs/2026-08-24-framework-business-split-design.md`

## Global Constraints

- **不改任何 planet 视觉行为** — 每个 phase 结束视觉应与重构前逐帧一致
- **不改任何测试逻辑** — 11 个现有测试必须在每个 commit 后全绿
- **每个 phase 结束都能跑 `npm run build && npm test`**
- **`framework/` 里任何文件不得 `import` `demos/*`**
- **`framework/core/` 不得 `import` `framework/renderer3d/*`**
- **不新增单元测试**（Handle / FrameLoop / HUD 不加测试）
- **`vite.config.ts` / `tsconfig.json` 不改**（无 path alias，纯相对路径 import）
- **不 auto-commit，等操作者本地确认 diff 后再 commit**（用户明确要求）

---

## Phase A — 目录搬家 & 类型拆分

低风险，全部是移动 + 改 import 路径。做完 Phase A 后，`grep -r "from.*src/core\|from.*src/ecs\|from.*src/graph\|from.*src/shaders\|from.*src/utils" src/` 应无残留。

### Task A1: 建目录骨架

**Files:**
- Create dirs: `src/framework/core/`, `src/framework/graph/`, `src/framework/ecs/components/`, `src/framework/ui/`, `src/framework/renderer3d/`, `src/demos/planet/components/`, `src/demos/planet/controllers/`, `src/demos/planet/nodes/`, `src/demos/planet/shaders/`, `src/demos/planet/utils/`, `src/demos/planet/ui/`, `src/__tests__/framework/`, `src/__tests__/demos/planet/`

**Interfaces:** none

- [ ] **Step 1: Baseline verify**
  ```bash
  npm test && npm run build
  ```
  Expected: all green, no TS errors。记住这是所有后续 phase 的基线。

- [ ] **Step 2: 建目录**
  ```bash
  mkdir -p src/framework/core src/framework/graph src/framework/ecs/components \
           src/framework/ui src/framework/renderer3d \
           src/demos/planet/components src/demos/planet/controllers \
           src/demos/planet/nodes src/demos/planet/shaders \
           src/demos/planet/utils src/demos/planet/ui \
           src/__tests__/framework src/__tests__/demos/planet
  ```

- [ ] **Step 3: Verify**
  ```bash
  find src/framework src/demos -type d | sort
  ```
  Expected: 12 个新目录都在

- [ ] **Step 4: 暂停 commit**（本 task 只建空目录，等 A2 一起 commit）

### Task A2: 搬 `src/core/*` → `src/framework/core/`

**Files:**
- Move: `src/core/CanvasSurfaceManager.ts` → `src/framework/core/CanvasSurfaceManager.ts`
- Move: `src/core/initWebGPU.ts` → `src/framework/core/initWebGPU.ts`
- Move: `src/core/ISurface.ts` → `src/framework/core/ISurface.ts`
- Move: `src/core/PipelineManager.ts` → `src/framework/core/PipelineManager.ts`
- Move: `src/core/RenderGraph.ts` → `src/framework/core/RenderGraph.ts`
- Move: `src/core/ResourceManager.ts` → `src/framework/core/ResourceManager.ts`
- Move: `src/core/SurfaceResources.ts` → `src/framework/core/SurfaceResources.ts`
- Move: `src/core/WebGPUEngine.ts` → `src/framework/core/WebGPUEngine.ts` （**保留旧名，Phase B 才改名**）
- Move: `src/core/types.ts` → 暂时保留在 `src/core/types.ts`（A3 拆分）
- Modify (import fixes): `src/main.ts`, `src/graph/GraphBuilder.ts`, `src/graph/GraphDebugUI.ts`, `src/graph/nodes/*.ts`, `src/controllers/OrbitCameraController.ts`, `src/ui/DebugHUD.ts`, `src/__tests__/*.ts`

**Interfaces:** none

- [ ] **Step 1: 用 git mv 搬文件**（保留 blame history）
  ```bash
  git mv src/core/CanvasSurfaceManager.ts src/framework/core/
  git mv src/core/initWebGPU.ts           src/framework/core/
  git mv src/core/ISurface.ts             src/framework/core/
  git mv src/core/PipelineManager.ts      src/framework/core/
  git mv src/core/RenderGraph.ts          src/framework/core/
  git mv src/core/ResourceManager.ts      src/framework/core/
  git mv src/core/SurfaceResources.ts     src/framework/core/
  git mv src/core/WebGPUEngine.ts         src/framework/core/
  ```

- [ ] **Step 2: 修 framework/core 内部的相对 import**
  这些文件之间互相 import 时相对路径不变（同目录），无需修改。但它们 import `../ecs/*` 需要在 A4 前改成 `../../ecs/*`（因为深了一层）。**先只跑 build，看错误是否只在预期范围。**
  ```bash
  npm run build
  ```
  Expected fails: WebGPUEngine imports `../ecs/*` 的行、RenderGraph imports `../ecs/Scene` 的行。

- [ ] **Step 3: 修 `WebGPUEngine.ts` 里对 ecs 的相对路径**
  用 sed 或手改：把 `from '../ecs/` 改成 `from '../../ecs/`（`src/framework/core/*.ts` 里）
  ```bash
  # 快速看有哪些引用
  grep -rn "from '\\.\\./ecs" src/framework/core/
  # 手动改，或：
  sed -i '' "s|from '\\.\\./ecs|from '../../ecs|g" src/framework/core/*.ts
  ```

- [ ] **Step 4: 修 src/ 其余文件里对 `../core/` 的引用**（外部使用者）
  受影响：`src/main.ts`、`src/graph/GraphBuilder.ts`、`src/graph/GraphDebugUI.ts`、`src/graph/nodes/*.ts`、`src/controllers/OrbitCameraController.ts`、`src/ui/DebugHUD.ts`、`src/__tests__/*.ts`
  ```bash
  # 检查所有 import 到 core 的引用
  grep -rn "from '\\..*core/" src/ --include="*.ts"
  ```
  逐个把 `from '../core/X'` 改成 `from '../framework/core/X'`；把 `from '../../core/X'` 改成 `from '../../framework/core/X'`

- [ ] **Step 5: Build + test**
  ```bash
  npm run build && npm test
  ```
  Expected: 全绿。若有失败，用错误信息定位遗漏的 import。

- [ ] **Step 6: 暂停 commit**（合并到 Task A6 一起 commit）

### Task A3: 拆分 `src/core/types.ts`

**Files:**
- Create: `src/framework/graph/types.ts`（framework types：`FrameContext` / `BuildContext` / `SurfaceDescriptor` / `IGraphNode`）
- Create: `src/demos/planet/params.ts`（planet params：`NoiseParams` / `ClassifyParams` / `AtmosphereParams` / `AtmosphereLUTParams` / `LUTPreset` / `LUTResolution` / `LUT_PRESETS` / `CloudParams` / `MaterialParam` / `MaterialParams` + 所有 `DEFAULT_*` 常量）
- Delete: `src/core/types.ts`
- Modify: 所有 import types.ts 的文件

**Interfaces:**
- Produces:
  - `framework/graph/types.ts` exports `FrameContext`, `BuildContext`, `SurfaceDescriptor`, `IGraphNode` (原样保留字段，本 task 不改结构)
  - `demos/planet/params.ts` exports `NoiseParams`, `ClassifyParams`, `AtmosphereParams`, `AtmosphereLUTParams`, `LUTPreset`, `LUTResolution`, `LUT_PRESETS`, `CloudParams`, `MaterialParam`, `MaterialParams`, `DEFAULT_NOISE_PARAMS`, `DEFAULT_CLASSIFY_PARAMS`, `DEFAULT_ATMOSPHERE_PARAMS`, `DEFAULT_ATMOSPHERE_LUT_PARAMS`, `DEFAULT_CLOUD_PARAMS`, `DEFAULT_MATERIAL_PARAMS`

- [ ] **Step 1: 建 `src/framework/graph/types.ts`**
  从现 `src/core/types.ts` 复制 framework 部分（第 1-45 行左右：所有 `import` + `FrameContext` + `SurfaceDescriptor` + `BuildContext` + `IGraphNode` + `RenderGraph` re-export）。修 import 路径为 `../core/*`。

- [ ] **Step 2: 建 `src/demos/planet/params.ts`**
  从现 `src/core/types.ts` 复制其余所有类型 + 常量（第 47 行到文件结束）。无 import 依赖（都是纯数据类型）。

- [ ] **Step 3: 删除 `src/core/types.ts`**
  ```bash
  git rm src/core/types.ts
  ```

- [ ] **Step 4: 全局改 import**
  ```bash
  grep -rn "from.*core/types" src/ --include="*.ts"
  ```
  规则：
  - 引用 `FrameContext` / `BuildContext` / `SurfaceDescriptor` / `IGraphNode` → 改为 `from '.../framework/graph/types.ts'`
  - 引用 `CloudParams` / `MaterialParams` / `AtmosphereParams` / `LUT_PRESETS` 等 → 改为 `from '.../demos/planet/params.ts'`
  - 单一文件里同时用两组的（如 `PlanetRenderNode`）需要两个 import 语句

- [ ] **Step 5: Build + test**
  ```bash
  npm run build && npm test
  ```

- [ ] **Step 6: 暂停 commit**

### Task A4: 搬 `src/ecs/*` → framework/ecs/ + 拆 components

**Files:**
- Move: `src/ecs/Scene.ts` → `src/framework/ecs/Scene.ts`
- Move: `src/ecs/Entity.ts` → `src/framework/ecs/Entity.ts`
- Move: `src/ecs/Transform.ts` → `src/framework/ecs/Transform.ts`
- Move: `src/ecs/components/CameraComponent.ts` → `src/framework/ecs/components/CameraComponent.ts`
- Move: `src/ecs/components/PlanetComponent.ts` → `src/demos/planet/components/PlanetComponent.ts`
- Move: `src/ecs/components/SunComponent.ts` → `src/demos/planet/components/SunComponent.ts`
- Modify import: 所有引用被搬文件的地方

**Interfaces:** none (纯搬)

- [ ] **Step 1: git mv 每个文件**
  ```bash
  git mv src/ecs/Scene.ts     src/framework/ecs/
  git mv src/ecs/Entity.ts    src/framework/ecs/
  git mv src/ecs/Transform.ts src/framework/ecs/
  git mv src/ecs/components/CameraComponent.ts src/framework/ecs/components/
  git mv src/ecs/components/PlanetComponent.ts src/demos/planet/components/
  git mv src/ecs/components/SunComponent.ts    src/demos/planet/components/
  # 应该空了
  rmdir src/ecs/components src/ecs
  ```

- [ ] **Step 2: 修 framework/ecs/* 内部相对路径**
  Scene/Entity/Transform 之间原来是 `./`（同目录），保持不变。
  CameraComponent 引用 `../Entity` 或 `../Transform` 保持相对路径。

- [ ] **Step 3: 修 demos/planet/components/* 内部相对路径**
  ```bash
  grep -n "from" src/demos/planet/components/*.ts
  ```
  PlanetComponent/SunComponent 如果引用 Entity/Transform（可能没有）：改成 `../../../framework/ecs/...`

- [ ] **Step 4: 全局改 import**
  ```bash
  grep -rn "from.*ecs" src/ --include="*.ts"
  ```
  - 引用 `Scene` / `Entity` / `Transform` / `CameraComponent` → `from '.../framework/ecs/...'`
  - 引用 `PlanetComponent` / `SunComponent` → `from '.../demos/planet/components/...'`

- [ ] **Step 5: Build + test**
  ```bash
  npm run build && npm test
  ```

- [ ] **Step 6: 暂停 commit**

### Task A5: 搬 planet 特定资源（shaders / utils / GraphDebugUI）

**Files:**
- Move: `src/shaders/*.wgsl` (10 个) → `src/demos/planet/shaders/`
- Move: `src/utils/icosphere.ts` → `src/demos/planet/utils/icosphere.ts`
- Move: `src/graph/GraphDebugUI.ts` → `src/framework/ui/GraphDebugUI.ts`
- Modify import: 所有引用者

**Interfaces:** none

- [ ] **Step 1: 搬 shaders**
  ```bash
  git mv src/shaders/*.wgsl src/demos/planet/shaders/
  rmdir src/shaders
  ```

- [ ] **Step 2: 搬 utils/icosphere**
  ```bash
  git mv src/utils/icosphere.ts src/demos/planet/utils/
  # 若 src/utils 为空则 rmdir
  ls src/utils 2>/dev/null && rmdir src/utils 2>/dev/null || true
  ```

- [ ] **Step 3: 搬 GraphDebugUI**
  ```bash
  git mv src/graph/GraphDebugUI.ts src/framework/ui/
  ```

- [ ] **Step 4: 修 import**
  ```bash
  # shader raw imports
  grep -rn "shaders/.*\\.wgsl" src/ --include="*.ts"
  # icosphere
  grep -rn "utils/icosphere" src/ --include="*.ts"
  # GraphDebugUI
  grep -rn "GraphDebugUI" src/ --include="*.ts"
  ```
  每个引用都改成新路径。特别注意 shader `?raw` import（如 `import x from '../shaders/planet.wgsl?raw'` → `'../shaders/planet.wgsl?raw'`（相对 planet demo）或 `'../../demos/planet/shaders/...'`（相对 framework））。

- [ ] **Step 5: Build + test**
  ```bash
  npm run build && npm test
  ```

- [ ] **Step 6: 暂停 commit**

### Task A6: 搬 controller + node 文件 + 测试文件

**Files:**
- Move: `src/controllers/OrbitCameraController.ts` → `src/demos/planet/controllers/OrbitCameraController.ts`
- Move: `src/graph/GraphBuilder.ts` → `src/demos/planet/graph.ts` **暂改名为 graph.ts**（内容 Phase B/C 才重写）
- Move: `src/graph/nodes/BaseNode.ts` → `src/framework/graph/BaseNode.ts`
- Move: `src/graph/nodes/*.ts`（12 个业务 node 全部）→ `src/demos/planet/nodes/`
- Move: `src/ui/DebugHUD.ts` → `src/demos/planet/ui/DebugHUD.ts` **暂保留原名**（Phase D 才拆）
- Move test files:
  - `Scene.test.ts` / `Entity.test.ts` / `Transform.test.ts` / `SurfaceResources.test.ts` → `src/__tests__/framework/`
  - `PlanetComponent.test.ts` / `CloudParams.test.ts` / `CloudNodeSharedRef.test.ts` / `AtmosphereParams.test.ts` / `AtmosphereLUT.test.ts` / `terrainCoords.test.ts` / `terrainParams.test.ts` → `src/__tests__/demos/planet/`
  - `setup.ts` 留原地 `src/__tests__/setup.ts`（vite.config.ts 里 setupFiles 指向这里，不改配置）

**Interfaces:** none

- [ ] **Step 1: 搬 controller**
  ```bash
  git mv src/controllers/OrbitCameraController.ts src/demos/planet/controllers/
  rmdir src/controllers
  ```

- [ ] **Step 2: 搬 GraphBuilder → graph.ts**
  ```bash
  git mv src/graph/GraphBuilder.ts src/demos/planet/graph.ts
  ```

- [ ] **Step 3: 搬 BaseNode（framework）**
  ```bash
  git mv src/graph/nodes/BaseNode.ts src/framework/graph/BaseNode.ts
  ```

- [ ] **Step 4: 搬其余 12 个 node → demos/planet/nodes/**
  ```bash
  git mv src/graph/nodes/*.ts src/demos/planet/nodes/
  rmdir src/graph/nodes src/graph
  ```

- [ ] **Step 5: 搬 DebugHUD**
  ```bash
  git mv src/ui/DebugHUD.ts src/demos/planet/ui/DebugHUD.ts
  rmdir src/ui
  ```

- [ ] **Step 6: 搬测试**
  ```bash
  git mv src/__tests__/Scene.test.ts           src/__tests__/framework/
  git mv src/__tests__/Entity.test.ts          src/__tests__/framework/
  git mv src/__tests__/Transform.test.ts       src/__tests__/framework/
  git mv src/__tests__/SurfaceResources.test.ts src/__tests__/framework/

  git mv src/__tests__/PlanetComponent.test.ts    src/__tests__/demos/planet/
  git mv src/__tests__/CloudParams.test.ts        src/__tests__/demos/planet/
  git mv src/__tests__/CloudNodeSharedRef.test.ts src/__tests__/demos/planet/
  git mv src/__tests__/AtmosphereParams.test.ts   src/__tests__/demos/planet/
  git mv src/__tests__/AtmosphereLUT.test.ts      src/__tests__/demos/planet/
  git mv src/__tests__/terrainCoords.test.ts      src/__tests__/demos/planet/
  git mv src/__tests__/terrainParams.test.ts      src/__tests__/demos/planet/
  # setup.ts 留原地
  ```

- [ ] **Step 7: 修所有 import 路径**
  ```bash
  # 每个类别都过一遍
  grep -rn "from.*graph/nodes" src/ --include="*.ts"
  grep -rn "from.*controllers/" src/ --include="*.ts"
  grep -rn "from.*ui/DebugHUD" src/ --include="*.ts"
  grep -rn "from.*GraphBuilder" src/ --include="*.ts"
  ```
  - `main.ts` 里 `import { GraphBuilder } from './graph/GraphBuilder.ts'` → `import { GraphBuilder } from './demos/planet/graph.ts'`（Phase B 会再改成 `bootstrap`）
  - `main.ts` 里 `import { DebugHUD } from './ui/DebugHUD.ts'` → `'./demos/planet/ui/DebugHUD.ts'`
  - `demos/planet/graph.ts`（原 GraphBuilder）里 `from './nodes/X'` → 保持（同目录了）
  - `demos/planet/nodes/*.ts` 里所有相对 import 都要重算：
    - `from '../BaseNode'` → `from '../../../framework/graph/BaseNode.ts'`
    - `from '../../core/*'` → `from '../../../framework/core/*'`
    - `from '../../ecs/Scene'` → `from '../../../framework/ecs/Scene'`
    - `from '../../ecs/components/PlanetComponent'` → `from '../components/PlanetComponent.ts'`
    - `from '../../shaders/*.wgsl?raw'` → `from '../shaders/*.wgsl?raw'`
    - `from '../../utils/icosphere'` → `from '../utils/icosphere.ts'`
  - `demos/planet/controllers/OrbitCameraController.ts` 类似重算
  - `demos/planet/ui/DebugHUD.ts` 里 `from '../graph/nodes/DebugWireframeNode'` → `'../nodes/DebugWireframeNode.ts'`；`from '../core/types'` → `'../params.ts'`
  - 测试文件类似重算

- [ ] **Step 8: Build + test**
  ```bash
  npm run build && npm test
  ```

- [ ] **Step 9: 视觉验证**
  ```bash
  npm run dev
  ```
  浏览器打开，确认 planet 显示正常，wireframe 快捷键（W）能切换，HUD 面板存在。

- [ ] **Step 10: 提交 Phase A**
  ```bash
  git status  # 应看到大量 rename
  git add -A
  git commit -m "refactor: reorganize files into framework/ and demos/planet/

Move all files under src/ into src/framework/ (demo-agnostic) or
src/demos/planet/ (business-specific) preserving existing behavior.
Split core/types.ts into framework/graph/types.ts (context types) and
demos/planet/params.ts (planet-specific params). Tests reorganized
alongside code.

No API or behavior changes; git mv used throughout for blame history."
  ```
  ⚠️ **等操作者确认 diff 后再执行 commit。**

---

## Phase B — Engine 拆分 & Loop 反转

Phase A 完成后开始。Phase B 的目标是把"帧循环"从 Engine 内部移到 demo bootstrap，并从 `FrameContext` 去掉 `resources`（`sceneColorView` / `depthView` 暂留，Phase C 才清）。

### Task B1: `WebGPUEngine` → `WebGPUContext` 改名 + 瘦身

**Files:**
- Modify + rename: `src/framework/core/WebGPUEngine.ts` → `src/framework/core/WebGPUContext.ts`
- Modify: `src/main.ts`（引用者）
- Modify: `src/demos/planet/graph.ts`（引用者）

**Interfaces:**
- Produces: `WebGPUContext` class with fields `device`, `resources`, `pipelines`, `surfaceDescriptor`; methods `addSurface(surface): SurfaceResources`, `getSurfaceResources(i: number): SurfaceResources`
- Removed: `start()`, `setGraph()`, `_graph`, `_frameIndex`, `_lastTime`, `_totalTime`, `_tick()`

- [ ] **Step 1: git mv 改名**
  ```bash
  git mv src/framework/core/WebGPUEngine.ts src/framework/core/WebGPUContext.ts
  ```

- [ ] **Step 2: 编辑 WebGPUContext.ts**
  在文件里执行以下删除：
  - 删除 `import { RenderGraph }` 一行
  - 删除类中 `_graph?: RenderGraph;` 字段
  - 删除 `_frameIndex`, `_lastTime`, `_totalTime` 字段
  - 删除 `setGraph()` 方法
  - 删除 `start()` 方法
  - 删除 `_tick()` 方法
  - 类名从 `WebGPUEngine` 改为 `WebGPUContext`

- [ ] **Step 3: 更新 `src/main.ts`**
  暂时的 main.ts 结构（Phase B 结束时会再改）：
  ```typescript
  import { initWebGPU }           from './framework/core/initWebGPU.ts';
  import { CanvasSurfaceManager } from './framework/core/CanvasSurfaceManager.ts';
  import { WebGPUContext }        from './framework/core/WebGPUContext.ts';
  import { GraphBuilder }         from './demos/planet/graph.ts';
  import { DebugHUD }             from './demos/planet/ui/DebugHUD.ts';

  async function main(): Promise<void> {
    const canvas  = document.getElementById('webgpu-canvas') as HTMLCanvasElement;
    const device  = await initWebGPU();
    const context = new WebGPUContext(device);
    context.addSurface(new CanvasSurfaceManager(canvas, device));
    const { debugWireframe, cloudParams, materialParams } = GraphBuilder.build(context, canvas);
    // ⚠️ 循环这里还没搭起来 —— 本 task 暂时 stub，B3-B5 补齐
    if (import.meta.env.DEV) new DebugHUD(debugWireframe, cloudParams, materialParams);
  }
  main().catch(err => { document.body.innerHTML = `<pre>${String(err)}</pre>`; });
  ```
  可能有 TS 报错说 GraphBuilder 参数类型不匹配（WebGPUContext vs WebGPUEngine）—— 下一步处理。

- [ ] **Step 4: 更新 GraphBuilder 里的参数类型**
  在 `src/demos/planet/graph.ts` 里把 `engine: WebGPUEngine` 参数类型改为 `context: WebGPUContext`；类名 `WebGPUEngine` 全局替换为 `WebGPUContext`；`engine.setGraph(graph)` 调用**注释掉**（B3 会重构 RenderGraph 使用方式）。

- [ ] **Step 5: Build**
  ```bash
  npm run build
  ```
  预期还有一些错误——RenderGraph 相关。**这个 task 结束时 build 允许失败**，因为帧循环还没接上。跑 test 不受影响：
  ```bash
  npm test
  ```
  Expected: 现有 11 个测试全绿（它们不依赖 engine.start()）。

- [ ] **Step 6: 暂停 commit**（合并到 B6 一起 commit）

### Task B2: 新增 `framework/core/FrameLoop.ts`

**Files:**
- Create: `src/framework/core/FrameLoop.ts`

**Interfaces:**
- Produces: `class FrameLoop { constructor(tick: (frame: FrameContext) => void, device: GPUDevice); start(): void; stop(): void; get running(): boolean }`
- Consumes: `FrameContext` from `framework/graph/types.ts`

- [ ] **Step 1: 建文件**
  ```typescript
  // src/framework/core/FrameLoop.ts
  import type { FrameContext } from '../graph/types.ts';

  export class FrameLoop {
    private _tick: (frame: FrameContext) => void;
    private _device: GPUDevice;
    private _running = false;
    private _rafId = 0;
    private _lastTime = 0;
    private _frameIndex = 0;
    private _totalTime = 0;

    constructor(tick: (frame: FrameContext) => void, device: GPUDevice) {
      this._tick   = tick;
      this._device = device;
    }

    get running(): boolean { return this._running; }

    start(): void {
      if (this._running) return;
      this._running  = true;
      this._lastTime = performance.now();
      const loop = (timestamp: number): void => {
        if (!this._running) return;
        const dt = Math.min((timestamp - this._lastTime) / 1000, 0.1);
        this._lastTime = timestamp;
        this._totalTime += dt;
        this._frameIndex++;
        const frame: FrameContext = {
          device:     this._device,
          frameIndex: this._frameIndex,
          dt,
          totalTime:  this._totalTime,
        };
        this._tick(frame);
        this._rafId = requestAnimationFrame(loop);
      };
      this._rafId = requestAnimationFrame(loop);
    }

    stop(): void {
      if (!this._running) return;
      this._running = false;
      cancelAnimationFrame(this._rafId);
    }
  }
  ```
  ⚠️ 此时 `FrameContext` 里还有 `targetView`/`sceneColorView`/`depthView`/`resources` 字段 —— **本 step 里 FrameLoop 只填 4 个新字段就会报 TS 错**。这是预期的，下一 step 处理。

- [ ] **Step 2: 修 `FrameContext` 类型** （在 `framework/graph/types.ts`）
  只删除 `resources` 字段。`sceneColorView`/`depthView`/`targetView` 保留。修改后：
  ```typescript
  export interface FrameContext {
    frameIndex:     number;
    dt:             number;
    totalTime:      number;
    device:         GPUDevice;
    targetView:     GPUTextureView;      // 暂留，Phase C 清理
    sceneColorView: GPUTextureView;      // 暂留，Phase C 清理
    depthView:      GPUTextureView;      // 暂留，Phase C 清理
  }
  ```

- [ ] **Step 3: 修 FrameLoop 的 tick 构造**
  由于 `FrameContext` 还有 `targetView`/`sceneColorView`/`depthView`，FrameLoop 不能独立构造出这些 view（那是 demo 层的责任）。改为让 tick 函数**接收**一个 "partial" ctx，由 demo 层补齐：
  
  修改 FrameLoop 里的 `frame` 构造，去掉 3 个 view 字段，改用 type-assertion 或让 demo 补齐。**方案：暂时把 FrameLoop 的 tick 签名改为 `(frame: Omit<FrameContext, 'targetView' | 'sceneColorView' | 'depthView'>) => void`**，demo bootstrap 里补齐 view。
  
  最终修改：
  ```typescript
  // FrameLoop.ts 里 tick 类型改为：
  export type FrameLoopTick = (frame: Pick<FrameContext, 'device' | 'frameIndex' | 'dt' | 'totalTime'>) => void;
  
  constructor(tick: FrameLoopTick, device: GPUDevice) { ... }
  ```
  然后 `frame` 对象只构造 4 个字段，去掉 3 个 view。

- [ ] **Step 4: Build**
  `npm run build` — 因为 GraphBuilder / Nodes 还在用 `ctx.resources`，会有大量错误。暂时**只**在 `types.ts` 里保留 `resources?: ResourceManager` 作为可选字段（加 `?`），让编译过：
  ```typescript
  resources?: ResourceManager;   // Phase B 兼容项，Phase C 会彻底删除
  ```
  重新 build，预期通过或只剩少量错误。

- [ ] **Step 5: 暂停 commit**

### Task B3: `RenderGraph` 瘦身

**Files:**
- Modify: `src/framework/core/RenderGraph.ts`

**Interfaces:**
- Produces: `class RenderGraph { addNode(node: IGraphNode): void; runFrame(encoder: GPUCommandEncoder, ctx: FrameContext): void }`
- Removed: `scene` field, `constructor(scene)`, `update()`, `execute()` separately

- [ ] **Step 1: 编辑 RenderGraph.ts**
  ```typescript
  import type { IGraphNode, FrameContext } from '../graph/types.ts';

  export class RenderGraph {
    private _nodes: IGraphNode[] = [];

    addNode(node: IGraphNode): void { this._nodes.push(node); }

    /** 每帧调用：run update + record all passes 到给定 encoder */
    runFrame(encoder: GPUCommandEncoder, ctx: FrameContext): void {
      for (const n of this._nodes) n.update(ctx);
      for (const n of this._nodes) n.recordPass(encoder, ctx);
    }
  }
  ```
  删除：`import Scene`, `readonly scene`, `constructor(scene)`, 分离的 `update()` 和 `execute()`。

- [ ] **Step 2: 修 `demos/planet/graph.ts` 里 `new RenderGraph(scene)` → `new RenderGraph()`**
  也删除文件末尾 `engine.setGraph(graph)` 那行注释（如果 B1 留了注释）。
  改让 `GraphBuilder.build()` 返回 `{ graph, ... }`，返回给 bootstrap 里让 loop 用。

- [ ] **Step 3: Build**
  预期还有一些错误，因为 main.ts 里没接上 loop。下一 task 处理。

- [ ] **Step 4: 暂停 commit**

### Task B4: 新增 `framework/renderer3d/SceneTargets.ts`

**Files:**
- Create: `src/framework/renderer3d/SceneTargets.ts`

**Interfaces:**
- Produces: `interface SceneTargets { color: TextureHandle<'scene.color'>; depth: TextureHandle<'scene.depth'> }`; `function create3DSceneTargets(context: WebGPUContext, surfaceIndex?: number): SceneTargets`
- Consumes: `WebGPUContext` (framework/core/); `TextureHandle` — **注意：本 phase Handle 系统还没建**。本 task 暂用 minimal 内联类型，Phase C 建 handles.ts 后统一 import。

- [ ] **Step 1: 建文件**
  ```typescript
  // src/framework/renderer3d/SceneTargets.ts
  import type { WebGPUContext } from '../core/WebGPUContext.ts';

  // 临时最小 handle 定义，Phase C 会替换为 framework/graph/handles.ts 的正式版本
  export interface TextureHandleLite<Tag extends string = string> {
    readonly __tag: Tag;
    readonly key: string;
  }

  export interface SceneTargets {
    color: TextureHandleLite<'scene.color'>;
    depth: TextureHandleLite<'scene.depth'>;
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
      color: { __tag: 'scene.color' as const, key: 'scene.color' },
      depth: { __tag: 'scene.depth' as const, key: 'scene.depth' },
    };
  }
  ```

- [ ] **Step 2: 从 GraphBuilder 中删除 `scene.color` / `scene.depth` 的 registerTexture 调用**
  它们现在归 `create3DSceneTargets()` 负责。

- [ ] **Step 3: Build**
  `npm run build`，预期错误逐渐减少但循环仍未接上。

- [ ] **Step 4: 暂停 commit**

### Task B5: `demos/planet/index.ts` bootstrap + `main.ts` 定型

**Files:**
- Create: `src/demos/planet/index.ts`
- Modify: `src/demos/planet/graph.ts`（重构 GraphBuilder → buildPlanetGraph 函数）
- Modify: `src/main.ts`

**Interfaces:**
- Produces: `bootstrap(context: WebGPUContext, canvas: HTMLCanvasElement): PlanetDemoHandle`; `PlanetDemoHandle { dispose(): void }`
- Consumes: `WebGPUContext`, `FrameLoop`, `create3DSceneTargets`, `buildPlanetGraph`

- [ ] **Step 1: 在 `graph.ts` 里把 `GraphBuilder.build()` 改成导出函数**
  ```typescript
  export function buildPlanetGraph(context: WebGPUContext, canvas: HTMLCanvasElement): {
    graph:          RenderGraph;
    scene:          Scene;
    sceneTargets:   SceneTargets;
    debugWireframe: DebugWireframeNode;
    cloudParams:    CloudParams;
    materialParams: MaterialParams;
  } {
    // ... 原 GraphBuilder.build 的内容
    // 1) 用 create3DSceneTargets(context) 代替原 registerTexture('scene.color'/...)
    // 2) 返回 graph 和 scene 供 bootstrap 里搭桥（Phase B 阶段 nodes 还需要 scene，Phase C 才彻底切）
  }
  ```
  暂时保留 GraphBuilder class 作为 wrapper 也可（`GraphBuilder.build = buildPlanetGraph`），或直接删掉 class 语法。

- [ ] **Step 2: 建 `demos/planet/index.ts`**
  ```typescript
  // src/demos/planet/index.ts
  import type { WebGPUContext } from '../../framework/core/WebGPUContext.ts';
  import { FrameLoop }           from '../../framework/core/FrameLoop.ts';
  import { buildPlanetGraph }    from './graph.ts';
  import { DebugHUD }            from './ui/DebugHUD.ts';

  export interface PlanetDemoHandle {
    dispose(): void;
  }

  export function bootstrap(context: WebGPUContext, canvas: HTMLCanvasElement): PlanetDemoHandle {
    const { graph, sceneTargets, debugWireframe, cloudParams, materialParams } =
      buildPlanetGraph(context, canvas);

    const surfaceRes = context.getSurfaceResources(0);
    const surface    = context.surfaces[0];

    const loop = new FrameLoop((frame) => {
      // Phase B 兼容：把 view 塞进 ctx 让旧 Node 能读
      const ctx = frame as any;
      ctx.targetView     = surface.getTargetView();
      ctx.sceneColorView = surfaceRes.getView('scene.color');
      ctx.depthView      = surfaceRes.getView('scene.depth');
      ctx.resources      = context.resources;

      const encoder = context.device.createCommandEncoder();
      graph.runFrame(encoder, ctx);
      context.device.queue.submit([encoder.finish()]);
    }, context.device);
    loop.start();

    const hud = import.meta.env.DEV
      ? new DebugHUD(debugWireframe, cloudParams, materialParams)
      : undefined;

    return {
      dispose(): void { loop.stop(); /* hud 目前无 dispose，Phase D 补上 */ },
    };
  }
  ```

- [ ] **Step 3: 更新 `main.ts` 到最终形态**
  ```typescript
  // src/main.ts
  import { initWebGPU }           from './framework/core/initWebGPU.ts';
  import { CanvasSurfaceManager } from './framework/core/CanvasSurfaceManager.ts';
  import { WebGPUContext }        from './framework/core/WebGPUContext.ts';
  import { bootstrap }            from './demos/planet/index.ts';

  async function main(): Promise<void> {
    const canvas  = document.getElementById('webgpu-canvas') as HTMLCanvasElement;
    const device  = await initWebGPU();
    const context = new WebGPUContext(device);
    context.addSurface(new CanvasSurfaceManager(canvas, device));
    bootstrap(context, canvas);
  }

  main().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    document.body.innerHTML = `<pre style="color:red;padding:1rem;">${msg}</pre>`;
  });
  ```

- [ ] **Step 4: 补 `WebGPUContext.surfaces` getter**（如果之前没暴露）
  在 `src/framework/core/WebGPUContext.ts` 里加：
  ```typescript
  get surfaces(): ISurface[] { return this._surfaces.map(p => p.surface); }
  ```

- [ ] **Step 5: Build + test**
  ```bash
  npm run build && npm test
  ```
  预期全绿。

- [ ] **Step 6: 视觉验证**
  ```bash
  npm run dev
  ```
  浏览器打开：planet 应正常显示 + 旋转、wireframe（W 键）能切、HUD 存在。**这是 Phase B 的核心里程碑。**

- [ ] **Step 7: HMR 泄漏检查**
  在 dev server 运行状态下：改一下 `demos/planet/graph.ts` 里任意注释保存。刷新前后打开 Chrome DevTools Performance → 检查 requestAnimationFrame 是否**没有叠加**（应仍是一条 timeline，而不是多条）。若叠加，说明 dispose 没生效，需 debug。
  
  Phase B 特有：HMR 会重新执行 main.ts，但旧的 loop 无人 stop。Vite 的 HMR 模块热替换会 discard 旧模块，但 RAF 回调仍持引用。**可接受**：本项目不做完整 HMR dispose 集成（YAGNI），只要"整页刷新"后无泄漏即可。

- [ ] **Step 8: 提交 Phase B**
  ```bash
  git add -A
  git commit -m "refactor: extract FrameLoop and slim WebGPUContext

WebGPUEngine renamed to WebGPUContext with loop/graph ownership removed.
New FrameLoop class handles the RAF cycle; demos/planet/index.ts owns
the tick function and can dispose(). RenderGraph simplified to
runFrame(encoder, ctx). New framework/renderer3d/SceneTargets.ts owns
the scene.color/scene.depth convention (was hardcoded in WebGPUEngine).

FrameContext.resources removed. targetView/sceneColorView/depthView
retained as compat shim until Phase C migrates nodes to handles."
  ```
  ⚠️ **等确认。**

---

## Phase C — Handle 系统 & Node 新契约

Phase B 完成后开始。这是最大改动。每个 Node 迁移都独立成 task，可独立 revert。

### Task C1: 建 `framework/graph/handles.ts`

**Files:**
- Create: `src/framework/graph/handles.ts`
- Modify: `src/framework/renderer3d/SceneTargets.ts`（用正式 handle 替换 `TextureHandleLite`）

**Interfaces:**
- Produces: `BufferHandle<Tag>`, `TextureHandle<Tag>`, `createBufferHandle`, `createTextureHandle` factory

- [ ] **Step 1: 建 handles.ts**
  ```typescript
  // src/framework/graph/handles.ts
  export interface BufferHandle<Tag extends string = string> {
    readonly __tag:  Tag;
    readonly __kind: 'buffer';
    readonly key:    string;
  }
  export interface TextureHandle<Tag extends string = string> {
    readonly __tag:  Tag;
    readonly __kind: 'texture';
    readonly key:    string;
  }
  ```

- [ ] **Step 2: 替换 SceneTargets 中的 TextureHandleLite**
  ```typescript
  import type { TextureHandle } from '../graph/handles.ts';
  export interface SceneTargets {
    color: TextureHandle<'scene.color'>;
    depth: TextureHandle<'scene.depth'>;
  }
  // return 里加 __kind: 'texture'
  ```
  删除 `TextureHandleLite` 定义。

- [ ] **Step 3: Build + test**
  ```bash
  npm run build && npm test
  ```

- [ ] **Step 4: 暂停 commit**

### Task C2: `ResourceManager` typed API

**Files:**
- Modify: `src/framework/core/ResourceManager.ts`

**Interfaces:**
- Produces (new methods): `createBufferHandle<Tag>(tag: Tag, desc: GPUBufferDescriptor): BufferHandle<Tag>`; `createTextureHandle<Tag>(tag: Tag, desc: GPUTextureDescriptor): TextureHandle<Tag>`; `resolveBuffer(h: BufferHandle): GPUBuffer`; `resolveTexture(h: TextureHandle): GPUTexture`
- Kept (deprecated): `createBuffer(key, desc)`, `getBuffer(key)`, `createTexture(key, desc)`, `getTexture(key)` — Phase C 结束时才可以删

- [ ] **Step 1: 读现有 ResourceManager**
  ```bash
  cat src/framework/core/ResourceManager.ts
  ```

- [ ] **Step 2: 加 typed API（不删旧 API）**
  在 ResourceManager 类内追加：
  ```typescript
  import type { BufferHandle, TextureHandle } from '../graph/handles.ts';

  createBufferHandle<Tag extends string>(tag: Tag, desc: GPUBufferDescriptor): BufferHandle<Tag> {
    this.createBuffer(tag, desc);  // 复用旧实现，key = tag
    return { __tag: tag, __kind: 'buffer', key: tag };
  }
  createTextureHandle<Tag extends string>(tag: Tag, desc: GPUTextureDescriptor): TextureHandle<Tag> {
    this.createTexture(tag, desc);
    return { __tag: tag, __kind: 'texture', key: tag };
  }
  resolveBuffer(h: BufferHandle): GPUBuffer {
    const b = this.getBuffer(h.key);
    if (!b) throw new Error(`resolveBuffer: no buffer for '${h.key}'`);
    return b;
  }
  resolveTexture(h: TextureHandle): GPUTexture {
    const t = this.getTexture(h.key);
    if (!t) throw new Error(`resolveTexture: no texture for '${h.key}'`);
    return t;
  }
  ```

- [ ] **Step 3: Build + test**

- [ ] **Step 4: 暂停 commit**

### Task C3: 重写 `BaseNode`

**Files:**
- Modify: `src/framework/graph/BaseNode.ts`

**Interfaces:**
- Produces: `abstract class BaseNode<I extends NodeInputs = {}, O extends NodeOutputs = {}>`; methods `setInputs(i: I): this`, getter `outputs: O`, protected `_inputs`, `_outputs`
- 保留：`build(ctx)`, `update(ctx)`, `recordPass(encoder, ctx)` 抽象方法签名不变

- [ ] **Step 1: 编辑 BaseNode.ts**
  ```typescript
  // src/framework/graph/BaseNode.ts
  import type { IGraphNode, BuildContext, FrameContext } from './types.ts';
  import type { BufferHandle, TextureHandle } from './handles.ts';

  export type NodeInputs  = Record<string, unknown>;
  export type NodeOutputs = Record<string, BufferHandle | TextureHandle>;

  export abstract class BaseNode<
    I extends NodeInputs  = {},
    O extends NodeOutputs = {},
  > implements IGraphNode {
    abstract readonly name: string;

    protected _inputs!:  I;
    protected _outputs!: O;

    setInputs(inputs: I): this {
      this._inputs = inputs;
      return this;
    }

    get outputs(): O { return this._outputs; }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    build(_ctx: BuildContext): void {}
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    update(_ctx: FrameContext): void {}
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    recordPass(_encoder: GPUCommandEncoder, _ctx: FrameContext): void {}
  }
  ```

- [ ] **Step 2: 修 4 个空 stub node**（GasPlanetNode / IceBiomeNode / IndustrialOverlayNode / SSAONode）
  这些是 7 行空文件，新 BaseNode 是泛型，无参数默认为 `{}`。它们的 `extends BaseNode` 需要写作 `extends BaseNode<{}, {}>` 或保持 `extends BaseNode`（因默认值），并需实现 abstract `name`。
  查看当前内容：
  ```bash
  cat src/demos/planet/nodes/GasPlanetNode.ts
  ```
  确认 stub 后加上必要的 `readonly name`，若没有 build 则跳过（因为不再抽象）。
  
  Example 修补：
  ```typescript
  export class GasPlanetNode extends BaseNode {
    readonly name = 'GasPlanet';
  }
  ```

- [ ] **Step 3: Build**
  ```bash
  npm run build
  ```
  预期：8 个活跃 node 大量报错（因为它们还在用旧 constructor 签名等）。这些将在 C4-C11 逐个修。**test 应仍能跑**因为 test 不 import node runtime。

- [ ] **Step 4: 允许 build 暂时失败，跑 test 确认核心机制未坏**
  ```bash
  npm test
  ```

- [ ] **Step 5: 暂停 commit**

### Task C4: 迁移 `ComputeNoiseNode`

**Files:**
- Modify: `src/demos/planet/nodes/ComputeNoiseNode.ts`
- Modify: `src/demos/planet/graph.ts`（改 constructor 调用 + setInputs）

**Interfaces:**
- Produces:
  ```typescript
  class ComputeNoiseNode extends BaseNode<
    { subdivisions: number; noiseParams: NoiseParams; classifyParams: ClassifyParams },
    { heightBuffer: BufferHandle<'terrain.height'>; splatBuffer: BufferHandle<'terrain.splat'> }
  >
  ```

- [ ] **Step 1: 读现有 `ComputeNoiseNode.ts`**
  ```bash
  cat src/demos/planet/nodes/ComputeNoiseNode.ts
  ```

- [ ] **Step 2: 重写以匹配新契约**
  - Constructor 只接收 `ctx.device / ctx.resources / ctx.pipelines`（build 阶段），删除 `resources: ResourceManager, pipelines: PipelineManager` 参数
  - 在 `build(ctx)` 里：用 `ctx.resources.createBufferHandle('terrain.height', ...)` 创建 output handle，赋值给 `this._outputs = { heightBuffer, splatBuffer }`
  - 在 `update(ctx)` 里只读 `this._inputs`（subdivisions / noiseParams / classifyParams）
  - `recordPass` 里通过 `ctx.device` + `this._outputs` 或缓存的 `GPUBuffer` 执行 compute

- [ ] **Step 3: 修 graph.ts 调用**
  `new ComputeNoiseNode(context.resources, context.pipelines)` → `new ComputeNoiseNode()`
  在 bridgeInputs 里（如果 B5 里没建，本 step 建）：
  ```typescript
  const bridgeInputs = (frame: FrameContext) => {
    const p = planet.getComponent(PlanetComponent)!;
    noise.setInputs({
      subdivisions: p.subdivisions,
      noiseParams:  DEFAULT_NOISE_PARAMS,  // 之后可暴露 HUD
      classifyParams: DEFAULT_CLASSIFY_PARAMS,
    });
    // ... 其他节点暂用旧代码
  };
  // 在 FrameLoop tick 或 RenderGraph.runFrame 之前调用 bridgeInputs
  ```
  由于 B5 里 loop 现在是：`graph.runFrame(encoder, ctx)`，可以在 `bootstrap` 里 loop tick 内先调 `bridgeInputs(frame)` 再 `graph.runFrame`。**修改 `bootstrap`** 让它接收 `bridgeInputs` 并调用。

- [ ] **Step 4: 修 `buildPlanetGraph` 返回值加 `bridgeInputs`**
  ```typescript
  return { graph, sceneTargets, debugWireframe, cloudParams, materialParams, bridgeInputs };
  ```
  修改 `bootstrap` 里：
  ```typescript
  const { graph, ..., bridgeInputs } = buildPlanetGraph(context, canvas);
  const loop = new FrameLoop((frame) => {
    // ... 兼容 view 塞入
    bridgeInputs(frame);      // ← 新增
    const encoder = context.device.createCommandEncoder();
    graph.runFrame(encoder, ctx);
    // ...
  }, context.device);
  ```

- [ ] **Step 5: Build + test**

- [ ] **Step 6: 视觉验证**
  `npm run dev` — planet 应仍正常。因 ComputeNoise 的输出未变（还是同名 buffer），planet 表面应无差别。

- [ ] **Step 7: 提交**
  ```bash
  git add src/demos/planet/nodes/ComputeNoiseNode.ts src/demos/planet/graph.ts src/demos/planet/index.ts
  git commit -m "refactor(planet): migrate ComputeNoiseNode to typed input/output contract"
  ```
  ⚠️ **等确认。**

### Task C5: 迁移 `NormalComputeNode`

**Files:**
- Modify: `src/demos/planet/nodes/NormalComputeNode.ts`
- Modify: `src/demos/planet/graph.ts`

**Interfaces:**
- Produces:
  ```typescript
  class NormalComputeNode extends BaseNode<
    { heightBuffer: BufferHandle<'terrain.height'>; subdivisions: number },
    { normalBuffer: BufferHandle<'terrain.normal'> }
  >
  ```

- [ ] **Step 1: 读现有 NormalComputeNode.ts**

- [ ] **Step 2: 重写：constructor 简化，build 里创建 output handle，update 从 inputs 读**

- [ ] **Step 3: 修 graph.ts 里 setInputs**
  ```typescript
  normal.setInputs({
    heightBuffer: noise.outputs.heightBuffer,
    subdivisions: p.subdivisions,
  });
  ```

- [ ] **Step 4: Build + test + 视觉验证**

- [ ] **Step 5: Commit**（`refactor(planet): migrate NormalComputeNode to typed contract`）⚠️ 等确认

### Task C6: 迁移 `AtmosphereLUTNode`

**Files:**
- Modify: `src/demos/planet/nodes/AtmosphereLUTNode.ts`
- Modify: `src/demos/planet/graph.ts`

**Interfaces:**
- Produces:
  ```typescript
  class AtmosphereLUTNode extends BaseNode<
    { params: AtmosphereLUTParams; preset: LUTPreset },
    { lut: TextureHandle<'atmosphere.lut'> }
  >
  ```

- [ ] **Step 1: 读现有 AtmosphereLUTNode.ts**
  ```bash
  cat src/demos/planet/nodes/AtmosphereLUTNode.ts
  ```

- [ ] **Step 2: 重写以匹配新契约**
  - Constructor 无参
  - `build(ctx)` 里创建 LUT texture 并保存到 `this._outputs.lut = ctx.resources.createTextureHandle('atmosphere.lut', ...)`；同时创建 compute pipeline
  - `update(ctx)` 检测 `this._inputs.preset` / `this._inputs.params` 是否变化，变化则标记需 rebuild LUT
  - `recordPass(encoder, ctx)` 若首帧或参数变化，执行 compute pass 更新 LUT

- [ ] **Step 3: 修 graph.ts 里调用**
  ```typescript
  new AtmosphereLUTNode()
  // bridgeInputs 里：
  lut.setInputs({
    params: DEFAULT_ATMOSPHERE_LUT_PARAMS,
    preset: 'high',
  });
  ```

- [ ] **Step 4: Build + test + 视觉验证**
  LUT 通常只 build 阶段生成一次，视觉应无差别。

- [ ] **Step 5: Commit**（`refactor(planet): migrate AtmosphereLUTNode to typed contract`）⚠️ 等确认

### Task C7: 迁移 `CloudCoverageNode`

**Files:**
- Modify: `src/demos/planet/nodes/CloudCoverageNode.ts`
- Modify: `src/demos/planet/graph.ts`

**Interfaces:**
- Produces:
  ```typescript
  class CloudCoverageNode extends BaseNode<
    { cloudParams: CloudParams; sunDir: Vec3; totalTime: number },
    { coverageTexture: TextureHandle<'cloud.coverage'> }
  >
  ```

- [ ] **Step 1: 读现有 CloudCoverageNode.ts**

- [ ] **Step 2: 重写：**
  - Constructor 无参
  - `build(ctx)` 创建 coverage texture handle：`this._outputs.coverageTexture = ctx.resources.createTextureHandle('cloud.coverage', ...)`；创建 compute pipeline + uniform buffer
  - `update(ctx)` 从 `this._inputs.cloudParams` / `sunDir` / `totalTime` 计算 uniform 并写入
  - `recordPass(encoder, ctx)` 执行 compute pass

- [ ] **Step 3: 修 graph.ts 里调用**
  ```typescript
  new CloudCoverageNode()
  // bridgeInputs 里：
  cloudCov.setInputs({
    cloudParams: params.cloud,
    sunDir:      normalizedSunDir,
    totalTime:   frame.totalTime,
  });
  ```

- [ ] **Step 4: Build + test + 视觉验证**
  云覆盖图会作为下游 CloudRenderNode 的输入，本 task 单独看不出视觉变化，但整体渲染不应破坏。

- [ ] **Step 5: Commit**（`refactor(planet): migrate CloudCoverageNode to typed contract`）⚠️ 等确认

### Task C8: 迁移 `DebugWireframeNode`

**Files:**
- Modify: `src/demos/planet/nodes/DebugWireframeNode.ts`
- Modify: `src/demos/planet/graph.ts`

**Interfaces:**
- Produces:
  ```typescript
  class DebugWireframeNode extends BaseNode<
    { vpMatrix: Mat4; modelMatrix: Mat4; heightBuffer: BufferHandle<'terrain.height'>; subdivisions: number; enabled: boolean;
      colorTarget: TextureHandle<'scene.color'>; depthTarget: TextureHandle<'scene.depth'> },
    {}
  >
  ```
- 保留 `toggle: { enabled: boolean }` 作为外部引用给 HUD 用

- [ ] **Step 1: 读现有 DebugWireframeNode.ts**

- [ ] **Step 2: 重写：**
  - Constructor 无参；保留 `enabled: boolean` public 字段（HUD 引用它）
  - 或改为 `readonly toggle = { enabled: false }` 让外部只持有 toggle 对象
  - `build(ctx)` 创建 line-topology pipeline + uniform buffer
  - `update(ctx)` 从 inputs 读 vp/model 矩阵、写 uniform；判断 `this._inputs.enabled` 决定 pass 是否 skip
  - `recordPass(encoder, ctx)` 若 `_inputs.enabled = false` 直接返回；否则：resolve colorTarget/depthTarget 的 view，开 render pass，读 heightBuffer 生成线框位置，绘制

- [ ] **Step 3: 修 graph.ts 里调用**
  ```typescript
  const wire = new DebugWireframeNode();
  // graph.addNode(wire)
  // debugState = { wireframe: wire.toggle };  // 或直接 wire 自身
  // bridgeInputs:
  wire.setInputs({
    vpMatrix, modelMatrix, heightBuffer: noise.outputs.heightBuffer,
    subdivisions: p.subdivisions,
    enabled: wire.toggle.enabled,
    colorTarget: sceneTargets.color,
    depthTarget: sceneTargets.depth,
  });
  ```

- [ ] **Step 4: Build + test + 视觉验证**
  按 W 键应能切换线框显示。

- [ ] **Step 5: Commit**（`refactor(planet): migrate DebugWireframeNode to typed contract`）⚠️ 等确认

### Task C9: 迁移 `PlanetRenderNode`（最复杂）

**Files:**
- Modify: `src/demos/planet/nodes/PlanetRenderNode.ts`
- Modify: `src/demos/planet/graph.ts`

**Interfaces:**
- Produces:
  ```typescript
  class PlanetRenderNode extends BaseNode<
    {
      heightBuffer:   BufferHandle<'terrain.height'>;
      splatBuffer:    BufferHandle<'terrain.splat'>;
      normalBuffer:   BufferHandle<'terrain.normal'>;
      colorTarget:    TextureHandle<'scene.color'>;
      depthTarget:    TextureHandle<'scene.depth'>;
      vpMatrix:       Mat4;
      modelMatrix:    Mat4;
      cameraPos:      Vec3;
      sunDir:         Vec3;
      displaceScale:  number;
      lightColor:     Vec3;
      lightIntensity: number;
      materials:      MaterialParam[];
      subdivisions:   number;
    },
    {}
  >
  ```

- [ ] **Step 1: 读现有 PlanetRenderNode.ts** — 251 行，最大一个 node

- [ ] **Step 2: 重写：**
  - 移除 `scene`, `_scene`, `_materialParams`（materialParams 现从 inputs 每帧读）
  - `build()` 中：
    - 从 `ctx.resources.resolveBuffer(this._inputs.heightBuffer)` 拿 GPU buffer 建 bind group **⚠️ 问题：build 时 inputs 还没设**
    - **解决方案**：build 只创建 pipeline / uniform buffer / material buffer / vertex buffer / index buffer；bind group 的构造推迟到 update 或 recordPass（因为需要 input buffer 的 GPUBuffer）
    - 或者：build 里保存对 `ctx.resources` 的引用，在 update 里通过 `this._inputs.heightBuffer` 的 handle 惰性 resolve 并 memoize bind group
  - `update()` 里：从 `this._inputs` 读矩阵、位置、光照，写 `_perFrameBuffer` + `_materialBuffer`
  - `recordPass()` 里：从 `ctx` 获取 colorTarget/depthTarget 的 view（**问题：ctx 没 view，只有 device**）
    - **解决方案**：把 view 也纳入 inputs：加 `colorTargetView: GPUTextureView; depthTargetView: GPUTextureView` 到 inputs，让 demo bridge 每帧从 SurfaceResources 拿 view 塞进 inputs
    - 或者：resolveTexture 通过 handle 拿 GPUTexture，再 `.createView()`（每帧一次可接受，SurfaceResources 已缓存 texture）

- [ ] **Step 3: 修 graph.ts 里 setInputs**（含每帧从 SurfaceResources 取 view 塞入）
  ```typescript
  const surfaceRes = context.getSurfaceResources(0);
  // 在 bridgeInputs 里：
  planetN.setInputs({
    heightBuffer: noise.outputs.heightBuffer,
    splatBuffer:  noise.outputs.splatBuffer,
    normalBuffer: normal.outputs.normalBuffer,
    colorTarget:  sceneTargets.color,
    depthTarget:  sceneTargets.depth,
    // 视图每帧取（SurfaceResources 内部缓存 texture）
    // 或让 Node 自己 resolve
    vpMatrix:      cam.getVPMatrix(camera.transform.position),
    modelMatrix:   scaledModelMatrix(planet, planetComp.radius),
    cameraPos:     camera.transform.position,
    sunDir:        normalize(sunComp.worldPosition),
    displaceScale: planetComp.displaceScale,
    lightColor:    materialParams.lightColor,
    lightIntensity: materialParams.lightIntensity,
    materials:     materialParams.materials,
    subdivisions:  planetComp.subdivisions,
  });
  ```

- [ ] **Step 4: Build + test + 视觉验证** ⚠️ 这一步风险最大，若视觉异常需回滚重试

- [ ] **Step 5: Commit** ⚠️ 等确认

### Task C10: 迁移 `CloudRenderNode`

**Files:**
- Modify: `src/demos/planet/nodes/CloudRenderNode.ts`
- Modify: `src/demos/planet/graph.ts`

**Interfaces:**
- Produces:
  ```typescript
  class CloudRenderNode extends BaseNode<
    {
      coverageTexture: TextureHandle<'cloud.coverage'>;
      colorTarget:     TextureHandle<'scene.color'>;
      depthTarget:     TextureHandle<'scene.depth'>;
      vpMatrix:        Mat4;
      cameraPos:       Vec3;
      sunDir:          Vec3;
      cloudParams:     CloudParams;
      totalTime:       number;
    },
    {}
  >
  ```

- [ ] **Step 1: 读现有 CloudRenderNode.ts**

- [ ] **Step 2: 重写：**
  - Constructor 无参；移除对 scene 的引用
  - `build(ctx)` 创建 render pipeline（sample `cloud.coverage` texture + 输出到 `scene.color`）+ uniform buffer
  - `update(ctx)` 从 inputs 读 vp / cameraPos / sunDir / cloudParams / totalTime → 写 uniform
  - `recordPass(encoder, ctx)` resolve colorTarget/depthTarget view，resolve coverageTexture view，开 render pass 用 alpha blend 叠加云

- [ ] **Step 3: 修 graph.ts 里调用**
  ```typescript
  new CloudRenderNode()
  // bridgeInputs:
  cloudR.setInputs({
    coverageTexture: cloudCov.outputs.coverageTexture,
    colorTarget:     sceneTargets.color,
    depthTarget:     sceneTargets.depth,
    vpMatrix:        vp,
    cameraPos:       camera.transform.position,
    sunDir:          normalizedSunDir,
    cloudParams:     params.cloud,
    totalTime:       frame.totalTime,
  });
  ```

- [ ] **Step 4: Build + test + 视觉验证**
  云层应正常渲染在星球上方。

- [ ] **Step 5: Commit**（`refactor(planet): migrate CloudRenderNode to typed contract`）⚠️ 等确认

### Task C11: 迁移 `AtmosphereNode`

**Files:**
- Modify: `src/demos/planet/nodes/AtmosphereNode.ts`
- Modify: `src/demos/planet/graph.ts`

**Interfaces:**
- Produces:
  ```typescript
  class AtmosphereNode extends BaseNode<
    {
      lut:         TextureHandle<'atmosphere.lut'>;
      colorTarget: TextureHandle<'scene.color'>;
      depthTarget: TextureHandle<'scene.depth'>;
      targetView:  GPUTextureView;    // 最终输出到 swap chain（该 node 特殊，输出到 canvas）
      vpMatrix:    Mat4;
      cameraPos:   Vec3;
      sunDir:      Vec3;
      params:      AtmosphereParams;
      planetRadius: number;
    },
    {}
  >
  ```

- [ ] **Step 1: 读现有 AtmosphereNode.ts**

- [ ] **Step 2: 重写：**
  - Constructor 无参；移除 scene 引用
  - `build(ctx)` 创建 full-screen atmosphere shader pipeline + uniform buffer；采样 LUT texture
  - `update(ctx)` 从 inputs 读 vp / cameraPos / sunDir / params / planetRadius → 写 uniform
  - `recordPass(encoder, ctx)` 打开 render pass 输出到 `this._inputs.targetView`（swap chain），采样 `scene.color` 和 LUT，做大气合成

- [ ] **Step 3: 修 graph.ts + bridgeInputs**
  ```typescript
  new AtmosphereNode()
  // bridgeInputs：注意 targetView 每帧都要重新取（swap chain 每帧的 view 不同）
  atmos.setInputs({
    lut:          lutNode.outputs.lut,
    colorTarget:  sceneTargets.color,
    depthTarget:  sceneTargets.depth,
    targetView:   context.surfaces[0].getTargetView(),
    vpMatrix:     vp,
    cameraPos:    camera.transform.position,
    sunDir:       normalizedSunDir,
    params:       DEFAULT_ATMOSPHERE_PARAMS,   // 或从 params 面板暴露
    planetRadius: planetComp.radius,
  });
  ```

- [ ] **Step 4: Build + test + 视觉验证**
  大气散射效果应正常。这是最后一个 pass，直接输出到 canvas。

- [ ] **Step 5: Commit**（`refactor(planet): migrate AtmosphereNode to typed contract`）⚠️ 等确认

### Task C12: Phase C 收尾清理

**Files:**
- Modify: `src/framework/graph/types.ts`
- Modify: `src/demos/planet/index.ts`
- Modify: `src/framework/core/ResourceManager.ts`（可选：删除已无用的字符串 API）

**Interfaces:**
- Final `FrameContext`: `{ device, frameIndex, dt, totalTime }`（无 view / resources）

- [ ] **Step 1: 从 `FrameContext` 删除 `targetView` / `sceneColorView` / `depthView` / `resources?`**
  ```typescript
  export interface FrameContext {
    device:     GPUDevice;
    frameIndex: number;
    dt:         number;
    totalTime:  number;
  }
  ```

- [ ] **Step 2: 从 `demos/planet/index.ts` 的 tick 函数删除 view / resources 塞入代码**
  只保留：`bridgeInputs(frame); const encoder = ...; graph.runFrame(encoder, frame); submit`

- [ ] **Step 3: 检查 Node 中是否还有 `scene.getEntitiesWith` / `ctx.resources` / `ctx.sceneColorView` 等**
  ```bash
  grep -rE "scene\.(getEntitiesWith|mainCamera)|ctx\.(resources|sceneColorView|depthView|targetView)" src/demos/planet/nodes/
  ```
  Expected: 无输出。若有残留，回到相应 CX task 修补。

- [ ] **Step 4: 检查 ResourceManager 旧字符串 API 是否还有引用**
  ```bash
  grep -rn "resources\.getBuffer\|resources\.createBuffer\|resources\.getTexture\|resources\.createTexture" src/
  ```
  若全部改用了 handle API，可删除旧字符串 API（`createBuffer(key, desc)` 等）；若仍有引用（如 build 时 Node 内部创建自己的 uniform buffer），保留。

- [ ] **Step 5: Build + test + 视觉验证**

- [ ] **Step 6: Commit**
  ```bash
  git commit -m "refactor(framework): finalize FrameContext, remove compat shims

FrameContext now only contains device/frameIndex/dt/totalTime.
No node references scene.* or ctx.resources.
Nodes read all frame inputs via typed this._inputs."
  ```
  ⚠️ 等确认

---

## Phase D — UI Kit 拆分

可与 Phase C 并行执行，但为线性 plan 排在后面。

### Task D1: 建 `HUDPanel`

**Files:**
- Create: `src/framework/ui/HUDPanel.ts`

**Interfaces:**
- Produces: `class HUDPanel { constructor(opts: { title: string; position?: 'top-right'|'top-left'|'bottom-right'|'bottom-left' }); readonly el: HTMLElement; append(child: HTMLElement): void; dispose(): void }`

- [ ] **Step 1: 读现有 `DebugHUD._buildPanel()`（`src/demos/planet/ui/DebugHUD.ts:28-67`）**

- [ ] **Step 2: 建 HUDPanel.ts**
  ```typescript
  // src/framework/ui/HUDPanel.ts
  export interface HUDPanelOptions {
    title:     string;
    position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  }

  const POSITION_STYLE: Record<NonNullable<HUDPanelOptions['position']>, Partial<CSSStyleDeclaration>> = {
    'top-right':    { top: '12px', right: '12px' },
    'top-left':     { top: '12px', left:  '12px' },
    'bottom-right': { bottom: '12px', right: '12px' },
    'bottom-left':  { bottom: '12px', left:  '12px' },
  };

  export class HUDPanel {
    readonly el: HTMLElement;

    constructor(opts: HUDPanelOptions) {
      this.el = document.createElement('div');
      Object.assign(this.el.style, {
        position:     'fixed',
        width:        '260px',
        background:   'rgba(10,10,15,0.82)',
        borderRadius: '8px',
        padding:      '12px 16px',
        fontFamily:   'monospace',
        fontSize:     '13px',
        lineHeight:   '1.5',
        color:        '#cdd6f4',
        boxSizing:    'border-box',
        zIndex:       '9999',
        userSelect:   'none',
        maxHeight:    'calc(100vh - 24px)',
        overflowY:    'auto',
      }, POSITION_STYLE[opts.position ?? 'top-right']);

      const title = document.createElement('div');
      Object.assign(title.style, {
        fontSize:      '11px',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color:         '#6c7086',
        marginBottom:  '8px',
        paddingBottom: '6px',
        borderBottom:  '1px solid #313244',
      });
      title.textContent = opts.title;
      this.el.appendChild(title);

      document.body.appendChild(this.el);
    }

    append(child: HTMLElement): void { this.el.appendChild(child); }
    dispose(): void { this.el.remove(); }
  }
  ```

- [ ] **Step 3: Build + test**（无新测试要求，只确保不破坏）

- [ ] **Step 4: 暂停 commit**

### Task D2: 建 `HUDSection`

**Files:**
- Create: `src/framework/ui/HUDSection.ts`

**Interfaces:**
- Produces: `class HUDSection { constructor(title: string, expanded?: boolean); readonly el: HTMLElement; append(child: HTMLElement): void }`

- [ ] **Step 1: 读现有 `DebugHUD._buildSectionHeader()` + section 组装逻辑**（`src/demos/planet/ui/DebugHUD.ts:96-123, 191-206`）

- [ ] **Step 2: 建 HUDSection.ts**
  ```typescript
  // src/framework/ui/HUDSection.ts
  export class HUDSection {
    readonly el:     HTMLElement;
    private _body:   HTMLElement;
    private _arrow:  HTMLElement;
    private _open:   boolean;

    constructor(title: string, expanded = true) {
      this._open = expanded;
      this.el = document.createElement('div');
      Object.assign(this.el.style, { marginTop: '8px' });

      const header = document.createElement('div');
      Object.assign(header.style, {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase',
        color: '#6c7086', cursor: 'pointer', paddingBottom: '4px',
        borderBottom: '1px solid #313244', marginBottom: '6px',
      });
      const label = document.createElement('span');
      label.textContent = title;
      this._arrow = document.createElement('span');
      this._arrow.textContent = expanded ? '▼' : '▶';
      header.appendChild(label); header.appendChild(this._arrow);

      this._body = document.createElement('div');
      this._body.style.display = expanded ? 'block' : 'none';

      header.addEventListener('click', () => this._toggle());
      this.el.appendChild(header);
      this.el.appendChild(this._body);
    }

    append(child: HTMLElement): void { this._body.appendChild(child); }

    private _toggle(): void {
      this._open = !this._open;
      this._arrow.textContent = this._open ? '▼' : '▶';
      this._body.style.display = this._open ? 'block' : 'none';
    }
  }
  ```

- [ ] **Step 3: 暂停 commit**

### Task D3: 建 `HUDSlider`

**Files:**
- Create: `src/framework/ui/HUDSlider.ts`

**Interfaces:**
- Produces: `class HUDSlider { constructor(opts: { label: string; min: number; max: number; step: number; value: number; onInput: (v: number) => void }); readonly el: HTMLElement; setValue(v: number): void }`

- [ ] **Step 1: 读现有 `DebugHUD._buildGenericSlider()`（`src/demos/planet/ui/DebugHUD.ts:208-246`）**

- [ ] **Step 2: 建 HUDSlider.ts**
  ```typescript
  // src/framework/ui/HUDSlider.ts
  export interface HUDSliderOptions {
    label:  string;
    min:    number;
    max:    number;
    step:   number;
    value:  number;
    onInput: (v: number) => void;
  }

  export class HUDSlider {
    readonly el: HTMLElement;
    private _slider:  HTMLInputElement;
    private _valueEl: HTMLElement;
    private _decimals: number;

    constructor(opts: HUDSliderOptions) {
      this._decimals = opts.step < 0.1 ? 2 : 1;

      this.el = document.createElement('div');
      Object.assign(this.el.style, {
        display: 'grid', gridTemplateColumns: '60px 1fr 36px',
        alignItems: 'center', gap: '6px', marginBottom: '2px',
      });

      const labelEl = document.createElement('span');
      labelEl.textContent = opts.label;
      Object.assign(labelEl.style, {
        fontSize: '10px', color: '#9399b2', overflow: 'hidden', whiteSpace: 'nowrap',
      });

      this._slider = document.createElement('input');
      this._slider.type  = 'range';
      this._slider.min   = String(opts.min);
      this._slider.max   = String(opts.max);
      this._slider.step  = String(opts.step);
      this._slider.value = String(opts.value);
      Object.assign(this._slider.style, {
        width: '100%', accentColor: '#89b4fa', cursor: 'pointer',
      });

      this._valueEl = document.createElement('span');
      this._valueEl.textContent = opts.value.toFixed(this._decimals);
      Object.assign(this._valueEl.style, {
        fontSize: '10px', color: '#cdd6f4', textAlign: 'right',
      });

      this._slider.addEventListener('input', () => {
        const v = parseFloat(this._slider.value);
        this._valueEl.textContent = v.toFixed(this._decimals);
        opts.onInput(v);
      });

      this.el.appendChild(labelEl);
      this.el.appendChild(this._slider);
      this.el.appendChild(this._valueEl);
    }

    setValue(v: number): void {
      this._slider.value = String(v);
      this._valueEl.textContent = v.toFixed(this._decimals);
    }
  }
  ```

- [ ] **Step 3: 暂停 commit**

### Task D4: 建 `HUDToggle`

**Files:**
- Create: `src/framework/ui/HUDToggle.ts`

**Interfaces:**
- Produces: `class HUDToggle { constructor(opts: { label: string; value: boolean; onChange: (v: boolean) => void; keybindHint?: string; bindKey?: string }); readonly el: HTMLElement; setValue(v: boolean): void; dispose(): void }`

- [ ] **Step 1: 读现有 `DebugHUD._buildWireframeRow()` + `_bindKeys()`（`src/demos/planet/ui/DebugHUD.ts:69-92, 248-255`）**

- [ ] **Step 2: 建 HUDToggle.ts**
  ```typescript
  // src/framework/ui/HUDToggle.ts
  export interface HUDToggleOptions {
    label:        string;
    value:        boolean;
    onChange:     (v: boolean) => void;
    keybindHint?: string;   // "W" 之类显示提示
    bindKey?:     string;   // "w" 之类实际按键，大小写自动兼容
  }

  export class HUDToggle {
    readonly el: HTMLElement;
    private _checkbox: HTMLInputElement;
    private _keydownHandler?: (e: KeyboardEvent) => void;

    constructor(opts: HUDToggleOptions) {
      this.el = document.createElement('label');
      Object.assign(this.el.style, {
        display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
      });

      this._checkbox = document.createElement('input');
      this._checkbox.type    = 'checkbox';
      this._checkbox.checked = opts.value;
      Object.assign(this._checkbox.style, {
        margin: '0', cursor: 'pointer', accentColor: '#cdd6f4',
      });
      this._checkbox.addEventListener('change', () => opts.onChange(this._checkbox.checked));

      const label = document.createElement('span');
      label.textContent = opts.label;
      Object.assign(label.style, { flex: '1' });

      this.el.appendChild(this._checkbox);
      this.el.appendChild(label);

      if (opts.keybindHint) {
        const hint = document.createElement('span');
        hint.textContent = `(${opts.keybindHint})`;
        Object.assign(hint.style, { color: '#585b70' });
        this.el.appendChild(hint);
      }

      if (opts.bindKey) {
        const target = opts.bindKey.toLowerCase();
        this._keydownHandler = (e: KeyboardEvent) => {
          if (e.key.toLowerCase() === target) {
            const next = !this._checkbox.checked;
            this._checkbox.checked = next;
            opts.onChange(next);
          }
        };
        window.addEventListener('keydown', this._keydownHandler);
      }
    }

    setValue(v: boolean): void { this._checkbox.checked = v; }

    dispose(): void {
      if (this._keydownHandler) {
        window.removeEventListener('keydown', this._keydownHandler);
      }
    }
  }
  ```

- [ ] **Step 3: Build + test**

- [ ] **Step 4: 暂停 commit**

### Task D5: 重写 `PlanetHUD` 使用新原子

**Files:**
- Rename: `src/demos/planet/ui/DebugHUD.ts` → `src/demos/planet/ui/PlanetHUD.ts`（**用 git mv 保留 blame**）
- Rewrite: `src/demos/planet/ui/PlanetHUD.ts`
- Modify: `src/demos/planet/index.ts`（用 PlanetHUD 替换 DebugHUD）

**Interfaces:**
- Produces:
  ```typescript
  export class PlanetHUD {
    constructor(params: { cloud: CloudParams; material: MaterialParams },
                debug:  { wireframe: { enabled: boolean } });
    dispose(): void;
  }
  ```

- [ ] **Step 1: git mv 改名**
  ```bash
  git mv src/demos/planet/ui/DebugHUD.ts src/demos/planet/ui/PlanetHUD.ts
  ```

- [ ] **Step 2: 重写文件内容**
  ```typescript
  // src/demos/planet/ui/PlanetHUD.ts
  import { HUDPanel, HUDSection, HUDSlider, HUDToggle } from '../../../framework/ui/index.ts';
  import type { CloudParams, MaterialParams } from '../params.ts';

  const TERRAIN_LABELS = ['Water', 'Sand', 'Grass', 'Rock', 'Snow'] as const;

  const CLOUD_SLIDER_DEFS: readonly { key: keyof CloudParams; label: string; min: number; max: number; step: number }[] = [
    { key: 'coverageFreq',      label: 'Coverage Freq', min: 0.1, max: 10.0, step: 0.1  },
    { key: 'coverageThreshold', label: 'Coverage Thr.', min: 0.0, max:  1.0, step: 0.01 },
    { key: 'extinction',        label: 'Extinction',    min: 0.0, max: 20.0, step: 0.1  },
    { key: 'scatterAlbedo',     label: 'Scatter Albedo',min: 0.0, max:  1.0, step: 0.01 },
    { key: 'mieG',              label: 'Mie G',         min:-1.0, max:  1.0, step: 0.01 },
  ];

  export class PlanetHUD {
    private _panel: HUDPanel;
    private _toggles: HUDToggle[] = [];

    constructor(
      params: { cloud: CloudParams; material: MaterialParams },
      debug:  { wireframe: { enabled: boolean } },
    ) {
      this._panel = new HUDPanel({ title: 'Debug', position: 'top-right' });

      // Wireframe
      const wireToggle = new HUDToggle({
        label: 'Wireframe', keybindHint: 'W', bindKey: 'w',
        value: debug.wireframe.enabled,
        onChange: (v) => { debug.wireframe.enabled = v; },
      });
      this._toggles.push(wireToggle);
      this._panel.append(wireToggle.el);

      // Cloud section
      const cloudSec = new HUDSection('Cloud', true);
      for (const def of CLOUD_SLIDER_DEFS) {
        cloudSec.append(new HUDSlider({
          label: def.label, min: def.min, max: def.max, step: def.step,
          value: params.cloud[def.key],
          onInput: (v) => { (params.cloud as Record<string, number>)[def.key as string] = v; },
        }).el);
      }
      this._panel.append(cloudSec.el);

      // PBR section
      const pbrSec = new HUDSection('PBR Materials', true);
      for (let i = 0; i < 5; i++) {
        const mat = params.material.materials[i];
        const sub = document.createElement('div');
        Object.assign(sub.style, {
          marginBottom: '8px', paddingLeft: '4px', borderLeft: '2px solid #45475a',
        });
        const subLabel = document.createElement('div');
        subLabel.textContent = TERRAIN_LABELS[i];
        Object.assign(subLabel.style, { fontSize: '11px', color: '#a6adc8', marginBottom: '2px' });
        sub.appendChild(subLabel);
        sub.appendChild(new HUDSlider({ label: 'Rough', min: 0, max: 1, step: 0.01,
          value: mat.roughness, onInput: (v) => { mat.roughness = v; } }).el);
        sub.appendChild(new HUDSlider({ label: 'Metal', min: 0, max: 1, step: 0.01,
          value: mat.metallic, onInput: (v) => { mat.metallic = v; } }).el);
        pbrSec.append(sub);
      }
      // Light intensity
      const lightSub = document.createElement('div');
      Object.assign(lightSub.style, {
        marginBottom: '8px', paddingLeft: '4px', borderLeft: '2px solid #f9e2af',
      });
      const lightLabel = document.createElement('div');
      lightLabel.textContent = 'Light';
      Object.assign(lightLabel.style, { fontSize: '11px', color: '#f9e2af', marginBottom: '2px' });
      lightSub.appendChild(lightLabel);
      lightSub.appendChild(new HUDSlider({ label: 'Intensity', min: 0.1, max: 10, step: 0.1,
        value: params.material.lightIntensity,
        onInput: (v) => { params.material.lightIntensity = v; } }).el);
      pbrSec.append(lightSub);
      this._panel.append(pbrSec.el);
    }

    dispose(): void {
      this._toggles.forEach(t => t.dispose());
      this._panel.dispose();
    }
  }
  ```

- [ ] **Step 3: 建 `framework/ui/index.ts` 汇总 export**
  ```typescript
  // src/framework/ui/index.ts
  export { HUDPanel } from './HUDPanel.ts';
  export { HUDSection } from './HUDSection.ts';
  export { HUDSlider } from './HUDSlider.ts';
  export { HUDToggle } from './HUDToggle.ts';
  export { GraphDebugUI } from './GraphDebugUI.ts';
  ```

- [ ] **Step 4: 修 `demos/planet/index.ts` 里 HUD 使用**
  ```typescript
  import { PlanetHUD } from './ui/PlanetHUD.ts';
  // ...
  // Phase C 修完后，debugWireframe.enabled → 通过 debugState.wireframe.enabled 传
  const hud = import.meta.env.DEV
    ? new PlanetHUD(
        { cloud: cloudParams, material: materialParams },
        { wireframe: { get enabled() { return debugWireframe.enabled; },
                       set enabled(v) { debugWireframe.enabled = v; } } },
      )
    : undefined;
  return { dispose(): void { loop.stop(); hud?.dispose(); } };
  ```

- [ ] **Step 5: Build + test**

- [ ] **Step 6: 视觉像素对比**
  `npm run dev` — 打开旧 commit 的 tab 和新 commit 的 tab（或截图对比）。**面板外观应逐像素一致**（配色、字号、宽度、间距、折叠箭头）。

- [ ] **Step 7: Commit**
  ```bash
  git commit -m "refactor(ui): split DebugHUD into framework HUD kit + PlanetHUD

Extract HUDPanel/HUDSection/HUDSlider/HUDToggle to framework/ui/.
PlanetHUD composes these atoms with planet-specific labels (terrain
biome names, cloud/PBR sections). No visual changes."
  ```
  ⚠️ 等确认

---

## Phase E — 收尾 & 加护栏

### Task E1: 加 CI 边界检查

**Files:**
- Modify: `package.json`（加 npm script）
- Create: `scripts/check-import-boundaries.sh`（若选脚本方案）or `.eslintrc.json`（若选 eslint 方案）

**Interfaces:** none

- [ ] **Step 1: 选择方案**（脚本方案更简单，本项目未用 eslint）
  用 shell 脚本 + grep 即可，无需引入 eslint 依赖。

- [ ] **Step 2: 建 `scripts/check-import-boundaries.sh`**
  ```bash
  mkdir -p scripts
  ```
  ```bash
  #!/usr/bin/env bash
  # scripts/check-import-boundaries.sh
  set -e

  # 1. framework/ 里不许 import demos/
  BAD_A=$(grep -rn "from ['\"].*demos/" src/framework/ --include="*.ts" || true)
  if [ -n "$BAD_A" ]; then
    echo "❌ framework/ 里禁止 import demos/："
    echo "$BAD_A"
    exit 1
  fi

  # 2. framework/core/ 不许 import framework/renderer3d/
  BAD_B=$(grep -rn "from ['\"].*framework/renderer3d/" src/framework/core/ --include="*.ts" || true)
  if [ -n "$BAD_B" ]; then
    echo "❌ framework/core/ 里禁止 import framework/renderer3d/："
    echo "$BAD_B"
    exit 1
  fi

  # 3. Node 里不许直接访问 scene.*
  BAD_C=$(grep -rEn "scene\.(getEntitiesWith|mainCamera)" src/demos/planet/nodes/ --include="*.ts" || true)
  if [ -n "$BAD_C" ]; then
    echo "❌ Node 里不得访问 scene.* 业务查询："
    echo "$BAD_C"
    exit 1
  fi

  echo "✅ Import boundaries OK"
  ```
  ```bash
  chmod +x scripts/check-import-boundaries.sh
  ```

- [ ] **Step 3: 在 package.json 加 script**
  ```json
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "check-boundaries": "bash scripts/check-import-boundaries.sh",
    "check": "npm run check-boundaries && npm run build && npm test"
  }
  ```

- [ ] **Step 4: 跑一次**
  ```bash
  npm run check-boundaries
  ```
  Expected: `✅ Import boundaries OK`。若失败说明前面有遗漏，回到相应 phase 修补。

- [ ] **Step 5: Commit**
  ```bash
  git add scripts/ package.json
  git commit -m "chore: add script to enforce framework/demo import boundary

Fails CI if:
- framework/ imports from demos/
- framework/core/ imports from framework/renderer3d/
- planet nodes access scene.getEntitiesWith or scene.mainCamera"
  ```
  ⚠️ 等确认

### Task E2: 更新文档

**Files:**
- Modify: `AGENT.md`
- Modify: `README.md`

**Interfaces:** none

- [ ] **Step 1: 读现有 AGENT.md / README.md**

- [ ] **Step 2: 更新 AGENT.md**
  加一节 "Framework / Business 分层"，说明：
  - `src/framework/` = 通用 WebGPU 渲染框架（demo 无关）
  - `src/demos/planet/` = 星球 demo 业务代码
  - Node 契约：只通过 `this._inputs` 读数据，不访问 Scene
  - 加新 demo：拷贝 `src/demos/planet/` 骨架，改 `main.ts` 里的一行 import
  - 边界检查：`npm run check-boundaries`

- [ ] **Step 3: 更新 README.md**
  在项目结构一节反映新目录布局。

- [ ] **Step 4: Commit**
  ```bash
  git commit -m "docs: describe framework/demo layering in AGENT.md and README.md"
  ```
  ⚠️ 等确认

---

## 验证 checklist（重构完成后运行）

- [ ] `npm run check` 全绿
- [ ] `grep -r "from.*demos/" src/framework/` 无输出
- [ ] `grep -rE "scene\.(getEntitiesWith|mainCamera)" src/demos/planet/nodes/` 无输出
- [ ] `grep -rn "sceneColorView\|depthView\|targetView" src/framework/graph/types.ts` 无输出（FrameContext 干净）
- [ ] `grep -n "_graph\|_tick\|\bstart(\b\|setGraph" src/framework/core/WebGPUContext.ts` 无输出
- [ ] 手工：`npm run dev` 打开浏览器，planet 应正常显示 + 旋转 + W 键切线框 + HUD 存在
- [ ] 手工：改一个 shader 保存，HMR 后无叠加 RAF 循环（Chrome Performance 检查）
- [ ] 试验：把 `main.ts` 的 `import { bootstrap } from './demos/planet/index.ts'` 改成一个假的空 demo bootstrap，应能编译通过（证明 framework/ 真的 demo-agnostic）
