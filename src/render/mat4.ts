/**
 * 4×4 列主序矩阵与轨道相机（手写，无 gl-matrix 依赖）
 * 坐标：X 线路走向，Y 高程，Z 横线路
 */

export type Mat4 = Float32Array;

export function mat4Identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function mat4Perspective(fovyRad: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovyRad / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

export function mat4LookAt(eye: Vec3Like, center: Vec3Like, up: Vec3Like): Mat4 {
  let zx = eye.x - center.x;
  let zy = eye.y - center.y;
  let zz = eye.z - center.z;
  let len = Math.hypot(zx, zy, zz);
  zx /= len;
  zy /= len;
  zz /= len;
  // x = up × z
  let xx = up.y * zz - up.z * zy;
  let xy = up.z * zx - up.x * zz;
  let xz = up.x * zy - up.y * zx;
  len = Math.hypot(xx, xy, xz);
  xx /= len;
  xy /= len;
  xz /= len;
  // y = z × x
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  const m = mat4Identity();
  m[0] = xx;
  m[1] = yx;
  m[2] = zx;
  m[4] = xy;
  m[5] = yy;
  m[6] = zy;
  m[8] = xz;
  m[9] = yz;
  m[10] = zz;
  m[12] = -(xx * eye.x + xy * eye.y + xz * eye.z);
  m[13] = -(yx * eye.x + yy * eye.y + yz * eye.z);
  m[14] = -(zx * eye.x + zy * eye.y + zz * eye.z);
  return m;
}

export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface OrbitState {
  target: Vec3Like;
  distance: number;
  yaw: number;
  pitch: number;
}

export function orbitEye(o: OrbitState): Vec3Like {
  const cp = Math.cos(o.pitch);
  return {
    x: o.target.x + o.distance * cp * Math.cos(o.yaw),
    y: o.target.y + o.distance * Math.sin(o.pitch),
    z: o.target.z + o.distance * cp * Math.sin(o.yaw),
  };
}

/** 视图矩阵 */
export function orbitView(o: OrbitState): Mat4 {
  return mat4LookAt(orbitEye(o), o.target, { x: 0, y: 1, z: 0 });
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
