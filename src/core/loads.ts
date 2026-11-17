/**
 * 导线荷载计算（GB 50545 / 设计手册体系）
 *
 * 比载 γ (N/(m·mm²)) 与单位长度荷载 w (N/m)：
 *   自重      g1 = 9.80665·q
 *   覆冰重    g2 = 9.80665·ρ·π·b·(d+b)·1e-6
 *   垂直总载  gV = g1 + g2
 *   风荷载    gH = α·W0·d_proj·μsc，其中 W0 = v²/1600 (kPa)
 * 手册常用风压简化：标准空气密度下 W0 = v²/1600 kPa（v 单位 m/s）。
 *
 * 覆冰时风载体型系数 μsc 取 1.2（覆冰线），无冰取 1.1（绞线）；
 * 风压不均匀系数 α 按设计风速取（近地面 1.0 附近，可外部覆盖）。
 *
 * 风偏处理：风沿水平面横向吹，导线在"风偏平面"内仍为一条悬链线，
 * 该平面由竖直方向与合成荷载方向张成，平面内有效均布荷载 w = sqrt(gV²+gH²)，
 * 风偏角 η = atan(gH/gV)。三维坐标再由该平面映射回世界坐标。
 */

import type { ConductorType, WeatherCase } from './types';

export const G = 9.80665;
/** 标准空气密度下 v(m/s) → 风压(kPa)：W0 = v²/1600 */
export function windPressureKPa(v: number): number {
  return (v * v) / 1600;
}

export interface LoadComponents {
  /** 单根子导线自重 (N/m) */
  selfWeight: number;
  /** 覆冰重 (N/m) */
  iceWeight: number;
  /** 竖直荷载合计 (N/m) */
  vertical: number;
  /** 水平风荷载 (N/m) */
  horizontal: number;
  /** 风偏平面内合成荷载 (N/m) */
  resultant: number;
  /** 风偏角（弧度），atan(horizontal/vertical)，无风为 0 */
  swingAngleRad: number;
  /** 竖直比载 γv (MPa/m = N/(m·mm²))，按总截面积 */
  gammaV: number;
  /** 水平比载 γh */
  gammaH: number;
  /** 合成比载 γ */
  gamma: number;
  /** 计算风荷载时实际采用的受风直径 (mm) */
  windDiameter: number;
}

export interface LoadOptions {
  /** 风压不均匀系数 α，缺省 1.0 */
  alpha?: number;
  /** 无冰体型系数，缺省 1.1 */
  muBare?: number;
  /** 覆冰体型系数，缺省 1.2 */
  muIced?: number;
}

/**
 * 计算单根子导线在指定工况下的荷载分量。
 * 分裂导线的整相荷载 = 单根 × bundleN，截面积同理，比载不变，
 * 因此解算统一在比载/单根层面进行，张力按总截面换算。
 */
export function computeLoads(conductor: ConductorType, wc: WeatherCase, opts: LoadOptions = {}): LoadComponents {
  const alpha = opts.alpha ?? 1.0;
  const muBare = opts.muBare ?? 1.1;
  const muIced = opts.muIced ?? 1.2;
  const rhoIce = wc.iceDensity ?? 900;

  const d = conductor.diameter;
  const b = Math.max(0, wc.ice);
  const A = conductor.area;

  const selfWeight = G * conductor.massPerLength;
  // 覆冰圆环截面积 π·b·(d+b)，mm²；ρ kg/m³ → N/m 系数 1e-9·G·1e6 = G·1e-3
  // 推导：面积 mm² × 1e-6 = m²，×ρ = kg/m，×G = N/m → πb(d+b)·ρ·G·1e-6
  const iceWeight = b > 0 ? Math.PI * b * (d + b) * rhoIce * G * 1e-6 : 0;
  const vertical = selfWeight + iceWeight;

  // 受风直径：无冰 d；有冰 d+2b
  const windDiameter = b > 0 ? d + 2 * b : d;
  const mu = b > 0 ? muIced : muBare;
  const W0 = windPressureKPa(Math.max(0, wc.windSpeed)); // kPa = kN/m²
  // W0(kPa) × 直径(mm)：kN/m = kPa·m，直径 mm×1e-3 →
  // gH(N/m) = W0 × (diam·1e-3) × μ × α × 1000 = W0·diam·μ·α
  const horizontal = W0 * windDiameter * mu * alpha;

  const resultant = Math.hypot(vertical, horizontal);
  const swingAngleRad = horizontal > 0 ? Math.atan2(horizontal, vertical) : 0;

  const gammaV = vertical / A;
  const gammaH = horizontal / A;
  const gamma = resultant / A;

  return {
    selfWeight,
    iceWeight,
    vertical,
    horizontal,
    resultant,
    swingAngleRad,
    gammaV,
    gammaH,
    gamma,
    windDiameter,
  };
}
