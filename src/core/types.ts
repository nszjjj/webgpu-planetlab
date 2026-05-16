// src/core/types.ts
import type { ResourceManager } from './ResourceManager.ts';
import type { PipelineManager } from './PipelineManager.ts';
import type { Scene } from '../ecs/Scene.ts';
import type { RenderGraph } from './RenderGraph.ts';
import type { SurfaceResources } from './SurfaceResources.ts';

export interface FrameContext {
  frameIndex: number;
  dt: number;
  totalTime: number;
  device: GPUDevice;
  targetView: GPUTextureView;
  sceneColorView: GPUTextureView;
  depthView: GPUTextureView;
  resources: ResourceManager;        // 共享资源，Node 可按需查询 terrain buffer 等
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

export interface AtmosphereParams {
  planetRadius: number;
  atmosphereRadius: number;
  H_R: number;
  H_M: number;
  betaR: [number, number, number];
  betaM: number;
  mieG: number;
  numSamples: number;
  numLightSamples: number;
}

export const DEFAULT_ATMOSPHERE_PARAMS: AtmosphereParams = {
  planetRadius: 1.0,
  atmosphereRadius: 1.20,
  H_R: 0.08,
  H_M: 0.012,
  // betaR normalized from Nishita (1993) for unit-sphere planet with H_R=0.08.
  // Ratio preserved from Rayleigh λ⁻⁴: ~1 : 2.4 : 4.1
  betaR: [0.15, 0.35, 0.86],
  betaM: 0.08,
  mieG: 0.76,
  numSamples: 16,
  numLightSamples: 8,
};

// ── Atmosphere LUT ──────────────────────────────────────────────────────

export type LUTPreset = 'low' | 'medium' | 'high' | 'ultra';

export interface LUTResolution {
  r: number;
  muS: number;
  muV: number;
}

export const LUT_PRESETS: Record<LUTPreset, LUTResolution> = {
  low:    { r: 8,  muS: 16, muV: 16 },
  medium: { r: 16, muS: 32, muV: 32 },
  high:   { r: 32, muS: 64, muV: 64 },
  ultra:  { r: 64, muS: 128, muV: 128 },
};

export interface AtmosphereLUTParams {
  planetRadius: number;
  atmosphereRadius: number;
  betaR: [number, number, number];
  betaM: number;
  H_R: number;
  H_M: number;
  mieG: number;
  numSamples: number;
  numLightSamples: number;
}

export const DEFAULT_ATMOSPHERE_LUT_PARAMS: AtmosphereLUTParams = {
  planetRadius: 1.0,
  atmosphereRadius: 1.20,
  betaR: [0.15, 0.35, 0.86],
  betaM: 0.08,
  H_R: 0.08,
  H_M: 0.012,
  mieG: 0.76,
  numSamples: 32,
  numLightSamples: 16,
};

export interface CloudParams {
  cloudInnerRadius:  number;   // inner shell edge (planet units)
  cloudOuterRadius:  number;   // outer shell edge — extensible to multi-layer in Phase 2
  extinction:        number;   // total attenuation coefficient
  scatterAlbedo:     number;   // scatter / extinction ratio
  mieG:              number;   // Henyey-Greenstein asymmetry parameter
  scaleHeight:       number;   // vertical density falloff within shell [0,1]
  timeOffset:        number;   // FBM time drift for animation (Phase 1 = 0)
  numSteps:          number;   // ray march steps per pixel
  coverageFreq:      number;   // FBM frequency for coverage pattern
  coverageThreshold: number;   // density below this value = no cloud
}

export const DEFAULT_CLOUD_PARAMS: CloudParams = {
  cloudInnerRadius:  1.02,
  cloudOuterRadius:  1.10,
  extinction:        60.0,
  scatterAlbedo:     0.9,
  mieG:              0.6,
  scaleHeight:       0.3,
  timeOffset:        0.0,
  numSteps:          32,
  coverageFreq:      3.0,
  coverageThreshold: 0.45,
};

export interface MaterialParam {
  roughness: number;
  metallic: number;
}

export interface MaterialParams {
  materials: [MaterialParam, ...MaterialParam[]];
  lightColor: [number, number, number];
  lightIntensity: number;
}

export const DEFAULT_MATERIAL_PARAMS: MaterialParams = {
  materials: [
    { roughness: 0.20, metallic: 0.30 },   // water  — bit 0
    { roughness: 0.70, metallic: 0.00 },   // sand   — bit 1
    { roughness: 0.80, metallic: 0.00 },   // grass  — bit 2
    { roughness: 0.55, metallic: 0.05 },   // rock   — bit 3
    { roughness: 0.45, metallic: 0.00 },   // snow   — bit 4
    { roughness: 0.50, metallic: 0.00 },   // reserved 5
    { roughness: 0.50, metallic: 0.00 },   // reserved 6
    { roughness: 0.50, metallic: 0.00 },   // reserved 7
    { roughness: 0.50, metallic: 0.00 },   // reserved 8
    { roughness: 0.50, metallic: 0.00 },   // reserved 9
  ],
  lightColor: [1.0, 0.95, 0.85],
  lightIntensity: 2.0,
};
