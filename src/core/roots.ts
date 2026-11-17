/**
 * 标量方程求根：Brent 方法（双精度，收敛可靠）
 * 用于导线状态方程的应力求解与精确线长守恒求解。
 */

export interface RootResult {
  root: number;
  iterations: number;
  evaluations: number;
  converged: boolean;
}

/**
 * Brent 求根，要求 f(a) < 0 < f(b)（调用方负责保证异号与方向）。
 * @param fa 可预先传入的 f(a)，避免重复求值
 * @param fb 可预先传入的 f(b)
 */
export function brentRoot(
  f: (x: number) => number,
  a: number,
  b: number,
  opts: { tol?: number; maxIter?: number; fa?: number; fb?: number } = {},
): RootResult {
  const tol = opts.tol ?? 1e-12;
  const maxIter = opts.maxIter ?? 200;
  let evaluations = 0;
  const evalF = (x: number) => {
    evaluations++;
    return f(x);
  };

  let fa = opts.fa ?? evalF(a);
  let fb = opts.fb ?? evalF(b);
  if (!(fa < 0 && fb > 0) || !Number.isFinite(fa) || !Number.isFinite(fb)) {
    throw new Error(`Brent 求根：要求 f(a)<0<f(b)，收到 f(${a})=${fa}, f(${b})=${fb}`);
  }

  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;
  let iterations = 0;
  let converged = false;

  while (iterations++ < maxIter) {
    if (fb * fc > 0) {
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }
    const tol1 = 2 * Number.EPSILON * Math.abs(b) + 0.5 * tol;
    const xm = 0.5 * (c - b);
    if (Math.abs(xm) <= tol1 || fb === 0) {
      converged = true;
      break;
    }
    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p: number;
      let q: number;
      if (a === c) {
        p = 2 * xm * s;
        q = 1 - s;
      } else {
        q = fa / fc;
        const r = fb / fc;
        p = s * (2 * xm * q * (q - r) - (b - a) * (r - 1));
        q = (q - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      p = Math.abs(p);
      if (2 * p < Math.min(3 * xm * q - Math.abs(tol1 * q), Math.abs(e * q))) {
        e = d;
        d = p / q;
      } else {
        d = xm;
        e = d;
      }
    } else {
      d = xm;
      e = d;
    }
    a = b;
    fa = fb;
    if (Math.abs(d) > tol1) b += d;
    else b += xm >= 0 ? tol1 : -tol1;
    fb = evalF(b);
  }

  return { root: b, iterations, evaluations, converged };
}

/**
 * 对单调增函数自动扩展区间求根（f 随 x 单调增时使用）。
 * 状态方程 f'(σ)=1+2K/σ³ > 0，满足条件。
 */
export function rootMonotoneIncreasing(
  f: (x: number) => number,
  xStart: number,
  opts: { tol?: number; maxIter?: number } = {},
): RootResult {
  let lo = Math.max(xStart * 1e-6, 1e-9);
  let hi = Math.max(xStart, 1);
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
  return brentRoot(f, lo, hi, { ...opts, fa: flo, fb: fhi });
}
