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

if (typeof globalThis.GPUBufferUsage === 'undefined') {
  (globalThis as Record<string, unknown>).GPUBufferUsage = {
    MAP_READ:      0x01,
    MAP_WRITE:     0x02,
    COPY_SRC:      0x04,
    COPY_DST:      0x08,
    INDEX:         0x10,
    VERTEX:        0x20,
    UNIFORM:       0x40,
    STORAGE:       0x80,
    INDIRECT:     0x100,
    QUERY_RESOLVE: 0x200,
  };
}

if (typeof globalThis.GPUShaderStage === 'undefined') {
  (globalThis as Record<string, unknown>).GPUShaderStage = {
    VERTEX:   0x01,
    FRAGMENT: 0x02,
    COMPUTE:  0x04,
  };
}
