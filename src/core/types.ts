// src/core/types.ts
import type { ResourceManager } from './ResourceManager.ts';
import type { PipelineManager } from './PipelineManager.ts';
import type { Scene } from '../ecs/Scene.ts';
import type { RenderGraph } from './RenderGraph.ts';

export interface FrameContext {
  frameIndex: number;
  dt: number;
  totalTime: number;
  device: GPUDevice;
  targetView: GPUTextureView;
  depthView: GPUTextureView;
}

export interface BuildContext {
  device: GPUDevice;
  resources: ResourceManager;
  pipelines: PipelineManager;
  scene: Scene;
}

export interface IGraphNode {
  readonly name: string;
  build(ctx: BuildContext): void;
  update(ctx: FrameContext): void;
  recordPass(encoder: GPUCommandEncoder, ctx: FrameContext): void;
}

// Re-export RenderGraph type for use in nodes
export type { RenderGraph };
