# 大气与云效果消失：三处独立 Bug 的连锁分析

## 问题现象

重构为 LUT 大气 + 云 raymarching 管线后，渲染结果退化为无大气光晕、无可见云层的裸球体：

- 星球边缘没有蓝色大气散射光晕（应有明显的 limb glow）
- 通过 HUD 调节云参数，球体局部会轻微变暗，但完全看不到白色漂浮云层
- 调整 Coverage F 参数可见明暗分区变化，说明 coverage buffer 本身正常

---

## Bug 1：LUT 计算着色器 dispatch z 维度错误 → 仅 4/32 层有效

### 原因

`AtmosphereLUTNode.ts` 中 `dispatchWorkgroups` 的 z 维度计算有误：

```typescript
// 错误写法
pass.dispatchWorkgroups(
  Math.ceil(res.muV / 8),
  Math.ceil(res.muS / 8),
  Math.ceil(res.r / 8),   // ← res.r = 32，结果为 4 个 workgroup
);
```

`lut_gen.wgsl` 的 workgroup size 为 `@workgroup_size(8, 8, 1)`，z 方向每个 workgroup 只包含 **1 个线程**。因此 dispatch z=4 只在 z=0,1,2,3 上各运行了 1 次，剩余 28 个 z-slice 保持为全零（未初始化缓冲区）。

LUT 覆盖率仅有 12.5%（4/32 层），大气 in-scatter 几乎为零。

### 修复

```typescript
// 正确写法：z workgroup_size=1，每个 z-slice 需要一个 workgroup
pass.dispatchWorkgroups(
  Math.ceil(res.muV / 8),
  Math.ceil(res.muS / 8),
  res.r,   // 32 个 workgroup × 1 线程 = 32 个 z-slice 全部覆盖
);
```

修复后 debug readback 确认：32 个 z-slice 全部有数据，非零 texel 占比 65.4%（另外约 35% 为夜侧零值，属于正常物理结果）。

### 附：错误尝试

排查过程中曾错误地将 `lut_gen.wgsl` 的 workgroup size 从 `@workgroup_size(8, 8, 1)` 改为 `@workgroup_size(8, 8, 8)`，意图让每个 workgroup 覆盖 8 个 z-slice。但 8×8×8 = 512 个 invocation，超过 WebGPU 规范保证的最低 `maxComputeInvocationsPerWorkgroup = 256`，导致 pipeline 创建静默失败，地形渲染管线整体崩溃，表现为全黑光滑球体。正确解法是修 dispatch 而不是修 workgroup_size。

---

## Bug 2：LUT 重写时丢失大气亮度缩放因子 → 大气不可见

### 原因

旧版大气使用逐像素 raymarching，累计 in-scatter 数值量级偏小，需要一个艺术缩放因子 `SCATTER_SCALE = 6.0` 来放大到可视范围。迁移到 LUT 采样版本时，该常量被遗漏：

```wgsl
// 旧版（有 SCATTER_SCALE）
finalColor = color * viewT + accum * 6.0;

// 新版 LUT（遗漏了 SCATTER_SCALE）
let finalColor = color * viewT + accum;   // ← 大气亮度仅为应有值的 1/6
```

LUT 本身数值正确（fix 1 修复后），但无缩放的输出过暗，在 tonemapping 后几乎不可见。

### 修复

在 `atmosphere.wgsl` 中恢复该常量并应用：

```wgsl
const SCATTER_SCALE: f32 = 6.0;
...
let finalColor = color * viewT + accum * SCATTER_SCALE;
```

---

## Bug 3：云 in-scatter 亮度不足 → 只有遮光效果，无白色云层

### 原因一：Beer's Powder 公式误用

原始云渲染代码引入了 Beer's Powder 近似（一种多次散射的廉价近似），但将"全路径光学深度"的公式用到了"单步光学深度"上：

```wgsl
// 错误：tau 是单步光学深度 ≈ 0.0025×60 ≈ 0.15，Beer's Powder 在此量级下约等于 4τ ≈ 0.01
let beerPowder = 2.0 * exp(-tau) * (1.0 - exp(-2.0 * tau));
inScatter += tau * scatterAlbedo * phaseHG * beerPowder * transmittance * sunColor;
// beerPowder ≈ 4τ 时，inScatter ∝ τ² → 比正确公式暗约 100 倍
```

正确的单散射公式不需要 Beer's Powder（该项应作用于整段路径，而非每步）：

```wgsl
// 正确：标准单散射，T(cam→p) · σ_s · phase · L_sun
inScatter += transmittance * tau * scatterAlbedo * phaseHG * sunColor;
```

### 原因二：HG 相位函数在侧向角度极小 + 缺少艺术亮度倍增

即使修正散射公式，单散射模型在太阳光与视线夹角接近 90° 时，HG 相位函数值仅约 **0.032**（远小于各向同性的 1/(4π) ≈ 0.08）。真实云的白色外观来自数十次多次散射，单次散射无法还原这一效果。

同时，大气渲染有 `SCATTER_SCALE = 6.0` 放大，而云的 in-scatter 完全没有对应的亮度补偿，导致云的 RGB 分量（约 0.028）远低于大气散射后的背景亮度，只有遮光而无增亮。

### 修复

```wgsl
const CLOUD_SCATTER_SCALE: f32 = 15.0;   // 艺术缩放，对应大气的 SCATTER_SCALE
...
let phaseHG  = hg_phase(cosTheta, u.mieG);
// 与各向同性 50% 混合，近似多次散射使侧向也有可见亮度
let phaseIso = 1.0 / (4.0 * PI);
let phase    = mix(phaseHG, phaseIso, 0.5);
inScatter   += transmittance * tau * u.scatterAlbedo * phase * CLOUD_SCATTER_SCALE * sunColor;
```

修复后理论最大 in-scatter ≈ `scatterAlbedo × blendedPhase × scale × (1−T_final)` ≈ 0.9 × 0.056 × 15 × 0.98 ≈ **0.74**，在 [0,1] 范围内可产生清晰可见的白色云层。

---

## 参数调整：云壳与大气厚度

| 层级 | 内径 | 外径 | 厚度 |
|------|------|------|------|
| 云壳（旧） | 1.03 | 1.08 | 0.05 |
| 云壳（新） | 1.02 | 1.10 | 0.08 |
| 大气（旧） | 1.00 | 1.12 | 0.12 |
| 大气（新） | 1.00 | 1.20 | 0.20 |

旧参数下云顶（1.10）与大气顶（1.12）仅差 0.02 单位，几乎没有纯 Rayleigh 散射区，无法形成云层之上的大气光晕（limb glow）。扩大大气半径至 1.20 后，云顶到大气顶之间有 0.10 单位的散射区，从侧面观察时可见蓝色光晕包裹云层的效果。

---

## 修改文件汇总

| 文件 | 修改内容 |
|------|----------|
| `src/graph/nodes/AtmosphereLUTNode.ts` | dispatch z 从 `Math.ceil(res.r/8)` 改为 `res.r` |
| `src/shaders/atmosphere.wgsl` | 恢复 `SCATTER_SCALE = 6.0` 并应用到最终颜色 |
| `src/shaders/cloud_render.wgsl` | 移除 Beer's Powder 误用；加入 `CLOUD_SCATTER_SCALE = 15.0` 及各向同性相位混合 |
| `src/core/types.ts` | `cloudInnerRadius` 1.03→1.02，`cloudOuterRadius` 1.08→1.10，`extinction` 8→60，`atmosphereRadius` 1.12→1.20（同时更新 LUT 参数） |
