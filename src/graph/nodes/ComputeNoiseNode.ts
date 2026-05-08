// src/graph/nodes/ComputeNoiseNode.ts
import { BaseNode } from './BaseNode.ts';
import type { BuildContext, FrameContext, NoiseParams, ClassifyParams } from '../../core/types.ts';
import { DEFAULT_NOISE_PARAMS, DEFAULT_CLASSIFY_PARAMS } from '../../core/types.ts';
import type { ResourceManager } from '../../core/ResourceManager.ts';
import type { PipelineManager } from '../../core/PipelineManager.ts';
import { OCTA_RESOLUTION } from '../../utils/octahedral.ts';
import noiseGenSrc from '../../shaders/noise_gen.wgsl?raw';
import classifySrc from '../../shaders/terrain_classify.wgsl?raw';

export class ComputeNoiseNode extends BaseNode {
  readonly name = 'ComputeNoise';

  private _resources: ResourceManager;
  private _pipelines: PipelineManager;
  private _noiseParams: NoiseParams;
  private _classifyParams: ClassifyParams;

  private _noiseGenPipeline!: GPUComputePipeline;
  private _classifyPipeline!: GPUComputePipeline;
  private _noiseBindGroup!: GPUBindGroup;
  private _classifyBindGroup!: GPUBindGroup;

  // Terrain is static — generate once on the first frame, then skip.
  private _generated = false;

  constructor(
    resources: ResourceManager,
    pipelines: PipelineManager,
    noiseParams: NoiseParams = DEFAULT_NOISE_PARAMS,
    classifyParams: ClassifyParams = DEFAULT_CLASSIFY_PARAMS,
  ) {
    super();
    this._resources = resources;
    this._pipelines = pipelines;
    this._noiseParams = noiseParams;
    this._classifyParams = classifyParams;
  }

  override build(ctx: BuildContext): void {
    const BUFFER_SIZE = OCTA_RESOLUTION * OCTA_RESOLUTION * 4; // f32 or u32 = 4 bytes each

    // ── Shared terrain buffers (consumed by PlanetRenderNode) ──────────────────
    const heightBuffer = this._resources.createBuffer('terrain.height', {
      size: BUFFER_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const splatBuffer = this._resources.createBuffer('terrain.splat', {
      size: BUFFER_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    // ── NoiseParams uniform: 4 × f32 = 16 bytes ───────────────────────────────
    const noiseParamsBuffer = this._resources.createBuffer('noise.params', {
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    ctx.device.queue.writeBuffer(noiseParamsBuffer, 0, new Float32Array([
      this._noiseParams.continent_freq,
      this._noiseParams.continent_persistence,
      this._noiseParams.mountain_freq,
      this._noiseParams.detail_freq,
    ]));

    // ── ClassifyParams uniform: 7 × f32 + 1 pad = 32 bytes ────────────────────
    const classifyParamsBuffer = this._resources.createBuffer('noise.classify_params', {
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    ctx.device.queue.writeBuffer(classifyParamsBuffer, 0, new Float32Array([
      this._classifyParams.water_max,
      this._classifyParams.sand_max,
      this._classifyParams.grass_max,
      this._classifyParams.rock_max,
      this._classifyParams.ore_iron_threshold,
      this._classifyParams.ore_rare_threshold,
      this._classifyParams.ore_noise_freq,
      0, // _pad0
    ]));

    // ── Pass A: noise_gen pipeline ─────────────────────────────────────────────
    const noiseGenModule = ctx.device.createShaderModule({ code: noiseGenSrc });
    const noiseGenBGL = ctx.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    this._noiseGenPipeline = this._pipelines.createComputePipeline('terrain.noise_gen', {
      layout: ctx.device.createPipelineLayout({ bindGroupLayouts: [noiseGenBGL] }),
      compute: { module: noiseGenModule, entryPoint: 'main' },
    });
    this._noiseBindGroup = ctx.device.createBindGroup({
      layout: noiseGenBGL,
      entries: [
        { binding: 0, resource: { buffer: noiseParamsBuffer } },
        { binding: 1, resource: { buffer: heightBuffer } },
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
    this._classifyPipeline = this._pipelines.createComputePipeline('terrain.classify', {
      layout: ctx.device.createPipelineLayout({ bindGroupLayouts: [classifyBGL] }),
      compute: { module: classifyModule, entryPoint: 'main' },
    });
    this._classifyBindGroup = ctx.device.createBindGroup({
      layout: classifyBGL,
      entries: [
        { binding: 0, resource: { buffer: classifyParamsBuffer } },
        { binding: 1, resource: { buffer: heightBuffer } },
        { binding: 2, resource: { buffer: splatBuffer } },
      ],
    });
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
