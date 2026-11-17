// 端到端验证：用已知关节角度的合成 BVH 检验整条解算管线。
// 验收标准：重新标零后，解算角度与输入真值最大偏差 <= 1°。
// 运行：npm run validate
import { parseBvh } from '../bvh/parser';
import { evaluateAll } from '../bvh/skeleton';
import { computeAngleSeries, mapJoints } from '../bvh/angles';
import { detectEvents, detectCycles, analyzeGait } from '../bvh/gait';
import { generateSyntheticBvh, type SynthResult } from './synthBvh';
import type { JointAngles } from '../core/types';

interface CaseResult {
  name: string;
  maxAbs: Record<string, number>;
  meanAbs: Record<string, number>;
  pass: boolean;
  count: number;
}

const TOL = 1.0; // 验收阈值（度）

function compare(synth: SynthResult, computed: JointAngles[], startFrame: number) {
  const keys: [keyof JointAngles, keyof SynthResult['truth'][number]][] = [
    ['hipFlexL', 'hipFlexL'], ['hipFlexR', 'hipFlexR'],
    ['kneeFlexL', 'kneeFlexL'], ['kneeFlexR', 'kneeFlexR'],
    ['ankleDorsiL', 'ankleDorsiL'], ['ankleDorsiR', 'ankleDorsiR'],
  ];
  const maxAbs: Record<string, number> = {};
  const sumAbs: Record<string, number> = {};
  let count = 0;
  for (const [ck] of keys) {
    maxAbs[ck] = 0;
    sumAbs[ck] = 0;
  }
  for (let f = startFrame; f < synth.truth.length; f++) {
    count++;
    for (const [ck, tk] of keys) {
      const diff = Math.abs(computed[f][ck] - synth.truth[f][tk]);
      maxAbs[ck] = Math.max(maxAbs[ck], diff);
      sumAbs[ck] += diff;
    }
  }
  const meanAbs: Record<string, number> = {};
  for (const k of Object.keys(sumAbs)) meanAbs[k] = sumAbs[k] / count;
  const pass = Object.values(maxAbs).every((v) => v <= TOL);
  return { maxAbs, meanAbs, pass, count };
}

function runCase(name: string, synth: SynthResult, birthYear = 1980): CaseResult & { extra?: string } {
  const bvh = parseBvh(synth.bvh, 'synthetic.bvh');
  const poses = evaluateAll(bvh);
  const series = computeAngleSeries(bvh, poses);
  const map = mapJoints(bvh);

  if (series.referenceFrame >= Math.round(0.5 / synth.frameTime)) {
    throw new Error(`${name}: 静止参考帧检测错误，得到第 ${series.referenceFrame} 帧`);
  }

  // 从行走开始后比较（跳过静止段与起步过渡 10 帧）
  const start = Math.round(0.5 / synth.frameTime) + 10;
  const cmp = compare(synth, series.frames, start);

  // 步态事件与周期健全性
  const events = detectEvents(bvh, poses);
  const cycles = detectCycles(bvh, events);
  const analysis = analyzeGait(bvh, poses, series.frames, birthYear);
  const hsL = events.filter((e) => e.side === 'L' && e.type === 'HS').length;
  const hsR = events.filter((e) => e.side === 'R' && e.type === 'HS').length;
  const extra =
    `事件 L-HS×${hsL} R-HS×${hsR}，周期 ${cycles.length} 个，` +
    `对称指数 ${analysis.metrics.symmetryIndex.toFixed(2)}%，` +
    `支撑相 L ${analysis.metrics.stancePctL.toFixed(1)}% R ${analysis.metrics.stancePctR.toFixed(1)}%，` +
    `步频 ${analysis.metrics.cadence.toFixed(1)} 步/分，` +
    `参考帧=${series.referenceFrame}，关节映射=${Object.values(map).every((v) => v >= 0) ? '完整' : '缺失'}`;

  return { name, ...cmp, extra };
}

function printResult(r: CaseResult & { extra?: string }) {
  const tag = r.pass ? '✅ PASS' : '❌ FAIL';
  console.log(`\n${tag}  ${r.name}（${r.count} 个行走帧逐帧对比，阈值 ${TOL}°）`);
  for (const k of Object.keys(r.maxAbs)) {
    const ok = r.maxAbs[k] <= TOL;
    console.log(
      `   ${ok ? ' ' : '!'} ${k.padEnd(10)} 最大偏差 ${r.maxAbs[k].toFixed(3)}°  平均 ${r.meanAbs[k].toFixed(3)}°`,
    );
  }
  if (r.extra) console.log(`   ${r.extra}`);
}

// ---- 用例 1：标准 ZXY 顺序、无偏置，基础精度 ----
const base = generateSyntheticBvh({});
const r1 = runCase('合成 BVH 基础精度（ZXY 顺序，100Hz）', base);

// ---- 用例 2：注入厂家零位偏置，检验重新标零 ----
const biased = generateSyntheticBvh({
  zeroBias: { hipL: 12, hipR: -8, kneeL: 7, kneeR: -5, ankleL: 6, ankleR: -4 },
});
const r2 = runCase('厂家零位偏置（髋±12°/膝±7°/踝±6°）后重新标零', biased);

// ---- 用例 3：XYZ 顺序，检验欧拉序无关性 ----
const xyz = generateSyntheticBvh({ rotationOrder: 'XYZ' });
const r3 = runCase('XYZ 旋转顺序（角度解算应与通道顺序无关）', xyz);

// ---- 用例 4：YXZ 顺序 + 偏置组合 ----
const yxz = generateSyntheticBvh({
  rotationOrder: 'YXZ',
  zeroBias: { hipL: 15, kneeR: 10, ankleR: -9 },
});
const r4 = runCase('YXZ 顺序叠加零位偏置', yxz);

// ---- 用例 5：低采样率 50Hz ----
const lowRate = generateSyntheticBvh({ frameTime: 0.02 });
const r5 = runCase('50Hz 低采样率', lowRate);

[r1, r2, r3, r4, r5].forEach(printResult);

const allPass = [r1, r2, r3, r4, r5].every((r) => r.pass);
console.log(`\n${'='.repeat(60)}`);
console.log(allPass
  ? `✅ 全部用例通过：解算角度与输入真值偏差均不超过 ${TOL}°`
  : '❌ 存在超出 1° 阈值的用例，需要检查角度解算');
if (!allPass) process.exit(1);
