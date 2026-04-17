import { mat4, vec3 } from 'wgpu-matrix';
import type { Mat4, Vec3 } from 'wgpu-matrix';

export class CameraComponent {
  fov: number;
  near: number;
  far: number;
  aspect: number;

  // Camera looks at this point (world space)
  target: Vec3 = vec3.create(0, 0, 0);
  up: Vec3 = vec3.create(0, 1, 0);

  private _vp: Mat4 = mat4.identity();

  constructor(fov: number, aspect: number, near: number, far: number) {
    this.fov = fov;
    this.aspect = aspect;
    this.near = near;
    this.far = far;
  }

  /** Compute VP matrix from camera world position. Call each frame after Transform updates. */
  getVPMatrix(position: Vec3): Mat4 {
    const view = mat4.lookAt(position, this.target, this.up);
    const proj = mat4.perspective(this.fov, this.aspect, this.near, this.far);
    mat4.multiply(proj, view, this._vp);
    return this._vp;
  }
}
