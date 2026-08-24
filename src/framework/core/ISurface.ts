// src/core/ISurface.ts

export interface ISurface {
  readonly width: number;
  readonly height: number;
  /** 返回当前帧的渲染目标 View。CanvasSurfaceManager 每帧从 swapchain 取；OffscreenSurfaceManager 返回固定纹理 View。 */
  getTargetView(): GPUTextureView;
  /** 注册 resize 回调。回调在 surface 尺寸实际改变后触发，传入新的像素尺寸（已乘 DPR）。 */
  onResize(cb: (width: number, height: number) => void): void;
}
