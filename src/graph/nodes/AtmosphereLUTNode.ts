// src/graph/nodes/AtmosphereLUTNode.ts
import { BaseNode } from './BaseNode.ts';
import type { BuildContext, FrameContext, AtmosphereLUTParams, LUTPreset } from '../../core/types.ts';
import { LUT_PRESETS, DEFAULT_ATMOSPHERE_LUT_PARAMS } from '../../core/types.ts';
import type { ResourceManager } from '../../core/ResourceManager.ts';
import type { PipelineManager } from '../../core/PipelineManager.ts';
import lutGenSrc from '../../shaders/lut_gen.wgsl?raw';

// Uniform buffer layout (offsets in bytes, std140-aligned):
// planetRadius     : f32 @  0
// atmosphereRadius : f32 @  4
// H_R              : f32 @  8
// H_M              : f32 @ 12
// betaR            : vec3 @ 16  (align 16 — H_R/H_M placed before it to fill gap)
// betaM            : f32 @ 28  (fills the 4-byte padding after vec3)
// mieG             : f32 @ 32
// numSamples       : u32 @ 36
// numLightSamples  : u32 @ 40
// lutResR          : u32 @ 44
// lutResMuS        : u32 @ 48
// lutResMuV        : u32 @ 52
// _pad             : 8 bytes @ 56 (pad to 64)
// total: 64 bytes
const UNIFORM_SIZE = 64;

export class AtmosphereLUTNode extends BaseNode {
  readonly name = 'AtmosphereLUT';

  private _resources: ResourceManager;
  private _pipelines: PipelineManager;
  private _preset: LUTPreset;
  private _params: AtmosphereLUTParams;

  private _pipeline!: GPUComputePipeline;
  private _bindGroup!: GPUBindGroup;
  private _texture!: GPUTexture;
  private _sampler!: GPUSampler;

  private _generated = false;

  constructor(
    resources: ResourceManager,
    pipelines: PipelineManager,
    preset: LUTPreset = 'high',
    params?: Partial<AtmosphereLUTParams>,
  ) {
    super();
    this._resources = resources;
    this._pipelines = pipelines;
    this._preset = preset;
    this._params = { ...DEFAULT_ATMOSPHERE_LUT_PARAMS, ...params };
  }

  /** Expose LUT texture for AtmosphereNode bind group */
  get lutTexture(): GPUTexture {
    return this._texture;
  }

  /** Expose LUT sampler */
  get lutSampler(): GPUSampler {
    return this._sampler;
  }

  override build(ctx: BuildContext): void {
    const { device } = ctx;
    const res = LUT_PRESETS[this._preset];

    this._texture = this._resources.createTexture(`atmosphere.lut.${this._preset}`, {
      size: [res.muV, res.muS, res.r],
      format: 'rgba16float',
      dimension: '3d',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });

    this._sampler = device.createSampler({
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
      minFilter: 'linear',
      magFilter: 'linear',
    });

    const uniformBuffer = this._resources.createBuffer('atmosphere.lut.params', {
      size: UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const data = new Float32Array(UNIFORM_SIZE / 4);
    const p = this._params;
    data[0]  = p.planetRadius;
    data[1]  = p.atmosphereRadius;
    data[2]  = p.H_R;
    data[3]  = p.H_M;
    data[4]  = p.betaR[0];
    data[5]  = p.betaR[1];
    data[6]  = p.betaR[2];
    data[7]  = p.betaM;
    data[8]  = p.mieG;
    const dv = new DataView(data.buffer);
    dv.setUint32(36, p.numSamples, true);
    dv.setUint32(40, p.numLightSamples, true);
    dv.setUint32(44, res.r, true);
    dv.setUint32(48, res.muS, true);
    dv.setUint32(52, res.muV, true);

    ctx.device.queue.writeBuffer(uniformBuffer, 0, data);

    const shaderModule = device.createShaderModule({ code: lutGenSrc });

    const bgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '3d' } },
      ],
    });

    this._pipeline = this._pipelines.createComputePipeline('atmosphere.lut_gen', {
      layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
      compute: { module: shaderModule, entryPoint: 'main' },
    });

    this._bindGroup = device.createBindGroup({
      layout: bgl,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: this._texture.createView() },
      ],
    });
  }

  override recordPass(encoder: GPUCommandEncoder, _ctx: FrameContext): void {
    if (this._generated) return;

    const res = LUT_PRESETS[this._preset];
    const pass = encoder.beginComputePass();
    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0, this._bindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(res.muV / 8),
      Math.ceil(res.muS / 8),
      Math.ceil(res.r / 8),
    );
    pass.end();

    this._generated = true;
  }
}
