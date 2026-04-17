// src/graph/nodes/PlanetRenderNode.ts
import { BaseNode } from './BaseNode.ts';
import type { BuildContext, FrameContext } from '../../core/types.ts';
import type { Scene } from '../../ecs/Scene.ts';
import type { ResourceManager } from '../../core/ResourceManager.ts';
import type { PipelineManager } from '../../core/PipelineManager.ts';
import { PlanetComponent } from '../../ecs/components/PlanetComponent.ts';
import { CameraComponent } from '../../ecs/components/CameraComponent.ts';
import planetShaderSrc from '../../shaders/planet.wgsl?raw';

export class PlanetRenderNode extends BaseNode {
  readonly name = 'PlanetRender';

  private _scene: Scene;
  private _resources: ResourceManager;
  private _pipelines: PipelineManager;

  private _pipeline!: GPURenderPipeline;
  private _uniformBuffer!: GPUBuffer;
  private _bindGroup!: GPUBindGroup;
  private _indexBuffer!: GPUBuffer;
  private _indexCount = 0;

  constructor(scene: Scene, resources: ResourceManager, pipelines: PipelineManager) {
    super();
    this._scene = scene;
    this._resources = resources;
    this._pipelines = pipelines;
  }

  override build(ctx: BuildContext): void {
    // Use first planet's component for pipeline constants (one pipeline covers all planets of same resolution)
    const planets = this._scene.getEntitiesWith(PlanetComponent);
    const planet = planets[0]!.getComponent(PlanetComponent)!;

    // ── Shader module ──────────────────────────────────────────────────────────
    const shaderModule = ctx.device.createShaderModule({ code: planetShaderSrc });

    // ── Bind group layout: slot 0 = uniform buffer ─────────────────────────────
    const bindGroupLayout = ctx.device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'uniform' },
      }],
    });

    // ── Render pipeline ────────────────────────────────────────────────────────
    this._pipeline = this._pipelines.createRenderPipeline('planet', {
      layout: ctx.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        constants: {
          rings: planet.rings,
          segments: planet.segments,
        },
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    // ── Uniform buffer: viewProj (64) + model (64) = 128 bytes ─────────────────
    this._uniformBuffer = this._resources.createBuffer('planet.uniform', {
      size: 128,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // ── Bind group ─────────────────────────────────────────────────────────────
    this._bindGroup = ctx.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this._uniformBuffer } }],
    });

    // ── Index buffer ───────────────────────────────────────────────────────────
    const indices = buildSphereIndices(planet.rings, planet.segments);
    this._indexCount = indices.length;
    this._indexBuffer = this._resources.createBuffer('planet.index', {
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint32Array(this._indexBuffer.getMappedRange()).set(indices);
    this._indexBuffer.unmap();
  }

  override update(ctx: FrameContext): void {
    const planets = this._scene.getEntitiesWith(PlanetComponent);
    if (planets.length === 0) return;

    const cam = this._scene.mainCamera.getComponent(CameraComponent)!;
    const vp = cam.getVPMatrix(this._scene.mainCamera.transform.position);
    ctx.device.queue.writeBuffer(this._uniformBuffer, 0, vp);

    // Use first planet's model matrix (extend to per-draw in a future task)
    const planet = planets[0]!;
    const planetComp = planet.getComponent(PlanetComponent)!;
    // Scale model matrix by radius; planet transform drives position/rotation
    const model = planet.transform.getWorldMatrix();
    // Apply uniform scale for radius on top of transform
    const scaledModel = new Float32Array(16);
    scaledModel.set(model);
    scaledModel[0] *= planetComp.radius;
    scaledModel[5] *= planetComp.radius;
    scaledModel[10] *= planetComp.radius;
    ctx.device.queue.writeBuffer(this._uniformBuffer, 64, scaledModel);
  }

  override recordPass(encoder: GPUCommandEncoder, ctx: FrameContext): void {
    const planets = this._scene.getEntitiesWith(PlanetComponent);
    if (planets.length === 0) return;

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: ctx.targetView,
        clearValue: { r: 0.02, g: 0.02, b: 0.05, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: ctx.depthView,
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0, this._bindGroup);
    pass.setIndexBuffer(this._indexBuffer, 'uint32');
    pass.drawIndexed(this._indexCount);
    pass.end();
  }
}

/** Generate index buffer for a UV sphere grid (rings × segments quads → 2 triangles each). */
function buildSphereIndices(rings: number, segments: number): Uint32Array {
  const cols = segments + 1;
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
