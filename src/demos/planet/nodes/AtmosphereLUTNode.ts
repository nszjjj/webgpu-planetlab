// src/graph/nodes/AtmosphereLUTNode.ts
import { BaseNode } from '../../../framework/graph/BaseNode.ts';
import type { BuildContext, FrameContext } from '../../../framework/graph/types.ts';
import type { TextureHandle } from '../../../framework/graph/handles.ts';
import type { AtmosphereLUTParams, LUTPreset } from '../params.ts';
import { LUT_PRESETS } from '../params.ts';
import lutGenSrc from '../shaders/lut_gen.wgsl?raw';

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

export class AtmosphereLUTNode extends BaseNode<
  { params: AtmosphereLUTParams; preset: LUTPreset },
  { lut: TextureHandle<string> }
> {
  readonly name = 'AtmosphereLUT';

  private _pipeline!:      GPUComputePipeline;
  private _bindGroup!:     GPUBindGroup;
  private _texture!:       GPUTexture;
  private _sampler!:       GPUSampler;
  private _uniformBuffer!: GPUBuffer;

  // The LUT is static — generate once on the first frame, then skip.
  private _generated = false;

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
    const preset = this._inputs.preset;
    const res = LUT_PRESETS[preset];

    const lutHandle = ctx.resources.createTextureHandle(`atmosphere.lut.${preset}`, {
      size: [res.muV, res.muS, res.r],
      format: 'rgba16float',
      dimension: '3d',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });
    this._outputs = { lut: lutHandle };
    this._texture = ctx.resources.resolveTexture(lutHandle);

    this._sampler = device.createSampler({
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
      minFilter: 'linear',
      magFilter: 'linear',
    });

    this._uniformBuffer = ctx.resources.createBuffer('atmosphere.lut.params', {
      size: UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const shaderModule = device.createShaderModule({ code: lutGenSrc });

    const bgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '3d' } },
      ],
    });

    this._pipeline = ctx.pipelines.createComputePipeline('atmosphere.lut_gen', {
      layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
      compute: { module: shaderModule, entryPoint: 'main' },
    });

    this._bindGroup = device.createBindGroup({
      layout: bgl,
      entries: [
        { binding: 0, resource: { buffer: this._uniformBuffer } },
        { binding: 1, resource: this._texture.createView() },
      ],
    });
  }

  override update(ctx: FrameContext): void {
    if (this._generated) return;

    const p = this._inputs.params;
    const res = LUT_PRESETS[this._inputs.preset];

    const data = new Float32Array(UNIFORM_SIZE / 4);
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

    ctx.device.queue.writeBuffer(this._uniformBuffer, 0, data);
  }

  override recordPass(encoder: GPUCommandEncoder, _ctx: FrameContext): void {
    if (this._generated) return;

    const res = LUT_PRESETS[this._inputs.preset];

    const pass = encoder.beginComputePass();
    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0, this._bindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(res.muV / 8),
      Math.ceil(res.muS / 8),
      res.r,
    );
    pass.end();

    this._generated = true;
  }
}
