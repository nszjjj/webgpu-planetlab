// src/graph/nodes/CloudRenderNode.ts
import { mat4 } from 'wgpu-matrix';
import { BaseNode } from './BaseNode.ts';
import type { BuildContext, FrameContext, CloudParams } from '../../core/types.ts';
import { DEFAULT_CLOUD_PARAMS } from '../../core/types.ts';
import type { Scene } from '../../ecs/Scene.ts';
import type { ResourceManager } from '../../core/ResourceManager.ts';
import type { PipelineManager } from '../../core/PipelineManager.ts';
import type { SurfaceResources } from '../../core/SurfaceResources.ts';
import { CameraComponent } from '../../ecs/components/CameraComponent.ts';
import { PlanetComponent } from '../../ecs/components/PlanetComponent.ts';
import { SunComponent } from '../../ecs/components/SunComponent.ts';
import cloudRenderSrc from '../../shaders/cloud_render.wgsl?raw';

const UNIFORM_SIZE = 128; // bytes

export class CloudRenderNode extends BaseNode {
  readonly name = 'CloudRender';

  private _scene:     Scene;
  private _resources: ResourceManager;
  private _pipelines: PipelineManager;
  private _params:    CloudParams;

  private _pipeline!:      GPURenderPipeline;
  private _uniformBuffer!: GPUBuffer;
  private _bindGroup!:     GPUBindGroup;
  private _bgl!:           GPUBindGroupLayout;
  private _surfaceRes!:    SurfaceResources;
  private _device!:        GPUDevice;

  // Pre-allocated scratch buffers — avoid per-frame GC pressure
  private readonly _uniformData = new Float32Array(UNIFORM_SIZE / 4);
  private readonly _invVPOut    = new Float32Array(16);
  private readonly _uniformDV:   DataView;

  constructor(
    scene:     Scene,
    resources: ResourceManager,
    pipelines: PipelineManager,
    params:    CloudParams = DEFAULT_CLOUD_PARAMS,
  ) {
    super();
    this._scene     = scene;
    this._resources = resources;
    this._pipelines = pipelines;
    this._params    = params;
    this._uniformDV = new DataView(this._uniformData.buffer);
  }

  override build(ctx: BuildContext): void {
    this._device     = ctx.device;
    this._surfaceRes = ctx.surfaceRes;

    // Half-resolution cloud colour RT; resizes with canvas
    ctx.surfaceRes.registerTexture('cloud.color', (w, h) => ({
      size:   [Math.max(1, Math.floor(w / 2)), Math.max(1, Math.floor(h / 2))],
      format: 'rgba16float' as GPUTextureFormat,
      usage:  GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    }));

    const shader = ctx.device.createShaderModule({ code: cloudRenderSrc });

    this._bgl = ctx.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'depth' } },
      ],
    });

    this._pipeline = this._pipelines.createRenderPipeline('cloud.render', {
      layout:    ctx.device.createPipelineLayout({ bindGroupLayouts: [this._bgl] }),
      vertex:    { module: shader, entryPoint: 'vs_main' },
      fragment:  {
        module:     shader,
        entryPoint: 'fs_main',
        targets:    [{ format: 'rgba16float' }],
      },
      primitive: { topology: 'triangle-list' },
    });

    this._uniformBuffer = this._resources.createBuffer('cloud.render.uniform', {
      size:  UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this._rebuildBindGroup();
    ctx.surfaceRes.onChanged(() => this._rebuildBindGroup());
  }

  private _rebuildBindGroup(): void {
    const coverageBuffer = this._resources.getBuffer('cloud.coverage');
    if (!coverageBuffer) throw new Error('CloudRenderNode: cloud.coverage buffer not found — ensure CloudCoverageNode.build() runs first');
    this._bindGroup = this._device.createBindGroup({
      layout:  this._bgl,
      entries: [
        { binding: 0, resource: { buffer: this._uniformBuffer } },
        { binding: 1, resource: { buffer: coverageBuffer } },
        { binding: 2, resource: this._surfaceRes.getView('scene.depth') },
      ],
    });
  }

  override update(ctx: FrameContext): void {
    const cam    = this._scene.mainCamera.getComponent(CameraComponent)!;
    const camPos = this._scene.mainCamera.transform.position;

    const vp = cam.getVPMatrix(camPos);
    mat4.inverse(vp, this._invVPOut);

    const planets      = this._scene.getEntitiesWith(PlanetComponent);
    const planetRadius = planets[0]?.getComponent(PlanetComponent)?.radius ?? 1.0;

    const sunComp    = this._scene.getEntitiesWith(SunComponent)[0]?.getComponent(SunComponent);
    const sunPos     = sunComp?.worldPosition ?? [100, 50, 0];
    const sx = sunPos[0] as number;
    const sy = sunPos[1] as number;
    const sz = sunPos[2] as number;
    const sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
    // Degenerate guard: sun at planet centre — default to +Y direction (matches AtmosphereNode)
    let sdx: number, sdy: number, sdz: number;
    if (sl < 1e-6) {
      sdx = 0; sdy = 1; sdz = 0;
    } else {
      sdx = sx / sl; sdy = sy / sl; sdz = sz / sl;
    }

    const data = this._uniformData;
    const dv   = this._uniformDV;
    data.fill(0);

    // Uniform buffer layout (float indices, each float = 4 bytes):
    data.set(this._invVPOut, 0);             // bytes   0–63: mat4 invViewProj
    data[16] = camPos[0]!;                   // bytes  64–67: cameraPos.x
    data[17] = camPos[1]!;                   // bytes  68–71: cameraPos.y
    data[18] = camPos[2]!;                   // bytes  72–75: cameraPos.z
    data[19] = planetRadius;                 // bytes  76–79: planetRadius
    data[20] = sdx;                           // bytes  80–83: sunDir.x
    data[21] = sdy;                           // bytes  84–87: sunDir.y
    data[22] = sdz;                           // bytes  88–91: sunDir.z
    data[23] = this._params.cloudInnerRadius; // bytes  92–95
    data[24] = this._params.cloudOuterRadius; // bytes  96–99
    data[25] = this._params.extinction;       // bytes 100–103
    data[26] = this._params.scatterAlbedo;    // bytes 104–107
    data[27] = this._params.mieG;             // bytes 108–111
    data[28] = this._params.scaleHeight;      // bytes 112–115
    data[29] = this._params.timeOffset;       // bytes 116–119
    dv.setUint32(120, this._params.numSteps, true); // bytes 120–123: numSteps (u32, LE)

    ctx.device.queue.writeBuffer(this._uniformBuffer, 0, data);
  }

  override recordPass(encoder: GPUCommandEncoder, _ctx: FrameContext): void {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view:       this._surfaceRes.getView('cloud.color'),
        loadOp:     'clear',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },  // a=1: transmittance=1 (fully clear)
        storeOp:    'store',
      }],
    });
    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0, this._bindGroup);
    pass.draw(6);
    pass.end();
  }
}
