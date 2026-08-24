import type { Scene } from '../../../framework/ecs/Scene.ts';

export class OrbitCameraController {
  private _scene: Scene;
  private _canvas: HTMLCanvasElement;

  // Spherical coordinates (camera around origin)
  private _theta = Math.PI / 3;   // polar angle from Y-axis [0.05, PI-0.05]
  private _phi = 0;               // azimuthal angle
  private _radius = 4;            // distance from origin

  private _isDragging = false;
  private _lastX = 0;
  private _lastY = 0;

  constructor(scene: Scene, canvas: HTMLCanvasElement) {
    this._scene = scene;
    this._canvas = canvas;
    this._bindEvents();
    this._applyToCamera();
  }

  private _bindEvents(): void {
    this._canvas.addEventListener('mousedown', (e) => {
      this._isDragging = true;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
    });

    window.addEventListener('mouseup', () => {
      this._isDragging = false;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this._isDragging) return;
      const dx = e.clientX - this._lastX;
      const dy = e.clientY - this._lastY;
      this._lastX = e.clientX;
      this._lastY = e.clientY;

      this._phi   -= dx * 0.005;
      this._theta -= dy * 0.005;
      this._theta  = Math.max(0.05, Math.min(Math.PI - 0.05, this._theta));

      this._applyToCamera();
    });

    this._canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._radius += e.deltaY * 0.01;
      this._radius  = Math.max(1.5, Math.min(20, this._radius));
      this._applyToCamera();
    }, { passive: false });
  }

  private _applyToCamera(): void {
    const x = this._radius * Math.sin(this._theta) * Math.cos(this._phi);
    const y = this._radius * Math.cos(this._theta);
    const z = this._radius * Math.sin(this._theta) * Math.sin(this._phi);
    this._scene.mainCamera.transform.setPosition(x, y, z);
  }
}
