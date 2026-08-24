// src/graph/nodes/CloudRenderNode.ts
import { mat4 } from 'wgpu-matrix';
import { BaseNode } from '../../../framework/graph/BaseNode.ts';
import type { BuildContext, FrameContext } from '../../../framework/graph/types.ts';
import type { BufferHandle, TextureHandle } from '../../../framework/graph/handles.ts';
import type { SurfaceResources } from '../../../framework/core/SurfaceResources.ts';
import type { CloudParams } from '../params.ts';
import cloudRenderSrc from '../shaders/cloud_render.wgsl?raw';

const UNIFORM_SIZE = 128; // bytes

type CloudRenderInputs = {
  coverageBuffer: BufferHandle<'cloud.coverage'>;
  depthTarget:    TextureHandle<'scene.depth'>;

  vpMatrix:     Float32Array;
  cameraPos:    [number, number, number];
  sunDir:       [number, number, number];
  planetRadius: number;
  cloudParams:  CloudParams;
};

export class CloudRenderNode extends BaseNode<CloudRenderInputs, {}> {
  readonly name = 'CloudRender';

  private _pipeline!:      GPURenderPipeline;
  private _uniformBuffer!: GPUBuffer;
  private _bindGroup!:     GPUBindGroup;
  private _bgl!:           GPUBindGroupLayout;
  private _surfaceRes!:    SurfaceResources;
  private _device!:        GPUDevice;
  private _coverageBuffer!: GPUBuffer;

  // Pre-allocated scratch buffers — avoid per-frame GC pressure
  private readonly _uniformData = new Float32Array(UNIFORM_SIZE / 4);
  private readonly _invVPOut    = new Float32Array(16);
  private readonly _uniformDV:   DataView;

  constructor() {
    super();
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

    this._pipeline = ctx.pipelines.createRenderPipeline('cloud.render', {
      layout:    ctx.device.createPipelineLayout({ bindGroupLayouts: [this._bgl] }),
      vertex:    { module: shader, entryPoint: 'vs_main' },
      fragment:  {
        module:     shader,
        entryPoint: 'fs_main',
        targets:    [{ format: 'rgba16float' }],
      },
      primitive: { topology: 'triangle-list' },
    });

    this._uniformBuffer = ctx.resources.createBuffer('cloud.render.uniform', {
      size:  UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this._coverageBuffer = ctx.resources.resolveBuffer(this._inputs.coverageBuffer);

    this._rebuildBindGroup();
    ctx.surfaceRes.onChanged(() => this._rebuildBindGroup());
  }

  private _rebuildBindGroup(): void {
    this._bindGroup = this._device.createBindGroup({
      layout:  this._bgl,
      entries: [
        { binding: 0, resource: { buffer: this._uniformBuffer } },
        { binding: 1, resource: { buffer: this._coverageBuffer } },
        { binding: 2, resource: this._surfaceRes.getView(this._inputs.depthTarget.key) },
      ],
    });
  }

  override update(ctx: FrameContext): void {
    const p = this._inputs.cloudParams;

    mat4.inverse(this._inputs.vpMatrix, this._invVPOut);

    const camPos = this._inputs.cameraPos;
    const sunDir = this._inputs.sunDir;

    const data = this._uniformData;
    const dv   = this._uniformDV;
    data.fill(0);

    // Uniform buffer layout (float indices, each float = 4 bytes):
    data.set(this._invVPOut, 0);              // bytes   0–63: mat4 invViewProj
    data[16] = camPos[0];                      // bytes  64–67: cameraPos.x
    data[17] = camPos[1];                      // bytes  68–71: cameraPos.y
    data[18] = camPos[2];                      // bytes  72–75: cameraPos.z
    data[19] = this._inputs.planetRadius;       // bytes  76–79: planetRadius
    data[20] = sunDir[0];                       // bytes  80–83: sunDir.x
    data[21] = sunDir[1];                       // bytes  84–87: sunDir.y
    data[22] = sunDir[2];                       // bytes  88–91: sunDir.z
    data[23] = p.cloudInnerRadius;               // bytes  92–95
    data[24] = p.cloudOuterRadius;               // bytes  96–99
    data[25] = p.extinction;                     // bytes 100–103
    data[26] = p.scatterAlbedo;                  // bytes 104–107
    data[27] = p.mieG;                           // bytes 108–111
    data[28] = p.scaleHeight;                    // bytes 112–115
    data[29] = p.timeOffset;                     // bytes 116–119
    dv.setUint32(120, p.numSteps, true);         // bytes 120–123: numSteps (u32, LE)

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
