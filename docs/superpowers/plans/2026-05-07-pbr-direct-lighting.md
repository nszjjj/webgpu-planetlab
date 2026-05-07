# PBR Direct Lighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Lambert diffuse in planet fragment shader with Cook-Torrance PBR (GGX + Smith + Fresnel-Schlick), direct lighting only.

**Architecture:** New `pbr_common.wgsl` holds pure BRDF functions. `planet.wgsl` fragment imports and calls them. PerFrame uniform grows from 160→200 bytes (adds cameraPos, lightColor, lightIntensity). New MaterialParams uniform buffer (160 bytes, on-change update) provides roughness/metallic per terrain type via binding slot 3. DebugHUD gets PBR slider section.

**Tech Stack:** WGSL shaders, TypeScript, WebGPU API, existing Render Graph + ECS framework

---

### Task 1: Add PBR types to types.ts

**Files:**
- Modify: `src/core/types.ts`

- [ ] **Step 1: Add MaterialParam, MaterialParams, and DEFAULT_MATERIAL_PARAMS**

Append to `src/core/types.ts`:

```ts
export interface MaterialParam {
  roughness: number;
  metallic: number;
}

export interface MaterialParams {
  materials: [MaterialParam, ...MaterialParam[]];
  lightColor: [number, number, number];
  lightIntensity: number;
}

export const DEFAULT_MATERIAL_PARAMS: MaterialParams = {
  materials: [
    { roughness: 0.20, metallic: 0.30 },   // water  — bit 0
    { roughness: 0.70, metallic: 0.00 },   // sand   — bit 1
    { roughness: 0.80, metallic: 0.00 },   // grass  — bit 2
    { roughness: 0.55, metallic: 0.05 },   // rock   — bit 3
    { roughness: 0.45, metallic: 0.00 },   // snow   — bit 4
    { roughness: 0.50, metallic: 0.00 },   // reserved 5
    { roughness: 0.50, metallic: 0.00 },   // reserved 6
    { roughness: 0.50, metallic: 0.00 },   // reserved 7
    { roughness: 0.50, metallic: 0.00 },   // reserved 8
    { roughness: 0.50, metallic: 0.00 },   // reserved 9
  ],
  lightColor: [1.0, 0.95, 0.85],
  lightIntensity: 2.0,
};
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: no new errors.

---

### Task 2: Create pbr_common.wgsl

**Files:**
- Create: `src/shaders/pbr_common.wgsl`

- [ ] **Step 1: Write the shader file**

```wgsl
// src/shaders/pbr_common.wgsl
// Cook-Torrance BRDF with GGX distribution and Smith geometry.
// Direct lighting only — IBL deferred.

const PI: f32 = 3.14159265358979323846;

// ── BRDF Microfacet Functions ──────────────────────────────────────────────

fn DistributionGGX(N: vec3f, H: vec3f, roughness: f32) -> f32 {
  let a      = roughness * roughness;
  let a2     = a * a;
  let NdotH  = max(dot(N, H), 0.0);
  let denom  = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / (PI * denom * denom);
}

fn GeometrySchlickGGX(NdotV: f32, roughness: f32) -> f32 {
  let k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
  return NdotV / (NdotV * (1.0 - k) + k);
}

fn GeometrySmith(N: vec3f, V: vec3f, L: vec3f, roughness: f32) -> f32 {
  return GeometrySchlickGGX(max(dot(N, V), 0.0), roughness)
       * GeometrySchlickGGX(max(dot(N, L), 0.0), roughness);
}

fn fresnelSchlick(cosTheta: f32, F0: vec3f) -> vec3f {
  return F0 + (vec3(1.0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

// ── Cook-Torrance BRDF ─────────────────────────────────────────────────────

fn cookTorranceBRDF(
  N: vec3f, V: vec3f, L: vec3f,
  albedo: vec3f, metallic: f32, roughness: f32,
) -> vec3f {
  let H = normalize(V + L);

  let F0 = mix(vec3(0.04), albedo, metallic);

  let NDF = DistributionGGX(N, H, roughness);
  let G   = GeometrySmith(N, V, L, roughness);
  let F   = fresnelSchlick(max(dot(H, V), 0.0), F0);

  let numerator    = NDF * G * F;
  let NdotL        = max(dot(N, L), 0.0);
  let NdotV        = max(dot(N, V), 0.0);
  let denominator  = max(4.0 * NdotV * NdotL, 0.001);

  let specular = numerator / denominator;

  let kD = (vec3(1.0) - F) * (1.0 - metallic);
  return kD * albedo / PI + specular;
}

// ── Direct Lighting ────────────────────────────────────────────────────────

fn directLight(
  N: vec3f, V: vec3f, L: vec3f,
  albedo: vec3f, metallic: f32, roughness: f32,
  lightColor: vec3f, lightIntensity: f32,
) -> vec3f {
  let NdotL  = max(dot(N, L), 0.0);
  let radiance = lightColor * lightIntensity;
  return cookTorranceBRDF(N, V, L, albedo, metallic, roughness) * radiance * NdotL;
}

// ── Tone Mapping ───────────────────────────────────────────────────────────

fn tonemapReinhard(color: vec3f) -> vec3f {
  return color / (color + vec3(1.0));
}

fn tonemapACESFilm(color: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((color * (a * color + b)) / (color * (c * color + d) + e), vec3(0.0), vec3(1.0));
}
```

---

### Task 3: Rewrite planet.wgsl fragment for PBR

**Files:**
- Modify: `src/shaders/planet.wgsl`

- [ ] **Step 1: Replace the entire file**

```wgsl
// Planet render shader — vertex displacement via height_buffer, PBR fragment.
// Uniform layout: PerFrame 200 bytes + MaterialUniforms 160 bytes.

const PI              : f32 = 3.14159265358979323846;
const TERRAIN_RES     : u32 = 512u;
const AMBIENT         : f32 = 0.03;  // minimum light on dark side

override rings    : u32 = 128u;
override segments : u32 = 128u;

struct PerFrameUniforms {
  viewProj       : mat4x4<f32>,   // offset   0
  model          : mat4x4<f32>,   // offset  64
  displaceScale  : f32,           // offset 128
  _pad0          : f32,           // offset 132
  _pad1          : f32,           // offset 136
  _pad2          : f32,           // offset 140
  sunDir         : vec3<f32>,     // offset 144  (align 16, 144/16=9 ✓)
  _pad3          : f32,           // offset 156
  cameraPos      : vec3<f32>,     // offset 160  (align 16, 160/16=10 ✓)
  _pad4          : f32,           // offset 172
  lightColor     : vec3<f32>,     // offset 176  (align 16, 176/16=11 ✓)
  lightIntensity : f32,           // offset 188
  _pad5          : f32,           // offset 192
  _pad6          : f32,           // offset 196
}

struct MaterialUniforms {
  waterRoughness : f32,           // offset   0
  waterMetallic  : f32,           // offset   4
  _mPad0         : vec2<f32>,     // offset   8
  sandRoughness  : f32,           // offset  16
  sandMetallic   : f32,           // offset  20
  _mPad1         : vec2<f32>,     // offset  24
  grassRoughness : f32,           // offset  32
  grassMetallic  : f32,           // offset  36
  _mPad2         : vec2<f32>,     // offset  40
  rockRoughness  : f32,           // offset  48
  rockMetallic   : f32,           // offset  52
  _mPad3         : vec2<f32>,     // offset  56
  snowRoughness  : f32,           // offset  64
  snowMetallic   : f32,           // offset  68
  _mPad4         : vec2<f32>,     // offset  72
  // Reserved slots 5-9 (80-160 bytes)
  _reserved0     : vec4<f32>,     // offset  80
  _reserved1     : vec4<f32>,     // offset  96
  _reserved2     : vec4<f32>,     // offset 112
  _reserved3     : vec4<f32>,     // offset 128
  _reserved4     : vec4<f32>,     // offset 144
}

@group(0) @binding(0) var<uniform>       perFrame      : PerFrameUniforms;
@group(0) @binding(1) var<storage, read> height_buffer : array<f32>;
@group(0) @binding(2) var<storage, read> splat_buffer  : array<u32>;
@group(0) @binding(3) var<uniform>       materials     : MaterialUniforms;

struct MaterialParam {
  roughness : f32,
  metallic  : f32,
}

struct VertexOut {
  @builtin(position) clipPosition : vec4<f32>,
  @location(0)       normal       : vec3<f32>,
  @location(1)       spherePos    : vec3<f32>,  // original unit-sphere pos for terrain lookup
}

fn sphere_pos_to_index(p: vec3<f32>) -> u32 {
  let n     = normalize(p);
  let theta = acos(clamp(n.y, -1.0, 1.0));
  var phi   = atan2(n.z, n.x);
  if (phi < 0.0) { phi += 2.0 * PI; }
  let i = u32(clamp(theta / PI * f32(TERRAIN_RES - 1u), 0.0, f32(TERRAIN_RES - 1u)));
  let j = u32(clamp(phi / (2.0 * PI) * f32(TERRAIN_RES - 1u), 0.0, f32(TERRAIN_RES - 1u)));
  return i * TERRAIN_RES + j;
}

fn splat_to_color(mask: u32) -> vec3<f32> {
  if ((mask & (1u << 4u)) != 0u) { return vec3<f32>(0.90, 0.92, 0.95); } // snow
  if ((mask & (1u << 3u)) != 0u) { return vec3<f32>(0.45, 0.40, 0.35); } // rock
  if ((mask & (1u << 2u)) != 0u) { return vec3<f32>(0.25, 0.55, 0.20); } // grass
  if ((mask & (1u << 1u)) != 0u) { return vec3<f32>(0.76, 0.70, 0.50); } // sand
  return vec3<f32>(0.10, 0.25, 0.60);                                      // water
}

fn splat_to_material(mask: u32) -> MaterialParam {
  // Priority: snow > rock > grass > sand > water (matches splat_to_color)
  if ((mask & (1u << 4u)) != 0u) { return MaterialParam(materials.snowRoughness,  materials.snowMetallic);  }
  if ((mask & (1u << 3u)) != 0u) { return MaterialParam(materials.rockRoughness,  materials.rockMetallic);  }
  if ((mask & (1u << 2u)) != 0u) { return MaterialParam(materials.grassRoughness, materials.grassMetallic); }
  if ((mask & (1u << 1u)) != 0u) { return MaterialParam(materials.sandRoughness,  materials.sandMetallic);  }
  return MaterialParam(materials.waterRoughness, materials.waterMetallic);
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  let cols = segments + 1u;
  let i    = vertexIndex / cols;
  let j    = vertexIndex % cols;

  let theta = f32(i) / f32(rings)    * PI;
  let phi   = f32(j) / f32(segments) * 2.0 * PI;

  let localPos = vec3<f32>(
    sin(theta) * cos(phi),
    cos(theta),
    sin(theta) * sin(phi),
  );

  let h         = height_buffer[sphere_pos_to_index(localPos)];
  let displaced = localPos * (1.0 + h * perFrame.displaceScale);

  let worldNormal = normalize((perFrame.model * vec4<f32>(localPos, 0.0)).xyz);
  let worldPos    = (perFrame.model * vec4<f32>(displaced, 1.0)).xyz;

  var out: VertexOut;
  out.clipPosition = perFrame.viewProj * vec4<f32>(worldPos, 1.0);
  out.normal       = worldNormal;
  out.spherePos    = localPos;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let mask   = splat_buffer[sphere_pos_to_index(in.spherePos)];
  let albedo = splat_to_color(mask);
  let mat    = splat_to_material(mask);

  let N = normalize(in.normal);
  let V = normalize(perFrame.cameraPos - (perFrame.model * vec4<f32>(in.spherePos, 1.0)).xyz);
  let L = normalize(perFrame.sunDir.xyz);

  // Cook-Torrance direct lighting
  let pbrColor = directLight(
    N, V, L,
    albedo, mat.metallic, mat.roughness,
    perFrame.lightColor, perFrame.lightIntensity,
  );

  // Ambient fill for dark side
  let ambient = albedo * AMBIENT;
  let color   = pbrColor + ambient;

  // Tone map to avoid hard clipping in unorm RT
  let tonemapped = tonemapReinhard(color);

  return vec4<f32>(tonemapped, 1.0);
}
```

The file is now self-contained — `directLight` and `tonemapReinhard` are duplicated inline rather than imported, because WGSL import support varies across WebGPU implementations. If your toolchain supports `import` syntax, these can be moved to `pbr_common.wgsl` later.

> **Note:** If Vite's WGSL handling supports `#import` or `@import`, the `directLight`, `cookTorranceBRDF`, DistributionGGX, GeometrySmith, fresnelSchlick, and tonemapReinhard functions can be placed in `pbr_common.wgsl` and imported. For now, the self-contained approach avoids toolchain risk.

---

### Task 4: Update PlanetRenderNode for PBR uniforms

**Files:**
- Modify: `src/graph/nodes/PlanetRenderNode.ts`

**Design note:** Material buffer (160 bytes) is written every frame — no dirty-flag optimization. This avoids wiring callbacks between DebugHUD and PlanetRenderNode through GraphBuilder/main.ts. The overhead is negligible.

- [ ] **Step 1: Replace PlanetRenderNode.ts**

```ts
// src/graph/nodes/PlanetRenderNode.ts
import { BaseNode } from './BaseNode.ts';
import type { BuildContext, FrameContext, MaterialParams } from '../../core/types.ts';
import { DEFAULT_MATERIAL_PARAMS } from '../../core/types.ts';
import type { Scene } from '../../ecs/Scene.ts';
import type { ResourceManager } from '../../core/ResourceManager.ts';
import type { PipelineManager } from '../../core/PipelineManager.ts';
import { PlanetComponent } from '../../ecs/components/PlanetComponent.ts';
import { CameraComponent } from '../../ecs/components/CameraComponent.ts';
import { SunComponent } from '../../ecs/components/SunComponent.ts';
import planetShaderSrc from '../../shaders/planet.wgsl?raw';

const PERFRAME_SIZE = 200;

export class PlanetRenderNode extends BaseNode {
  readonly name = 'PlanetRender';

  private _scene: Scene;
  private _resources: ResourceManager;
  private _pipelines: PipelineManager;

  private _pipeline!:       GPURenderPipeline;
  private _perFrameBuffer!: GPUBuffer;
  private _materialBuffer!: GPUBuffer;
  private _bindGroup!:      GPUBindGroup;
  private _indexBuffer!:    GPUBuffer;
  private _indexCount = 0;

  private _materialParams: MaterialParams;

  constructor(
    scene:     Scene,
    resources: ResourceManager,
    pipelines: PipelineManager,
    materialParams: MaterialParams = DEFAULT_MATERIAL_PARAMS,
  ) {
    super();
    this._scene          = scene;
    this._resources      = resources;
    this._pipelines      = pipelines;
    this._materialParams = materialParams;
  }

  get materialParams(): MaterialParams { return this._materialParams; }

  override build(ctx: BuildContext): void {
    const planets = this._scene.getEntitiesWith(PlanetComponent);
    const planet  = planets[0]!.getComponent(PlanetComponent)!;

    const shaderModule = ctx.device.createShaderModule({ code: planetShaderSrc });

    const bindGroupLayout = ctx.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });

    this._pipeline = this._pipelines.createRenderPipeline('planet', {
      layout: ctx.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: {
        module:     shaderModule,
        entryPoint: 'vs_main',
        constants: {
          rings:    planet.rings,
          segments: planet.segments,
        },
      },
      fragment: {
        module:     shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: ctx.surfaceDesc.colorFormat }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: {
        format:            ctx.surfaceDesc.depthFormat,
        depthWriteEnabled: true,
        depthCompare:      'less',
      },
    });

    this._perFrameBuffer = this._resources.createBuffer('planet.perFrame', {
      size:  PERFRAME_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this._materialBuffer = this._resources.createBuffer('planet.material', {
      size:  160,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const heightBuffer = this._resources.getBuffer('terrain.height');
    const splatBuffer  = this._resources.getBuffer('terrain.splat');
    if (!heightBuffer || !splatBuffer) {
      throw new Error('PlanetRenderNode.build(): terrain buffers not found');
    }

    this._bindGroup = ctx.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this._perFrameBuffer } },
        { binding: 1, resource: { buffer: heightBuffer } },
        { binding: 2, resource: { buffer: splatBuffer } },
        { binding: 3, resource: { buffer: this._materialBuffer } },
      ],
    });

    const indices = buildSphereIndices(planet.rings, planet.segments);
    this._indexCount = indices.length;
    this._indexBuffer = this._resources.createBuffer('planet.index', {
      size:             indices.byteLength,
      usage:            GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint32Array(this._indexBuffer.getMappedRange()).set(indices);
    this._indexBuffer.unmap();
  }

  private _writeMaterialBuffer(device: GPUDevice): void {
    const m    = this._materialParams.materials;
    const data = new Float32Array(40); // 10 slots × 4 floats
    for (let i = 0; i < m.length && i < 10; i++) {
      const off = i * 4;
      data[off]     = m[i].roughness;
      data[off + 1] = m[i].metallic;
      data[off + 2] = 0;
      data[off + 3] = 0;
    }
    device.queue.writeBuffer(this._materialBuffer, 0, data);
  }

  override update(ctx: FrameContext): void {
    const planets = this._scene.getEntitiesWith(PlanetComponent);
    if (planets.length === 0) return;

    const cam = this._scene.mainCamera.getComponent(CameraComponent)!;
    const vp  = cam.getVPMatrix(this._scene.mainCamera.transform.position);

    const pf = new Float32Array(50);
    pf.set(vp, 0);

    const planet     = planets[0]!;
    const planetComp = planet.getComponent(PlanetComponent)!;
    const model      = planet.transform.getWorldMatrix();

    const scaledModel = new Float32Array(16);
    scaledModel.set(model);
    scaledModel[0]  *= planetComp.radius;
    scaledModel[5]  *= planetComp.radius;
    scaledModel[10] *= planetComp.radius;
    pf.set(scaledModel, 16);

    pf[32] = planetComp.displaceScale;

    const sunEntities = this._scene.getEntitiesWith(SunComponent);
    const sunPos = sunEntities[0]?.getComponent(SunComponent)?.worldPosition ?? [100, 50, 0];
    const dx = sunPos[0], dy = sunPos[1], dz = sunPos[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    pf[36] = dx / len;
    pf[37] = dy / len;
    pf[38] = dz / len;

    const cp = cam.getWorldPosition(this._scene.mainCamera.transform);
    pf[40] = cp[0];
    pf[41] = cp[1];
    pf[42] = cp[2];

    pf[44] = this._materialParams.lightColor[0];
    pf[45] = this._materialParams.lightColor[1];
    pf[46] = this._materialParams.lightColor[2];
    pf[47] = this._materialParams.lightIntensity;

    ctx.device.queue.writeBuffer(this._perFrameBuffer, 0, pf);

    // Material buffer written every frame (160 bytes, negligible overhead)
    this._writeMaterialBuffer(ctx.device);
  }

  override recordPass(encoder: GPUCommandEncoder, ctx: FrameContext): void {
    const planets = this._scene.getEntitiesWith(PlanetComponent);
    if (planets.length === 0) return;

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view:       ctx.sceneColorView,
        clearValue: { r: 0.02, g: 0.02, b: 0.05, a: 1 },
        loadOp:     'clear',
        storeOp:    'store',
      }],
      depthStencilAttachment: {
        view:            ctx.depthView,
        depthClearValue: 1.0,
        depthLoadOp:     'clear',
        depthStoreOp:    'store',
      },
    });

    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0, this._bindGroup);
    pass.setIndexBuffer(this._indexBuffer, 'uint32');
    pass.drawIndexed(this._indexCount);
    pass.end();
  }
}

function buildSphereIndices(rings: number, segments: number): Uint32Array {
  const cols    = segments + 1;
  const indices = new Uint32Array(rings * segments * 6);
  let idx = 0;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * cols + j;
      const b = (i + 1) * cols + j;
      const c = i * cols + j + 1;
      const d = (i + 1) * cols + j + 1;
      indices[idx++] = a; indices[idx++] = b; indices[idx++] = c;
      indices[idx++] = b; indices[idx++] = d; indices[idx++] = c;
    }
  }
  return indices;
}
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: no errors.

---

### Task 5: Update GraphBuilder to pass material params

**Files:**
- Modify: `src/graph/GraphBuilder.ts`

- [ ] **Step 1: Update GraphBuilder.build()**

Replace `src/graph/GraphBuilder.ts`:

```ts
// src/graph/GraphBuilder.ts
import { RenderGraph }           from '../core/RenderGraph.ts';
import { Scene }                 from '../ecs/Scene.ts';
import { Entity }                from '../ecs/Entity.ts';
import { CameraComponent }       from '../ecs/components/CameraComponent.ts';
import { PlanetComponent }       from '../ecs/components/PlanetComponent.ts';
import { SunComponent }          from '../ecs/components/SunComponent.ts';
import { ComputeNoiseNode }      from './nodes/ComputeNoiseNode.ts';
import { PlanetRenderNode }      from './nodes/PlanetRenderNode.ts';
import { CloudCoverageNode }     from './nodes/CloudCoverageNode.ts';
import { CloudRenderNode }       from './nodes/CloudRenderNode.ts';
import { AtmosphereNode }        from './nodes/AtmosphereNode.ts';
import { DebugWireframeNode }    from './nodes/DebugWireframeNode.ts';
import { OrbitCameraController } from '../controllers/OrbitCameraController.ts';
import type { BuildContext, CloudParams, MaterialParams } from '../core/types.ts';
import { DEFAULT_CLOUD_PARAMS, DEFAULT_MATERIAL_PARAMS }  from '../core/types.ts';
import type { WebGPUEngine }     from '../core/WebGPUEngine.ts';

export class GraphBuilder {
  static build(engine: WebGPUEngine, canvas: HTMLCanvasElement): {
    debugWireframe: DebugWireframeNode;
    cloudParams:    CloudParams;
    materialParams: MaterialParams;
  } {
    const { device, resources, pipelines } = engine;
    const cloudParams:    CloudParams    = { ...DEFAULT_CLOUD_PARAMS };
    const materialParams: MaterialParams = {
      materials:     [...DEFAULT_MATERIAL_PARAMS.materials] as MaterialParams['materials'],
      lightColor:    [...DEFAULT_MATERIAL_PARAMS.lightColor] as [number, number, number],
      lightIntensity: DEFAULT_MATERIAL_PARAMS.lightIntensity,
    };
    const surfaceRes  = engine.getSurfaceResources(0);
    const surfaceDesc = engine.surfaceDescriptor;

    // ── Surface-dependent RTs ──────────────────────────────────────────────
    surfaceRes.registerTexture('scene.color', (w, h) => ({
      size:   [w, h],
      format: surfaceDesc.colorFormat,
      usage:  GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    }));
    surfaceRes.registerTexture('scene.depth', (w, h) => ({
      size:   [w, h],
      format: surfaceDesc.depthFormat,
      usage:  GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    }));

    // ── Scene ──────────────────────────────────────────────────────────────
    const scene = new Scene();

    const planet = new Entity('planet');
    planet.transform.setPosition(0, 0, 0);
    planet.addComponent(new PlanetComponent(1.0, 128, 128));
    scene.addEntity(planet);

    const camera = new Entity('camera');
    camera.addComponent(
      new CameraComponent(Math.PI / 4, canvas.width / canvas.height, 0.1, 100),
    );
    scene.addEntity(camera);
    scene.mainCamera = camera;

    const sun = new Entity('sun');
    sun.addComponent(new SunComponent());
    scene.addEntity(sun);

    new OrbitCameraController(scene, canvas);

    // ── Build context ──────────────────────────────────────────────────────
    const buildCtx: BuildContext = { device, resources, surfaceRes, surfaceDesc, pipelines, scene };

    // ── Nodes ──────────────────────────────────────────────────────────────
    const noiseNode         = new ComputeNoiseNode(resources, pipelines);
    const planetNode        = new PlanetRenderNode(scene, resources, pipelines, materialParams);
    const cloudCoverageNode = new CloudCoverageNode(resources, pipelines, cloudParams);
    const cloudRenderNode   = new CloudRenderNode(scene, resources, pipelines, cloudParams);
    const atmosNode         = new AtmosphereNode(scene, resources, pipelines);
    const debugWireframe    = new DebugWireframeNode(resources, pipelines);

    noiseNode.build(buildCtx);
    planetNode.build(buildCtx);
    cloudCoverageNode.build(buildCtx);
    cloudRenderNode.build(buildCtx);
    atmosNode.build(buildCtx);
    debugWireframe.build(buildCtx);

    const graph = new RenderGraph(scene);
    graph.addNode(noiseNode);
    graph.addNode(planetNode);
    graph.addNode(cloudCoverageNode);
    graph.addNode(cloudRenderNode);
    graph.addNode(atmosNode);
    graph.addNode(debugWireframe);

    engine.setGraph(graph);
    return { debugWireframe, cloudParams, materialParams };
  }
}
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: no errors.

---

### Task 6: Update DebugHUD with PBR sliders

**Files:**
- Modify: `src/ui/DebugHUD.ts`

**Design note:** No `_onMaterialDirty` callback — material buffer is written every frame in PlanetRenderNode.update(). HUD only mutates the shared `MaterialParams` object. The `_buildCloudSliderRow` is typed for `CloudParams` keys; PBR sliders are built inline with direct property access to avoid `Record<string, number>` casts.

- [ ] **Step 1: Replace DebugHUD.ts**

```ts
// src/ui/DebugHUD.ts
import type { DebugWireframeNode } from '../graph/nodes/DebugWireframeNode.ts';
import type { CloudParams, MaterialParams } from '../core/types.ts';

const TERRAIN_LABELS = ['Water', 'Sand', 'Grass', 'Rock', 'Snow'];

export class DebugHUD {
  private _wireframeCheckbox!: HTMLInputElement;
  private _cloudExpanded = true;
  private _pbrExpanded   = true;

  constructor(
    private _wireframe:      DebugWireframeNode,
    private _cloudParams:    CloudParams,
    private _materialParams: MaterialParams,
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
    panel.appendChild(this._buildPBRSection());

    document.body.appendChild(panel);
  }

  private _buildWireframeRow(): HTMLLabelElement {
    const row = document.createElement('label');
    Object.assign(row.style, {
      display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
    });

    const checkbox = document.createElement('input');
    checkbox.type    = 'checkbox';
    checkbox.checked = this._wireframe.enabled;
    Object.assign(checkbox.style, { margin: '0', cursor: 'pointer', accentColor: '#cdd6f4' });
    checkbox.addEventListener('change', () => { this._wireframe.enabled = checkbox.checked; });
    this._wireframeCheckbox = checkbox;

    const label = document.createElement('span');
    label.textContent = 'Wireframe';
    Object.assign(label.style, { flex: '1' });

    const hint = document.createElement('span');
    hint.textContent = '(W)';
    Object.assign(hint.style, { color: '#585b70' });

    row.appendChild(checkbox); row.appendChild(label); row.appendChild(hint);
    return row;
  }

  // ── Cloud section ────────────────────────────────────────────────────────

  private _buildCloudSection(): HTMLDivElement {
    const section = document.createElement('div');
    Object.assign(section.style, { marginTop: '8px' });

    const [header, body, arrow] = this._buildSectionHeader('Cloud', this._cloudExpanded);
    body.style.display = this._cloudExpanded ? 'block' : 'none';

    const sliders: Array<{ key: keyof CloudParams; label: string; min: number; max: number; step: number }> = [
      { key: 'coverageFreq',      label: 'Coverage Freq', min: 0.1, max: 10.0, step: 0.1  },
      { key: 'coverageThreshold', label: 'Coverage Thr.', min: 0.0, max:  1.0, step: 0.01 },
      { key: 'extinction',        label: 'Extinction',    min: 0.0, max: 20.0, step: 0.1  },
      { key: 'scatterAlbedo',     label: 'Scatter Albedo',min: 0.0, max:  1.0, step: 0.01 },
      { key: 'mieG',              label: 'Mie G',         min:-1.0, max:  1.0, step: 0.01 },
    ];

    for (const def of sliders) {
      body.appendChild(this._buildCloudSliderRow(def));
    }

    header.addEventListener('click', () => {
      this._cloudExpanded = !this._cloudExpanded;
      arrow.textContent   = this._cloudExpanded ? '▼' : '▶';
      body.style.display  = this._cloudExpanded ? 'block' : 'none';
    });

    section.appendChild(header); section.appendChild(body);
    return section;
  }

  private _buildCloudSliderRow(def: {
    key: keyof CloudParams; label: string; min: number; max: number; step: number;
  }): HTMLDivElement {
    return this._buildGenericSlider(
      def.label, def.min, def.max, def.step,
      this._cloudParams[def.key],
      (v) => { (this._cloudParams as Record<string, number>)[def.key as string] = v; },
    );
  }

  // ── PBR section ──────────────────────────────────────────────────────────

  private _buildPBRSection(): HTMLDivElement {
    const section = document.createElement('div');
    Object.assign(section.style, { marginTop: '8px' });

    const [header, body, arrow] = this._buildSectionHeader('PBR Materials', this._pbrExpanded);
    body.style.display = this._pbrExpanded ? 'block' : 'none';

    for (let i = 0; i < 5; i++) {
      const mat = this._materialParams.materials[i];

      const sub = document.createElement('div');
      Object.assign(sub.style, {
        marginBottom: '8px', paddingLeft: '4px', borderLeft: '2px solid #45475a',
      });

      const subLabel = document.createElement('div');
      subLabel.textContent = TERRAIN_LABELS[i];
      Object.assign(subLabel.style, { fontSize: '11px', color: '#a6adc8', marginBottom: '2px' });
      sub.appendChild(subLabel);

      sub.appendChild(this._buildGenericSlider('Rough', 0.0, 1.0, 0.01,
        mat.roughness, (v) => { mat.roughness = v; }));
      sub.appendChild(this._buildGenericSlider('Metal', 0.0, 1.0, 0.01,
        mat.metallic,  (v) => { mat.metallic = v; }));

      body.appendChild(sub);
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
    lightSub.appendChild(this._buildGenericSlider('Intensity', 0.1, 10.0, 0.1,
      this._materialParams.lightIntensity,
      (v) => { this._materialParams.lightIntensity = v; }));
    body.appendChild(lightSub);

    header.addEventListener('click', () => {
      this._pbrExpanded = !this._pbrExpanded;
      arrow.textContent = this._pbrExpanded ? '▼' : '▶';
      body.style.display = this._pbrExpanded ? 'block' : 'none';
    });

    section.appendChild(header); section.appendChild(body);
    return section;
  }

  // ── Shared helpers ───────────────────────────────────────────────────────

  private _buildSectionHeader(title: string, expanded: boolean): [HTMLDivElement, HTMLDivElement, HTMLSpanElement] {
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase',
      color: '#6c7086', cursor: 'pointer', paddingBottom: '4px',
      borderBottom: '1px solid #313244', marginBottom: '6px',
    });
    const hdrLabel = document.createElement('span');
    hdrLabel.textContent = title;
    const arrow = document.createElement('span');
    arrow.textContent = expanded ? '▼' : '▶';
    header.appendChild(hdrLabel); header.appendChild(arrow);
    const body = document.createElement('div');
    return [header, body, arrow];
  }

  private _buildGenericSlider(
    label: string, min: number, max: number, step: number,
    initialVal: number,
    onInput: (v: number) => void,
  ): HTMLDivElement {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'grid', gridTemplateColumns: '60px 1fr 36px',
      alignItems: 'center', gap: '6px', marginBottom: '2px',
    });

    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    Object.assign(labelEl.style, {
      fontSize: '10px', color: '#9399b2', overflow: 'hidden', whiteSpace: 'nowrap',
    });

    const slider = document.createElement('input');
    slider.type  = 'range';
    slider.min   = String(min);
    slider.max   = String(max);
    slider.step  = String(step);
    slider.value = String(initialVal);
    Object.assign(slider.style, { width: '100%', accentColor: '#89b4fa', cursor: 'pointer' });

    const decimals = step < 0.1 ? 2 : 1;
    const valueEl  = document.createElement('span');
    valueEl.textContent = initialVal.toFixed(decimals);
    Object.assign(valueEl.style, { fontSize: '10px', color: '#cdd6f4', textAlign: 'right' });

    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      valueEl.textContent = v.toFixed(decimals);
      onInput(v);
    });

    row.appendChild(labelEl); row.appendChild(slider); row.appendChild(valueEl);
    return row;
  }

  private _bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'w' || e.key === 'W') {
        this._wireframe.enabled         = !this._wireframe.enabled;
        this._wireframeCheckbox.checked = this._wireframe.enabled;
      }
    });
  }
}
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: no errors.

---

### Task 7: Update main.ts to pass materialParams to DebugHUD

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Update main.ts**

Replace the entire file:

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
  const { debugWireframe, cloudParams, materialParams } = GraphBuilder.build(engine, canvas);
  engine.start();
  if (import.meta.env.DEV) {
    new DebugHUD(debugWireframe, cloudParams, materialParams);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  document.body.innerHTML = `<pre style="color:red;padding:1rem;">${msg}</pre>`;
});
```

No dirty callbacks — material buffer is written every frame in PlanetRenderNode.update().

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: no errors.

---

### Task 8: Build and verify

**Files:**
- None (verification only)

- [ ] **Step 1: Build the project**

```bash
npx tsc && npx vite build
```
Expected: no errors. If WGSL syntax issues, fix and retry.

- [ ] **Step 2: Run tests**

```bash
npx vitest run
```
Expected: all existing tests pass.

- [ ] **Step 3: Manual visual check**

Run `npx vite dev` and open browser. Verify:
- Planet renders with visible specular highlights (light side brighter, specular on water)
- Dark side has ambient fill (not pitch black)
- PBR section visible in Debug HUD with functional sliders
- Wireframe toggle still works (W key)
- Cloud section still works
