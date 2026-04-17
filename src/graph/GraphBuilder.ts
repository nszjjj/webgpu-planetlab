// src/graph/GraphBuilder.ts
import { RenderGraph } from '../core/RenderGraph.ts';
import { ResourceManager } from '../core/ResourceManager.ts';
import { PipelineManager } from '../core/PipelineManager.ts';
import { Scene } from '../ecs/Scene.ts';
import { Entity } from '../ecs/Entity.ts';
import { CameraComponent } from '../ecs/components/CameraComponent.ts';
import { PlanetComponent } from '../ecs/components/PlanetComponent.ts';
import { PlanetRenderNode } from './nodes/PlanetRenderNode.ts';
import { OrbitCameraController } from '../controllers/OrbitCameraController.ts';
import type { BuildContext } from '../core/types.ts';

export interface BuiltGraph {
  graph: RenderGraph;
  orbitController: OrbitCameraController;
}

export class GraphBuilder {
  static build(device: GPUDevice, canvas: HTMLCanvasElement): BuiltGraph {
    const resources = new ResourceManager(device);
    const pipelines = new PipelineManager(device);
    const scene = new Scene();

    // ── Planet entity ──────────────────────────────────────────────────────────
    const planet = new Entity('planet');
    planet.transform.setPosition(0, 0, 0);
    planet.addComponent(new PlanetComponent(1.0, 64, 64));
    scene.addEntity(planet);

    // ── Camera entity ──────────────────────────────────────────────────────────
    const camera = new Entity('camera');
    camera.addComponent(
      new CameraComponent(Math.PI / 4, canvas.width / canvas.height, 0.1, 100),
    );
    scene.addEntity(camera);
    scene.mainCamera = camera;

    // ── Orbit controller (sets initial camera position) ────────────────────────
    const orbitController = new OrbitCameraController(scene, canvas);

    // ── Render graph ───────────────────────────────────────────────────────────
    const graph = new RenderGraph(scene);

    const buildCtx: BuildContext = { device, resources, pipelines, scene };

    const planetNode = new PlanetRenderNode(scene, resources, pipelines);
    planetNode.build(buildCtx);
    graph.addNode(planetNode);

    return { graph, orbitController };
  }
}
