export class ResourceManager {
  private _device: GPUDevice;
  private _buffers = new Map<string, GPUBuffer>();
  private _textures = new Map<string, GPUTexture>();

  constructor(device: GPUDevice) {
    this._device = device;
  }

  createBuffer(name: string, descriptor: GPUBufferDescriptor): GPUBuffer {
    if (this._buffers.has(name)) {
      console.warn(`ResourceManager: buffer "${name}" already exists, returning cached.`);
      return this._buffers.get(name)!;
    }
    const buf = this._device.createBuffer(descriptor);
    this._buffers.set(name, buf);
    return buf;
  }

  getBuffer(name: string): GPUBuffer | undefined {
    return this._buffers.get(name);
  }

  createTexture(name: string, descriptor: GPUTextureDescriptor): GPUTexture {
    if (this._textures.has(name)) {
      console.warn(`ResourceManager: texture "${name}" already exists, returning cached.`);
      return this._textures.get(name)!;
    }
    const tex = this._device.createTexture(descriptor);
    this._textures.set(name, tex);
    return tex;
  }

  getTexture(name: string): GPUTexture | undefined {
    return this._textures.get(name);
  }

  destroy(): void {
    this._buffers.forEach(b => b.destroy());
    this._textures.forEach(t => t.destroy());
    this._buffers.clear();
    this._textures.clear();
  }
}
