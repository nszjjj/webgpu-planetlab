// src/core/WebGPUEngine.ts
import { RenderGraph }          from './RenderGraph.ts';
import { ResourceManager }      from './ResourceManager.ts';
import { PipelineManager }      from './PipelineManager.ts';
import { SurfaceResources }     from './SurfaceResources.ts';
import type { ISurface }        from './ISurface.ts';
import { CanvasSurfaceManager } from './CanvasSurfaceManager.ts';
import type { FrameContext, SurfaceDescriptor } from './types.ts';

interface SurfacePair {
  surface:    ISurface;
  surfaceRes: SurfaceResources;
}

export class WebGPUEngine {
  private _device:    GPUDevice;
  private _resources: ResourceManager;
  private _pipelines: PipelineManager;
  private _surfaces:  SurfacePair[] = [];
  private _graph?:    RenderGraph;

  private _frameIndex = 0;
  private _lastTime   = 0;
  private _totalTime  = 0;

  constructor(device: GPUDevice) {
    this._device    = device;
    this._resources = new ResourceManager(device);
    this._pipelines = new PipelineManager(device);

    device.lost.then((info) => {
      console.error('WebGPU device lost:', info.message);
    });
  }

  get device()    { return this._device; }
  get resources() { return this._resources; }
  get pipelines() { return this._pipelines; }

  /** Surface 的格式描述符，供 GraphBuilder 构造 BuildContext 时使用。 */
  get surfaceDescriptor(): SurfaceDescriptor {
    const { surface } = this._surfaces[0]!;
    return {
      width:        surface.width,
      height:       surface.height,
      colorFormat:  'rgba8unorm',
      depthFormat:  'depth32float',
      targetFormat: navigator.gpu.getPreferredCanvasFormat(),
      sampleCount:  1,
    };
  }

  /**
   * 注册一个 Surface。内部创建对应的 SurfaceResources，绑定 resize 回调。
   * 返回 SurfaceResources 供 GraphBuilder 注册 RT 纹理。
   */
  addSurface(surface: ISurface): SurfaceResources {
    const surfaceRes = new SurfaceResources(this._device, surface.width, surface.height);
    this._surfaces.push({ surface, surfaceRes });

    surface.onResize((w, h) => {
      if (surface instanceof CanvasSurfaceManager) {
        surface.reconfigure(this._device, w, h);
      }
      surfaceRes.onSurfaceChanged(w, h);
    });

    return surfaceRes;
  }

  /** 取第 index 个 Surface 的 SurfaceResources（GraphBuilder 使用）。 */
  getSurfaceResources(index: number): SurfaceResources {
    return this._surfaces[index]!.surfaceRes;
  }

  /** GraphBuilder 构造完 RenderGraph 后调用，注入 graph。 */
  setGraph(graph: RenderGraph): void {
    this._graph = graph;
  }

  start(): void {
    this._lastTime = performance.now();
    requestAnimationFrame(this._tick.bind(this));
  }

  private _tick(timestamp: number): void {
    const dt = Math.min((timestamp - this._lastTime) / 1000, 0.1);
    this._lastTime = timestamp;
    this._totalTime += dt;
    this._frameIndex++;

    const { surface, surfaceRes } = this._surfaces[0]!;
    const ctx: FrameContext = {
      frameIndex:     this._frameIndex,
      dt,
      totalTime:      this._totalTime,
      device:         this._device,
      targetView:     surface.getTargetView(),
      sceneColorView: surfaceRes.getView('scene.color'),
      depthView:      surfaceRes.getView('scene.depth'),
      resources:      this._resources,
    };

    this._graph!.update(ctx);
    this._graph!.execute(ctx);

    requestAnimationFrame(this._tick.bind(this));
  }
}
