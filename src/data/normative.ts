// 标准步态曲线常模（矢状面髋/膝/踝角度，按步态周期 0~100%）。
// 数据形态参照 Winter《Biomechanics and Motor Control of Human Movement》
// 经典健康成人曲线的代表性数值，角度单位度，已按本系统约定（屈曲为正）。

export type JointKey = 'hip' | 'knee' | 'ankle';

// 11 个控制点（每 10% 一个），查询时线性插值
const NORM_POINTS = 11;

function makeCurve(values: number[]): Float32Array {
  if (values.length !== NORM_POINTS) throw new Error('常模曲线需要 11 个控制点');
  return Float32Array.from(values);
}

/** 健康成人常模：左/右共用（健康人双侧近似对称） */
export const NORMATIVE_CURVES: Record<JointKey, Float32Array> = {
  // 髋屈曲：HS 时约 25° 屈 -> 支撑相伸直约 -10°（过伸）-> 摆动相再屈到 25°
  hip: makeCurve([25, 22, 15, 5, -5, -10, -8, 0, 12, 20, 25]),
  // 膝屈曲：HS 接近 0 -> 负荷反应期屈到 ~20° -> 支撑相伸直 -> 摆动相屈到 60°
  knee: makeCurve([0, 15, 20, 12, 5, 2, 5, 20, 45, 60, 30]),
  // 踝背屈：HS 约 0 -> 跖屈（负值）-> 支撑相背屈 10° -> 蹬离跖屈 -15° -> 摆动回 0
  ankle: makeCurve([0, -5, -8, -3, 5, 10, 8, -5, -15, -8, 0]),
};

/** 在任意周期百分比 pct(0..100) 查常模值 */
export function normativeAt(key: JointKey, pct: number): number {
  const curve = NORMATIVE_CURVES[key];
  const x = Math.max(0, Math.min(100, pct)) / 10;
  const i = Math.min(9, Math.floor(x));
  const a = x - i;
  return curve[i] * (1 - a) + curve[i + 1] * a;
}

/**
 * 把一条按帧的角度曲线，按给定步态周期重采样到固定 101 个点（0..100%）。
 */
export function resampleCycle(
  values: ArrayLike<number>,
  startFrame: number,
  endFrame: number,
): Float32Array {
  const out = new Float32Array(101);
  const span = Math.max(1, endFrame - startFrame);
  for (let p = 0; p <= 100; p++) {
    const f = startFrame + (p / 100) * span;
    const i0 = Math.floor(f);
    const i1 = Math.min(endFrame, i0 + 1);
    const a = f - i0;
    const v0 = values[Math.max(0, Math.min(values.length - 1, i0))];
    const v1 = values[Math.max(0, Math.min(values.length - 1, i1))];
    out[p] = v0 * (1 - a) + v1 * a;
  }
  return out;
}

export interface DeviationCell {
  pct: number;          // 周期百分比
  measured: number;
  normative: number;
  deviation: number;    // measured - normative（度，带符号）
  absDev: number;
}

/** 单关节单周期相对常模的逐百分比偏差 */
export function cycleDeviation(
  key: JointKey,
  cycleCurve: Float32Array,
): DeviationCell[] {
  const cells: DeviationCell[] = [];
  for (let p = 0; p <= 100; p++) {
    const measured = cycleCurve[p];
    const normative = normativeAt(key, p);
    const deviation = measured - normative;
    cells.push({ pct: p, measured, normative, deviation, absDev: Math.abs(deviation) });
  }
  return cells;
}

/** 多个周期的偏差平均（按关节、按百分比），让热力条反映整体水平 */
export function averageCycles(curves: Float32Array[]): Float32Array {
  const out = new Float32Array(101);
  if (!curves.length) return out;
  for (const c of curves) for (let p = 0; p <= 100; p++) out[p] += c[p];
  for (let p = 0; p <= 100; p++) out[p] /= curves.length;
  return out;
}

/** 热力条配色：偏差 0° 绿，随 |偏差| 增大过渡到黄、红（>=15°） */
export function deviationColor(absDev: number): string {
  const t = Math.min(1, absDev / 15);
  // HSL: 120(绿) -> 50(黄) -> 0(红)
  const hue = 120 * (1 - t);
  return `hsl(${hue.toFixed(0)}, 80%, 45%)`;
}
