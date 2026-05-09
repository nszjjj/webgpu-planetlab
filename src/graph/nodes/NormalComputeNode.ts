// src/graph/nodes/NormalComputeNode.ts
import { BaseNode } from './BaseNode.ts';
import type { BuildContext, FrameContext } from '../../core/types.ts';
import type { ResourceManager } from '../../core/ResourceManager.ts';
import type { PipelineManager } from '../../core/PipelineManager.ts';
import { OCTA_RESOLUTION } from '../../utils/octahedral.ts';
import normalGenSrc from '../../shaders/normal_gen.wgsl?raw';

export class NormalComputeNode extends BaseNode {
  readonly name = 'NormalCompute';

  private _resources: ResourceManager;
  private _pipelines: PipelineManager;
  private _displaceScale: number;

  private _pipeline!:   GPUComputePipeline;
  private _bindGroup!:  GPUBindGroup;

  private _generated = false;

  constructor(
    resources: ResourceManager,
    pipelines: PipelineManager,
    displaceScale = 0.15,
  ) {
    super();
    this._resources = resources;
    this._pipelines = pipelines;
    this._displaceScale = displaceScale;
  }

  override build(ctx: BuildContext): void {
    const BUFFER_SIZE = OCTA_RESOLUTION * OCTA_RESOLUTION * 3 * 4; // 512*512*3 f32

    const normalBuffer = this._resources.createBuffer('terrain.normal', {
      size:  BUFFER_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const displaceBuffer = this._resources.createBuffer('normal.displaceParams', {
      size:  16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    ctx.device.queue.writeBuffer(displaceBuffer, 0, new Float32Array([
      this._displaceScale, 0, 0, 0,
    ]));

    const heightBuffer = this._resources.getBuffer('terrain.height');
    if (!heightBuffer) {
      throw new Error('NormalComputeNode.build(): terrain.height not found');
    }

    const shaderModule = ctx.device.createShaderModule({ code: normalGenSrc });
    const bindGroupLayout = ctx.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    this._pipeline = this._pipelines.createComputePipeline('terrain.normal_gen', {
      layout: ctx.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      compute: { module: shaderModule, entryPoint: 'main' },
    });

    this._bindGroup = ctx.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: displaceBuffer } },
        { binding: 1, resource: { buffer: heightBuffer } },
        { binding: 2, resource: { buffer: normalBuffer } },
      ],
    });
  }

  override recordPass(encoder: GPUCommandEncoder, _ctx: FrameContext): void {
    if (this._generated) return;

    const WG = Math.ceil(OCTA_RESOLUTION / 8); // 64 workgroups
    const pass = encoder.beginComputePass();
    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0, this._bindGroup);
    pass.dispatchWorkgroups(WG, WG);
    pass.end();

    this._generated = true;
  }
}
