// src/core/initWebGPU.ts

/**
 * 请求 GPU adapter 和 device。
 * 如果浏览器不支持 WebGPU 或找不到 adapter，抛出 Error。
 * device.lost 由调用方处理（通常在 WebGPUEngine 里）。
 */
export async function initWebGPU(): Promise<GPUDevice> {
  if (!navigator.gpu) {
    throw new Error('WebGPU is not supported in this browser.');
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    throw new Error('No GPU adapter found.');
  }
  const device = await adapter.requestDevice();
  return device;
}
