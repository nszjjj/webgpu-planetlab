// src/graph/nodes/PlanetRenderNode.ts
import { BaseNode } from '../../../framework/graph/BaseNode.ts';
import type { BuildContext, FrameContext } from '../../../framework/graph/types.ts';
import type { BufferHandle, TextureHandle } from '../../../framework/graph/handles.ts';
import type { SurfaceResources } from '../../../framework/core/SurfaceResources.ts';
import type { MaterialParam } from '../params.ts';
import { generateIcosphere } from '../utils/icosphere.ts';
import planetShaderSrc from '../shaders/planet.wgsl?raw';

const PERFRAME_SIZE = 208;

type PlanetInputs = {
  heightBuffer:  BufferHandle<'terrain.height'>;
  splatBuffer:   BufferHandle<'terrain.splat'>;
  normalBuffer:  BufferHandle<'terrain.normal'>;
  colorTarget:   TextureHandle<'scene.color'>;
  depthTarget:   TextureHandle<'scene.depth'>;

  vpMatrix:      Float32Array;
  modelMatrix:   Float32Array;
  cameraPos:     [number, number, number];
  sunDir:        [number, number, number];
  displaceScale: number;

  lightColor:     [number, number, number];
  lightIntensity: number;
  materials:      readonly MaterialParam[];

  subdivisions: number;
};

export class PlanetRenderNode extends BaseNode<PlanetInputs, {}> {
  readonly name = 'PlanetRender';

  private _pipeline!:       GPURenderPipeline;
  private _perFrameBuffer!: GPUBuffer;
  private _materialBuffer!: GPUBuffer;
  private _bindGroup!:      GPUBindGroup;
  private _vertexBuffer!:   GPUBuffer;
  private _indexBuffer!:    GPUBuffer;
  private _indexCount = 0;
  private _surfaceRes!:     SurfaceResources;

  override build(ctx: BuildContext): void {
    this._surfaceRes = ctx.surfaceRes;
    this._outputs = {};

    const shaderModule = ctx.device.createShaderModule({ code: planetShaderSrc });

    const bindGroupLayout = ctx.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        {
          binding: 4,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' },
        },
      ],
    });

    this._pipeline = ctx.pipelines.createRenderPipeline('planet', {
      layout: ctx.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: {
        module:     shaderModule,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 12,  // 3 × f32
          stepMode:    'vertex',
          attributes: [{
            shaderLocation: 0,
            offset:         0,
            format:         'float32x3',
          }],
        }],
      },
      fragment: {
        module:     shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: ctx.surfaceDesc.colorFormat }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: {
        format:            ctx.surfaceDesc.depthFormat,
        depthWriteEnabled: true,
        depthCompare:      'less',
      },
    });

    // planet.perFrame / planet.vertices / planet.index keys are preserved —
    // DebugWireframeNode still looks them up by string.
    this._perFrameBuffer = ctx.resources.createBuffer('planet.perFrame', {
      size:  PERFRAME_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this._materialBuffer = ctx.resources.createBuffer('planet.material', {
      size:  160,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const heightBuffer = ctx.resources.resolveBuffer(this._inputs.heightBuffer);
    const splatBuffer  = ctx.resources.resolveBuffer(this._inputs.splatBuffer);
    const normalBuffer = ctx.resources.resolveBuffer(this._inputs.normalBuffer);

    this._bindGroup = ctx.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this._perFrameBuffer } },
        { binding: 1, resource: { buffer: heightBuffer } },
        { binding: 2, resource: { buffer: splatBuffer } },
        { binding: 3, resource: { buffer: this._materialBuffer } },
        { binding: 4, resource: { buffer: normalBuffer } },
      ],
    });

    // ── Icosphere mesh ──────────────────────────────────────────────────────
    const mesh = generateIcosphere(this._inputs.subdivisions);

    this._vertexBuffer = ctx.resources.createBuffer('planet.vertices', {
      size:             mesh.vertices.byteLength,
      usage:            GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this._vertexBuffer.getMappedRange()).set(mesh.vertices);
    this._vertexBuffer.unmap();

    this._indexCount = mesh.indices.length;
    this._indexBuffer = ctx.resources.createBuffer('planet.index', {
      size:             mesh.indices.byteLength,
      usage:            GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint32Array(this._indexBuffer.getMappedRange()).set(mesh.indices);
    this._indexBuffer.unmap();
  }

  private _writeMaterialBuffer(device: GPUDevice): void {
    const m    = this._inputs.materials;
    const data = new Float32Array(40); // 10 slots × 4 floats
    for (let i = 0; i < m.length && i < 10; i++) {
      const off = i * 4;
      data[off]     = m[i].roughness;
      data[off + 1] = m[i].metallic;
      data[off + 2] = 0;
      data[off + 3] = 0;
    }
    device.queue.writeBuffer(this._materialBuffer, 0, data);
  }

  override update(ctx: FrameContext): void {
    const pf = new Float32Array(52);
    pf.set(this._inputs.vpMatrix, 0);
    pf.set(this._inputs.modelMatrix, 16);

    pf[32] = this._inputs.displaceScale;

    pf[36] = this._inputs.sunDir[0];
    pf[37] = this._inputs.sunDir[1];
    pf[38] = this._inputs.sunDir[2];

    pf[40] = this._inputs.cameraPos[0];
    pf[41] = this._inputs.cameraPos[1];
    pf[42] = this._inputs.cameraPos[2];

    pf[44] = this._inputs.lightColor[0];
    pf[45] = this._inputs.lightColor[1];
    pf[46] = this._inputs.lightColor[2];
    pf[47] = this._inputs.lightIntensity;

    ctx.device.queue.writeBuffer(this._perFrameBuffer, 0, pf);

    // Material buffer written every frame (160 bytes, negligible overhead)
    this._writeMaterialBuffer(ctx.device);
  }

  override recordPass(encoder: GPUCommandEncoder, _ctx: FrameContext): void {
    const colorView = this._surfaceRes.getView(this._inputs.colorTarget.key);
    const depthView = this._surfaceRes.getView(this._inputs.depthTarget.key);

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view:       colorView,
        clearValue: { r: 0.02, g: 0.02, b: 0.05, a: 1 },
        loadOp:     'clear',
        storeOp:    'store',
      }],
      depthStencilAttachment: {
        view:            depthView,
        depthClearValue: 1.0,
        depthLoadOp:     'clear',
        depthStoreOp:    'store',
      },
    });

    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0, this._bindGroup);
    pass.setVertexBuffer(0, this._vertexBuffer);
    pass.setIndexBuffer(this._indexBuffer, 'uint32');
    pass.drawIndexed(this._indexCount);
    pass.end();
  }
}
