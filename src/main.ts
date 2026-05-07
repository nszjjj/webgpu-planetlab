// src/main.ts
import { initWebGPU }           from './core/initWebGPU.ts';
import { CanvasSurfaceManager } from './core/CanvasSurfaceManager.ts';
import { WebGPUEngine }         from './core/WebGPUEngine.ts';
import { GraphBuilder }         from './graph/GraphBuilder.ts';
import { DebugHUD }             from './ui/DebugHUD.ts';

async function main(): Promise<void> {
  const canvas  = document.getElementById('webgpu-canvas') as HTMLCanvasElement;
  const device  = await initWebGPU();
  const surface = new CanvasSurfaceManager(canvas, device);
  const engine  = new WebGPUEngine(device);
  engine.addSurface(surface);
  const { debugWireframe, cloudParams, materialParams } = GraphBuilder.build(engine, canvas);
  engine.start();
  if (import.meta.env.DEV) {
    new DebugHUD(debugWireframe, cloudParams, materialParams);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  document.body.innerHTML = `<pre style="color:red;padding:1rem;">${msg}</pre>`;
});
