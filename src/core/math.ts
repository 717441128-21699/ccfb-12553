// 列主序 4x4 矩阵 / 3 维向量数学库，约定与 WebGL uniform 一致。
// m[col*4 + row]，平移分量位于 m[12], m[13], m[14]。

export type Vec3 = [number, number, number];
export type Mat4 = Float32Array;

export const v3 = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];
export const cloneV = (a: Vec3): Vec3 => [a[0], a[1], a[2]];

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
export function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}
export function normalize(a: Vec3): Vec3 {
  const l = length(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 向量投影到由单位法向量 n 定义的平面（减去法向分量，保留平面内分量） */
export function projectPlane(a: Vec3, n: Vec3): Vec3 {
  const d = dot(a, n);
  return [a[0] - n[0] * d, a[1] - n[1] * d, a[2] - n[2] * d];
}

/**
 * 平面内有符号夹角（度）：从 a 转向 b，绕单位轴 axis（右手定则为正）。
 * a、b 不必先归一化。
 */
export function signedAngleDeg(a: Vec3, b: Vec3, axis: Vec3): number {
  const la = length(a);
  const lb = length(b);
  if (la < 1e-9 || lb < 1e-9) return 0;
  const an = scale(a, 1 / la);
  const bn = scale(b, 1 / lb);
  const cos = Math.max(-1, Math.min(1, dot(an, bn)));
  const ang = Math.acos(cos) * RAD2DEG;
  return dot(cross(an, bn), axis) >= 0 ? ang : -ang;
}

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const clamp = (x: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, x));

export function identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/** 由平移向量构成 */
export function fromTranslation(t: Vec3): Mat4 {
  const m = identity();
  m[12] = t[0];
  m[13] = t[1];
  m[14] = t[2];
  return m;
}

/** 单轴旋转矩阵，axis: 0=X 1=Y 2=Z，angle 为弧度 */
export function fromAxisAngle(axis: 0 | 1 | 2, angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const m = identity();
  if (axis === 0) {
    m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
  } else if (axis === 1) {
    m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
  } else {
    m[0] = c; m[1] = s; m[4] = -s; m[5] = c;
  }
  return m;
}

/**
 * BVH 通道欧拉角（度）-> 局部旋转矩阵。
 * order 为 BVH 通道声明顺序（如 'ZXY'），按声明顺序依次左乘，
 * 即点变换 p' = R0 * R1 * R2 * p（先应用最后一个轴）。
 */
export function fromEuler(eulerDeg: Vec3, order: string): Mat4 {
  const axes: Record<string, 0 | 1 | 2> = { X: 0, Y: 1, Z: 2 };
  let m = identity();
  for (const ch of order) {
    const idx = axes[ch];
    const r = fromAxisAngle(idx, eulerDeg[idx] * DEG2RAD);
    m = multiply(r, m);
  }
  return m;
}

/** a * b（列主序），输出新矩阵 */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) {
        s += a[k * 4 + row] * b[col * 4 + k];
      }
      out[col * 4 + row] = s;
    }
  }
  return out;
}

/** 取平移部分 */
export function getTranslation(m: Mat4): Vec3 {
  return [m[12], m[13], m[14]];
}

/** 取 3x3 旋转部分（去掉平移/缩放影响，假设无缩放） */
export function getRotation(m: Mat4): Mat4 {
  const r = identity();
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) r[i * 4 + j] = m[i * 4 + j];
  }
  return r;
}

/** 变换方向（忽略平移） */
export function transformDir(m: Mat4, d: Vec3): Vec3 {
  return [
    m[0] * d[0] + m[4] * d[1] + m[8] * d[2],
    m[1] * d[0] + m[5] * d[1] + m[9] * d[2],
    m[2] * d[0] + m[6] * d[1] + m[10] * d[2],
  ];
}

/** 变换点（含平移） */
export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/** 仿射矩阵求逆（骨架变换只含刚体变换，这里用通用余子式法） */
export function inverse(m: Mat4): Mat4 {
  const out = new Float32Array(16);
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return identity();
  det = 1 / det;

  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b04 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b01 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

export function perspective(fovyDeg: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan((fovyDeg * DEG2RAD) / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

export function lookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  const z = normalize(sub(eye, center));
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  const m = identity();
  m[0] = x[0]; m[1] = y[0]; m[2] = z[0];
  m[4] = x[1]; m[5] = y[1]; m[6] = z[1];
  m[8] = x[2]; m[9] = y[2]; m[10] = z[2];
  m[12] = -dot(x, eye);
  m[13] = -dot(y, eye);
  m[14] = -dot(z, eye);
  return m;
}
