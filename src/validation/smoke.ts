// Node 端到端冒烟测试：覆盖除 WebGL 渲染外的完整分析管线。
// 运行：npx tsx src/validation/smoke.ts
import { parseBvh } from '../bvh/parser';
import { evaluateAll } from '../bvh/skeleton';
import { computeAngleSeries, mapJoints } from '../bvh/angles';
import { analyzeGait } from '../bvh/gait';
import { generateSyntheticBvh } from './synthBvh';
import { buildEnvelope, parseEmgCsv, resample } from '../bvh/emg';
import {
  resampleCycle, cycleDeviation, normativeAt, averageCycles, deviationColor,
} from '../data/normative';
import { buildMetricsCsv, buildReportHtml } from '../data/report';
import type { EmgChannel } from '../core/types';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name} ${detail}`); }
}

console.log('1) BVH 解析与骨架');
const synth = generateSyntheticBvh({ zeroBias: { hipL: 10, kneeR: -6 } });
const bvh = parseBvh(synth.bvh, 'smoke.bvh');
check('解析出 19 个关节', bvh.joints.length === 19);
check('帧数一致', bvh.frameCount === synth.frameCount);
check('通道数 = 60', bvh.channelCount === 60);
check('关节名映射完整', Object.values(mapJoints(bvh)).every((v) => v >= 0));

console.log('2) 前向运动学');
const poses = evaluateAll(bvh);
check('每帧都有世界矩阵', poses.length === bvh.frameCount && poses[0].world.length === 19);
const hip0 = poses[0].positions[mapJoints(bvh).pelvis];
check('静止帧骨盆位于原点高度', Math.abs(hip0[0]) < 1e-6 && Math.abs(hip0[2]) < 1e-6);

console.log('3) 角度解算 + 重新标零');
const series = computeAngleSeries(bvh, poses);
check('静止参考帧在开头 1/3', series.referenceFrame < bvh.frameCount / 3);
check('参考帧角度归零',
  Math.abs(series.frames[series.referenceFrame].hipFlexL) < 1e-9 &&
  Math.abs(series.frames[series.referenceFrame].kneeFlexR) < 1e-9);

console.log('4) 步态分析');
const analysis = analyzeGait(bvh, poses, series.frames, 1985);
check('检出步态事件', analysis.events.length > 0);
check('切分出步态周期', analysis.cycles.length > 0);
check('对称指数为有限非负数', Number.isFinite(analysis.metrics.symmetryIndex) && analysis.metrics.symmetryIndex >= 0);
check('步频为正数', analysis.metrics.cadence > 0);
check('年龄段判定', analysis.metrics.ageGroup === '40-59');
check('常模支撑相约 60%', analysis.metrics.normStancePct >= 60 && analysis.metrics.normStancePct <= 65);

console.log('5) 常模曲线与偏差热力');
const hipVals = Float32Array.from(series.frames.map((f) => f.hipFlexL));
const cyc = analysis.cycles.find((c) => c.side === 'L') ?? analysis.cycles[0];
const curve = resampleCycle(hipVals, cyc.startFrame, cyc.endFrame);
check('周期重采样为 101 点', curve.length === 101);
const dev = cycleDeviation('hip', curve);
check('偏差格 101 个', dev.length === 101);
check('偏差含实测/常模/差值', dev.every((d) =>
  Number.isFinite(d.measured) && Number.isFinite(d.normative) &&
  Math.abs(d.deviation - (d.measured - d.normative)) < 1e-9));
check('常模查询边界', normativeAt('knee', 0) === 0 && normativeAt('ankle', 100) === 0);
check('多周期平均', averageCycles([curve, curve]).every((v, i) => Math.abs(v - curve[i]) < 1e-9));
check('热力配色函数', deviationColor(0).startsWith('hsl(120') && deviationColor(20).startsWith('hsl(0'));

console.log('6) EMG 包络');
const rate = 1000;
const raw = Float32Array.from({ length: rate * 2 }, (_, i) =>
  Math.sin(i / 8) * (i > rate ? 0.6 : 0.3) + 0.05 * Math.sin(i / 3));
const env = buildEnvelope('左股直肌', 'L', raw, rate, bvh.frameCount, bvh.frameTime);
check('EMG 重采样到帧数', env.envelope.length === bvh.frameCount && env.raw.length === bvh.frameCount);
check('包络归一化到 0..1', env.envelope.every((v) => v >= 0 && v <= 1 + 1e-6));
check('左右侧推断', env.side === 'L');

const csv = ['time,左股直肌,右股直肌',
  ...Array.from({ length: 500 }, (_, i) => `${(i / 1000).toFixed(3)},${Math.sin(i / 5)},${Math.cos(i / 7)}`),
].join('\n');
const emgFromCsv = parseEmgCsv(csv, bvh.frameCount, bvh.frameTime);
check('CSV 解析出 2 通道', emgFromCsv.length === 2);
check('CSV 通道命名保留', emgFromCsv[0].label === '左股直肌');

console.log('7) 报告与数据表');
const loaded = {
  session: {
    id: 'S1', patientId: 'P1', label: '初诊', capturedAt: '2026-11-01T00:00:00.000Z',
    bvh, emg: [env] as EmgChannel[],
  },
  poses, angles: series, analysis,
};
const csvOut = buildMetricsCsv(loaded, null);
check('CSV 含 BOM 与表头', csvOut.charCodeAt(0) === 0xfeff && csvOut.split('\n')[0].includes('指标'));
check('CSV 含对称指数行', csvOut.split('\n').some((l) => l.startsWith('对称指数')));
const html = buildReportHtml(loaded, null, '测试患者', {
  view3d: 'data:image/png;base64,AAAA', curves: 'data:image/png;base64,BBBB',
});
check('报告 HTML 含关键章节', html.includes('核心指标对照') && html.includes('临床解读') && html.includes('三维姿态截图'));
check('报告嵌入图片', html.includes('data:image/png'));

console.log('8) 重采样工具');
const rs = resample(Float32Array.from([0, 10]), 5);
check('线性重采样端点', rs[0] === 0 && rs[4] === 10 && rs.length === 5);

console.log(`\n${failures === 0 ? '✅ 冒烟测试全部通过' : `❌ ${failures} 项失败`}`);
if (failures) process.exit(1);
