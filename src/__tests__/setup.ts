// src/__tests__/setup.ts
// Minimal WebGPU globals for the Node/Vitest environment

if (typeof globalThis.GPUTextureUsage === 'undefined') {
  (globalThis as Record<string, unknown>).GPUTextureUsage = {
    COPY_SRC:          0x01,
    COPY_DST:          0x02,
    TEXTURE_BINDING:   0x04,
    STORAGE_BINDING:   0x08,
    RENDER_ATTACHMENT: 0x10,
  };
}
