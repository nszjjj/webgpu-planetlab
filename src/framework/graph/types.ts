// src/framework/graph/types.ts
import type { ResourceManager } from '../core/ResourceManager.ts';
import type { PipelineManager } from '../core/PipelineManager.ts';
import type { RenderGraph } from '../core/RenderGraph.ts';
import type { SurfaceResources } from '../core/SurfaceResources.ts';

export interface FrameContext {
  frameIndex: number;
  dt: number;
  totalTime: number;
  device: GPUDevice;
}

export interface SurfaceDescriptor {
  width: number;
  height: number;
  colorFormat: GPUTextureFormat;   // scene RT (intermediate) format
  depthFormat: GPUTextureFormat;
  targetFormat: GPUTextureFormat;  // swapchain / canvas format
  sampleCount: number;
}

export interface BuildContext {
  device: GPUDevice;
  resources: ResourceManager;
  surfaceRes: SurfaceResources;      // surface RT 管理（scene.color / scene.depth）
  surfaceDesc: SurfaceDescriptor;    // format / size 描述符，避免硬编码
  pipelines: PipelineManager;
}

export interface IGraphNode {
  readonly name: string;
  build(ctx: BuildContext): void;
  update(ctx: FrameContext): void;
  recordPass(encoder: GPUCommandEncoder, ctx: FrameContext): void;
}

// Re-export RenderGraph type for use in nodes
export type { RenderGraph };
