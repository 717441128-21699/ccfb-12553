/**
 * 风偏平面与三维坐标映射
 *
 * 无风时导线在竖直平面内；有风时合成荷载方向偏离竖直，
 * 导线形状所在平面（风偏平面）由两个单位向量张成：
 *   e_t  —— 平面内"水平档距方向"（沿两挂点水平连线）
 *   e_u  —— 平面内"上轴"，向风的反方向倾斜，与竖直夹角 = 风偏角 η
 * 重力分量使导线沿 -e_u 下垂，风压使导线沿 -e_u 的水平分量偏向风去向。
 */

import type { Vec3 } from './types';

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(a: Vec3, k: number): Vec3 {
  return { x: a.x * k, y: a.y * k, z: a.z * k };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function length3(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

export function normalize(a: Vec3): Vec3 {
  const l = length3(a);
  if (l < 1e-15) throw new Error('normalize：零向量无法归一化');
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

export function distance3(a: Vec3, b: Vec3): number {
  return length3(sub(a, b));
}

export interface WindPlaneBasis {
  /** 风偏平面内、与合成荷载方向垂直的单位轴（平面内"水平"轴） */
  eT: Vec3;
  /** 风偏平面内上轴单位向量，与合成荷载方向相反；无风时即竖直向上 */
  eU: Vec3;
  /** 风偏角（弧度） */
  swingRad: number;
  /** 本档实际采用的水平风向单位向量（风的去向） */
  windDir: Vec3;
  /** 二维解算用档距：弦在 eT 上的投影 (m)，恒正 */
  L2d: number;
  /** 二维解算用高差：弦在 eU 上的投影 (m) */
  h2d: number;
}

/**
 * 构造风偏平面基（斜平面法，保证两挂点都在平面内，曲线精确穿过挂点）。
 *
 * 合成荷载单位方向 d = -cosη·up + sinη·wind（风把导线吹向 wind 去向），
 * 平面由挂点弦 chord 与 d 张成；eU=-d，eT 为弦在平面内垂直于 eU 的分量。
 *
 * @param chord 终点挂点减起点挂点（完整三维向量）
 * @param swingRad 风偏角 atan(gH/gV)
 * @param windDirInput 可选指定水平风向；缺省取横线路方向 cross(up, 水平弦)
 */
export function makeWindPlane(chord: Vec3, swingRad: number, windDirInput?: Vec3): WindPlaneBasis {
  const up: Vec3 = { x: 0, y: 1, z: 0 };
  const horizontal = { x: chord.x, y: 0, z: chord.z };
  const eSpan = normalize(horizontal);
  // 默认横线路风向
  let windDir = windDirInput ? normalize({ x: windDirInput.x, y: 0, z: windDirInput.z }) : cross(up, eSpan);
  // 去掉与档距方向平行的分量，保证风向横线路
  const para = dot(windDir, eSpan);
  windDir = normalize(sub(windDir, scale(eSpan, para)));

  const sinEta = Math.sin(swingRad);
  const cosEta = Math.cos(swingRad);
  // eU 与合成荷载反向
  const eU = normalize(add(scale(up, cosEta), scale(windDir, -sinEta)));

  // eT：弦在平面内、垂直于 eU 的分量
  const proj = dot(chord, eU);
  const eTRaw = sub(chord, scale(eU, proj));
  const eT = normalize(eTRaw);
  const L2d = dot(chord, eT);
  const h2d = proj;
  if (!(L2d > 0)) {
    throw new Error(`风偏平面构造失败：档距投影非正 L2d=${L2d}`);
  }
  return { eT, eU, swingRad, windDir, L2d, h2d };
}

/**
 * 风偏平面内的二维局部点 (xi, eta) 映射到世界坐标。
 * @param anchor 起点挂点世界坐标
 * @param basis 风偏平面基
 * @param xi 距起点的平面内水平坐标（沿 eT，m）
 * @param eta 平面内竖向坐标（沿 eU，m，相对起点的悬链线局部高度）
 */
export function mapToWorld(anchor: Vec3, basis: WindPlaneBasis, xi: number, eta: number): Vec3 {
  return add(add(anchor, scale(basis.eT, xi)), scale(basis.eU, eta));
}
