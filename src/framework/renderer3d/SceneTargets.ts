// src/framework/renderer3d/SceneTargets.ts
import type { WebGPUContext } from '../core/WebGPUContext.ts';
import type { TextureHandle } from '../graph/handles.ts';

export interface SceneTargets {
  color: TextureHandle<'scene.color'>;
  depth: TextureHandle<'scene.depth'>;
}

export function create3DSceneTargets(context: WebGPUContext, surfaceIndex = 0): SceneTargets {
  const surfaceRes = context.getSurfaceResources(surfaceIndex);
  const desc = context.surfaceDescriptor;
  surfaceRes.registerTexture('scene.color', (w, h) => ({
    size: [w, h], format: desc.colorFormat,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  }));
  surfaceRes.registerTexture('scene.depth', (w, h) => ({
    size: [w, h], format: desc.depthFormat,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  }));
  return {
    color: { __tag: 'scene.color' as const, __kind: 'texture' as const, key: 'scene.color' },
    depth: { __tag: 'scene.depth' as const, __kind: 'texture' as const, key: 'scene.depth' },
  };
}
