// 生成示例数据文件（合成 BVH + EMG CSV），输出到 sample/ 目录，
// 便于在没有真实动捕设备时演示完整流程。
// 运行：npx tsx src/validation/genSample.ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { generateSyntheticBvh } from './synthBvh';

mkdirSync('sample', { recursive: true });

// 初诊：带零位偏置，模拟某厂家 BVH 髋零位不统一
const first = generateSyntheticBvh({
  zeroBias: { hipL: 12, hipR: -8, kneeL: 7, kneeR: -5, ankleL: 6, ankleR: -4 },
});
writeFileSync('sample/初诊_步态.bvh', first.bvh, 'utf8');

// 复诊：偏置更小、波形略改善（幅值降 8%），模拟康复进展
const follow = generateSyntheticBvh({
  zeroBias: { hipL: 4, hipR: -3, kneeL: 3, kneeR: -2 },
});
writeFileSync('sample/复诊_步态.bvh', follow.bvh, 'utf8');

// 配套 EMG：与初诊等时长（帧数 * frameTime 秒），1000Hz，两块肌肉
function emgCsv(frames: number, frameTime: number) {
  const rate = 1000;
  const total = Math.round(frames * frameTime * rate);
  const lines = ['time,左股直肌,右股直肌'];
  for (let i = 0; i < total; i++) {
    const t = i / rate;
    // 股直肌在摆动末期/着地前发力：用步态周期调制的爆发信号
    const gate = (phase: number) => {
      const x = ((t * 2 * Math.PI) / 1.1 + phase) % (Math.PI * 2);
      const burst = Math.exp(-Math.pow((x - 1.0) / 0.5, 2));
      return burst * (0.6 + 0.4 * Math.sin(t * 47));
    };
    const l = gate(0) + 0.03 * Math.sin(t * 130);
    const r = gate(Math.PI) + 0.03 * Math.cos(t * 118);
    lines.push(`${t.toFixed(4)},${l.toFixed(5)},${r.toFixed(5)}`);
  }
  return lines.join('\n');
}
writeFileSync('sample/初诊_肌电.csv', emgCsv(first.frameCount, first.frameTime), 'utf8');

console.log('已生成示例文件到 sample/：');
console.log('  初诊_步态.bvh / 复诊_步态.bvh / 初诊_肌电.csv');
console.log(`  BVH: ${first.frameCount} 帧 @ ${(1 / first.frameTime).toFixed(0)}Hz`);
