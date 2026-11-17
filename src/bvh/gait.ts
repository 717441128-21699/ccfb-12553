// 步态事件检测（HS 足跟着地 / TO 足趾离地）、步态周期划分、
// 左右对称性与支撑相占比，以及同龄常模对照。
import type { BvhData, Pose, GaitEvent, GaitCycle, GaitMetrics, Side } from '../core/types';
import { mapJoints } from './angles';
import { sub, length, clamp } from '../core/math';

export interface GaitAnalysis {
  events: GaitEvent[];
  cycles: GaitCycle[];
  metrics: GaitMetrics;
}

/** 足部高度序列（取脚趾与脚踝的较低者，近似足底高度） */
function footHeightSeries(poses: Pose[], foot: number, toe: number): number[] {
  return poses.map((p) => {
    const hf = foot >= 0 ? p.positions[foot][1] : 0;
    const ht = toe >= 0 ? p.positions[toe][1] : hf;
    return Math.min(hf, ht);
  });
}

/**
 * 基于足底高度 + 垂直速度的状态机事件检测：
 * - HS 足跟着地：摆动相下落后，高度回到接近该脚最低点、垂直速度由负转正/趋零
 * - TO 足趾离地：支撑相结束，高度从最低平台开始持续上升
 * 阈值相对该脚自身高度量程自适应，不依赖绝对单位（cm/m）。
 */
export function detectEvents(bvh: BvhData, poses: Pose[]): GaitEvent[] {
  const map = mapJoints(bvh);
  const events: GaitEvent[] = [];
  const minGap = Math.max(3, Math.round(0.1 / bvh.frameTime)); // 100ms 防抖

  const detectSide = (side: Side, foot: number, toe: number) => {
    if (foot < 0) return;
    const h = footHeightSeries(poses, foot, toe);
    const n = h.length;
    const vel = new Array<number>(n).fill(0);
    for (let i = 1; i < n; i++) vel[i] = (h[i] - h[i - 1]) / bvh.frameTime;

    const hmin = Math.min(...h);
    const hmax = Math.max(...h);
    const range = Math.max(1e-6, hmax - hmin);
    // 迟滞阈值：进入接触带 18%，离开 30%，避免平台抖动反复触发
    const enterBand = hmin + range * 0.18;
    const exitBand = hmin + range * 0.3;

    let lastEvent = -Infinity;
    let grounded = h[0] <= enterBand; // 起始静止站立视为支撑

    for (let i = 1; i < n - 1; i++) {
      if (i - lastEvent < minGap) continue;

      if (!grounded) {
        // 摆动相下落：高度穿入接触带且仍在下降/趋稳 -> HS
        if (h[i] <= enterBand && vel[i] < range * 2) {
          events.push({ side, type: 'HS', frame: i, time: i * bvh.frameTime });
          lastEvent = i;
          grounded = true;
        }
      } else {
        // 支撑相：高度持续升破退出带 -> TO
        if (h[i] >= exitBand && vel[i] > 0 && h[i + 1] > h[i]) {
          events.push({ side, type: 'TO', frame: i, time: i * bvh.frameTime });
          lastEvent = i;
          grounded = false;
        }
      }
    }
  };

  detectSide('L', map.footL, map.toeL);
  detectSide('R', map.footR, map.toeR);
  events.sort((a, b) => a.frame - b.frame);
  return events;
}

/** 按同侧连续两次 HS 切分步态周期，并在其中定位 TO 计算支撑相占比 */
export function detectCycles(bvh: BvhData, events: GaitEvent[]): GaitCycle[] {
  const cycles: GaitCycle[] = [];
  (['L', 'R'] as Side[]).forEach((side) => {
    const hs = events.filter((e) => e.side === side && e.type === 'HS');
    const to = events.filter((e) => e.side === side && e.type === 'TO');
    for (let k = 0; k < hs.length - 1; k++) {
      const start = hs[k].frame;
      const end = hs[k + 1].frame;
      // 周期内第一个 TO
      const toeOff = to.find((e) => e.frame > start && e.frame < end);
      const stanceFrames = toeOff ? toeOff.frame - start : Math.round((end - start) * 0.6);
      const len = end - start;
      const phasePct: number[] = [];
      for (let f = start; f <= end; f++) phasePct.push(((f - start) / len) * 100);
      cycles.push({
        side,
        startFrame: start,
        endFrame: end,
        duration: len * bvh.frameTime,
        stanceFrames,
        stancePct: clamp((stanceFrames / len) * 100, 0, 100),
        phasePct,
      });
    }
  });
  cycles.sort((a, b) => a.startFrame - b.startFrame);
  return cycles;
}

/** 年龄分组：常模数据按年龄段给出 */
export function ageGroup(birthYear: number, now = new Date().getFullYear()): string {
  const age = now - birthYear;
  if (age < 18) return '<18';
  if (age < 40) return '18-39';
  if (age < 60) return '40-59';
  if (age < 75) return '60-74';
  return '75+';
}

/**
 * 常模（基于 Perry & Burnfield《Gait Analysis》/ Winter 临床步态数据的
 * 代表性区间，单位 %）。支撑相占比健康成人约 60%，对称指数 <5% 视为正常。
 */
export const NORM = {
  stancePct: { '<18': 60, '18-39': 60, '40-59': 61, '60-74': 63, '75+': 65 } as Record<string, number>,
  symmetry: { '<18': 4, '18-39': 4, '40-59': 5, '60-74': 6, '75+': 8 } as Record<string, number>,
  cadence: { '<18': 116, '18-39': 113, '40-59': 108, '60-74': 101, '75+': 94 } as Record<string, number>,
};

function mean(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

/** 角度活动范围（周期内最大-最小）的双侧均值 */
function rangeOfMotion(values: number[]): number {
  if (!values.length) return 0;
  return Math.max(...values) - Math.min(...values);
}

/** 汇总对称指数、支撑相、步频、活动范围并对照常模 */
export function analyzeGait(
  bvh: BvhData,
  poses: Pose[],
  angleFrames: { hipFlexL: number; hipFlexR: number; kneeFlexL: number; kneeFlexR: number; ankleDorsiL: number; ankleDorsiR: number }[],
  birthYear: number,
): GaitAnalysis {
  const events = detectEvents(bvh, poses);
  const cycles = detectCycles(bvh, events);
  const group = ageGroup(birthYear);

  const cycL = cycles.filter((c) => c.side === 'L');
  const cycR = cycles.filter((c) => c.side === 'R');
  const stanceL = mean(cycL.map((c) => c.stancePct));
  const stanceR = mean(cycR.map((c) => c.stancePct));

  // 对称指数（Robinson 形式）：|L-R| / 0.5(L+R) * 100，0 为完全对称
  const denom = (stanceL + stanceR) / 2 || 1;
  const symmetryIndex = Math.abs(stanceL - stanceR) / denom * 100;

  // 步频：全部 HS 事件数 / 总时长 * 60
  const hsCount = events.filter((e) => e.type === 'HS').length;
  const duration = bvh.frameCount * bvh.frameTime;
  const cadence = duration > 0 ? (hsCount / duration) * 60 : 0;

  const rom = (side: Side) => {
    const suf = side === 'L' ? 'L' : 'R';
    const hip = rangeOfMotion(angleFrames.map((a) => a[`hipFlex${suf}` as 'hipFlexL']));
    const knee = rangeOfMotion(angleFrames.map((a) => a[`kneeFlex${suf}` as 'kneeFlexL']));
    const ankle = rangeOfMotion(angleFrames.map((a) => a[`ankleDorsi${suf}` as 'ankleDorsiL']));
    return { hip, knee, ankle };
  };

  const metrics: GaitMetrics = {
    symmetryIndex,
    stancePctL: stanceL,
    stancePctR: stanceR,
    cadence,
    cycleDurationL: mean(cycL.map((c) => c.duration)),
    cycleDurationR: mean(cycR.map((c) => c.duration)),
    avgRoML: rom('L'),
    avgRoMR: rom('R'),
    ageGroup: group,
    normStancePct: NORM.stancePct[group],
    normSymmetry: NORM.symmetry[group],
  };

  return { events, cycles, metrics };
}

/** 骨盆在水平面的瞬时移动速度（m/s，BVH 单位按 cm 时换算） */
export function pelvisSpeed(poses: Pose[], pelvis: number, frameTime: number, unit = 'cm'): number[] {
  const k = unit === 'cm' ? 0.01 : 1;
  return poses.map((p, i) => {
    if (i === 0) return 0;
    const d = sub(p.positions[pelvis], poses[i - 1].positions[pelvis]);
    return (length(d) * k) / frameTime;
  });
}
