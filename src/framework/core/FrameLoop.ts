// src/framework/core/FrameLoop.ts
import type { FrameContext } from '../graph/types.ts';

export type FrameLoopTick = (frame: Pick<FrameContext, 'device' | 'frameIndex' | 'dt' | 'totalTime'>) => void;

export class FrameLoop {
  private _tick: FrameLoopTick;
  private _device: GPUDevice;
  private _running = false;
  private _rafId = 0;
  private _lastTime = 0;
  private _frameIndex = 0;
  private _totalTime = 0;

  constructor(tick: FrameLoopTick, device: GPUDevice) {
    this._tick   = tick;
    this._device = device;
  }

  get running(): boolean { return this._running; }

  start(): void {
    if (this._running) return;
    this._running  = true;
    this._lastTime = performance.now();
    const loop = (timestamp: number): void => {
      if (!this._running) return;
      const dt = Math.min((timestamp - this._lastTime) / 1000, 0.1);
      this._lastTime = timestamp;
      this._totalTime += dt;
      this._frameIndex++;
      const frame = {
        device:     this._device,
        frameIndex: this._frameIndex,
        dt,
        totalTime:  this._totalTime,
      };
      this._tick(frame);
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    if (!this._running) return;
    this._running = false;
    cancelAnimationFrame(this._rafId);
  }
}
