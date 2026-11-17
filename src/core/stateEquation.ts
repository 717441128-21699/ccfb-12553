/**
 * 导线状态方程：由参考（控制）工况应力推求任一工况的水平应力。
 *
 * 提供两套求解器：
 *  1. handbookStateStress —— 手册代表档距法（斜抛物线状态方程），
 *     与《电力工程高压送电线路设计手册》例题同公式，是默认工程算法；
 *  2. exactSectionStress —— 悬链线精确解 + 无应力线长守恒（逐档积分），
 *     用于与手册法交叉验证，量化抛物线近似的毫米级偏差。
 */

import { solveCatenary2D } from './catenary2d';
import { brentRoot } from './roots';

export interface SpanGeom {
  /** 水平档距 L (m) */
  L: number;
  /** 挂点高差 h (m) */
  h: number;
}

export interface StateCaseParams {
  /** 合成比载 γ (MPa/m) */
  gamma: number;
  /** 气温 (℃) */
  temperature: number;
}

export interface ReferenceParams extends StateCaseParams {
  /** 参考工况水平应力 σ0 (MPa) */
  stress: number;
}

/** 代表档距（等效档距）Ldb = sqrt(ΣL³/ΣL) */
export function representativeSpan(spans: SpanGeom[]): number {
  let sumL = 0;
  let sumL3 = 0;
  for (const s of spans) {
    sumL += s.L;
    sumL3 += s.L ** 3;
  }
  return Math.sqrt(sumL3 / sumL);
}

/**
 * 手册状态方程（代表档距法，斜抛物线形式）：
 *
 *   σ - γ²·Ldb²·E/(24·σ²) + α·E·(t - t0)
 *     = σ0 - γ0²·Ldb²·E/(24·σ0²)
 *
 * 移项为求根形式（f 单调增，f'=1+2K/σ³>0）：
 *   f(σ) = σ - K/σ² - [σ0 - K0/σ0² - α·E·(t-t0)] = 0
 */
export function handbookStateStress(
  target: StateCaseParams,
  ref: ReferenceParams,
  Ldb: number,
  E: number,
  alpha: number,
): number {
  const K = (target.gamma * target.gamma * Ldb * Ldb * E) / 24;
  const K0 = (ref.gamma * ref.gamma * Ldb * Ldb * E) / 24;
  const rhs = ref.stress - K0 / (ref.stress * ref.stress) - alpha * E * (target.temperature - ref.temperature);

  const f = (sigma: number): number => sigma - K / (sigma * sigma) - rhs;
  // f 单调增；构造异号区间 f(lo)<0<f(hi)
  let lo = 1e-6;
  let hi = Math.max(ref.stress * 4, 100);
  let flo = f(lo);
  let fhi = f(hi);
  let guard = 0;
  while ((!Number.isFinite(flo) || flo >= 0) && guard++ < 80) {
    lo *= 0.5;
    flo = f(lo);
  }
  guard = 0;
  while ((!Number.isFinite(fhi) || fhi <= 0) && guard++ < 80) {
    hi *= 2;
    fhi = f(hi);
  }
  const res = brentRoot(f, lo, hi, { fa: flo, fb: fhi, tol: 1e-13 });
  if (!res.converged) throw new Error('状态方程（手册法）应力求解未收敛');
  return res.root;
}

/**
 * 单档在给定应力下、折算到参考温度的无应力线长（悬链线精确 + 弹性解析积分）。
 *
 * 悬链线参数 p∈[m,n]，ds = c·cosh(p)dp；该点张力 T=σ·cosh(p)，
 * 弹性伸长后 ds = ds0·(1+T/E)，故
 *   ds0 = c·cosh(p)/(1+k·cosh(p)) dp，  k=σ/E
 * 解析原函数（k<1，实际 k≈1e-3）：
 *   F(p) = c/k·[ p - 2/((1+k)·q)·artanh(q·tanh(p/2)) ]，  q=sqrt((1-k)/(1+k))
 * 再按线膨胀折算到参考温度：L0_ref = L0_case / (1+α·(t-t0))
 */
export function unstressedLengthAtRef(
  span: SpanGeom,
  sigma: number,
  gamma: number,
  E: number,
  alpha: number,
  tCase: number,
  tRef: number,
): number {
  const cat = solveCatenary2D({ L: span.L, h: span.h, c: sigma / gamma });
  const k = sigma / E;
  const q = Math.sqrt((1 - k) / (1 + k));
  const c = cat.c;

  const primitive = (p: number): number => {
    const th = Math.tanh(p / 2);
    return (c / k) * (p - (2 / ((1 + k) * q)) * Math.atanh(q * th));
  };

  const l0case = primitive(cat.n) - primitive(cat.m);
  return l0case / (1 + alpha * (tCase - tRef));
}

/**
 * 精确法：耐张段内各档无应力线长守恒，求目标工况水平应力。
 * 应力增大 → 弹性伸长增大 → 折算无应力线长减小，故 g(σ) 单调减，求异号根。
 */
export function exactSectionStress(
  spans: SpanGeom[],
  target: StateCaseParams,
  ref: ReferenceParams,
  E: number,
  alpha: number,
): number {
  let s0Total = 0;
  for (const sp of spans) {
    s0Total += unstressedLengthAtRef(sp, ref.stress, ref.gamma, E, alpha, ref.temperature, ref.temperature);
  }

  const g = (sigma: number): number => {
    let sum = 0;
    for (const sp of spans) {
      sum += unstressedLengthAtRef(sp, sigma, target.gamma, E, alpha, target.temperature, ref.temperature);
    }
    return sum - s0Total;
  };

  let lo = 1e-4;
  let hi = Math.max(ref.stress * 4, 200);
  let glo = g(lo);
  let ghi = g(hi);
  let guard = 0;
  // g 单调减：lo 处应为正，hi 处应为负；传给 Brent 时取负号
  while ((!Number.isFinite(glo) || glo <= 0) && guard++ < 80) {
    lo *= 0.5;
    glo = g(lo);
  }
  guard = 0;
  while ((!Number.isFinite(ghi) || ghi >= 0) && guard++ < 80) {
    hi *= 2;
    ghi = g(hi);
  }
  const neg = (x: number): number => -g(x);
  const res = brentRoot(neg, lo, hi, { fa: -glo, fb: -ghi, tol: 1e-13 });
  if (!res.converged) throw new Error('状态方程（精确法）应力求解未收敛');
  return res.root;
}
