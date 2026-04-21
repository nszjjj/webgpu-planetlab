// src/core/SurfaceResources.ts

export class SurfaceResources {
  private _device: GPUDevice;
  private _textures  = new Map<string, GPUTexture>();
  private _views     = new Map<string, GPUTextureView>();
  private _factories = new Map<string, (w: number, h: number) => GPUTextureDescriptor>();
  private _callbacks: Array<() => void> = [];
  private _width: number;
  private _height: number;
  private _destroyed = false;

  constructor(device: GPUDevice, width: number, height: number) {
    this._device = device;
    this._width  = width;
    this._height = height;
  }

  registerTexture(name: string, factory: (w: number, h: number) => GPUTextureDescriptor): void {
    if (this._destroyed) throw new Error('SurfaceResources: already destroyed');
    this._factories.set(name, factory);
    const tex = this._device.createTexture(factory(this._width, this._height));
    this._textures.set(name, tex);
  }

  getView(name: string): GPUTextureView {
    if (this._destroyed) throw new Error('SurfaceResources: already destroyed');
    if (!this._views.has(name)) {
      const tex = this._textures.get(name);
      if (!tex) throw new Error(`SurfaceResources: texture "${name}" not registered`);
      this._views.set(name, tex.createView());
    }
    return this._views.get(name)!;
  }

  onSurfaceChanged(width: number, height: number): void {
    if (this._destroyed) throw new Error('SurfaceResources: already destroyed');
    this._width  = width;
    this._height = height;
    for (const [name, factory] of this._factories) {
      this._textures.get(name)?.destroy();
      this._textures.set(name, this._device.createTexture(factory(width, height)));
      this._views.delete(name);
    }
    for (const cb of this._callbacks) cb();
  }

  onChanged(cb: () => void): void {
    this._callbacks.push(cb);
  }

  destroy(): void {
    this._textures.forEach(t => t.destroy());
    this._textures.clear();
    this._views.clear();
    this._factories.clear();
    this._callbacks.length = 0;
    this._destroyed = true;
  }
}
