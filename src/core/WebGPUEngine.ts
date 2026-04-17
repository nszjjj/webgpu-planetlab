// src/core/WebGPUEngine.ts
import type { RenderGraph } from './RenderGraph.ts';
import type { FrameContext } from './types.ts';
import { GraphBuilder } from '../graph/GraphBuilder.ts';

export class WebGPUEngine {
  private _device!: GPUDevice;
  private _context!: GPUCanvasContext;
  private _depthTexture!: GPUTexture;
  private _graph!: RenderGraph;
  // Held to keep event listeners alive (not read after construction)
  private _orbitController!: ReturnType<typeof GraphBuilder.build>['orbitController'];
  private _canvas!: HTMLCanvasElement;
  private _frameIndex = 0;
  private _lastTime = 0;
  private _totalTime = 0;

  async init(): Promise<void> {
    if (!navigator.gpu) {
      throw new Error('WebGPU is not supported in this browser.');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No GPU adapter found.');

    this._device = await adapter.requestDevice();

    this._canvas = document.getElementById('webgpu-canvas') as HTMLCanvasElement;
    this._canvas.width = window.innerWidth;
    this._canvas.height = window.innerHeight;

    this._context = this._canvas.getContext('webgpu') as GPUCanvasContext;
    const format = navigator.gpu.getPreferredCanvasFormat();
    this._context.configure({ device: this._device, format });

    this._depthTexture = this._device.createTexture({
      size: [this._canvas.width, this._canvas.height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const { graph, orbitController } = GraphBuilder.build(this._device, this._canvas);
    this._graph = graph;
    this._orbitController = orbitController;
    void this._orbitController; // keep reference alive; suppress noUnusedLocals
  }

  start(): void {
    this._lastTime = performance.now();
    requestAnimationFrame(this._tick.bind(this));
  }

  private _tick(timestamp: number): void {
    const dt = Math.min((timestamp - this._lastTime) / 1000, 0.1); // cap at 100ms
    this._lastTime = timestamp;
    this._totalTime += dt;
    this._frameIndex++;

    const ctx: FrameContext = {
      frameIndex: this._frameIndex,
      dt,
      totalTime: this._totalTime,
      device: this._device,
      targetView: this._context.getCurrentTexture().createView(),
      depthView: this._depthTexture.createView(),
    };

    this._graph.update(ctx);
    this._graph.execute(ctx);

    requestAnimationFrame(this._tick.bind(this));
  }
}
