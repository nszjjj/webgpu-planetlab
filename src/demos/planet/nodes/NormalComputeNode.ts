// src/graph/nodes/NormalComputeNode.ts
import { BaseNode } from '../../../framework/graph/BaseNode.ts';
import type { BuildContext, FrameContext } from '../../../framework/graph/types.ts';
import type { BufferHandle } from '../../../framework/graph/handles.ts';
import { OCTA_RESOLUTION } from '../utils/octahedral.ts';
import normalGenSrc from '../shaders/normal_gen.wgsl?raw';

export class NormalComputeNode extends BaseNode<
  { heightBuffer: BufferHandle<'terrain.height'>; displaceScale: number },
  { normalBuffer: BufferHandle<'terrain.normal'> }
> {
  readonly name = 'NormalCompute';

  private _pipeline!:             GPUComputePipeline;
  private _bindGroup!:            GPUBindGroup;
  private _displaceParamsBuffer!: GPUBuffer;

  // Normals are static — generate once on the first frame, then skip.
  private _generated = false;

  override build(ctx: BuildContext): void {
    const BUFFER_SIZE = OCTA_RESOLUTION * OCTA_RESOLUTION * 3 * 4; // 512*512*3 f32

    const normalHandle = ctx.resources.createBufferHandle('terrain.normal', {
      size:  BUFFER_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    this._outputs = { normalBuffer: normalHandle };

    this._displaceParamsBuffer = ctx.resources.createBuffer('normal.displaceParams', {
      size:  16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const heightBuffer = ctx.resources.resolveBuffer(this._inputs.heightBuffer);
    const normalBuffer = ctx.resources.resolveBuffer(normalHandle);

    const shaderModule = ctx.device.createShaderModule({ code: normalGenSrc });
    const bindGroupLayout = ctx.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    this._pipeline = ctx.pipelines.createComputePipeline('terrain.normal_gen', {
      layout: ctx.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      compute: { module: shaderModule, entryPoint: 'main' },
    });

    this._bindGroup = ctx.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this._displaceParamsBuffer } },
        { binding: 1, resource: { buffer: heightBuffer } },
        { binding: 2, resource: { buffer: normalBuffer } },
      ],
    });
  }

  override update(ctx: FrameContext): void {
    if (this._generated) return;

    ctx.device.queue.writeBuffer(this._displaceParamsBuffer, 0, new Float32Array([
      this._inputs.displaceScale, 0, 0, 0,
    ]));
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
