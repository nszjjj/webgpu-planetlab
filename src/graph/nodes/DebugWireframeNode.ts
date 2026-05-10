// src/graph/nodes/DebugWireframeNode.ts
import { BaseNode } from './BaseNode.ts';
import type { BuildContext, FrameContext } from '../../core/types.ts';
import type { ResourceManager } from '../../core/ResourceManager.ts';
import type { PipelineManager } from '../../core/PipelineManager.ts';
import { generateIcosphere } from '../../utils/icosphere.ts';
import wireframeSrc from '../../shaders/wireframe.wgsl?raw';

const WIRE_SUBDIV = 5;  // must match GraphBuilder planet subdivisions

export class DebugWireframeNode extends BaseNode {
  readonly name = 'DebugWireframe';

  enabled = false;

  private _pipeline!:    GPURenderPipeline;
  private _bindGroup!:   GPUBindGroup;
  private _vertexBuffer!: GPUBuffer;
  private _edgeBuffer!:  GPUBuffer;
  private _edgeCount = 0;
  private _depthFormat!: GPUTextureFormat;
  private _colorFormat!: GPUTextureFormat;

  private _resources: ResourceManager;
  private _pipelines: PipelineManager;

  constructor(resources: ResourceManager, pipelines: PipelineManager) {
    super();
    this._resources = resources;
    this._pipelines = pipelines;
  }

  override build(ctx: BuildContext): void {
    this._colorFormat = ctx.surfaceDesc.targetFormat;
    this._depthFormat = ctx.surfaceDesc.depthFormat;

    // Reuse or create icosphere vertex buffer (PlanetRenderNode creates it first)
    let vbuf = this._resources.getBuffer('planet.vertices');
    if (!vbuf) {
      const mesh = generateIcosphere(WIRE_SUBDIV);
      vbuf = this._resources.createBuffer('planet.vertices', {
        size:             mesh.vertices.byteLength,
        usage:            GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
      });
      new Float32Array(vbuf.getMappedRange()).set(mesh.vertices);
      vbuf.unmap();
    }
    this._vertexBuffer = vbuf;

    // Edge index buffer from icosphere triangle list (deduplicated edges)
    const mesh = generateIcosphere(WIRE_SUBDIV);
    const edgeSet = new Set<number>();  // packed min*65536+max
    const pairs: number[] = [];
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const a = mesh.indices[i], b = mesh.indices[i + 1], c = mesh.indices[i + 2];
      emitEdge(a, b, edgeSet, pairs);
      emitEdge(b, c, edgeSet, pairs);
      emitEdge(c, a, edgeSet, pairs);
    }
    this._edgeCount = pairs.length;
    this._edgeBuffer = this._resources.createBuffer('debug.wireframe.edges', {
      size:             pairs.length * 4,
      usage:            GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint32Array(this._edgeBuffer.getMappedRange()).set(pairs);
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
        buffers: [{
          arrayStride: 12,
          stepMode:    'vertex',
          attributes: [{
            shaderLocation: 0,
            offset:         0,
            format:         'float32x3',
          }],
        }],
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
      },
    });
    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0, this._bindGroup);
    pass.setVertexBuffer(0, this._vertexBuffer);
    pass.setIndexBuffer(this._edgeBuffer, 'uint32');
    pass.drawIndexed(this._edgeCount);
    pass.end();
  }
}

function emitEdge(a: number, b: number, set: Set<number>, out: number[]): void {
  const min = a < b ? a : b;
  const max = a > b ? a : b;
  const key = min * 65536 + max;
  if (set.has(key)) return;
  set.add(key);
  out.push(a, b);
}
