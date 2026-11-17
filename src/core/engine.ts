/**
 * 线路解算引擎
 *
 * 流程：
 *   1. 塔位分组耐张段（isStrain 分界，无耐张塔则整线一段）；
 *   2. 每个气象工况：计算各型号导线荷载 → 各耐张段状态方程求应力
 *      → 逐档逐相构造风偏平面 → 悬链线精确解 → 自适应加密三维折线；
 *   3. 全部双精度计算，渲染层仅在上传 GPU 时转 float32。
 */

import { solveCatenary2D, supportTension } from './catenary2d';
import { computeLoads, type LoadComponents } from './loads';
import {
  exactSectionStress,
  handbookStateStress,
  representativeSpan,
  type SpanGeom,
} from './stateEquation';
import { makeWindPlane, mapToWorld } from './windPlane';
import type {
  ConductorType,
  CurvePoint,
  ProjectInput,
  ProjectResult,
  CaseResult,
  SpanCurve,
  Tower,
  WeatherCase,
  Vec3,
} from './types';

export type StressSolver = 'handbook' | 'exact';

export interface SolveOptions {
  solver?: StressSolver;
  /** 折线自适应加密的弦偏差容限 (m)，缺省 0.005 */
  tessTolerance?: number;
  /** 单档最大折线点数，缺省 256 */
  maxPointsPerSpan?: number;
}

/** 挂点世界坐标：塔位 + 相别横向偏移 + 挂点高度 */
export function attachmentPoint(tower: Tower, phaseIndex: number): Vec3 {
  return {
    x: tower.x,
    y: tower.groundY + tower.attachmentHeights[phaseIndex],
    z: tower.z + tower.attachmentOffsets[phaseIndex],
  };
}

/** 按耐张塔切分耐张段，返回每段 [起始塔序号, 终止塔序号] */
export function buildTensionSections(towers: Tower[]): Array<[number, number]> {
  const sections: Array<[number, number]> = [];
  let start = 0;
  for (let i = 1; i < towers.length - 1; i++) {
    if (towers[i].isStrain) {
      sections.push([start, i]);
      start = i;
    }
  }
  sections.push([start, towers.length - 1]);
  return sections;
}

interface SectionContext {
  from: number;
  to: number;
  spans: SpanGeom[];
  Ldb: number;
  E: number;
  alpha: number;
  refStress: number;
  refGamma: number;
  refTemp: number;
}

function findSectionIndex(sections: SectionContext[], spanIndex: number): number {
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (spanIndex >= s.from && spanIndex < s.to) return i;
  }
  throw new Error(`档 ${spanIndex} 不属于任何耐张段`);
}

/**
 * 自适应加密：递归中点细分，直到所有折线弦与真实悬链线的平面内偏差
 * 小于容限或达到点数上限。返回参数 x（距起点平面内水平距离）序列。
 */
function adaptiveSample(
  pointAt: (x: number) => { xi: number; eta: number; s: number; slope: number },
  L: number,
  tolerance: number,
  maxPoints: number,
): number[] {
  const xs: number[] = [0, L];
  const stack: Array<[number, number]> = [[0, L]];
  while (stack.length > 0 && xs.length < maxPoints - 1) {
    const [x1, x2] = stack.pop()!;
    const xm = 0.5 * (x1 + x2);
    const p1 = pointAt(x1);
    const p2 = pointAt(x2);
    const pm = pointAt(xm);
    // 中点到弦的竖直（eta）偏差；eT/eU 正交等尺度，即平面真实偏差
    const chordEta = 0.5 * (p1.eta + p2.eta);
    const dev = Math.abs(pm.eta - chordEta);
    if (dev > tolerance) {
      // 保持有序插入：xm 位于 x1、x2 之间，用二分找插入位
      let lo = 0;
      let hi = xs.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (xs[mid] < xm) lo = mid + 1;
        else hi = mid;
      }
      xs.splice(lo, 0, xm);
      stack.push([x1, xm], [xm, x2]);
    }
  }
  xs.sort((a, b) => a - b);
  return xs;
}

export function solveProject(input: ProjectInput, options: SolveOptions = {}): ProjectResult {
  const solver: StressSolver = options.solver ?? 'handbook';
  const tolerance = options.tessTolerance ?? 0.005;
  const maxPoints = options.maxPointsPerSpan ?? 256;
  const t0 = performance.now();

  const towers = input.towers;
  if (towers.length < 2) throw new Error('至少需要两基塔才能构成一档');
  const nSpans = towers.length - 1;

  const conductorMap = new Map<string, ConductorType>();
  for (const c of input.conductors) conductorMap.set(c.id, c);

  // 耐张段上下文（用第一相导线的材料参数；同一耐张段默认同型号）
  const autoSections = buildTensionSections(towers);
  const sections: SectionContext[] = autoSections.map(([from, to], idx) => {
    const declared = input.tensionSections[idx];
    const ref = declared?.reference ?? {
      temperature: 15,
      ice: 0,
      windSpeed: 0,
      stress: conductorMap.get(input.phaseConductorIds[0])!.ratedTensileStrength /
        conductorMap.get(input.phaseConductorIds[0])!.area / 4,
    };
    const conductor = conductorMap.get(input.phaseConductorIds[0])!;
    const spans: SpanGeom[] = [];
    for (let i = from; i < to; i++) {
      const a = attachmentPoint(towers[i], 0);
      const b = attachmentPoint(towers[i + 1], 0);
      spans.push({ L: Math.hypot(b.x - a.x, b.z - a.z), h: b.y - a.y });
    }
    // 参考工况比载（按参考工况的气温/冰/风现场组合）
    const refCase: WeatherCase = {
      id: '__ref__',
      name: '参考',
      temperature: ref.temperature,
      ice: ref.ice,
      windSpeed: ref.windSpeed,
    };
    const refLoads = computeLoads(conductor, refCase);
    return {
      from,
      to,
      spans,
      Ldb: representativeSpan(spans),
      E: conductor.elasticModulus,
      alpha: conductor.expansionCoeff,
      refStress: ref.stress,
      refGamma: refLoads.gamma,
      refTemp: ref.temperature,
    };
  });

  const cases: CaseResult[] = [];

  for (const wc of input.weatherCases) {
    const caseT0 = performance.now();
    const curves: SpanCurve[] = [];

    // 每相导线型号 → 荷载；耐张段 → 应力
    for (let phase = 0; phase < 3; phase++) {
      const conductor = conductorMap.get(input.phaseConductorIds[phase]);
      if (!conductor) throw new Error(`未知导线型号：${input.phaseConductorIds[phase]}`);
      const loads = computeLoads(conductor, wc);
      const totalArea = conductor.area * conductor.bundleN;

      // 各耐张段本工况应力
      const sectionStress = sections.map((sec) => {
        if (wc.explicitStress !== undefined) return wc.explicitStress;
        const target = { gamma: loads.gamma, temperature: wc.temperature };
        const ref = {
          gamma: sec.refGamma,
          temperature: sec.refTemp,
          stress: sec.refStress,
        };
        return solver === 'exact'
          ? exactSectionStress(sec.spans, target, ref, sec.E, sec.alpha)
          : handbookStateStress(target, ref, sec.Ldb, sec.E, sec.alpha);
      });

      for (let i = 0; i < nSpans; i++) {
        const secIdx = findSectionIndex(sections, i);
        const sigma = sectionStress[secIdx];
        const H = sigma * totalArea;
        const start = attachmentPoint(towers[i], phase);
        const end = attachmentPoint(towers[i + 1], phase);
        const chord = ((): Vec3 => {
          const d = { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z };
          return d;
        })();
        const horizontalSpan = Math.hypot(chord.x, chord.z);

        const basis = makeWindPlane(chord, loads.swingAngleRad, wc.windDir);
        const cat = solveCatenary2D({ L: basis.L2d, h: basis.h2d, c: sigma / loads.gamma });

        const xs = adaptiveSample(cat.pointAt, basis.L2d, tolerance, maxPoints);
        const points: CurvePoint[] = xs.map((x) => {
          const p2 = cat.pointAt(x);
          const world = mapToWorld(start, basis, p2.xi, p2.eta);
          return {
            ...world,
            s: p2.s,
            tension: supportTension(H, cat.m + x / cat.c),
          };
        });

        // 弧垂统计直接采用二维悬链线解算器的精确值（平面内定义与手册一致）
        const midSpanSag = cat.midSpanSag;
        const maxSag = cat.maxSag;

        // 侧向偏移：相对两挂点竖直平面的水平距离
        const eSpan = {
          x: chord.x / horizontalSpan,
          y: 0,
          z: chord.z / horizontalSpan,
        };
        const lateralAt = (p: Vec3): number => {
          const dx = p.x - start.x;
          const dz = p.z - start.z;
          const along = dx * eSpan.x + dz * eSpan.z;
          const lx = dx - along * eSpan.x;
          const lz = dz - along * eSpan.z;
          return Math.hypot(lx, lz);
        };
        let maxLateralOffset = 0;
        for (const p of points) maxLateralOffset = Math.max(maxLateralOffset, lateralAt(p));

        curves.push({
          spanIndex: i,
          phaseIndex: phase,
          caseId: wc.id,
          start,
          end,
          horizontalSpan,
          heightDifference: end.y - start.y,
          horizontalStress: sigma,
          horizontalTension: H,
          midSpanSag,
          maxSag,
          maxSagX: cat.maxSagX,
          length: cat.length,
          swingAngleDeg: (loads.swingAngleRad * 180) / Math.PI,
          maxLateralOffset,
          points,
        });
      }
    }

    cases.push({
      caseId: wc.id,
      curves,
      violations: [],
      elapsedMs: performance.now() - caseT0,
    });
  }

  const totalElapsedMs = performance.now() - t0;
  return { cases, totalElapsedMs };
}

export type { LoadComponents };
export { computeLoads };
