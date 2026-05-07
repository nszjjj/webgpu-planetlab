// src/graph/GraphBuilder.ts
import { RenderGraph }           from '../core/RenderGraph.ts';
import { Scene }                 from '../ecs/Scene.ts';
import { Entity }                from '../ecs/Entity.ts';
import { CameraComponent }       from '../ecs/components/CameraComponent.ts';
import { PlanetComponent }       from '../ecs/components/PlanetComponent.ts';
import { SunComponent }          from '../ecs/components/SunComponent.ts';
import { ComputeNoiseNode }      from './nodes/ComputeNoiseNode.ts';
import { PlanetRenderNode }      from './nodes/PlanetRenderNode.ts';
import { CloudCoverageNode }     from './nodes/CloudCoverageNode.ts';
import { CloudRenderNode }       from './nodes/CloudRenderNode.ts';
import { AtmosphereNode }        from './nodes/AtmosphereNode.ts';
import { DebugWireframeNode }    from './nodes/DebugWireframeNode.ts';
import { OrbitCameraController } from '../controllers/OrbitCameraController.ts';
import type { BuildContext, CloudParams, MaterialParams } from '../core/types.ts';
import { DEFAULT_CLOUD_PARAMS, DEFAULT_MATERIAL_PARAMS }  from '../core/types.ts';
import type { WebGPUEngine }     from '../core/WebGPUEngine.ts';

export class GraphBuilder {
  static build(engine: WebGPUEngine, canvas: HTMLCanvasElement): {
    debugWireframe: DebugWireframeNode;
    cloudParams:    CloudParams;
    materialParams: MaterialParams;
  } {
    const { device, resources, pipelines } = engine;
    const cloudParams:    CloudParams    = { ...DEFAULT_CLOUD_PARAMS };
    const materialParams: MaterialParams = {
      materials:     [...DEFAULT_MATERIAL_PARAMS.materials] as MaterialParams['materials'],
      lightColor:    [...DEFAULT_MATERIAL_PARAMS.lightColor] as [number, number, number],
      lightIntensity: DEFAULT_MATERIAL_PARAMS.lightIntensity,
    };
    const surfaceRes  = engine.getSurfaceResources(0);
    const surfaceDesc = engine.surfaceDescriptor;

    // ── Surface-dependent RTs ──────────────────────────────────────────────
    surfaceRes.registerTexture('scene.color', (w, h) => ({
      size:   [w, h],
      format: surfaceDesc.colorFormat,
      usage:  GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    }));
    surfaceRes.registerTexture('scene.depth', (w, h) => ({
      size:   [w, h],
      format: surfaceDesc.depthFormat,
      usage:  GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    }));

    // ── Scene ──────────────────────────────────────────────────────────────
    const scene = new Scene();

    const planet = new Entity('planet');
    planet.transform.setPosition(0, 0, 0);
    planet.addComponent(new PlanetComponent(1.0, 128, 128));
    scene.addEntity(planet);

    const camera = new Entity('camera');
    camera.addComponent(
      new CameraComponent(Math.PI / 4, canvas.width / canvas.height, 0.1, 100),
    );
    scene.addEntity(camera);
    scene.mainCamera = camera;

    const sun = new Entity('sun');
    sun.addComponent(new SunComponent());
    scene.addEntity(sun);

    new OrbitCameraController(scene, canvas);

    // ── Build context ──────────────────────────────────────────────────────
    const buildCtx: BuildContext = { device, resources, surfaceRes, surfaceDesc, pipelines, scene };

    // ── Nodes ──────────────────────────────────────────────────────────────
    const noiseNode         = new ComputeNoiseNode(resources, pipelines);
    const planetNode        = new PlanetRenderNode(scene, resources, pipelines, materialParams);
    const cloudCoverageNode = new CloudCoverageNode(resources, pipelines, cloudParams);
    const cloudRenderNode   = new CloudRenderNode(scene, resources, pipelines, cloudParams);
    const atmosNode         = new AtmosphereNode(scene, resources, pipelines);
    const debugWireframe    = new DebugWireframeNode(resources, pipelines);

    noiseNode.build(buildCtx);
    planetNode.build(buildCtx);
    cloudCoverageNode.build(buildCtx);
    cloudRenderNode.build(buildCtx);
    atmosNode.build(buildCtx);
    debugWireframe.build(buildCtx);

    const graph = new RenderGraph(scene);
    graph.addNode(noiseNode);
    graph.addNode(planetNode);
    graph.addNode(cloudCoverageNode);
    graph.addNode(cloudRenderNode);
    graph.addNode(atmosNode);
    graph.addNode(debugWireframe);

    engine.setGraph(graph);
    return { debugWireframe, cloudParams, materialParams };
  }
}
