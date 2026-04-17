// src/main.ts
import { WebGPUEngine } from './core/WebGPUEngine.ts';

const engine = new WebGPUEngine();

engine.init().then(() => {
  engine.start();
}).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  document.body.innerHTML = `<pre style="color:red;padding:1rem;">${msg}</pre>`;
});
