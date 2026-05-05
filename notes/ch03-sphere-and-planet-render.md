# 球体网格与星球渲染

本章对应 `PlanetRenderNode`，覆盖从球体几何构造到最终上屏的完整流程。

---

## 球面参数方程

{TODO: 解释 (θ, φ) 坐标系，θ ∈ [0, π] 为极角，φ ∈ [0, 2π] 为方位角，以及对应的 xyz 转换公式。说明 rings/segments 参数如何控制细分精度。}

---

## 索引缓冲与三角面构造

{TODO: 解释 `buildSphereIndices()` 的逻辑——把 (rings+1)×(segments+1) 个顶点按四边形拆成三角形对，说明 cols 变量的作用，以及为什么顶点数比格子数多一圈（首尾衔接）。}

---

## 无顶点 Buffer 的 Vertex Shader

{TODO: 这是本章最值得重点讲的细节。Vertex shader 没有传统的顶点位置 buffer，完全由内置变量 `vertex_index` 推算球面坐标：先把 index 映射到 (i, j) 格子位置，再转换为 (θ, φ)，最终算出 xyz。对比传统做法说明这样的好处（省显存，任意 LOD 只改 constants，不用重传数据）。}

---

## 地形高度采样与顶点位移

{TODO: 说明 vertex shader 如何用 (θ, φ) 算出 terrain.height buffer 的索引（与 CPU 侧 `sphericalToIndex()` 等价），读取高度值后沿法线方向偏移顶点位置，形成地形起伏。解释 `displace_scale` uniform 的作用。}

---

## SplatMap 与地形着色

{TODO: 说明 fragment shader 如何读取 terrain.splat 里的地形类型 ID，按类型查表输出颜色。提及 bit 优先级的处理方式（如果 splat 用 bit mask 而非单一 ID）。}

---

## Uniform Buffer 布局

{TODO: 列出 160 bytes 的 uniform 布局：viewProj(64) + model(64) + displace_scale(4) + pad(12) + sunDir(12) + pad(4)，说明 model 矩阵里 radius 是直接乘进去的而不是单独字段。}

---

## 深度写入与渲染目标

{TODO: 说明这个 pass 输出到 scene.color（中间 RT，不是 canvas），同时写入 scene.depth，为后续 AtmosphereNode 的世界坐标重建提供深度数据。}
