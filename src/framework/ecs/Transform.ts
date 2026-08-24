import { mat4, quat, vec3 } from 'wgpu-matrix';
import type { Mat4, Quat, Vec3 } from 'wgpu-matrix';

export class Transform {
  private _position: Vec3 = vec3.create(0, 0, 0);
  private _rotation: Quat = quat.identity();
  private _scale: Vec3 = vec3.create(1, 1, 1);
  private _worldMatrix: Mat4 = mat4.identity();
  private _dirty = true;

  get position(): Vec3 {
    return this._position;
  }

  setPosition(x: number, y: number, z: number): void {
    vec3.set(x, y, z, this._position);
    this._dirty = true;
  }

  setRotation(q: Quat): void {
    quat.copy(q, this._rotation);
    this._dirty = true;
  }

  setScale(x: number, y: number, z: number): void {
    vec3.set(x, y, z, this._scale);
    this._dirty = true;
  }

  getWorldMatrix(): Mat4 {
    if (this._dirty) {
      const t = mat4.translation(this._position);
      const r = mat4.fromQuat(this._rotation);
      const s = mat4.scaling(this._scale);
      mat4.multiply(mat4.multiply(t, r), s, this._worldMatrix);
      this._dirty = false;
    }
    return this._worldMatrix;
  }
}
