// src/graph/nodes/CloudCoverageNode.ts
import { BaseNode } from './BaseNode.ts';
import type { BuildContext, FrameContext, CloudParams } from '../../core/types.ts';
import { DEFAULT_CLOUD_PARAMS } from '../../core/types.ts';
import type { ResourceManager } from '../../core/ResourceManager.ts';
import type { PipelineManager } from '../../core/PipelineManager.ts';
import cloudCoverageSrc from '../../shaders/cloud_coverage.wgsl?raw';

const COVERAGE_W   = 512;
const COVERAGE_H   = 256;
// Must match const W : u32 = 512u and H : u32 = 256u in cloud_coverage.wgsl
const UNIFORM_SIZE = 16; // 4 × f32

export class CloudCoverageNode extends BaseNode {
  readonly name = 'CloudCoverage';

  private _resources: ResourceManager;
  private _pipelines: PipelineManager;
  private _params:    CloudParams;

  private _pipeline!:      GPUComputePipeline;
  private _uniformBuffer!: GPUBuffer;
  private _bindGroup!:     GPUBindGroup;

  constructor(
    resources: ResourceManager,
    pipelines: PipelineManager,
    params:    CloudParams = DEFAULT_CLOUD_PARAMS,
  ) {
    super();
    this._resources = resources;
    this._pipelines = pipelines;
    this._params    = { ...params };
  }

  override build(ctx: BuildContext): void {
    const { device } = ctx;

    // Primary coverage buffer: one f32 per texel, read by CloudRenderNode each frame
    this._resources.createBuffer('cloud.coverage', {
      size:  COVERAGE_W * COVERAGE_H * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE,
    });

    const shader = device.createShaderModule({ code: cloudCoverageSrc });

    const bgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    this._pipeline = this._pipelines.createComputePipeline('cloud.coverage', {
      layout:  device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
      compute: { module: shader, entryPoint: 'cs_main' },
    });

    this._uniformBuffer = this._resources.createBuffer('cloud.coverage.uniform', {
      size:  UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const coverageBuffer = this._resources.getBuffer('cloud.coverage')!;
    this._bindGroup = device.createBindGroup({
      layout:  bgl,
      entries: [
        { binding: 0, resource: { buffer: this._uniformBuffer } },
        { binding: 1, resource: { buffer: coverageBuffer } },
      ],
    });
  }

  override update(ctx: FrameContext): void {
    const p = this._params;
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
      Math.ceil(COVERAGE_W / 8),
      Math.ceil(COVERAGE_H / 8),
    );
    pass.end();
  }
}
