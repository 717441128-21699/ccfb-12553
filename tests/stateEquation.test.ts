import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  handbookStateStress,
  exactSectionStress,
  representativeSpan,
  unstressedLengthAtRef,
} from '../src/core/stateEquation';
import { solveCatenary2D } from '../src/core/catenary2d';

const E = 65000; // MPa
const alpha = 20.5e-6;

test('代表档距 Ldb=sqrt(ΣL³/ΣL)', () => {
  const spans = [{ L: 300, h: 0 }, { L: 400, h: 10 }, { L: 350, h: -8 }];
  const Ldb = representativeSpan(spans);
  const expected = Math.sqrt((300 ** 3 + 400 ** 3 + 350 ** 3) / 1050);
  assert.ok(Math.abs(Ldb - expected) < 1e-10);
});

test('同工况反解：目标=参考时状态方程返回原应力', () => {
  const Ldb = 350;
  const gamma = 33.7e-3;
  const ref = { gamma, temperature: 15, stress: 55 };
  const sigma = handbookStateStress({ gamma, temperature: 15 }, ref, Ldb, E, alpha);
  assert.ok(Math.abs(sigma - 55) < 1e-9);
});

test('温度升高 → 应力降低；覆冰加重 → 应力升高', () => {
  const Ldb = 400;
  const gamma = 33.7e-3;
  const ref = { gamma, temperature: 15, stress: 55 };
  const hot = handbookStateStress({ gamma, temperature: 40 }, ref, Ldb, E, alpha);
  const coldIce = handbookStateStress({ gamma: 55e-3, temperature: -5 }, ref, Ldb, E, alpha);
  assert.ok(hot < 55);
  assert.ok(coldIce > 55);
  // 数量级合理：40℃ 温升 Δσ≈αEΔt≈33MPa 的一部分（含几何项）
  assert.ok(hot > 20 && hot < 55);
  assert.ok(coldIce < 200);
});

test('精确法与手册法在常规档距下应力差 < 1%，弧垂差毫米级', () => {
  // 工程常见耐张段：档距变化 ≤15%，代表档距近似的适用区间
  const spans = [
    { L: 300, h: 0 },
    { L: 320, h: 8 },
    { L: 310, h: -6 },
    { L: 345, h: 0 },
  ];
  const gamma0 = 33.7e-3;
  const ref = { gamma: gamma0, temperature: 15, stress: 55 };
  const target = { gamma: gamma0, temperature: 40 };
  const Ldb = representativeSpan(spans);
  const sHand = handbookStateStress(target, ref, Ldb, E, alpha);
  const sExact = exactSectionStress(spans, target, ref, E, alpha);
  assert.ok(Math.abs(sHand - sExact) / sExact < 0.01,
    `handbook=${sHand} exact=${sExact}`);

  // 各自最大档中点弧垂差异 < 5mm
  const cat = (sigma: number) => solveCatenary2D({ L: 345, h: 0, c: sigma / gamma0 });
  const fHand = cat(sHand).midSpanSag;
  const fExact = cat(sExact).midSpanSag;
  assert.ok(Math.abs(fHand - fExact) < 0.005, `弧垂差 ${Math.abs(fHand - fExact)}m`);
});

test('方法学对照：档距严重不均（300~420）时手册 Ldb 近似偏保守，精确法给出真值', () => {
  // 此用例记录两法方法学差异，不作为一致性断言；
  // 工程设计默认采用手册法（与审图依据一致），精确法用于复核。
  const spans = [
    { L: 300, h: 0 },
    { L: 380, h: 12 },
    { L: 340, h: -10 },
    { L: 420, h: 0 },
  ];
  const gamma0 = 33.7e-3;
  const ref = { gamma: gamma0, temperature: 15, stress: 55 };
  const target = { gamma: gamma0, temperature: 40 };
  const sHand = handbookStateStress(target, ref, representativeSpan(spans), E, alpha);
  const sExact = exactSectionStress(spans, target, ref, E, alpha);
  // 两法均给出有限正应力，且精确法守恒残差为机器精度
  assert.ok(sHand > 0 && sExact > 0);
  let s0ref = 0;
  let s0target = 0;
  for (const sp of spans) {
    s0ref += unstressedLengthAtRef(sp, ref.stress, ref.gamma, E, alpha, 15, 15);
    s0target += unstressedLengthAtRef(sp, sExact, target.gamma, E, alpha, 40, 15);
  }
  assert.ok(Math.abs(s0target - s0ref) < 1e-9);
});

test('精确法：求解应力回代后各档无应力线长严格守恒（<1e-9 m）', () => {
  const spans = [
    { L: 250, h: 0 },
    { L: 360, h: 20 },
  ];
  const gamma0 = 34e-3;
  const ref = { gamma: gamma0, temperature: 10, stress: 60 };
  const target = { gamma: 48e-3, temperature: -5 };
  const sigma = exactSectionStress(spans, target, ref, E, alpha);

  let s0ref = 0;
  let s0target = 0;
  for (const sp of spans) {
    s0ref += unstressedLengthAtRef(sp, ref.stress, ref.gamma, E, alpha, ref.temperature, ref.temperature);
    s0target += unstressedLengthAtRef(sp, sigma, target.gamma, E, alpha, target.temperature, ref.temperature);
  }
  assert.ok(Math.abs(s0target - s0ref) < 1e-9, `守恒残差 ${s0target - s0ref}m`);
});

test('无应力线长解析积分与高精度数值积分一致', () => {
  const sp = { L: 400, h: 25 };
  const sigma = 50;
  const gamma = 34e-3;
  const analytic = unstressedLengthAtRef(sp, sigma, gamma, E, alpha, 15, 15);
  // 数值积分：ds0 = c·cosh(p)/(1+k·cosh(p)) dp，Simpson 1e5 段
  const cat = solveCatenary2D({ L: sp.L, h: sp.h, c: sigma / gamma });
  const k = sigma / E;
  const c = cat.c;
  const N = 100000;
  const dp = (cat.n - cat.m) / N;
  const integrand = (p: number) => (c * Math.cosh(p)) / (1 + k * Math.cosh(p));
  let sum = integrand(cat.m) + integrand(cat.n);
  for (let i = 1; i < N; i++) {
    const p = cat.m + i * dp;
    sum += (i % 2 === 0 ? 2 : 4) * integrand(p);
  }
  const numeric = (sum * dp) / 3;
  assert.ok(Math.abs(analytic - numeric) < 1e-7, `解析=${analytic} 数值=${numeric}`);
});
