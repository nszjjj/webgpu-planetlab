// src/core/CanvasSurfaceManager.ts
import type { ISurface } from './ISurface.ts';

export class CanvasSurfaceManager implements ISurface {
  private _canvas:  HTMLCanvasElement;
  private _context: GPUCanvasContext;
  private _device:  GPUDevice;
  private _width:   number;
  private _height:  number;

  constructor(canvas: HTMLCanvasElement, device: GPUDevice) {
    this._canvas  = canvas;
    this._device  = device;
    this._width   = Math.round(canvas.clientWidth  * devicePixelRatio);
    this._height  = Math.round(canvas.clientHeight * devicePixelRatio);
    canvas.width  = this._width;
    canvas.height = this._height;
    this._context = canvas.getContext('webgpu') as GPUCanvasContext;
    this._configure();
  }

  get width()  { return this._width; }
  get height() { return this._height; }

  getTargetView(): GPUTextureView {
    return this._context.getCurrentTexture().createView();
  }

  /** Engine 在 resize 回调里调用，重新配置 context。 */
  reconfigure(device: GPUDevice, width: number, height: number): void {
    this._device  = device;
    this._width   = width;
    this._height  = height;
    this._canvas.width  = width;
    this._canvas.height = height;
    this._configure();
  }

  onResize(cb: (w: number, h: number) => void): void {
    new ResizeObserver(entries => {
      const e = entries[0];
      if (!e) return;
      const w = Math.round(e.contentRect.width  * devicePixelRatio);
      const h = Math.round(e.contentRect.height * devicePixelRatio);
      if (w > 0 && h > 0) cb(w, h);
    }).observe(this._canvas);
  }

  private _configure(): void {
    this._context.configure({
      device: this._device,
      format: navigator.gpu.getPreferredCanvasFormat(),
    });
  }
}
