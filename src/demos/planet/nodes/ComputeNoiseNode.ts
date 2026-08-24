// src/graph/nodes/ComputeNoiseNode.ts
import { BaseNode } from '../../../framework/graph/BaseNode.ts';
import type { BuildContext, FrameContext } from '../../../framework/graph/types.ts';
import type { BufferHandle } from '../../../framework/graph/handles.ts';
import type { NoiseParams, ClassifyParams } from '../params.ts';
import { OCTA_RESOLUTION } from '../utils/octahedral.ts';
import noiseGenSrc from '../shaders/noise_gen.wgsl?raw';
import classifySrc from '../shaders/terrain_classify.wgsl?raw';

export class ComputeNoiseNode extends BaseNode<
  { noiseParams: NoiseParams; classifyParams: ClassifyParams },
  { heightBuffer: BufferHandle<'terrain.height'>; splatBuffer: BufferHandle<'terrain.splat'> }
> {
  readonly name = 'ComputeNoise';

  private _noiseGenPipeline!:     GPUComputePipeline;
  private _classifyPipeline!:     GPUComputePipeline;
  private _noiseBindGroup!:       GPUBindGroup;
  private _classifyBindGroup!:    GPUBindGroup;
  private _noiseParamsBuffer!:    GPUBuffer;
  private _classifyParamsBuffer!: GPUBuffer;

  // Terrain is static — generate once on the first frame, then skip.
  private _generated = false;

  override build(ctx: BuildContext): void {
    const BUFFER_SIZE = OCTA_RESOLUTION * OCTA_RESOLUTION * 4; // f32 or u32 = 4 bytes each

    // ── Shared terrain buffers (consumed by PlanetRenderNode) ──────────────────
    const heightBuffer = ctx.resources.createBufferHandle('terrain.height', {
      size: BUFFER_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const splatBuffer = ctx.resources.createBufferHandle('terrain.splat', {
      size: BUFFER_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    this._outputs = { heightBuffer, splatBuffer };

    const heightGPUBuffer = ctx.resources.resolveBuffer(heightBuffer);
    const splatGPUBuffer  = ctx.resources.resolveBuffer(splatBuffer);

    // ── NoiseParams uniform: 4 × f32 = 16 bytes ───────────────────────────────
    this._noiseParamsBuffer = ctx.resources.createBuffer('noise.params', {
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // ── ClassifyParams uniform: 7 × f32 + 1 pad = 32 bytes ────────────────────
    this._classifyParamsBuffer = ctx.resources.createBuffer('noise.classify_params', {
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // ── Pass A: noise_gen pipeline ─────────────────────────────────────────────
    const noiseGenModule = ctx.device.createShaderModule({ code: noiseGenSrc });
    const noiseGenBGL = ctx.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    this._noiseGenPipeline = ctx.pipelines.createComputePipeline('terrain.noise_gen', {
      layout: ctx.device.createPipelineLayout({ bindGroupLayouts: [noiseGenBGL] }),
      compute: { module: noiseGenModule, entryPoint: 'main' },
    });
    this._noiseBindGroup = ctx.device.createBindGroup({
      layout: noiseGenBGL,
      entries: [
        { binding: 0, resource: { buffer: this._noiseParamsBuffer } },
        { binding: 1, resource: { buffer: heightGPUBuffer } },
      ],
    });

    // ── Pass B: terrain_classify pipeline ─────────────────────────────────────
    const classifyModule = ctx.device.createShaderModule({ code: classifySrc });
    const classifyBGL = ctx.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    this._classifyPipeline = ctx.pipelines.createComputePipeline('terrain.classify', {
      layout: ctx.device.createPipelineLayout({ bindGroupLayouts: [classifyBGL] }),
      compute: { module: classifyModule, entryPoint: 'main' },
    });
    this._classifyBindGroup = ctx.device.createBindGroup({
      layout: classifyBGL,
      entries: [
        { binding: 0, resource: { buffer: this._classifyParamsBuffer } },
        { binding: 1, resource: { buffer: heightGPUBuffer } },
        { binding: 2, resource: { buffer: splatGPUBuffer } },
      ],
    });
  }

  override update(ctx: FrameContext): void {
    if (this._generated) return;

    const { noiseParams, classifyParams } = this._inputs;

    ctx.device.queue.writeBuffer(this._noiseParamsBuffer, 0, new Float32Array([
      noiseParams.continent_freq,
      noiseParams.continent_persistence,
      noiseParams.mountain_freq,
      noiseParams.detail_freq,
    ]));

    ctx.device.queue.writeBuffer(this._classifyParamsBuffer, 0, new Float32Array([
      classifyParams.water_max,
      classifyParams.sand_max,
      classifyParams.grass_max,
      classifyParams.rock_max,
      classifyParams.ore_iron_threshold,
      classifyParams.ore_rare_threshold,
      classifyParams.ore_noise_freq,
      0, // _pad0
    ]));
  }

  override recordPass(encoder: GPUCommandEncoder, _ctx: FrameContext): void {
    if (this._generated) return;

    const WG = Math.ceil(OCTA_RESOLUTION / 8); // 64 workgroups per axis

    // Pass A: generate height
    const passA = encoder.beginComputePass();
    passA.setPipeline(this._noiseGenPipeline);
    passA.setBindGroup(0, this._noiseBindGroup);
    passA.dispatchWorkgroups(WG, WG);
    passA.end();

    // Pass B: classify terrain.
    // Per WebGPU spec §10.3, ending one compute pass and beginning another on the
    // same encoder creates a pipeline barrier for storage buffer accesses.
    const passB = encoder.beginComputePass();
    passB.setPipeline(this._classifyPipeline);
    passB.setBindGroup(0, this._classifyBindGroup);
    passB.dispatchWorkgroups(WG, WG);
    passB.end();

    this._generated = true;
  }
}
