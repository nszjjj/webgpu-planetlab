export class PipelineManager {
  private _device: GPUDevice;
  private _renderPipelines = new Map<string, GPURenderPipeline>();
  private _computePipelines = new Map<string, GPUComputePipeline>();

  constructor(device: GPUDevice) {
    this._device = device;
  }

  createRenderPipeline(
    name: string,
    descriptor: GPURenderPipelineDescriptor,
  ): GPURenderPipeline {
    if (this._renderPipelines.has(name)) {
      console.warn(`PipelineManager: render pipeline "${name}" already exists, returning cached.`);
      return this._renderPipelines.get(name)!;
    }
    const pipeline = this._device.createRenderPipeline(descriptor);
    this._renderPipelines.set(name, pipeline);
    return pipeline;
  }

  getRenderPipeline(name: string): GPURenderPipeline | undefined {
    return this._renderPipelines.get(name);
  }

  createComputePipeline(
    name: string,
    descriptor: GPUComputePipelineDescriptor,
  ): GPUComputePipeline {
    if (this._computePipelines.has(name)) {
      console.warn(`PipelineManager: compute pipeline "${name}" already exists, returning cached.`);
      return this._computePipelines.get(name)!;
    }
    const pipeline = this._device.createComputePipeline(descriptor);
    this._computePipelines.set(name, pipeline);
    return pipeline;
  }
}
