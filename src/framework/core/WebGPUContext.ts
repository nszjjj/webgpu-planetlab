// src/core/WebGPUContext.ts
import { ResourceManager }      from './ResourceManager.ts';
import { PipelineManager }      from './PipelineManager.ts';
import { SurfaceResources }     from './SurfaceResources.ts';
import type { ISurface }        from './ISurface.ts';
import { CanvasSurfaceManager } from './CanvasSurfaceManager.ts';
import type { SurfaceDescriptor } from '../graph/types.ts';

interface SurfacePair {
  surface:    ISurface;
  surfaceRes: SurfaceResources;
}

export class WebGPUContext {
  private _device:    GPUDevice;
  private _resources: ResourceManager;
  private _pipelines: PipelineManager;
  private _surfaces:  SurfacePair[] = [];

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

  /** 已注册的 Surface 列表（demo bootstrap 用来取 targetView）。 */
  get surfaces(): ISurface[] {
    return this._surfaces.map(p => p.surface);
  }

  /** Surface 的格式描述符，供 buildPlanetGraph 构造 BuildContext 时使用。 */
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
   * 返回 SurfaceResources 供 buildPlanetGraph 注册 RT 纹理。
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

  /** 取第 index 个 Surface 的 SurfaceResources（buildPlanetGraph 使用）。 */
  getSurfaceResources(index: number): SurfaceResources {
    return this._surfaces[index]!.surfaceRes;
  }
}
