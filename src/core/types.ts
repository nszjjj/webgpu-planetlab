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

export interface NoiseParams {
  continent_freq: number;
  continent_persistence: number;
  mountain_freq: number;
  detail_freq: number;
}

export interface ClassifyParams {
  water_max: number;
  sand_max: number;
  grass_max: number;
  rock_max: number;
  ore_iron_threshold: number;
  ore_rare_threshold: number;
  ore_noise_freq: number;
}

export const DEFAULT_NOISE_PARAMS: NoiseParams = {
  continent_freq: 0.8,
  continent_persistence: 0.5,
  mountain_freq: 3.0,
  detail_freq: 8.0,
};

export const DEFAULT_CLASSIFY_PARAMS: ClassifyParams = {
  water_max: 0.35,
  sand_max: 0.40,
  grass_max: 0.65,
  rock_max: 0.80,
  ore_iron_threshold: 0.85,
  ore_rare_threshold: 0.95,
  ore_noise_freq: 12.0,
};
