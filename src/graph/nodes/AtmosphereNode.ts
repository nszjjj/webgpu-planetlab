// src/graph/nodes/AtmosphereNode.ts
import { mat4 } from 'wgpu-matrix';
import { BaseNode } from './BaseNode.ts';
import type { BuildContext, FrameContext, AtmosphereParams } from '../../core/types.ts';
import { DEFAULT_ATMOSPHERE_PARAMS } from '../../core/types.ts';
import type { Scene } from '../../ecs/Scene.ts';
import type { ResourceManager } from '../../core/ResourceManager.ts';
import type { PipelineManager } from '../../core/PipelineManager.ts';
import { CameraComponent } from '../../ecs/components/CameraComponent.ts';
import { PlanetComponent } from '../../ecs/components/PlanetComponent.ts';
import { SunComponent } from '../../ecs/components/SunComponent.ts';
import type { Entity } from '../../ecs/Entity.ts';
import atmosphereSrc from '../../shaders/atmosphere.wgsl?raw';

// Uniform buffer layout: 144 bytes (see spec)
const UNIFORM_SIZE = 144;

// Default sun position used when no SunEntity exists in the scene
const DEFAULT_SUN_POS: [number, number, number] = [100, 50, 0];

export class AtmosphereNode extends BaseNode {
  readonly name = 'Atmosphere';

  private _scene: Scene;
  private _resources: ResourceManager;
  private _pipelines: PipelineManager;
  private _params: AtmosphereParams;

  private _pipeline!: GPURenderPipeline;
  private _uniformBuffer!: GPUBuffer;
  private _bindGroup!: GPUBindGroup;
  private _bindGroupLayout!: GPUBindGroupLayout;
  private _device!: GPUDevice;

  // Pre-allocated scratch buffers — reused every frame to avoid GC pressure
  private readonly _uniformData = new Float32Array(UNIFORM_SIZE / 4);
  private readonly _sunDir      = new Float32Array(3);
  private readonly _invVPOut    = new Float32Array(16);

  private _cachedSunEntity:    Entity | undefined;
  private _cachedPlanetEntity: Entity | undefined;

  constructor(
    scene: Scene,
    resources: ResourceManager,
    pipelines: PipelineManager,
    params: AtmosphereParams = DEFAULT_ATMOSPHERE_PARAMS,
  ) {
    super();
    this._scene     = scene;
    this._resources = resources;
    this._pipelines = pipelines;
    this._params    = params;
  }

  override build(ctx: BuildContext): void {
    const { device } = ctx;
    this._device = device;

    const shaderModule = device.createShaderModule({ code: atmosphereSrc });

    this._bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'depth', viewDimension: '2d' } },
      ],
    });

    this._pipeline = this._pipelines.createRenderPipeline('atmosphere', {
      layout: device.createPipelineLayout({ bindGroupLayouts: [this._bindGroupLayout] }),
      vertex:   { module: shaderModule, entryPoint: 'vs_main' },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: ctx.surfaceDesc.targetFormat }],
      },
      primitive: { topology: 'triangle-list' },
    });

    this._uniformBuffer = this._resources.createBuffer('atmosphere.uniform', {
      size: UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // 初始构建 bindGroup
    this._rebuildBindGroup(ctx.surfaceRes);

    // resize 时纹理重建后重新构建 bindGroup
    ctx.surfaceRes.onChanged(() => this._rebuildBindGroup(ctx.surfaceRes));

    this._cachedSunEntity    = this._scene.getEntitiesWith(SunComponent)[0];
    this._cachedPlanetEntity = this._scene.getEntitiesWith(PlanetComponent)[0];
  }

  private _rebuildBindGroup(surfaceRes: import('../../core/SurfaceResources.ts').SurfaceResources): void {
    this._bindGroup = this._device.createBindGroup({
      layout: this._bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this._uniformBuffer } },
        { binding: 1, resource: surfaceRes.getView('scene.color') },
        { binding: 2, resource: surfaceRes.getView('scene.depth') },
      ],
    });
  }

  override update(ctx: FrameContext): void {
    const cam    = this._scene.mainCamera.getComponent(CameraComponent)!;
    const camPos = this._scene.mainCamera.transform.position;

    // Sun direction: prefer cached SunComponent, fall back to default position
    const sunComp = this._cachedSunEntity?.getComponent(SunComponent);
    const sunPos  = sunComp?.worldPosition ?? DEFAULT_SUN_POS;

    // Planet position from cached entity
    const planetPos = this._cachedPlanetEntity?.transform.position;

    const dx  = sunPos[0] - (planetPos ? planetPos[0]! : 0);
    const dy  = sunPos[1] - (planetPos ? planetPos[1]! : 0);
    const dz  = sunPos[2] - (planetPos ? planetPos[2]! : 0);
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (len < 1e-6) {
      // Sun at planet center — default to +Y direction
      this._sunDir[0] = 0; this._sunDir[1] = 1; this._sunDir[2] = 0;
    } else {
      this._sunDir[0] = dx / len;
      this._sunDir[1] = dy / len;
      this._sunDir[2] = dz / len;
    }

    // Compute inverse view-projection into pre-allocated buffer
    const vp = cam.getVPMatrix(camPos);
    mat4.inverse(vp, this._invVPOut);

    const data = this._uniformData;
    data.fill(0); // clear padding fields

    // Layout matches AtmosphereUniforms struct in atmosphere.wgsl (offsets in floats):
    data[0]  = this._sunDir[0]!;   // sunDir.x      (float offset 0)
    data[1]  = this._sunDir[1]!;   // sunDir.y
    data[2]  = this._sunDir[2]!;   // sunDir.z
    const p  = this._params;
    data[3]  = p.planetRadius;     // planetRadius  (float offset 3)
    data[4]  = p.atmosphereRadius; // atmosphereRadius
    // [5..7] = _pad0,1,2 (zero)
    data[8]  = camPos[0]!;         // cameraPos.x   (float offset 8)
    data[9]  = camPos[1]!;
    data[10] = camPos[2]!;
    // [11] = _pad3 (zero)
    data[12] = p.betaR[0];         // betaR.x       (float offset 12)
    data[13] = p.betaR[1];
    data[14] = p.betaR[2];
    data[15] = p.betaM;            // betaM         (float offset 15)
    data[16] = p.mieG;             // mieG          (float offset 16)
    // [17..18] = numSamples/numLightSamples as u32 — use DataView for explicit byte offsets
    const dv = new DataView(data.buffer);
    dv.setUint32(68, p.numSamples,      true); // byte offset 68, little-endian
    dv.setUint32(72, p.numLightSamples, true); // byte offset 72
    // [19] = _pad4 (zero)
    // invViewProj at float offset 20 (byte offset 80)
    data.set(this._invVPOut, 20);

    ctx.device.queue.writeBuffer(this._uniformBuffer, 0, data);
  }

  override recordPass(encoder: GPUCommandEncoder, ctx: FrameContext): void {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view:       ctx.targetView,
        loadOp:     'clear',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        storeOp:    'store',
      }],
    });

    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0, this._bindGroup);
    pass.draw(6); // 6 vertices = 2 triangles = full-screen quad
    pass.end();
  }
}
