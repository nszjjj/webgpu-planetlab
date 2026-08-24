// src/graph/nodes/CloudCoverageNode.ts
import { BaseNode } from '../../../framework/graph/BaseNode.ts';
import type { BuildContext, FrameContext } from '../../../framework/graph/types.ts';
import type { BufferHandle } from '../../../framework/graph/handles.ts';
import type { CloudParams } from '../params.ts';
import cloudCoverageSrc from '../shaders/cloud_coverage.wgsl?raw';

const CLOUD_OCTA_RES = 256;
// Must match const OCTA_RES : u32 = 256u in cloud_coverage.wgsl and cloud_render.wgsl
const UNIFORM_SIZE = 16; // 4 × f32

export class CloudCoverageNode extends BaseNode<
  { cloudParams: CloudParams },
  { coverageBuffer: BufferHandle<'cloud.coverage'> }
> {
  readonly name = 'CloudCoverage';

  private _pipeline!:      GPUComputePipeline;
  private _uniformBuffer!: GPUBuffer;
  private _bindGroup!:     GPUBindGroup;

  override build(ctx: BuildContext): void {
    const { device } = ctx;

    // Primary coverage buffer: one f32 per texel, read by CloudRenderNode each frame
    const coverageHandle = ctx.resources.createBufferHandle('cloud.coverage', {
      size:  CLOUD_OCTA_RES * CLOUD_OCTA_RES * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE,
    });
    this._outputs = { coverageBuffer: coverageHandle };

    const shader = device.createShaderModule({ code: cloudCoverageSrc });

    const bgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    this._pipeline = ctx.pipelines.createComputePipeline('cloud.coverage', {
      layout:  device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
      compute: { module: shader, entryPoint: 'cs_main' },
    });

    this._uniformBuffer = ctx.resources.createBuffer('cloud.coverage.uniform', {
      size:  UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const coverageBuffer = ctx.resources.resolveBuffer(coverageHandle);
    this._bindGroup = device.createBindGroup({
      layout:  bgl,
      entries: [
        { binding: 0, resource: { buffer: this._uniformBuffer } },
        { binding: 1, resource: { buffer: coverageBuffer } },
      ],
    });
  }

  override update(ctx: FrameContext): void {
    const p = this._inputs.cloudParams;
    ctx.device.queue.writeBuffer(
      this._uniformBuffer, 0,
      new Float32Array([p.timeOffset, p.coverageFreq, p.coverageThreshold, 0]),
    );
  }

  override recordPass(encoder: GPUCommandEncoder, _ctx: FrameContext): void {
    const pass = encoder.beginComputePass();
    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0, this._bindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(CLOUD_OCTA_RES / 8),
      Math.ceil(CLOUD_OCTA_RES / 8),
    );
    pass.end();
  }
}
