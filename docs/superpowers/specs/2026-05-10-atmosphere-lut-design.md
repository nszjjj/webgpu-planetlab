# Atmosphere Aerial Perspective LUT — 设计规格

## 概述

将当前 Nishita (1993) 单散射大气从逐像素 raymarch 改为基于预计算 3D LUT 的方案。LUT 参数化为 `(height, cosSunZenith, cosViewZenith)`，存储散射辐亮度（RGB）和透射率（A）。片段着色器用少量 LUT 采样替代 ~128 次光学深度积分。

**目标**：消除 `SCATTER_SCALE` 艺术修正、烘焙行星阴影、为多散射扩展预留接口、为 LOD 切换预留架构。

## 动机

- 当前 `atmosphere.wgsl` 每像素执行 16×8 = 128 次 `optical_depth()` 积分，`SCATTER_SCALE = 6.0` 补偿缺失的多散射能量
- 行星阴影是点光源二元遮挡，边缘偏硬
- 单次散射天然缺乏二次弹射，视觉上偏"塑料感"

## 架构

### 渲染图节点顺序

```
ComputeNoiseNode → NormalComputeNode → PlanetRenderNode →
CloudCoverageNode → CloudRenderNode →
AtmosphereLUTNode →     ← 新增：Compute Pass 预计算 3D LUT
AtmosphereNode →         ← 修改：片段着色器 LUT 采样替代 raymarch
DebugWireframeNode
```

### 数据流

```
AtmosphereLUTNode (compute, 首帧或参数变化时重算)
  → atmosphere.lut.{preset}  (texture_3d<rgba16float>)
       ↓
AtmosphereNode (fragment)
  → 沿视线方向查询 LUT（~8 次采样），累积散射 → canvas
```

## 类型定义

### types.ts 新增

```ts
export type LUTPreset = 'low' | 'medium' | 'high' | 'ultra';

export interface LUTResolution {
  r: number;       // height 轴采样数
  muS: number;     // cos(sunZenith) 轴采样数
  muV: number;     // cos(viewZenith) 轴采样数
}

export const LUT_PRESETS: Record<LUTPreset, LUTResolution> = {
  low:    { r: 8,  muS: 16, muV: 16 },   // ~2K 采样点
  medium: { r: 16, muS: 32, muV: 32 },   // ~16K
  high:   { r: 32, muS: 64, muV: 64 },   // ~130K
  ultra:  { r: 64, muS: 128, muV: 128 }, // ~1M，为未来保留
};

export interface AtmosphereLUTParams {
  planetRadius: number;
  atmosphereRadius: number;
  betaR: [number, number, number];
  betaM: number;
  H_R: number;              // Rayleigh scale height (fraction of planet radius)
  H_M: number;              // Mie scale height
  mieG: number;
  numSamples: number;       // LUT 预计算时的视线方向采样数
  numLightSamples: number;  // 太阳方向采样数
}

export const DEFAULT_ATMOSPHERE_LUT_PARAMS: AtmosphereLUTParams = {
  planetRadius: 1.0,
  atmosphereRadius: 1.12,
  betaR: [0.15, 0.35, 0.86],
  betaM: 0.08,
  H_R: 0.08,               // 从 atmosphere.wgsl 硬编码常量提取
  H_M: 0.012,
  mieG: 0.76,
  numSamples: 32,           // LUT 预计算用更高采样数（实时 16/8 → 离线 32/16）
  numLightSamples: 16,
};
```

说明：`AtmosphereLUTParams` 从现有 `AtmosphereParams` 提取 LUT 依赖的字段。后续加 HUD 时，大气参数滑块改变 → 触发 LUT 重算。

## AtmosphereLUTNode

新建 `src/graph/nodes/AtmosphereLUTNode.ts`，参照 `ComputeNoiseNode` 的 compute-node 模式。

### 构造函数

```ts
constructor(
  resources: ResourceManager,
  pipelines: PipelineManager,
  preset: LUTPreset = 'high',
  params?: Partial<AtmosphereLUTParams>,
)
```

### build(ctx: BuildContext)

1. 从 `LUT_PRESETS[preset]` 取分辨率 `res`
2. 在 ResourceManager 创建 `atmosphere.lut.{preset}`：`texture_3d<rgba16float>`，尺寸 `(res.muV, res.muS, res.r)`，usage `TEXTURE_BINDING | STORAGE_BINDING`（compute shader 写入 → fragment shader 采样）
3. 创建 `atmosphere.lut.params` uniform buffer（写入 `AtmosphereLUTParams`）
4. 创建 compute pipeline（`lut_gen.wgsl`），bind group：uniform + 可写 3D texture
5. dispatch `(ceil(muV/8), ceil(muS/8), ceil(r/8))` 工作网格
6. 标记 `_generated = true`，跳过后续帧

### recordPass(encoder, ctx)

```ts
if (this._generated) return;
const pass = encoder.beginComputePass();
pass.setPipeline(this._pipeline);
pass.setBindGroup(0, this._bindGroup);
pass.dispatchWorkgroups(wgX, wgY, wgZ);
pass.end();
this._generated = true;
```

### 预留接口

```ts
// Phase 2: LOD — 按相机距离自动切换 preset
setPreset(preset: LUTPreset): void  // 销毁旧 texture_3d，重建并重算

// Phase 2+: HUD 触发
regenerate(params: AtmosphereLUTParams): void  // 更新 uniform + reset _generated
```

## WGSL Compute Shader: lut_gen.wgsl

### 输入

| binding | 类型 | 内容 |
|---------|------|------|
| @group(0) @binding(0) | uniform | AtmosphereLUTParams |
| @group(0) @binding(1) | texture_storage_3d<rgba16float, write> | LUT 输出 |

### 算法

每个 workgroup 线程对应一个 `(idx_muV, idx_muS, idx_r)` 纹素：

1. 从线程索引重建 `(r, μ_s, μ_v)` 实际值：
   - `r` 从 `planetRadius` 到 `atmosphereRadius` 线性映射
   - `μ_s = cos(sunZenith)` 从 `-1` 到 `1`
   - `μ_v = cos(viewZenith)` 从 `-1` 到 `1`
2. 在高度 `r` 处沿 `μ_v` 方向做视线 raymarch（`numSamples` 步）
3. 每步：raymarch 沿太阳方向 `μ_s` 做光学深度积分（`numLightSamples` 步）+ 行星遮挡测试
4. 计算 Rayleigh + Mie 散射相位函数
5. 输出 `vec4(inscatter.rgb, transmittance)`

### 行星遮挡

在 shadow ray 的每步积分中，若采样点位置 `p + sunDir * t` 的 `length < planetRadius`，则该步计为完全遮挡（透射率 = 0）。

## 修改 AtmosphereNode

### AtmosphereNode.ts

- `build()`：bind group layout 新增一个 binding：`texture_3d<f32>`（LUT 纹理）+ 对应的 sampler
- `update()`：不变
- `_rebuildBindGroup()`：新增 LUT 纹理绑定

bind group 布局变更：

| binding | 类型 | 内容 |
|---------|------|------|
| 0 | uniform | AtmosphereUniforms（不变） |
| 1 | texture_2d<f32> | sceneColor |
| 2 | texture_depth_2d | sceneDepth |
| 3 | texture_2d<f32> | cloudColor |
| 4 | texture_3d<f32> | **LUT（新增）** |
| 5 | sampler | **LUT sampler（新增）** |

### atmosphere.wgsl 改动

片段着色器 `fs_main` 用 LUT 采样替代内层 raymarch：

```
fn sample_lut(r_norm: f32, mu_s: f32, mu_v: f32) -> vec4<f32> {
  // 将连续值映射到 LUT 纹素坐标 [0, 1]
  let u = mu_v * 0.5 + 0.5;   // cos(viewZenith)  → [0, 1]
  let v = mu_s * 0.5 + 0.5;   // cos(sunZenith)   → [0, 1]
  let w = r_norm;              // 高度归一化       → [0, 1]
  return textureSample(lutTexture, lutSampler, vec3(u, v, w));
}
```

主循环：沿视线方向取 `N_VIEW` 个采样点（建议 8-16），每点查询 LUT 获得散射和透射率，累积出最终颜色。

行星阴影已烘焙在 LUT 中，片段着色器无需再做 `intersect_sphere` 遮挡测试。

## GraphBuilder 改动

```ts
// 创建 LUT 参数（从现有 DEFAULT_ATMOSPHERE_PARAMS 提取）
const lutParams: AtmosphereLUTParams = { ... };

// 新增节点
const lutNode = new AtmosphereLUTNode(resources, pipelines, 'high', lutParams);

// 注册顺序：在 AtmosphereNode 之前
lutNode.build(buildCtx);
// ... AtmosphereNode 的 bind group 读取 atmosphere.lut.high 纹理

graph.addNode(lutNode);     // 插入到 CloudRenderNode 和 AtmosphereNode 之间
```

## 资源命名规范

| 名称 | 类型 | 说明 |
|------|------|------|
| `atmosphere.lut.{preset}` | `texture_3d<rgba16float>` | 3D 散射 LUT |
| `atmosphere.lut.params` | GPUBuffer (uniform) | LUT 预计算参数 |
| `atmosphere.lut.sampler` | GPUSampler | 线性插值采样器 |

## 测试

- **AtmosphereLUTNode 单元测试**：验证 build() 创建资源、preset 分辨率正确、recordPass 首帧 dispatch 后跳过后续帧
- **LUT 参数验证测试**：验证 `LUT_PRESETS` 各预设的合理性（分辨率 > 0，muV/muS 为偶数以保证 workgroup 对齐）
- **集成测试**：验证 LUT 纹理在 AtmosphereNode 的 bind group 中可访问

测试 file：`src/__tests__/AtmosphereLUT.test.ts`

## 浏览器兼容性

`texture_3d` 和 `texture_storage_3d` 在 WebGPU 规范中属于核心特性，Chrome/Edge 113+ 和 Firefox Nightly 均支持。`rgba16float` 作为 3D 纹理格式在所有支持 WebGPU 的平台上可用。

## 未来扩展（Phase 2+，仅设计参考）

### 多散射比值 LUT

- 新增 `MultiScatterLUTNode`：32×32 2D LUT，存储多散射/单散射比值
- 在 AtmosphereNode 中：`finalColor = singleScatter * (1.0 + multiScatterRatio)`
- 架构预留：AtmosphereNode bind group 已预留 texture binding slot

### 大气参数 Debug HUD

- `AtmosphereLUTParams` 字段接入 Debug HUD 滑块
- 滑块改变 → `AtmosphereLUTNode.regenerate(params)` → 重算 LUT
- 和云参数 HUD 模式一致

### LOD 自动切换

- 相机到大气层距离映射 preset：
  - `d < 2.0` → ultra
  - `d < 5.0` → high
  - `d < 10.0` → medium
  - `d >= 10.0` → low
- `AtmosphereLUTNode.setPreset()` 销毁旧纹理、重建、重算
- LOD 切换频率通过 hysteresis 控制，避免频繁重建

### 透射率 LUT 替代 Raymarch

- 当前方案仍保留外层视线积分（~8 步 LUT 查询）
- 可进一步升级为 4D LUT（含方位角），彻底移除视线 raymarch

## 变更文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/core/types.ts` | 修改 | 新增 LUTPreset、LUTResolution、LUT_PRESETS、AtmosphereLUTParams |
| `src/graph/nodes/AtmosphereLUTNode.ts` | 新建 | Compute 节点，预计算 3D LUT |
| `src/shaders/lut_gen.wgsl` | 新建 | LUT 预计算 compute shader |
| `src/graph/nodes/AtmosphereNode.ts` | 修改 | Bind group 新增 LUT 纹理 + sampler |
| `src/shaders/atmosphere.wgsl` | 修改 | 片段着色器用 LUT 采样替代 raymarch |
| `src/graph/GraphBuilder.ts` | 修改 | 注册 AtmosphereLUTNode |
| `src/__tests__/AtmosphereLUT.test.ts` | 新建 | LUT 节点单元测试 |
