// src/graph/nodes/PlanetRenderNode.ts
import { BaseNode } from './BaseNode.ts';
import type { BuildContext, FrameContext, MaterialParams } from '../../core/types.ts';
import { DEFAULT_MATERIAL_PARAMS } from '../../core/types.ts';
import type { Scene } from '../../ecs/Scene.ts';
import type { ResourceManager } from '../../core/ResourceManager.ts';
import type { PipelineManager } from '../../core/PipelineManager.ts';
import { PlanetComponent } from '../../ecs/components/PlanetComponent.ts';
import { CameraComponent } from '../../ecs/components/CameraComponent.ts';
import { SunComponent } from '../../ecs/components/SunComponent.ts';
import planetShaderSrc from '../../shaders/planet.wgsl?raw';

const PERFRAME_SIZE = 208;

export class PlanetRenderNode extends BaseNode {
  readonly name = 'PlanetRender';

  private _scene: Scene;
  private _resources: ResourceManager;
  private _pipelines: PipelineManager;

  private _pipeline!:       GPURenderPipeline;
  private _perFrameBuffer!: GPUBuffer;
  private _materialBuffer!: GPUBuffer;
  private _bindGroup!:      GPUBindGroup;
  private _indexBuffer!:    GPUBuffer;
  private _indexCount = 0;

  private _materialParams: MaterialParams;

  constructor(
    scene:     Scene,
    resources: ResourceManager,
    pipelines: PipelineManager,
    materialParams: MaterialParams = DEFAULT_MATERIAL_PARAMS,
  ) {
    super();
    this._scene          = scene;
    this._resources      = resources;
    this._pipelines      = pipelines;
    this._materialParams = materialParams;
  }

  get materialParams(): MaterialParams { return this._materialParams; }

  override build(ctx: BuildContext): void {
    const planets = this._scene.getEntitiesWith(PlanetComponent);
    const planet  = planets[0]!.getComponent(PlanetComponent)!;

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
      ],
    });

    this._pipeline = this._pipelines.createRenderPipeline('planet', {
      layout: ctx.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: {
        module:     shaderModule,
        entryPoint: 'vs_main',
        constants: {
          rings:    planet.rings,
          segments: planet.segments,
        },
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

    this._perFrameBuffer = this._resources.createBuffer('planet.perFrame', {
      size:  PERFRAME_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this._materialBuffer = this._resources.createBuffer('planet.material', {
      size:  160,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const heightBuffer = this._resources.getBuffer('terrain.height');
    const splatBuffer  = this._resources.getBuffer('terrain.splat');
    if (!heightBuffer || !splatBuffer) {
      throw new Error('PlanetRenderNode.build(): terrain buffers not found');
    }

    this._bindGroup = ctx.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this._perFrameBuffer } },
        { binding: 1, resource: { buffer: heightBuffer } },
        { binding: 2, resource: { buffer: splatBuffer } },
        { binding: 3, resource: { buffer: this._materialBuffer } },
      ],
    });

    const indices = buildSphereIndices(planet.rings, planet.segments);
    this._indexCount = indices.length;
    this._indexBuffer = this._resources.createBuffer('planet.index', {
      size:             indices.byteLength,
      usage:            GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint32Array(this._indexBuffer.getMappedRange()).set(indices);
    this._indexBuffer.unmap();
  }

  private _writeMaterialBuffer(device: GPUDevice): void {
    const m    = this._materialParams.materials;
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
    const planets = this._scene.getEntitiesWith(PlanetComponent);
    if (planets.length === 0) return;

    const cam = this._scene.mainCamera.getComponent(CameraComponent)!;
    const vp  = cam.getVPMatrix(this._scene.mainCamera.transform.position);

    const pf = new Float32Array(52);
    pf.set(vp, 0);

    const planet     = planets[0]!;
    const planetComp = planet.getComponent(PlanetComponent)!;
    const model      = planet.transform.getWorldMatrix();

    const scaledModel = new Float32Array(16);
    scaledModel.set(model);
    scaledModel[0]  *= planetComp.radius;
    scaledModel[5]  *= planetComp.radius;
    scaledModel[10] *= planetComp.radius;
    pf.set(scaledModel, 16);

    pf[32] = planetComp.displaceScale;

    const sunEntities = this._scene.getEntitiesWith(SunComponent);
    const sunPos = sunEntities[0]?.getComponent(SunComponent)?.worldPosition ?? [100, 50, 0];
    const dx = sunPos[0], dy = sunPos[1], dz = sunPos[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    pf[36] = dx / len;
    pf[37] = dy / len;
    pf[38] = dz / len;

    const cp = this._scene.mainCamera.transform.position;
    pf[40] = cp[0];
    pf[41] = cp[1];
    pf[42] = cp[2];

    pf[44] = this._materialParams.lightColor[0];
    pf[45] = this._materialParams.lightColor[1];
    pf[46] = this._materialParams.lightColor[2];
    pf[47] = this._materialParams.lightIntensity;

    ctx.device.queue.writeBuffer(this._perFrameBuffer, 0, pf);

    // Material buffer written every frame (160 bytes, negligible overhead)
    this._writeMaterialBuffer(ctx.device);
  }

  override recordPass(encoder: GPUCommandEncoder, ctx: FrameContext): void {
    const planets = this._scene.getEntitiesWith(PlanetComponent);
    if (planets.length === 0) return;

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view:       ctx.sceneColorView,
        clearValue: { r: 0.02, g: 0.02, b: 0.05, a: 1 },
        loadOp:     'clear',
        storeOp:    'store',
      }],
      depthStencilAttachment: {
        view:            ctx.depthView,
        depthClearValue: 1.0,
        depthLoadOp:     'clear',
        depthStoreOp:    'store',
      },
    });

    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0, this._bindGroup);
    pass.setIndexBuffer(this._indexBuffer, 'uint32');
    pass.drawIndexed(this._indexCount);
    pass.end();
  }
}

function buildSphereIndices(rings: number, segments: number): Uint32Array {
  const cols    = segments + 1;
  const indices = new Uint32Array(rings * segments * 6);
  let idx = 0;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * cols + j;
      const b = (i + 1) * cols + j;
      const c = i * cols + j + 1;
      const d = (i + 1) * cols + j + 1;
      indices[idx++] = a; indices[idx++] = b; indices[idx++] = c;
      indices[idx++] = b; indices[idx++] = d; indices[idx++] = c;
    }
  }
  return indices;
}
