// src/graph/nodes/AtmosphereNode.ts
import { mat4 } from 'wgpu-matrix';
import { BaseNode } from '../../../framework/graph/BaseNode.ts';
import type { BuildContext, FrameContext } from '../../../framework/graph/types.ts';
import type { TextureHandle } from '../../../framework/graph/handles.ts';
import type { ResourceManager } from '../../../framework/core/ResourceManager.ts';
import type { SurfaceResources } from '../../../framework/core/SurfaceResources.ts';
import type { AtmosphereParams } from '../params.ts';
import atmosphereSrc from '../shaders/atmosphere.wgsl?raw';

// Uniform buffer layout: 144 bytes (see spec)
const UNIFORM_SIZE = 144;

type AtmosInputs = {
  lut:         TextureHandle<string>;
  colorTarget: TextureHandle<'scene.color'>;
  depthTarget: TextureHandle<'scene.depth'>;
  targetView:  GPUTextureView;

  vpMatrix:     Float32Array;
  cameraPos:    [number, number, number];
  sunDir:       [number, number, number];
  params:       AtmosphereParams;
  planetRadius: number;
};

export class AtmosphereNode extends BaseNode<AtmosInputs, {}> {
  readonly name = 'Atmosphere';

  private _resources!:  ResourceManager;
  private _surfaceRes!: SurfaceResources;
  private _device!:     GPUDevice;

  private _pipeline!:      GPURenderPipeline;
  private _uniformBuffer!: GPUBuffer;
  private _bindGroup!:     GPUBindGroup;
  private _bindGroupLayout!: GPUBindGroupLayout;

  // Pre-allocated scratch buffers — reused every frame to avoid GC pressure
  private readonly _uniformData = new Float32Array(UNIFORM_SIZE / 4);
  private readonly _invVPOut    = new Float32Array(16);

  override build(ctx: BuildContext): void {
    const { device } = ctx;
    this._device     = device;
    this._resources   = ctx.resources;
    this._surfaceRes  = ctx.surfaceRes;

    const shaderModule = device.createShaderModule({ code: atmosphereSrc });

    this._bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'depth', viewDimension: '2d' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d' } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '3d' } },
      ],
    });

    this._pipeline = ctx.pipelines.createRenderPipeline('atmosphere', {
      layout: device.createPipelineLayout({ bindGroupLayouts: [this._bindGroupLayout] }),
      vertex:   { module: shaderModule, entryPoint: 'vs_main' },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: ctx.surfaceDesc.targetFormat }],
      },
      primitive: { topology: 'triangle-list' },
    });

    this._uniformBuffer = ctx.resources.createBuffer('atmosphere.uniform', {
      size: UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this._rebuildBindGroup();

    ctx.surfaceRes.onChanged(() => this._rebuildBindGroup());
  }

  private _rebuildBindGroup(): void {
    const lutView = this._resources.resolveTexture(this._inputs.lut).createView();

    this._bindGroup = this._device.createBindGroup({
      layout: this._bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this._uniformBuffer } },
        { binding: 1, resource: this._surfaceRes.getView(this._inputs.colorTarget.key) },
        { binding: 2, resource: this._surfaceRes.getView(this._inputs.depthTarget.key) },
        { binding: 3, resource: this._surfaceRes.getView('cloud.color') },
        { binding: 4, resource: lutView },
      ],
    });
  }

  override update(ctx: FrameContext): void {
    const camPos = this._inputs.cameraPos;
    const sunDir = this._inputs.sunDir;
    const p      = this._inputs.params;

    mat4.inverse(this._inputs.vpMatrix, this._invVPOut);

    const data = this._uniformData;
    data.fill(0);

    data[0]  = sunDir[0];
    data[1]  = sunDir[1];
    data[2]  = sunDir[2];
    data[3]  = this._inputs.planetRadius;
    data[4]  = p.atmosphereRadius;
    data[5]  = p.H_R;
    data[6]  = p.H_M;
    data[8]  = camPos[0];
    data[9]  = camPos[1];
    data[10] = camPos[2];
    data[12] = p.betaR[0];
    data[13] = p.betaR[1];
    data[14] = p.betaR[2];
    data[15] = p.betaM;
    data[16] = p.mieG;
    const dv = new DataView(data.buffer);
    dv.setUint32(68, p.numSamples,      true);
    dv.setUint32(72, p.numLightSamples, true);
    data.set(this._invVPOut, 20);

    ctx.device.queue.writeBuffer(this._uniformBuffer, 0, data);
  }

  override recordPass(encoder: GPUCommandEncoder, _ctx: FrameContext): void {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view:       this._inputs.targetView,
        loadOp:     'clear',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        storeOp:    'store',
      }],
    });

    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0, this._bindGroup);
    pass.draw(6);
    pass.end();
  }
}
