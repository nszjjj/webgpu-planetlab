# CloudNode Debug HUD 参数面板实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Debug HUD 中为 CloudNode 添加可折叠的 Cloud 参数分组，支持实时调整 5 个视觉参数，生产构建完全排除。

**Architecture:** `GraphBuilder` 创建单一 `cloudParams` 对象并以引用（非副本）传给两个 Cloud 节点；`DebugHUD` 持有该共享引用，渲染 5 个 slider 控件直接写入对象，节点下一帧自动感知；`main.ts` 用 `import.meta.env.DEV` 隔离整个 HUD 实例化，生产构建被 tree-shake 移除。

**Tech Stack:** TypeScript, Vite (`import.meta.env.DEV`), Vitest, WebGPU (browser native), DOM API（无框架）

---

## File Map

| 文件 | 变更类型 | 职责 |
|------|---------|------|
| `src/__tests__/CloudNodeSharedRef.test.ts` | Create | 验证两个 Cloud Node 持有 params 引用而非副本 |
| `src/graph/nodes/CloudCoverageNode.ts` | Modify L33 | 构造器：`{ ...params }` → `params` |
| `src/graph/nodes/CloudRenderNode.ts` | Modify L47 | 构造器：`{ ...params }` → `params` |
| `src/graph/GraphBuilder.ts` | Modify | 创建共享 `cloudParams`，显式传入两节点，更新返回类型 |
| `src/ui/DebugHUD.ts` | Modify | 新增第二参数 + Cloud 可折叠分组（5 个 slider） |
| `src/main.ts` | Modify | 解构 `cloudParams`，`DEV` guard 包裹 DebugHUD |

---

### Task 1: 共享 CloudParams 引用——测试并修改两个节点

**Files:**
- Create: `src/__tests__/CloudNodeSharedRef.test.ts`
- Modify: `src/graph/nodes/CloudCoverageNode.ts:33`
- Modify: `src/graph/nodes/CloudRenderNode.ts:47`

- [ ] **Step 1: 写失败测试**

创建 `src/__tests__/CloudNodeSharedRef.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { CloudCoverageNode } from '../graph/nodes/CloudCoverageNode.ts';
import { CloudRenderNode }   from '../graph/nodes/CloudRenderNode.ts';
import { DEFAULT_CLOUD_PARAMS, type CloudParams } from '../core/types.ts';

describe('CloudCoverageNode shared params ref', () => {
  it('holds the passed-in params object by reference, not by copy', () => {
    const params: CloudParams = { ...DEFAULT_CLOUD_PARAMS };
    const node = new CloudCoverageNode(undefined as any, undefined as any, params);
    expect((node as any)._params).toBe(params);
  });
});

describe('CloudRenderNode shared params ref', () => {
  it('holds the passed-in params object by reference, not by copy', () => {
    const params: CloudParams = { ...DEFAULT_CLOUD_PARAMS };
    const node = new CloudRenderNode(
      undefined as any,
      undefined as any,
      undefined as any,
      params,
    );
    expect((node as any)._params).toBe(params);
  });
});
```

- [ ] **Step 2: 确认测试失败**

```bash
npx vitest run src/__tests__/CloudNodeSharedRef.test.ts
```

期望：两个测试 FAIL，`expected {...} not to be {...}`（spread 创建了新对象）

- [ ] **Step 3: 修改 CloudCoverageNode**

打开 `src/graph/nodes/CloudCoverageNode.ts`，第 33 行：

```ts
// 改前
this._params    = { ...params };
// 改后
this._params    = params;
```

- [ ] **Step 4: 修改 CloudRenderNode**

打开 `src/graph/nodes/CloudRenderNode.ts`，第 47 行：

```ts
// 改前
this._params    = { ...params };
// 改后
this._params    = params;
```

- [ ] **Step 5: 确认测试通过**

```bash
npx vitest run src/__tests__/CloudNodeSharedRef.test.ts
```

期望：两个测试 PASS

- [ ] **Step 6: 运行全量测试**

```bash
npm test
```

期望：所有测试 PASS，无新增失败

- [ ] **Step 7: Commit**

```bash
git add src/__tests__/CloudNodeSharedRef.test.ts \
        src/graph/nodes/CloudCoverageNode.ts \
        src/graph/nodes/CloudRenderNode.ts
git commit -m "refactor: CloudCoverage/RenderNode hold CloudParams by reference"
```

---

### Task 2: GraphBuilder — 创建共享 cloudParams 并更新返回类型

**Files:**
- Modify: `src/graph/GraphBuilder.ts`

> `GraphBuilder.build()` 需要真实 GPU 设备，无法单元测试。TypeScript 编译器在 `main.ts` 消费端会捕获类型错误。

- [ ] **Step 1: 在 GraphBuilder.ts 顶部添加 import**

打开 `src/graph/GraphBuilder.ts`，找到现有的：

```ts
import type { BuildContext }     from '../core/types.ts';
```

替换为：

```ts
import type { BuildContext, CloudParams } from '../core/types.ts';
import { DEFAULT_CLOUD_PARAMS }           from '../core/types.ts';
```

- [ ] **Step 2: 更新 build() 返回类型**

第 19 行，修改方法签名：

```ts
// 改前
static build(engine: WebGPUEngine, canvas: HTMLCanvasElement): { debugWireframe: DebugWireframeNode } {
// 改后
static build(engine: WebGPUEngine, canvas: HTMLCanvasElement): { debugWireframe: DebugWireframeNode; cloudParams: CloudParams } {
```

- [ ] **Step 3: 创建共享 cloudParams 对象**

在 `build()` 方法体开头、`const { device, resources, pipelines } = engine;` 之后插入：

```ts
const cloudParams: CloudParams = { ...DEFAULT_CLOUD_PARAMS };
```

- [ ] **Step 4: 显式传入 cloudParams 给两个 Cloud Node**

找到约第 65-66 行的节点构造：

```ts
// 改前
const cloudCoverageNode = new CloudCoverageNode(resources, pipelines);
const cloudRenderNode   = new CloudRenderNode(scene, resources, pipelines);
// 改后
const cloudCoverageNode = new CloudCoverageNode(resources, pipelines, cloudParams);
const cloudRenderNode   = new CloudRenderNode(scene, resources, pipelines, cloudParams);
```

- [ ] **Step 5: 更新 return 语句**

找到约第 87 行：

```ts
// 改前
return { debugWireframe };
// 改后
return { debugWireframe, cloudParams };
```

- [ ] **Step 6: 验证 TypeScript 编译**

```bash
npx tsc --noEmit
```

期望：`main.ts` 可能出现 `cloudParams` 未使用的警告，但 `GraphBuilder.ts` 本身 0 错误

- [ ] **Step 7: Commit**

```bash
git add src/graph/GraphBuilder.ts
git commit -m "feat: GraphBuilder creates shared cloudParams and returns it"
```

---

### Task 3: DebugHUD — 新增 Cloud 可折叠分组

**Files:**
- Modify: `src/ui/DebugHUD.ts`

- [ ] **Step 1: 用以下内容完整替换 DebugHUD.ts**

```ts
// src/ui/DebugHUD.ts
import type { DebugWireframeNode } from '../graph/nodes/DebugWireframeNode.ts';
import type { CloudParams }        from '../core/types.ts';

export class DebugHUD {
  private _wireframeCheckbox!: HTMLInputElement;
  private _cloudExpanded = true;
  private _cloudBody!: HTMLDivElement;

  constructor(
    private _wireframe:   DebugWireframeNode,
    private _cloudParams: CloudParams,
  ) {
    this._buildPanel();
    this._bindKeys();
  }

  private _buildPanel(): void {
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      position:     'fixed',
      top:          '12px',
      right:        '12px',
      width:        '240px',
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
    });

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
    title.textContent = 'Debug';
    panel.appendChild(title);

    panel.appendChild(this._buildWireframeRow());
    panel.appendChild(this._buildCloudSection());

    document.body.appendChild(panel);
  }

  private _buildWireframeRow(): HTMLLabelElement {
    const row = document.createElement('label');
    Object.assign(row.style, {
      display:    'flex',
      alignItems: 'center',
      gap:        '8px',
      cursor:     'pointer',
    });

    const checkbox = document.createElement('input');
    checkbox.type    = 'checkbox';
    checkbox.checked = this._wireframe.enabled;
    Object.assign(checkbox.style, {
      margin:      '0',
      cursor:      'pointer',
      accentColor: '#cdd6f4',
    });
    checkbox.addEventListener('change', () => {
      this._wireframe.enabled = checkbox.checked;
    });
    this._wireframeCheckbox = checkbox;

    const label = document.createElement('span');
    label.textContent = 'Wireframe';
    Object.assign(label.style, { flex: '1' });

    const hint = document.createElement('span');
    hint.textContent = '(W)';
    Object.assign(hint.style, { color: '#585b70' });

    row.appendChild(checkbox);
    row.appendChild(label);
    row.appendChild(hint);
    return row;
  }

  private _buildCloudSection(): HTMLDivElement {
    const section = document.createElement('div');
    Object.assign(section.style, { marginTop: '8px' });

    const header = document.createElement('div');
    Object.assign(header.style, {
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'space-between',
      fontSize:       '11px',
      letterSpacing:  '0.08em',
      textTransform:  'uppercase',
      color:          '#6c7086',
      cursor:         'pointer',
      paddingBottom:  '4px',
      borderBottom:   '1px solid #313244',
      marginBottom:   '6px',
    });

    const headerLabel = document.createElement('span');
    headerLabel.textContent = 'Cloud';

    const arrow = document.createElement('span');
    arrow.textContent = this._cloudExpanded ? '▼' : '▶';

    header.appendChild(headerLabel);
    header.appendChild(arrow);

    const body = document.createElement('div');
    this._cloudBody = body;
    body.style.display = this._cloudExpanded ? 'block' : 'none';

    const sliders: Array<{
      key:   keyof CloudParams;
      label: string;
      min:   number;
      max:   number;
      step:  number;
    }> = [
      { key: 'coverageFreq',      label: 'Coverage Freq',  min:  0.1, max: 10.0, step: 0.1  },
      { key: 'coverageThreshold', label: 'Coverage Thr.',  min:  0.0, max:  1.0, step: 0.01 },
      { key: 'extinction',        label: 'Extinction',     min:  0.0, max: 20.0, step: 0.1  },
      { key: 'scatterAlbedo',     label: 'Scatter Albedo', min:  0.0, max:  1.0, step: 0.01 },
      { key: 'mieG',              label: 'Mie G',          min: -1.0, max:  1.0, step: 0.01 },
    ];

    for (const def of sliders) {
      body.appendChild(this._buildSliderRow(def));
    }

    header.addEventListener('click', () => {
      this._cloudExpanded    = !this._cloudExpanded;
      arrow.textContent      = this._cloudExpanded ? '▼' : '▶';
      body.style.display     = this._cloudExpanded ? 'block' : 'none';
    });

    section.appendChild(header);
    section.appendChild(body);
    return section;
  }

  private _buildSliderRow(def: {
    key:   keyof CloudParams;
    label: string;
    min:   number;
    max:   number;
    step:  number;
  }): HTMLDivElement {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display:             'grid',
      gridTemplateColumns: '90px 1fr 36px',
      alignItems:          'center',
      gap:                 '6px',
      marginBottom:        '4px',
    });

    const labelEl = document.createElement('span');
    labelEl.textContent = def.label;
    Object.assign(labelEl.style, {
      fontSize:   '11px',
      color:      '#a6adc8',
      overflow:   'hidden',
      whiteSpace: 'nowrap',
    });

    const initialVal = this._cloudParams[def.key] as number;

    const slider = document.createElement('input');
    slider.type  = 'range';
    slider.min   = String(def.min);
    slider.max   = String(def.max);
    slider.step  = String(def.step);
    slider.value = String(initialVal);
    Object.assign(slider.style, {
      width:       '100%',
      accentColor: '#89b4fa',
      cursor:      'pointer',
    });

    const decimals = def.step < 0.1 ? 2 : 1;
    const valueEl  = document.createElement('span');
    valueEl.textContent = initialVal.toFixed(decimals);
    Object.assign(valueEl.style, {
      fontSize:  '11px',
      color:     '#cdd6f4',
      textAlign: 'right',
    });

    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      (this._cloudParams as unknown as Record<string, number>)[def.key as string] = v;
      valueEl.textContent = v.toFixed(decimals);
    });

    row.appendChild(labelEl);
    row.appendChild(slider);
    row.appendChild(valueEl);
    return row;
  }

  private _bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'w' || e.key === 'W') {
        this._wireframe.enabled        = !this._wireframe.enabled;
        this._wireframeCheckbox.checked = this._wireframe.enabled;
      }
    });
  }
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
npx tsc --noEmit
```

期望：`DebugHUD.ts` 本身 0 错误；`main.ts` 仍有参数不匹配错误（下一步修复）

- [ ] **Step 3: Commit**

```bash
git add src/ui/DebugHUD.ts
git commit -m "feat: DebugHUD — collapsible Cloud param sliders"
```

---

### Task 4: main.ts — 接入 cloudParams 并添加 DEV guard

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: 替换 main.ts 全文**

```ts
// src/main.ts
import { initWebGPU }           from './core/initWebGPU.ts';
import { CanvasSurfaceManager } from './core/CanvasSurfaceManager.ts';
import { WebGPUEngine }         from './core/WebGPUEngine.ts';
import { GraphBuilder }         from './graph/GraphBuilder.ts';
import { DebugHUD }             from './ui/DebugHUD.ts';

async function main(): Promise<void> {
  const canvas  = document.getElementById('webgpu-canvas') as HTMLCanvasElement;
  const device  = await initWebGPU();
  const surface = new CanvasSurfaceManager(canvas, device);
  const engine  = new WebGPUEngine(device);
  engine.addSurface(surface);
  const { debugWireframe, cloudParams } = GraphBuilder.build(engine, canvas);
  engine.start();
  if (import.meta.env.DEV) {
    new DebugHUD(debugWireframe, cloudParams);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  document.body.innerHTML = `<pre style="color:red;padding:1rem;">${msg}</pre>`;
});
```

- [ ] **Step 2: 验证 TypeScript 编译无错误**

```bash
npx tsc --noEmit
```

期望：`0 errors`

- [ ] **Step 3: 运行全量测试**

```bash
npm test
```

期望：所有测试 PASS

- [ ] **Step 4: 手动验证（开发服务器）**

```bash
npm run dev
```

在浏览器中检查：
1. 右上角 HUD 宽度约 240px，顶部 "Debug" 标题
2. 第一行：Wireframe 复选框，`W` 键可切换
3. 第二小节：标题 "Cloud"，右侧 `▼`，点击后折叠变 `▶`，再点展开
4. 展开时有 5 行 slider：Coverage Freq / Coverage Thr. / Extinction / Scatter Albedo / Mie G
5. 拖动任意 slider，右侧数值同步，云层外观实时变化
6. `npm run build` 打包后打开 `dist/` 预览——HUD 不应出现（DEV guard 生效）

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat: wire cloudParams to DebugHUD with DEV guard"
```
