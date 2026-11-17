import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLoads, windPressureKPa, G } from '../src/core/loads';
import type { ConductorType, WeatherCase } from '../src/core/types';

const lgjk300: ConductorType = {
  id: 'LGJK-300',
  name: 'LGJK-300 扩径导线',
  area: 300,
  diameter: 27.63,
  massPerLength: 1.029, // kg/m
  elasticModulus: 65000,
  expansionCoeff: 20.5e-6,
  ratedTensileStrength: 90000,
  bundleN: 1,
};

test('风压 W0=v²/1600 kPa 与手册取值一致', () => {
  assert.ok(Math.abs(windPressureKPa(27) - 27 * 27 / 1600) < 1e-15);
  assert.ok(Math.abs(windPressureKPa(10) - 0.0625) < 1e-15);
});

test('自重比载 g1/A 与手册 g1=9.80665·q 一致', () => {
  const loads = computeLoads(lgjk300, { id: 't', name: 't', temperature: 15, ice: 0, windSpeed: 0 });
  const g1 = G * 1.029;
  assert.ok(Math.abs(loads.selfWeight - g1) < 1e-10);
  assert.ok(Math.abs(loads.gammaV - g1 / 300) < 1e-12);
  assert.ok(loads.iceWeight === 0);
  assert.ok(loads.horizontal === 0);
  assert.ok(loads.swingAngleRad === 0);
});

test('覆冰荷载 g2=π·b·(d+b)·ρ·G·1e-6，受风直径取 d+2b', () => {
  const b = 10;
  const loads = computeLoads(lgjk300, { id: 't', name: 't', temperature: -5, ice: b, windSpeed: 0 });
  const expected = Math.PI * b * (lgjk300.diameter + b) * 900 * G * 1e-6;
  assert.ok(Math.abs(loads.iceWeight - expected) < 1e-10);
  assert.ok(loads.windDiameter === lgjk300.diameter + 2 * b);
  assert.ok(Math.abs(loads.vertical - (loads.selfWeight + expected)) < 1e-12);
});

test('风荷载 gH=W0·d·μ·α，覆冰用 μ=1.2、无冰 μ=1.1', () => {
  const v = 27;
  const bare = computeLoads(lgjk300, { id: 'a', name: 'a', temperature: 15, ice: 0, windSpeed: v });
  const W0 = windPressureKPa(v);
  assert.ok(Math.abs(bare.horizontal - W0 * lgjk300.diameter * 1.1) < 1e-10);

  const iced = computeLoads(lgjk300, { id: 'b', name: 'b', temperature: -5, ice: 10, windSpeed: v });
  assert.ok(Math.abs(iced.horizontal - W0 * (lgjk300.diameter + 20) * 1.2) < 1e-10);
});

test('风偏角 η=atan(gH/gV)，合成荷载模长正确', () => {
  const loads = computeLoads(lgjk300, { id: 'a', name: 'a', temperature: 15, ice: 0, windSpeed: 27 });
  assert.ok(Math.abs(loads.swingAngleRad - Math.atan2(loads.horizontal, loads.vertical)) < 1e-15);
  assert.ok(Math.abs(loads.resultant - Math.hypot(loads.vertical, loads.horizontal)) < 1e-10);
  assert.ok(loads.swingAngleRad > 0 && loads.swingAngleRad < Math.PI / 2);
});

test('分裂导线：单根比载不变（整相张力由 bundleN 倍面积承担）', () => {
  const twin: ConductorType = { ...lgjk300, bundleN: 2 };
  const wc: WeatherCase = { id: 'a', name: 'a', temperature: 15, ice: 5, windSpeed: 20 };
  const l1 = computeLoads(lgjk300, wc);
  const l2 = computeLoads(twin, wc);
  assert.ok(Math.abs(l1.gamma - l2.gamma) < 1e-15);
  assert.ok(Math.abs(l1.gammaV - l2.gammaV) < 1e-15);
});
