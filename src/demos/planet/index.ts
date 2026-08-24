// src/demos/planet/index.ts
import type { WebGPUContext } from '../../framework/core/WebGPUContext.ts';
import { FrameLoop }          from '../../framework/core/FrameLoop.ts';
import { buildPlanetGraph }   from './graph.ts';
import { PlanetHUD }          from './ui/PlanetHUD.ts';

export interface PlanetDemoHandle {
  dispose(): void;
}

export function bootstrap(context: WebGPUContext, canvas: HTMLCanvasElement): PlanetDemoHandle {
  const { graph, sceneTargets, debugWireframe, cloudParams, materialParams, bridgeInputs } =
    buildPlanetGraph(context, canvas);
  void sceneTargets; // reserved for Phase C handle-based lookups

  const loop = new FrameLoop((frame) => {
    bridgeInputs(frame);
    const encoder = context.device.createCommandEncoder();
    graph.runFrame(encoder, frame);
    context.device.queue.submit([encoder.finish()]);
  }, context.device);
  loop.start();

  const hud = import.meta.env.DEV
    ? new PlanetHUD(
        { cloud: cloudParams, material: materialParams },
        { wireframe: debugWireframe },
      )
    : undefined;
  void hud;

  return {
    dispose(): void { loop.stop(); hud?.dispose(); },
  };
}
