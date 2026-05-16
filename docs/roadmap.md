# 后续开发 Checklist

> 按视觉收益排序。高收益项优先实现。

---

## 高收益

- [ ] **Bloom 后处理** — 对 HDR sceneColor RT 做亮度提取 + 高斯模糊 + 叠加，使大气 limb glow 和太阳高光发光；仅需一个额外 render pass，依赖已有的 `rgba16float` sceneColor。
- [ ] **云阴影投射到地表** — 云 RT 的 A 通道即 transmittance（1=晴，0=不透），在地形 PBR 光照阶段采样该值遮蔽直接光；数据已就位，无需新 buffer。
- [ ] **海洋平面特殊渲染** — 水面叠加 Fresnel 反射天空色 + 镜面高光；目前水体仅靠 PBR roughness=0.20 区分，缺少真实感。

---

## 中等收益

- [ ] **星空背景** — sky 像素（depth ≥ 0.9999）在夜侧应叠加星空；procedural hash 点阵或 cubemap 均可，与大气散射混合。
- [ ] **云层动画** — `timeOffset` 参数已预留，CloudCoverageNode FBM 增加时间偏移驱动云层漂移，每帧重新 dispatch coverage compute。
- [ ] **TAA / 云时域重投影** — 半分辨率云 RT 在摄像机移动时锯齿明显；时域积累可在不提升分辨率的前提下显著改善质量。

---

## 功能性扩展

- [ ] **地形 LOD** — 当前 icosphere 为固定细分，视角拉近时面数不足；按摄像机距离动态增减细分级别。
- [ ] **夜面城市灯光** — 在 NdotL < 0 的夜侧叠加自发光纹理（程序生成或贴图），planet lab 的标志性 showcase 内容。
- [ ] **多行星 / 轨道模拟** — 支持场景中多个星球实体，添加轨道组件驱动位置，完善 planet lab 核心玩法。
