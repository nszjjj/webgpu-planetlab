# webgpu-planetlab

WebGPU 驱动的程序化星球渲染器，灵感来源于《戴森球计划》(Dyson Sphere Program)。

## 演示

```
npm install
npm run dev      # 启动开发服务器
npm run build    # 生产构建
npm test         # 运行测试
```

需要支持 WebGPU 的浏览器（Chrome/Edge 113+、Firefox Nightly）。

---

使用 Github Pages 预览：[Github Pages - webgpu-planetlab](https://nszjjj.github.io/webgpu-planetlab/)

## 已实现功能

### 程序化地形
- **多层噪声合成**：Simplex FBM（大陆骨架）+ Ridged Multifractal（山脉脊线）+ Worley（细节纹理），通过计算着色器生成 512×512 八面体高度图
- **地形分类**：高度驱动的样带图（水面 / 沙滩 / 草地 / 岩石 / 雪地），稀有矿石使用独立频率噪声
- **法线计算**：高度图中心差分法生成细节法线，用于 PBR 光照

### 行星渲染
- **二十面体网格**：细分级别 5 的正二十面体（~10K 顶点），均匀球面分布，比 UV 球体极点无退化
- **八面体映射**：基于 Cigolle et al. (2014) 的均匀球面参数化，顶点着色器中采样高度图做位移
- **PBR Cook-Torrance 直接光照**：GGX 法线分布、Smith 几何遮蔽、Schlick 菲涅尔近似，Reinhard 色调映射
- **地形材质**：五种地形类型各有独立的粗糙度/金属度参数，通过 Debug HUD 实时调节

### 大气散射
- **Nishita 1993 单次散射模型**：Rayleigh（波长相关蓝色散射）+ Mie（Henyey-Greenstein 相位函数）
- **行星遮挡**：太阳被行星遮挡时产生阴影
- **云层合成**：通过双边上采样将云层合成到场景上，深度感知权重

### 云层系统
- **程序化云密度**：256×256 八面体 FBM 噪声，可调覆盖阈值
- **球形云壳光线步进**：Henyey-Greenstein 相位散射 + Beer's Powder 边缘变暗，行星遮挡测试
- **哈希抖动**：减少光线步进的带状伪影

### 调试工具（DEV 模式）
- **Debug HUD**：右上角半透明控制面板，Catppuccin 配色
- **线框模式**：绿色线框叠加，复选框或 W 键切换
- **云参数滑块**：覆盖频率、阈值、消光系数、散射反照率、Mie G 参数
- **PBR 材质滑块**：水/沙/草/岩/雪各独立粗糙度/金属度 + 光照强度

### 交互
- **轨道相机**：鼠标拖拽旋转、滚轮缩放，球面坐标约束，半径范围 1.5~20

### 引擎架构
- **Modern Render Graph**：显式帧图架构，所有渲染/计算逻辑封装为独立 Graph Node，单次 CommandEncoder 录制
- **ECS 数据层**：Entity-Component-System 管理场景数据（行星、相机、太阳），与渲染层解耦
- **Surface 抽象**：Canvas / Offscreen 渲染目标通过 ISurface 接口注入，支持 ResizeObserver 响应式缩放
- **资源管理**：ResourceManager（GPU Buffer/Texture 缓存）、PipelineManager（管线缓存）、SurfaceResources（表面附属 RT 生命周期）

## 渲染管线

```
ComputeNoiseNode → NormalComputeNode → PlanetRenderNode → CloudCoverageNode → CloudRenderNode → AtmosphereNode → DebugWireframeNode
     ↓                    ↓                   ↓                   ↓                  ↓                 ↓                  ↓
terrain.height      terrain.normal       scene.color       cloud.coverage      cloud.color        canvas          wireframe
terrain.splat                            scene.depth                                             (swapchain)
```

每个 Node 通过命名 GPU 资源传递数据，Node 之间不直接引用。

## 项目结构

```
src/
├── framework/                      ← 通用 WebGPU 渲染框架
│   ├── core/                       # WebGPUContext、FrameLoop、RenderGraph、资源/管线管理
│   ├── ecs/                        # ECS 框架（Entity、Transform、Scene、Component）
│   ├── graph/                      # BaseNode、Handle 类型系统、图上下文
│   ├── renderer3d/                 # SceneTargets 约定（颜色、深度、法线 RT）
│   └── ui/                         # HUDPanel/Section/Slider/Toggle + GraphDebugUI
├── demos/
│   └── planet/                     ← 星球 demo 业务层
│       ├── components/             # PlanetComponent、SunComponent 等业务组件
│       ├── nodes/                  # PlanetRenderNode、CloudRenderNode、AtmosphereNode 等
│       ├── shaders/                # 星球专属 WGSL 着色器
│       ├── params/                 # 星球参数预设（草原、冰封、气态等）
│       ├── graph.ts                # buildPlanetGraph function
│       ├── controllers/            # 星球交互控制器
│       └── ui/                     # PlanetHUD
├── main.ts                         # 应用入口（通过单行 import 选择 demo）
└── __tests__/
    ├── framework/                  # 框架层单元测试
    └── demos/planet/               # 业务层单元测试
```

## 计划功能

| 阶段 | 功能 |
|------|------|
| Phase 2 | 渲染图调试面板：节点列表、逐节点 GPU 计时 |
| Phase 3 | 后处理效果：Bloom 泛光 |
| Phase 4 | SSAO 屏幕空间环境光遮蔽 |
| Phase 5 | 气态巨行星渲染、冰封星球生物群系、DSP 风格工业建筑覆盖 |
| 后续 | 云层动画、水蚀模拟、多行星场景、大气透射率 LUT 优化 |

## 技术栈

| 类别 | 技术 |
|------|------|
| 图形 API | WebGPU |
| 语言 | TypeScript 6.0 (ESM) |
| 构建 | Vite 8 |
| 测试 | Vitest 3 |
| 数学库 | wgpu-matrix |
| 着色器 | WGSL |
