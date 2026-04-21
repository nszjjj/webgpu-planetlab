// src/__tests__/SurfaceResources.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SurfaceResources } from '../core/SurfaceResources.ts';

function makeMockDevice() {
  return {
    createTexture: vi.fn(() => ({
      destroy: vi.fn(),
      createView: vi.fn(() => ({ _tag: 'view_' + Math.random() })),
    })),
  } as unknown as GPUDevice;
}

describe('SurfaceResources', () => {
  let device: GPUDevice;
  let sr: SurfaceResources;

  beforeEach(() => {
    device = makeMockDevice();
    sr = new SurfaceResources(device, 800, 600);
  });

  it('registerTexture 立即创建纹理', () => {
    sr.registerTexture('scene.color', (w, h) => ({
      size: [w, h], format: 'rgba8unorm' as GPUTextureFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    }));
    expect((device.createTexture as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    const call = (device.createTexture as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.size).toEqual([800, 600]);
  });

  it('getView 返回缓存 View（同一引用）', () => {
    sr.registerTexture('scene.color', (w, h) => ({
      size: [w, h], format: 'rgba8unorm' as GPUTextureFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    }));
    const v1 = sr.getView('scene.color');
    const v2 = sr.getView('scene.color');
    expect(v1).toBe(v2);
  });

  it('onSurfaceChanged 销毁旧纹理、重建、使 View 缓存失效', () => {
    const factory = vi.fn((w: number, h: number) => ({
      size: [w, h], format: 'rgba8unorm' as GPUTextureFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    }));
    sr.registerTexture('scene.color', factory);

    const v1 = sr.getView('scene.color');
    sr.onSurfaceChanged(1280, 720);

    // 旧纹理被销毁
    const firstTex = (device.createTexture as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(firstTex.destroy).toHaveBeenCalled();

    // 新纹理用新尺寸
    expect(factory.mock.calls[1]).toEqual([1280, 720]);

    // View 缓存失效：getView 返回新引用
    const v2 = sr.getView('scene.color');
    expect(v2).not.toBe(v1);
  });

  it('onChanged 回调在 onSurfaceChanged 后触发', () => {
    sr.registerTexture('scene.color', (w, h) => ({
      size: [w, h], format: 'rgba8unorm' as GPUTextureFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    }));
    const cb = vi.fn();
    sr.onChanged(cb);
    sr.onSurfaceChanged(1280, 720);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('destroy 后调用 getView 抛出 "already destroyed" 错误', () => {
    sr.registerTexture('scene.color', (w, h) => ({
      size: [w, h], format: 'rgba8unorm' as GPUTextureFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    }));
    sr.destroy();
    expect(() => sr.getView('scene.color')).toThrow('already destroyed');
  });

  it('destroy 后调用 onSurfaceChanged 抛出 "already destroyed" 错误', () => {
    sr.destroy();
    expect(() => sr.onSurfaceChanged(640, 480)).toThrow('already destroyed');
  });
});
