import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveCatenary2D, supportTension, parabolicMidSag } from '../src/core/catenary2d';

const EPS = 1e-9;

test('等高档：曲线精确穿过两挂点且关于中点对称', () => {
  const L = 400;
  const h = 0;
  const c = 1500;
  const cat = solveCatenary2D({ L, h, c });
  const a = cat.pointAt(0);
  const b = cat.pointAt(L);
  assert.ok(Math.abs(a.eta) < EPS);
  assert.ok(Math.abs(b.eta) < EPS);
  assert.ok(Math.abs(a.s) < EPS);
  assert.ok(Math.abs(cat.m + cat.n) < EPS); // m=-n
  // 中点最大下垂
  const mid = cat.pointAt(L / 2);
  assert.ok(mid.eta < 0);
  assert.ok(Math.abs(cat.midSpanSag - (-mid.eta)) < 1e-12);
  assert.ok(Math.abs(cat.maxSag - cat.midSpanSag) < 1e-12);
  assert.ok(Math.abs(cat.maxSagX - L / 2) < 1e-9);
});

test('等高档弧垂与闭式公式 c(cosh(L/2c)-1) 一致', () => {
  const L = 300;
  const c = 1200;
  const cat = solveCatenary2D({ L, h: 0, c });
  const expected = c * (Math.cosh(L / (2 * c)) - 1);
  assert.ok(Math.abs(cat.midSpanSag - expected) < 1e-10);
});

test('悬链线满足微分方程 d²η/dξ² = (1/c)·cosh（数值二阶差分）', () => {
  const L = 500;
  const h = 35;
  const c = 900;
  const cat = solveCatenary2D({ L, h, c });
  const dx = 2.5;
  let maxErr = 0;
  for (let x = dx; x < L - dx; x += dx) {
    const y0 = cat.pointAt(x - dx).eta;
    const y1 = cat.pointAt(x).eta;
    const y2 = cat.pointAt(x + dx).eta;
    const d2 = (y2 - 2 * y1 + y0) / (dx * dx);
    // η = c·cosh(m+x/c) - const → d²η/dξ² = (1/c)·cosh(m+x/c)
    const exact = Math.cosh(cat.m + x / c) / c;
    maxErr = Math.max(maxErr, Math.abs(d2 - exact));
  }
  assert.ok(maxErr < 1e-8, `二阶差分最大误差 ${maxErr}`);
});

test('任意点斜率满足 dη/dξ = sinh(m+x/c)，弧长积分自洽', () => {
  const L = 250;
  const h = -28;
  const c = 700;
  const cat = solveCatenary2D({ L, h, c });
  const dx = 0.5;
  let arcLen = 0;
  for (let x = dx; x <= L; x += dx) {
    const p = cat.pointAt(x);
    assert.ok(Math.abs(p.slope - Math.sinh(cat.m + x / c)) < 1e-12);
    const prev = cat.pointAt(x - dx);
    arcLen += Math.hypot(p.xi - prev.xi, p.eta - prev.eta);
  }
  // 数值积分弧长与解析弧长一致（0.5m 步长，梯形误差量级 1e-7）
  assert.ok(Math.abs(arcLen - cat.length) < 1e-5);
});

test('高差档：端点高程差严格等于 h，弧垂为挂点连线到导线的竖直差', () => {
  const L = 350;
  const h = 42;
  const c = 1100;
  const cat = solveCatenary2D({ L, h, c });
  const b = cat.pointAt(L);
  assert.ok(Math.abs(b.eta - h) < 1e-9);
  // 逐点连线差非负（悬链线下垂于弦之下）
  let minSag = Infinity;
  for (let x = 0; x <= L; x += 5) {
    const p = cat.pointAt(x);
    const line = (h / L) * x;
    minSag = Math.min(minSag, line - p.eta);
  }
  assert.ok(minSag >= -1e-10);
  assert.ok(cat.maxSag > 0);
  assert.ok(cat.maxSagX > 0 && cat.maxSagX < L);
});

test('挂点张力 T=H·cosh(param)，高档挂点张力大于低档', () => {
  const L = 300;
  const h = 30;
  const c = 1000;
  const H = 25000;
  const cat = solveCatenary2D({ L, h, c });
  const tA = supportTension(H, cat.m);
  const tB = supportTension(H, cat.n);
  assert.ok(tB > tA);
  assert.ok(tA > H);
});

test('极限工况不发散：浅悬链（c 很大）弧垂趋抛物线近似，深悬链（c 小）可解', () => {
  // 浅悬链与抛物线公式的差异为抛物线近似固有量级（弧垂率 ~3.3% 时约 0.15%）
  const L = 400;
  const w = 18; // N/m
  const H = 27000; // N
  const A = 333.31; // mm²
  const sigma = H / A; // MPa
  const gamma = w / A; // MPa/m
  const cat = solveCatenary2D({ L, h: 0, c: sigma / gamma });
  const para = parabolicMidSag(L, 0, w, H);
  assert.ok(Math.abs(cat.midSpanSag - para) / para < 0.002);

  const deep = solveCatenary2D({ L: 100, h: 5, c: 50 });
  assert.ok(deep.length > 100);
  assert.ok(Number.isFinite(deep.midSpanSag));
});

test('非法输入抛错：非正档距、|h|>=L', () => {
  assert.throws(() => solveCatenary2D({ L: 0, h: 0, c: 100 }));
  assert.throws(() => solveCatenary2D({ L: 100, h: 100, c: 100 }));
  assert.throws(() => solveCatenary2D({ L: 100, h: NaN, c: 100 }));
});
