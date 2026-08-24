// src/main.ts
import { initWebGPU }           from './framework/core/initWebGPU.ts';
import { CanvasSurfaceManager } from './framework/core/CanvasSurfaceManager.ts';
import { WebGPUContext }        from './framework/core/WebGPUContext.ts';
import { bootstrap }            from './demos/planet/index.ts';

async function main(): Promise<void> {
  const canvas  = document.getElementById('webgpu-canvas') as HTMLCanvasElement;
  const device  = await initWebGPU();
  const context = new WebGPUContext(device);
  context.addSurface(new CanvasSurfaceManager(canvas, device));
  bootstrap(context, canvas);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  document.body.innerHTML = `<pre style="color:red;padding:1rem;">${msg}</pre>`;
});
