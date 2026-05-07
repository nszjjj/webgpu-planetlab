// src/graph/nodes/DebugWireframeNode.ts
import { BaseNode } from './BaseNode.ts';
import type { BuildContext, FrameContext } from '../../core/types.ts';
import type { ResourceManager } from '../../core/ResourceManager.ts';
import type { PipelineManager } from '../../core/PipelineManager.ts';
import wireframeSrc from '../../shaders/wireframe.wgsl?raw';

export class DebugWireframeNode extends BaseNode {
  readonly name = 'DebugWireframe';

  enabled = false;

  private _pipeline!: GPURenderPipeline;
  private _bindGroup!: GPUBindGroup;
  private _edgeBuffer!: GPUBuffer;
  private _edgeCount = 0;
  private _depthFormat!: GPUTextureFormat;
  private _colorFormat!: GPUTextureFormat;

  constructor(private _resources: ResourceManager, private _pipelines: PipelineManager) {
    super();
  }

  override build(ctx: BuildContext): void {
    this._colorFormat = ctx.surfaceDesc.targetFormat;
    this._depthFormat = ctx.surfaceDesc.depthFormat;

    const edges = buildWireframeEdges(128, 128);
    this._edgeCount = edges.length;
    this._edgeBuffer = this._resources.createBuffer('debug.wireframe.edges', {
      size: edges.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint32Array(this._edgeBuffer.getMappedRange()).set(edges);
    this._edgeBuffer.unmap();

    const bindGroupLayout = ctx.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });

    const shaderModule = ctx.device.createShaderModule({ code: wireframeSrc });

    this._pipeline = this._pipelines.createRenderPipeline('debug.wireframe', {
      layout: ctx.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        constants: { rings: 128, segments: 128 },
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: this._colorFormat }],
      },
      primitive: { topology: 'line-list', cullMode: 'none' },
      depthStencil: {
        format: this._depthFormat,
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
      },
    });

    const uniformBuffer = this._resources.getBuffer('planet.perFrame')!;
    const heightBuffer  = this._resources.getBuffer('terrain.height')!;

    this._bindGroup = ctx.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: heightBuffer } },
      ],
    });
  }

  override update(_ctx: FrameContext): void {}

  override recordPass(encoder: GPUCommandEncoder, ctx: FrameContext): void {
    if (!this.enabled) return;

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: ctx.targetView,
        loadOp: 'load',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: ctx.depthView,
        depthLoadOp: 'load',
        depthStoreOp: 'store',
        depthWriteEnabled: false,
      },
    });
    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0, this._bindGroup);
    pass.setIndexBuffer(this._edgeBuffer, 'uint32');
    pass.drawIndexed(this._edgeCount);
    pass.end();
  }
}

function buildWireframeEdges(rings: number, segments: number): Uint32Array {
  const cols = segments + 1;
  const pairs: number[] = [];
  for (let i = 0; i <= rings; i++)
    for (let j = 0; j < segments; j++)
      pairs.push(i * cols + j, i * cols + j + 1);
  for (let i = 0; i < rings; i++)
    for (let j = 0; j <= segments; j++)
      pairs.push(i * cols + j, (i + 1) * cols + j);
  return new Uint32Array(pairs);
}
