/**
 * 二维悬链线精确解算器（双精度）
 *
 * 坐标系（2D 平面内）：
 *   ξ —— 水平轴（沿档距方向）
 *   η —— 竖直轴，向上为正；重力沿 -η
 *
 * 悬链线标准方程（最低点 ξ=0 处 η=c）：
 *   η(ξ) = c·cosh(ξ/c)，  c = H / w
 * 其中 H 为水平张力 (N)，w 为沿弧长均布的单位长度自重 (N/m)。
 *
 * 两挂点 A(ξA, ηA)、B(ξB, ηB)，水平档距 L=ξB-ξA>0，高差 h=ηB-ηA。
 * 本模块不使用抛物线近似，所有弧垂/线长均由双曲函数精确给出，
 * 与《电力工程高压送电线路设计手册》的悬链线公式逐项对应，
 * 目标精度：相对手册例题 ≤ 1 cm（内部回归测试阈值 1e-6 m）。
 */

export interface Catenary2DInput {
  /** 水平档距 L (m)，> 0 */
  L: number;
  /** 挂点高差 h = ηB-ηA (m)，可正可负可为 0 */
  h: number;
  /** 悬链线常数 c = H/w (m)，> 0 */
  c: number;
}

export interface Catenary2DResult {
  /** 最低点相对 A 点的水平坐标 ξA（负值表示最低点在 A 左侧，即档外） */
  xLow: number;
  /** 最低点相对 A 点的竖向坐标 ηA-η(ξA)（即 A 相对最低点的高度，m） */
  yLow: number;
  /** A 点方程参数 m = ξA/c */
  m: number;
  /** B 点方程参数 n = ξB/c = m + L/c */
  n: number;
  c: number;
  L: number;
  h: number;
  /** 中点弧垂（挂点连线中点到导线的竖直距离，m），恒正 */
  midSpanSag: number;
  /** 最大弧垂（m） */
  maxSag: number;
  /** 最大弧垂位置距 A 的水平距离 (m) */
  maxSagX: number;
  /** 悬链线弧长（两挂点间，m） */
  length: number;
  /** A 点处导线张力 (N)，需外部乘回 w 时用 T=w·(c+y)，这里给量纲一的 y/c 形式见 tensionAt */
  /** 取点函数：给定距 A 的水平距离 x∈[0,L]，返回 {xi, eta, s, slope}（相对 A 的局部坐标） */
  pointAt: (x: number) => { xi: number; eta: number; s: number; slope: number };
}

const MIN_C = 1e-6;

/**
 * 由 L、h、c 解算悬链线几何。
 *
 * 两挂点参数 m、n（n=m+2u, u=L/(2c)）满足：
 *   sinh(n) - sinh(m) = L/c = 2u
 *   cosh(n) - cosh(m) = h/c
 * 两式相除得 tanh((n+m)/2) = h/L，但仅凭该式反解 m 的代数闭式不存在
 * （双曲函数非线性），故以 m0=artanh(h/L)-u 为初值，对
 *   F(m)=sinh(m+2u)-sinh(m)-2u=0
 * 做 Newton 迭代：F'(m)=cosh(m+2u)-cosh(m)。
 * 等高档 h=0 时 m=-u 即精确解，零次迭代退出。
 */
export function solveCatenary2D(input: Catenary2DInput): Catenary2DResult {
  const L = input.L;
  const h = input.h;
  const c = Math.max(input.c, MIN_C);
  if (!(L > 0)) throw new Error(`悬链线解算：水平档距必须为正，收到 L=${L}`);
  if (!Number.isFinite(L) || !Number.isFinite(h) || !Number.isFinite(c)) {
    throw new Error('悬链线解算：输入含非有限数值');
  }
  if (Math.abs(h) >= L) {
    throw new Error(`悬链线解算：挂点高差绝对值 ${Math.abs(h)} 不小于档距 ${L}，几何无解`);
  }

  const u = L / (2 * c);
  // 两挂点参数满足 n-m=2u，且
  //   sinh(n)-sinh(m)=2u  （恒等式，由 n-m=2u 与悬链线弧长关系自动满足）
  //   cosh(n)-cosh(m)=h/c  ← 真正待解的高差方程
  // 令 m 为未知量，G(m)=cosh(m+2u)-cosh(m)-h/c=0，G 单调增，唯一根。
  // 解析解：cosh(n)-cosh(m)=2·sinh(mid)·sinh(u)=h/c
  //   → sinh(mid) = h/(2c·sinh(u))，mid=(m+n)/2
  const mid = Math.asinh(h / (2 * c * Math.sinh(u)));
  const m = mid - u;
  const n = mid + u;

  // 最低点相对 A 的局部坐标：最低点 ξ=0，A 点 ξ=ξA=m·c
  const xLow = -m * c;
  // A 相对最低点的高度：ηA - c = c(cosh m - 1)
  const yLow = c * (Math.cosh(m) - 1);

  // 中点弧垂（手册"弧垂 f"定义，挂点连线中点处的竖直垂度）：
  //   弦中点高程 η_line(L/2) = c·sinh(mid)·sinh(u)
  //   导线中点 η_wire(L/2)  = c·cosh(mid)·cosh(u)
  // 恒等式化简：f = c·(cosh(u)-1)·cosh(u-mid)/cosh(u)
  // 等高档 mid=0 退化为 f = c·(cosh(u)-1)，与悬链线闭式一致。
  const coshU = Math.cosh(u);
  const midSpanSag = c * (coshU - 1) * (Math.cosh(u - mid) / coshU);
  if (midSpanSag < -1e-9) {
    throw new Error(`悬链线解算内部错误：中点弧垂为负 ${midSpanSag}`);
  }

  // 最大弧垂：导线上斜率等于挂点连线斜率 h/L 的点处，连线与导线竖直差最大。
  // sinh(ξ/c) = h/L  →  ξ* = c·asinh(h/L)（全局坐标，最低点 ξ=0）
  // 距 A 的水平距离 x* = ξ* - ξA = c·asinh(h/L) - m·c
  const xiStar = c * Math.asinh(h / L);
  let maxSagX = xiStar - m * c;
  // 极值点落在档外时（大高差档），最大值出现在较低挂点处，弧垂退化为 0 量级
  if (maxSagX < 0) maxSagX = 0;
  else if (maxSagX > L) maxSagX = L;

  // 通用竖直差 D(x) = 连线高程 - 导线高程（局部坐标，A 为原点）：
  // 连线: η_line(x) = (h/L)x；导线: η_wire(x) = c·cosh(m + x/c) - c·cosh(m)
  const sagAt = (x: number): number => {
    const wire = c * Math.cosh(m + x / c) - c * Math.cosh(m);
    const line = (h / L) * x;
    return line - wire;
  };
  const maxSag = Math.max(0, sagAt(maxSagX));

  // 弧长：s = c·(sinh n - sinh m)
  const length = c * (Math.sinh(n) - Math.sinh(m));

  const pointAt = (x: number) => {
    if (x < 0 || x > L) throw new Error(`悬链线取点：x=${x} 超出档距 [0,${L}]`);
    const xi = x; // 局部水平坐标即距 A 的水平距离
    const eta = c * Math.cosh(m + x / c) - c * Math.cosh(m); // 局部竖向坐标，A 为原点
    // 自 A 起的弧长：c·(sinh(m+x/c) - sinh m)
    const s = c * (Math.sinh(m + x / c) - Math.sinh(m));
    const slope = Math.sinh(m + x / c); // dη/dξ
    return { xi, eta, s, slope };
  };

  return {
    xLow,
    yLow,
    m,
    n,
    c,
    L,
    h,
    midSpanSag: Math.max(0, midSpanSag),
    maxSag,
    maxSagX,
    length,
    pointAt,
  };
}

/**
 * 挂点处导线张力 T = H·cosh(param) = w·c·cosh(param)。
 * 入参 param 为该挂点的 m（A）或 n（B）。
 */
export function supportTension(H: number, param: number): number {
  return H * Math.cosh(param);
}

/**
 * 斜抛物线近似（手册简化公式），仅用于对照与测试：
 * 中点弧垂 f = γL²/(8σ)·(1/cosβ)，β=atan(h/L)
 * @param w 单位长度荷载 (N/m)
 * @param H 水平张力 (N)
 */
export function parabolicMidSag(L: number, h: number, w: number, H: number): number {
  const beta = Math.atan2(h, L);
  return (w * L * L) / (8 * H * Math.cos(beta));
}

/** 平抛物线近似线长（手册公式）：L + h²/(2L) + γ²L³/(24σ²) */
export function parabolicLength(L: number, h: number, w: number, H: number): number {
  return L + (h * h) / (2 * L) + (w * w * L ** 3) / (24 * H * H);
}
