// src/demos/planet/graph.ts
import { RenderGraph }           from '../../framework/core/RenderGraph.ts';
import { Scene }                 from '../../framework/ecs/Scene.ts';
import { Entity }                from '../../framework/ecs/Entity.ts';
import { CameraComponent }       from '../../framework/ecs/components/CameraComponent.ts';
import { PlanetComponent }       from './components/PlanetComponent.ts';
import { SunComponent }          from './components/SunComponent.ts';
import { ComputeNoiseNode }      from './nodes/ComputeNoiseNode.ts';
import { NormalComputeNode }     from './nodes/NormalComputeNode.ts';
import { PlanetRenderNode }      from './nodes/PlanetRenderNode.ts';
import { CloudCoverageNode }     from './nodes/CloudCoverageNode.ts';
import { CloudRenderNode }       from './nodes/CloudRenderNode.ts';
import { AtmosphereLUTNode }     from './nodes/AtmosphereLUTNode.ts';
import { AtmosphereNode }        from './nodes/AtmosphereNode.ts';
import { DebugWireframeNode }    from './nodes/DebugWireframeNode.ts';
import { OrbitCameraController } from './controllers/OrbitCameraController.ts';
import type { BuildContext, FrameContext } from '../../framework/graph/types.ts';
import type { CloudParams, MaterialParams } from './params.ts';
import {
  DEFAULT_CLOUD_PARAMS,
  DEFAULT_MATERIAL_PARAMS,
  DEFAULT_NOISE_PARAMS,
  DEFAULT_CLASSIFY_PARAMS,
  DEFAULT_ATMOSPHERE_LUT_PARAMS,
  DEFAULT_ATMOSPHERE_PARAMS,
} from './params.ts';
import type { WebGPUContext }    from '../../framework/core/WebGPUContext.ts';
import type { SceneTargets }     from '../../framework/renderer3d/SceneTargets.ts';
import { create3DSceneTargets }  from '../../framework/renderer3d/SceneTargets.ts';

export function buildPlanetGraph(context: WebGPUContext, canvas: HTMLCanvasElement): {
  graph:          RenderGraph;
  scene:          Scene;
  sceneTargets:   SceneTargets;
  debugWireframe: DebugWireframeNode;
  cloudParams:    CloudParams;
  materialParams: MaterialParams;
  bridgeInputs:   (frame: FrameContext) => void;
} {
  const { device, resources, pipelines } = context;
  const cloudParams:    CloudParams    = { ...DEFAULT_CLOUD_PARAMS };
  const materialParams: MaterialParams = {
    materials:     [...DEFAULT_MATERIAL_PARAMS.materials] as MaterialParams['materials'],
    lightColor:    [...DEFAULT_MATERIAL_PARAMS.lightColor] as [number, number, number],
    lightIntensity: DEFAULT_MATERIAL_PARAMS.lightIntensity,
  };
  const surfaceRes  = context.getSurfaceResources(0);
  const surfaceDesc = context.surfaceDescriptor;

  // ── Surface-dependent RTs ────────────────────────────────────────────────
  const sceneTargets = create3DSceneTargets(context);

  // ── Scene ────────────────────────────────────────────────────────────────
  const scene = new Scene();

  const planet = new Entity('planet');
  planet.transform.setPosition(0, 0, 0);
  planet.addComponent(new PlanetComponent(1.0, 5));  // icosphere subdiv 5
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

  // ── Build context ────────────────────────────────────────────────────────
  const buildCtx: BuildContext = { device, resources, surfaceRes, surfaceDesc, pipelines };

  // ── Nodes ────────────────────────────────────────────────────────────────
  const noiseNode         = new ComputeNoiseNode();
  const normalNode        = new NormalComputeNode();
  const planetNode        = new PlanetRenderNode();
  const cloudCoverageNode = new CloudCoverageNode();
  const cloudRenderNode   = new CloudRenderNode();
  const atmosNode         = new AtmosphereNode();
  const debugWireframe    = new DebugWireframeNode();
  const lutNode           = new AtmosphereLUTNode();

  noiseNode.build(buildCtx);
  normalNode.setInputs({
    heightBuffer:  noiseNode.outputs.heightBuffer,
    displaceScale: 0.15,
  });
  normalNode.build(buildCtx);

  const planetComp = planet.getComponent(PlanetComponent)!;
  planetNode.setInputs({
    heightBuffer:  noiseNode.outputs.heightBuffer,
    splatBuffer:   noiseNode.outputs.splatBuffer,
    normalBuffer:  normalNode.outputs.normalBuffer,
    colorTarget:   sceneTargets.color,
    depthTarget:   sceneTargets.depth,
    vpMatrix:      new Float32Array(16),
    modelMatrix:   new Float32Array(16),
    cameraPos:     [0, 0, 0],
    sunDir:        [0, 1, 0],
    displaceScale: planetComp.displaceScale,
    lightColor:    materialParams.lightColor,
    lightIntensity: materialParams.lightIntensity,
    materials:     materialParams.materials,
    subdivisions:  planetComp.subdivisions,
  });
  planetNode.build(buildCtx);
  cloudCoverageNode.setInputs({ cloudParams });
  cloudCoverageNode.build(buildCtx);
  cloudRenderNode.setInputs({
    coverageBuffer: cloudCoverageNode.outputs.coverageBuffer,
    depthTarget:    sceneTargets.depth,
    vpMatrix:       new Float32Array(16),
    cameraPos:      [0, 0, 0],
    sunDir:         [0, 1, 0],
    planetRadius:   planetComp.radius,
    cloudParams,
  });
  cloudRenderNode.build(buildCtx);
  lutNode.setInputs({
    params: DEFAULT_ATMOSPHERE_LUT_PARAMS,
    preset: 'high',
  });
  lutNode.build(buildCtx);     // must build before atmosNode — creates atmosphere.lut.high
  atmosNode.setInputs({
    lut:           lutNode.outputs.lut,
    colorTarget:   sceneTargets.color,
    depthTarget:   sceneTargets.depth,
    targetView:    context.surfaces[0]!.getTargetView(),
    vpMatrix:      new Float32Array(16),
    cameraPos:     [0, 0, 0],
    sunDir:        [0, 1, 0],
    params:        DEFAULT_ATMOSPHERE_PARAMS,
    planetRadius:  planetComp.radius,
  });
  atmosNode.build(buildCtx);
  debugWireframe.setInputs({
    heightBuffer: noiseNode.outputs.heightBuffer,
    targetView:   context.surfaces[0]!.getTargetView(),
    depthTarget:  sceneTargets.depth,
  });
  debugWireframe.build(buildCtx);

  const graph = new RenderGraph();
  graph.addNode(noiseNode);
  graph.addNode(normalNode);
  graph.addNode(planetNode);
  graph.addNode(cloudCoverageNode);
  graph.addNode(cloudRenderNode);
  graph.addNode(lutNode);
  graph.addNode(atmosNode);
  graph.addNode(debugWireframe);

  const bridgeInputs = (_frame: FrameContext) => {
    noiseNode.setInputs({
      noiseParams: DEFAULT_NOISE_PARAMS,
      classifyParams: DEFAULT_CLASSIFY_PARAMS,
    });
    normalNode.setInputs({
      heightBuffer:  noiseNode.outputs.heightBuffer,
      displaceScale: 0.15,   // Could later come from PlanetComponent; hardcoded for now to match current behavior
    });
    lutNode.setInputs({
      params: DEFAULT_ATMOSPHERE_LUT_PARAMS,
      preset: 'high',
    });
    cloudCoverageNode.setInputs({ cloudParams });
    debugWireframe.setInputs({
      heightBuffer: noiseNode.outputs.heightBuffer,
      targetView:   context.surfaces[0]!.getTargetView(),
      depthTarget:  sceneTargets.depth,
    });

    const cam = camera.getComponent(CameraComponent)!;
    const sunComp = sun.getComponent(SunComponent)!;

    const vp = cam.getVPMatrix(camera.transform.position);
    const cp = camera.transform.position;
    const sPos = sunComp.worldPosition;
    const sMag = Math.hypot(sPos[0], sPos[1], sPos[2]) || 1;
    const sDir: [number, number, number] = [sPos[0] / sMag, sPos[1] / sMag, sPos[2] / sMag];

    const planetComp = planet.getComponent(PlanetComponent)!;
    const model  = planet.transform.getWorldMatrix();
    const scaled = new Float32Array(16);
    scaled.set(model);
    scaled[0]  *= planetComp.radius;
    scaled[5]  *= planetComp.radius;
    scaled[10] *= planetComp.radius;

    planetNode.setInputs({
      heightBuffer:  noiseNode.outputs.heightBuffer,
      splatBuffer:   noiseNode.outputs.splatBuffer,
      normalBuffer:  normalNode.outputs.normalBuffer,
      colorTarget:   sceneTargets.color,
      depthTarget:   sceneTargets.depth,
      vpMatrix:      vp,
      modelMatrix:   scaled,
      cameraPos:     [cp[0], cp[1], cp[2]] as [number, number, number],
      sunDir:        sDir,
      displaceScale: planetComp.displaceScale,
      lightColor:    materialParams.lightColor,
      lightIntensity: materialParams.lightIntensity,
      materials:     materialParams.materials,
      subdivisions:  planetComp.subdivisions,
    });

    cloudRenderNode.setInputs({
      coverageBuffer: cloudCoverageNode.outputs.coverageBuffer,
      depthTarget:    sceneTargets.depth,
      vpMatrix:       vp,
      cameraPos:      [cp[0], cp[1], cp[2]] as [number, number, number],
      sunDir:         sDir,
      planetRadius:   planetComp.radius,
      cloudParams,
    });

    // atmos requires the "sun - planet" delta, normalized (matches old node semantics)
    const planetPos = planet.transform.position;
    const dx = sPos[0] - planetPos[0];
    const dy = sPos[1] - planetPos[1];
    const dz = sPos[2] - planetPos[2];
    const dlen = Math.hypot(dx, dy, dz);
    const atmosSunDir: [number, number, number] = dlen < 1e-6
      ? [0, 1, 0]
      : [dx / dlen, dy / dlen, dz / dlen];

    atmosNode.setInputs({
      lut:           lutNode.outputs.lut,
      colorTarget:   sceneTargets.color,
      depthTarget:   sceneTargets.depth,
      targetView:    context.surfaces[0]!.getTargetView(),
      vpMatrix:      vp,
      cameraPos:     [cp[0], cp[1], cp[2]] as [number, number, number],
      sunDir:        atmosSunDir,
      params:        DEFAULT_ATMOSPHERE_PARAMS,
      planetRadius:  planetComp.radius,
    });
  };

  return { graph, scene, sceneTargets, debugWireframe, cloudParams, materialParams, bridgeInputs };
}
