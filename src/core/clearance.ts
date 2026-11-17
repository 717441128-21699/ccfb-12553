/**
 * 净空距离校核
 *
 * 三类检查：
 *   ground —— 导线各折线点正下方地面高程，垂直距离与限值比较；
 *   tree   —— 导线折线到树干圆柱/树冠球的最小三维净距；
 *   house  —— 导线折线到房屋长方体（OBB）的最小三维净距；
 *            无风工况附加屋顶垂直距离校核。
 *
 * 粗判用均匀空间哈希（格边长取场景特征尺度），30 塔 × 百级障碍仍为线性工作量。
 */

import type {
  ClearanceLimits,
  HouseObstacle,
  Obstacle,
  ProjectInput,
  ProjectResult,
  SpanCurve,
  TerrainGrid,
  TreeObstacle,
  Vec3,
  Violation,
} from './types';
import { add, scale, sub } from './windPlane';

/** 双线性插值取地形高程；格网外按边缘值钳制 */
export function terrainHeightAt(terrain: TerrainGrid, x: number, z: number): number {
  const fx = (x - terrain.originX) / terrain.cell;
  const fz = (z - terrain.originZ) / terrain.cell;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const clampI = (i: number, n: number): number => Math.max(0, Math.min(n - 1, i));
  const i0 = clampI(ix, terrain.nx);
  const i1 = clampI(ix + 1, terrain.nx);
  const j0 = clampI(iz, terrain.nz);
  const j1 = clampI(iz + 1, terrain.nz);
  const h = (i: number, j: number): number => terrain.heights[j * terrain.nx + i];
  const h00 = h(i0, j0);
  const h10 = h(i1, j0);
  const h01 = h(i0, j1);
  const h11 = h(i1, j1);
  return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
}

function segmentClosestPoint(a: Vec3, b: Vec3, p: Vec3): { point: Vec3; t: number } {
  const ab = sub(b, a);
  const len2 = ab.x ** 2 + ab.y ** 2 + ab.z ** 2;
  let t = len2 > 0 ? ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y + (p.z - a.z) * ab.z) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { point: add(a, scale(ab, t)), t };
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** 线段到球体的最小距离（返回最近点对与净距，净距已减半径，可负） */
function segmentSphereDistance(a: Vec3, b: Vec3, center: Vec3, radius: number) {
  const cp = segmentClosestPoint(a, b, center);
  return {
    wirePoint: cp.point,
    targetPoint: add(center, scale(sub(cp.point, center), radius / Math.max(dist(cp.point, center), 1e-12))),
    distance: dist(cp.point, center) - radius,
  };
}

/** 线段到有限圆柱（轴线 c0→c1，半径 r）的最小距离 */
function segmentCylinderDistance(a: Vec3, b: Vec3, c0: Vec3, c1: Vec3, r: number) {
  // 两有限线段最近点（迭代法，轴线为直线可解析）
  const u = sub(b, a);
  const v = sub(c1, c0);
  const w0 = sub(a, c0);
  const a2 = u.x ** 2 + u.y ** 2 + u.z ** 2;
  const b2 = v.x ** 2 + v.y ** 2 + v.z ** 2;
  const uv = u.x * v.x + u.y * v.y + u.z * v.z;
  const uw = u.x * w0.x + u.y * w0.y + u.z * w0.z;
  const vw = v.x * w0.x + v.y * w0.y + v.z * w0.z;
  let s: number;
  let t: number;
  const denom = a2 * b2 - uv * uv;
  if (denom > 1e-12) {
    s = (uv * vw - b2 * uw) / denom;
    t = (a2 * vw - uv * uw) / denom;
  } else {
    s = 0;
    t = 0;
  }
  s = Math.max(0, Math.min(1, s));
  t = Math.max(0, Math.min(1, t));
  const p = add(a, scale(u, s));
  const q = add(c0, scale(v, t));
  const d = dist(p, q);
  return {
    wirePoint: p,
    targetPoint: add(q, scale(sub(p, q), r / Math.max(d, 1e-12))),
    distance: d - r,
  };
}

function treeParts(tree: TreeObstacle) {
  const trunkTop: Vec3 = { x: tree.x, y: tree.baseY + tree.height - tree.crownRadius, z: tree.z };
  const trunkBase: Vec3 = { x: tree.x, y: tree.baseY, z: tree.z };
  const crownCenter: Vec3 = { x: tree.x, y: tree.baseY + tree.height - tree.crownRadius, z: tree.z };
  return { trunkTop, trunkBase, crownCenter };
}

/** 线段到 OBB 的最小距离（目标点为盒上最近点） */
function segmentBoxDistance(a: Vec3, b: Vec3, house: HouseObstacle) {
  const cos = Math.cos(house.yaw);
  const sin = Math.sin(house.yaw);
  const toLocal = (p: Vec3): Vec3 => {
    const dx = p.x - house.x;
    const dz = p.z - house.z;
    return {
      x: cos * dx - sin * dz,
      y: p.y - house.baseY,
      z: sin * dx + cos * dz,
    };
  };
  const lo: Vec3 = { x: -house.halfX, y: 0, z: -house.halfZ };
  const hi: Vec3 = { x: house.halfX, y: house.height, z: house.halfZ };

  // 分段细查：线段在局部系中按 8 段采样取最近盒点，再在最优段内二分加密
  const aL = toLocal(a);
  const bL = toLocal(b);
  const boxClamp = (p: Vec3): Vec3 => ({
    x: Math.max(lo.x, Math.min(hi.x, p.x)),
    y: Math.max(lo.y, Math.min(hi.y, p.y)),
    z: Math.max(lo.z, Math.min(hi.z, p.z)),
  });
  const localDist3 = (p: Vec3, q: Vec3) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);

  let best = Infinity;
  let bestWireLocal: Vec3 = aL;
  let bestTargetLocal: Vec3 = boxClamp(aL);
  let bestT = 0;
  const N = 8;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p: Vec3 = {
      x: aL.x + (bL.x - aL.x) * t,
      y: aL.y + (bL.y - aL.y) * t,
      z: aL.z + (bL.z - aL.z) * t,
    };
    const q = boxClamp(p);
    const d = localDist3(p, q);
    if (d < best) {
      best = d;
      bestWireLocal = p;
      bestTargetLocal = q;
      bestT = t;
    }
  }
  // 最优段内二分
  let tLo = Math.max(0, bestT - 1 / N);
  let tHi = Math.min(1, bestT + 1 / N);
  for (let iter = 0; iter < 24; iter++) {
    const tm = 0.5 * (tLo + tHi);
    const p: Vec3 = {
      x: aL.x + (bL.x - aL.x) * tm,
      y: aL.y + (bL.y - aL.y) * tm,
      z: aL.z + (bL.z - aL.z) * tm,
    };
    const q = boxClamp(p);
    const d = localDist3(p, q);
    if (d < best) {
      best = d;
      bestWireLocal = p;
      bestTargetLocal = q;
      bestT = tm;
    }
    // 凸距离函数：比较两侧中点决定收缩方向
    const tL = 0.5 * (tLo + tm);
    const pL: Vec3 = {
      x: aL.x + (bL.x - aL.x) * tL,
      y: aL.y + (bL.y - aL.y) * tL,
      z: aL.z + (bL.z - aL.z) * tL,
    };
    if (localDist3(pL, boxClamp(pL)) > d) tLo = tm;
    else tHi = tm;
  }

  const toWorld = (p: Vec3): Vec3 => ({
    x: house.x + cos * p.x + sin * p.z,
    y: house.baseY + p.y,
    z: house.z - sin * p.x + cos * p.z,
  });
  return {
    wirePoint: toWorld(bestWireLocal),
    targetPoint: toWorld(bestTargetLocal),
    distance: best,
  };
}

/** 均匀空间哈希粗判：返回与给定线段包围盒相交的候选障碍 */
class SpatialHash {
  private cell: number;
  private map = new Map<string, Obstacle[]>();

  constructor(obstacles: Obstacle[], cell: number) {
    this.cell = cell;
    for (const ob of obstacles) {
      const bbox = this.obstacleBBox(ob);
      for (let ix = Math.floor(bbox.minX / cell); ix <= Math.floor(bbox.maxX / cell); ix++) {
        for (let iz = Math.floor(bbox.minZ / cell); iz <= Math.floor(bbox.maxZ / cell); iz++) {
          const key = `${ix},${iz}`;
          const arr = this.map.get(key);
          if (arr) arr.push(ob);
          else this.map.set(key, [ob]);
        }
      }
    }
  }

  private obstacleBBox(ob: Obstacle) {
    if (ob.type === 'tree' && ob.tree) {
      const t = ob.tree;
      const r = Math.max(t.crownRadius, t.trunkRadius);
      return { minX: t.x - r, maxX: t.x + r, minZ: t.z - r, maxZ: t.z + r, minY: t.baseY, maxY: t.baseY + t.height };
    }
    const h = ob.house!;
    const r = Math.hypot(h.halfX, h.halfZ);
    return { minX: h.x - r, maxX: h.x + r, minZ: h.z - r, maxZ: h.z + r, minY: h.baseY, maxY: h.baseY + h.height };
  }

  query(a: Vec3, b: Vec3): Obstacle[] {
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minZ = Math.min(a.z, b.z);
    const maxZ = Math.max(a.z, b.z);
    const seen = new Set<Obstacle>();
    const result: Obstacle[] = [];
    for (let ix = Math.floor(minX / this.cell); ix <= Math.floor(maxX / this.cell); ix++) {
      for (let iz = Math.floor(minZ / this.cell); iz <= Math.floor(maxZ / this.cell); iz++) {
        for (const ob of this.map.get(`${ix},${iz}`) ?? []) {
          if (!seen.has(ob)) {
            seen.add(ob);
            result.push(ob);
          }
        }
      }
    }
    return result;
  }
}

function groundLimitFor(limits: ClearanceLimits, region: ProjectInput['region']): number {
  if (region === 'residential') return limits.groundResidential;
  if (region === 'difficult') return limits.groundDifficult;
  return limits.groundNonResidential;
}

/**
 * 对整份解算结果执行净空校核，违规点写回各 CaseResult.violations。
 * @returns 全部违规（按超标量降序）
 */
export function checkClearances(input: ProjectInput, result: ProjectResult): Violation[] {
  const allViolations: Violation[] = [];
  const hash = new SpatialHash(input.obstacles, 20);
  const groundLimit = groundLimitFor(input.limits, input.region);

  for (const caseResult of result.cases) {
    const wc = input.weatherCases.find((w) => w.id === caseResult.caseId)!;
    const hasWind = wc.windSpeed > 0;
    const violations: Violation[] = [];

    for (const curve of caseResult.curves) {
      // 1) 地面（每个折线点正下方垂直距离）
      if (input.terrain) {
        for (const p of curve.points) {
          const gy = terrainHeightAt(input.terrain, p.x, p.z);
          const d = p.y - gy;
          if (d < groundLimit) {
            violations.push({
              kind: 'ground',
              spanIndex: curve.spanIndex,
              phaseIndex: curve.phaseIndex,
              caseId: wc.id,
              wirePoint: { ...p },
              targetPoint: { x: p.x, y: gy, z: p.z },
              distance: d,
              limit: groundLimit,
              excess: groundLimit - d,
            });
          }
        }
      }

      // 2) 障碍物：逐线段 × 哈希候选
      for (let seg = 0; seg < curve.points.length - 1; seg++) {
        const a = curve.points[seg];
        const b = curve.points[seg + 1];
        for (const ob of hash.query(a, b)) {
          if (ob.type === 'tree' && ob.tree) {
            const t = ob.tree;
            const { trunkTop, trunkBase, crownCenter } = treeParts(t);
            const cyl = segmentCylinderDistance(a, b, trunkBase, trunkTop, t.trunkRadius);
            const sph = segmentSphereDistance(a, b, crownCenter, t.crownRadius);
            const best = cyl.distance <= sph.distance ? cyl : sph;
            if (best.distance < input.limits.treeWind) {
              violations.push({
                kind: 'tree',
                spanIndex: curve.spanIndex,
                phaseIndex: curve.phaseIndex,
                caseId: wc.id,
                wirePoint: best.wirePoint,
                targetPoint: best.targetPoint,
                distance: best.distance,
                limit: input.limits.treeWind,
                excess: input.limits.treeWind - best.distance,
                obstacleId: t.id,
              });
            }
          } else if (ob.type === 'house' && ob.house) {
            const h = ob.house;
            const box = segmentBoxDistance(a, b, h);
            const limit = hasWind ? input.limits.houseWind : input.limits.houseVertical;
            if (box.distance < limit) {
              violations.push({
                kind: 'house',
                spanIndex: curve.spanIndex,
                phaseIndex: curve.phaseIndex,
                caseId: wc.id,
                wirePoint: box.wirePoint,
                targetPoint: box.targetPoint,
                distance: box.distance,
                limit,
                excess: limit - box.distance,
                obstacleId: h.id,
              });
            }
          }
        }
      }
    }

    // 同目标合并：同一障碍/地面栅格、同档同相只保留最差一条
    const dedup = new Map<string, Violation>();
    for (const v of violations) {
      const key = `${v.kind}|${v.obstacleId ?? `${Math.round(v.wirePoint.x / 5)},${Math.round(v.wirePoint.z / 5)}`}|${v.spanIndex}|${v.phaseIndex}`;
      const prev = dedup.get(key);
      if (!prev || v.excess > prev.excess) dedup.set(key, v);
    }
    const merged = [...dedup.values()].sort((a, b) => b.excess - a.excess);
    caseResult.violations = merged;
    allViolations.push(...merged);
  }

  return allViolations.sort((a, b) => b.excess - a.excess);
}

export function curveBounds(curves: SpanCurve[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = { x: Infinity, y: Infinity, z: Infinity };
  const max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const c of curves) {
    for (const p of c.points) {
      min.x = Math.min(min.x, p.x);
      min.y = Math.min(min.y, p.y);
      min.z = Math.min(min.z, p.z);
      max.x = Math.max(max.x, p.x);
      max.y = Math.max(max.y, p.y);
      max.z = Math.max(max.z, p.z);
    }
  }
  return { min, max };
}
