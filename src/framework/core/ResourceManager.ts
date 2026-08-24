import type { BufferHandle, TextureHandle } from '../graph/handles.ts';

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

  createBufferHandle<Tag extends string>(tag: Tag, desc: GPUBufferDescriptor): BufferHandle<Tag> {
    this.createBuffer(tag, desc); // 复用旧实现，key = tag
    return { __tag: tag, __kind: 'buffer', key: tag };
  }

  createTextureHandle<Tag extends string>(tag: Tag, desc: GPUTextureDescriptor): TextureHandle<Tag> {
    this.createTexture(tag, desc);
    return { __tag: tag, __kind: 'texture', key: tag };
  }

  resolveBuffer(h: BufferHandle): GPUBuffer {
    const b = this.getBuffer(h.key);
    if (!b) throw new Error(`resolveBuffer: no buffer for '${h.key}'`);
    return b;
  }

  resolveTexture(h: TextureHandle): GPUTexture {
    const t = this.getTexture(h.key);
    if (!t) throw new Error(`resolveTexture: no texture for '${h.key}'`);
    return t;
  }
}
