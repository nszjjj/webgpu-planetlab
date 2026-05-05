# CloudNode Debug HUD 参数面板 — 设计文档

**日期：** 2026-05-06  
**状态：** 已确认

---

## 目标

在现有 Debug HUD 中为 CloudNode 添加可交互的调试参数面板，允许在开发时实时调整云层视觉参数，且不对生产代码引入任何公开 API 变动。

---

## 整体架构

```
GraphBuilder
  ├── 创建 cloudParams: CloudParams（单一共享对象）
  ├── 传给 CloudCoverageNode（持有引用，不 spread）
  ├── 传给 CloudRenderNode（持有引用，不 spread）
  └── 返回 { debugWireframe, cloudParams }

main.ts
  ├── 解构 cloudParams
  └── if (import.meta.env.DEV) → new DebugHUD(debugWireframe, cloudParams)

DebugHUD
  ├── Wireframe 行（现有，不变）
  └── Cloud 分组（新增，可折叠）
       ├── coverageFreq      slider [0.1, 10.0]  step 0.1
       ├── coverageThreshold slider [0.0, 1.0]   step 0.01
       ├── extinction        slider [0.0, 20.0]  step 0.1
       ├── scatterAlbedo     slider [0.0, 1.0]   step 0.01
       └── mieG              slider [-1.0, 1.0]  step 0.01
```

---

## 共享 CloudParams 引用

**动机：** 两个节点的 `update()` 方法都只读 `_params`，从不写入。`{ ...params }` 是无实际保护效果的防御性复制。改为共享引用后：

- HUD 直接修改同一对象，两个节点下一帧即感知变化
- 节点不需要新增任何公开 getter / setter
- `timeOffset` 未来用于动画时，两个节点天然同步

---

## DebugHUD 控件规格

### 构造器

```ts
constructor(
  private _wireframe: DebugWireframeNode,
  private _cloudParams: CloudParams,
)
```

### Cloud 分组行为

- 默认展开（`_cloudExpanded = true`）
- 点击分组标题行切换展开/折叠
- 折叠时隐藏所有 slider 行，标题行右侧显示 `▶` / `▼` 指示

### 控件布局（每行）

```
label         ━━━━●━━━  value
```

- 左：固定宽度 label
- 中：`<input type="range">` 填充剩余空间
- 右：`<span>` 显示当前值（随滑块实时更新）

### 参数范围

| 参数               | 默认值 | min  | max  | step |
|--------------------|--------|------|------|------|
| `coverageFreq`     | 3.0    | 0.1  | 10.0 | 0.1  |
| `coverageThreshold`| 0.45   | 0.0  | 1.0  | 0.01 |
| `extinction`       | 8.0    | 0.0  | 20.0 | 0.1  |
| `scatterAlbedo`    | 0.9    | 0.0  | 1.0  | 0.01 |
| `mieG`             | 0.6    | -1.0 | 1.0  | 0.01 |

### HUD 宽度

200px → 240px（容纳 slider + value 显示）

### 键盘快捷键

不为 Cloud 分组新增快捷键，保留现有 `W` 键控制 Wireframe。

---

## 生产构建隔离

`main.ts` 中 DebugHUD 实例化包裹在 `import.meta.env.DEV` 条件内，Vite 生产打包时整个 HUD 模块被 tree-shake 移除。

---

## 文件改动清单

| 文件 | 改动内容 |
|------|---------|
| `src/graph/nodes/CloudCoverageNode.ts` | 构造器：`{ ...params }` → `params` |
| `src/graph/nodes/CloudRenderNode.ts` | 构造器：`{ ...params }` → `params` |
| `src/graph/GraphBuilder.ts` | 创建共享 `cloudParams`，显式传入两节点，返回值增加 `cloudParams` |
| `src/ui/DebugHUD.ts` | 新增第二参数，Cloud 可折叠分组，宽度 240px |
| `src/main.ts` | 解构 `cloudParams`，`DEV` guard 包裹 DebugHUD |

不新增文件，不改变节点公开接口，测试文件无需改动。
