/**
 * 场景几何构建：把解算结果转成交错顶点数组（pos+normal+color）
 * 所有几何在 CPU 侧一次性建好，GPU 只负责绘制，保证大数据量下帧率稳定。
 */
import type {
  HouseObstacle,
  Obstacle,
  ProjectInput,
  SpanCurve,
  TerrainGrid,
  TreeObstacle,
  Vec3,
  Violation,
} from '../core/types';
import { terrainHeightAt } from '../core/clearance';

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export const COLORS = {
  terrain: { r: 0.42, g: 0.55, b: 0.36 },
  terrainGrid: { r: 0.35, g: 0.46, b: 0.3 },
  tower: { r: 0.28, g: 0.3, b: 0.34 },
  towerStrain: { r: 0.45, g: 0.32, b: 0.22 },
  wireHot: { r: 0.85, g: 0.38, b: 0.16 },
  wireIce: { r: 0.45, g: 0.72, b: 0.92 },
  wireWind: { r: 0.35, g: 0.55, b: 0.95 },
  trunk: { r: 0.4, g: 0.27, b: 0.16 },
  crown: { r: 0.2, g: 0.5, b: 0.22 },
  house: { r: 0.62, g: 0.58, b: 0.5 },
  roof: { r: 0.45, g: 0.3, b: 0.26 },
  violation: { r: 0.95, g: 0.12, b: 0.1 },
  markerLine: { r: 1.0, g: 0.85, b: 0.2 },
};

function pushVertex(
  arr: number[],
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  c: RGB,
): void {
  arr.push(x, y, z, nx, ny, nz, c.r, c.g, c.b);
}

function pushTri(arr: number[], a: number[], b: number[], c: number[], n: Vec3, color: RGB): void {
  arr.push(...a, n.x, n.y, n.z, color.r, color.g, color.b);
  arr.push(...b, n.x, n.y, n.z, color.r, color.g, color.b);
  arr.push(...c, n.x, n.y, n.z, color.r, color.g, color.b);
}

/** 地形：规则格网拆三角形，法线由相邻面叉积估计 */
export function buildTerrainMesh(terrain: TerrainGrid): Float32Array {
  const v: number[] = [];
  const { nx, nz, cell, originX, originZ } = terrain;
  const normalAt = (ix: number, iz: number): Vec3 => {
    const xl = terrainHeightAt(terrain, originX + Math.max(0, ix - 1) * cell, originZ + iz * cell);
    const xr = terrainHeightAt(terrain, originX + Math.min(nx - 1, ix + 1) * cell, originZ + iz * cell);
    const zl = terrainHeightAt(terrain, originX + ix * cell, originZ + Math.max(0, iz - 1) * cell);
    const zr = terrainHeightAt(terrain, originX + ix * cell, originZ + Math.min(nz - 1, iz + 1) * cell);
    const n = { x: xl - xr, y: 2 * cell, z: zl - zr };
    const l = Math.hypot(n.x, n.y, n.z);
    return { x: n.x / l, y: n.y / l, z: n.z / l };
  };

  for (let iz = 0; iz < nz - 1; iz++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      const x0 = originX + ix * cell;
      const x1 = x0 + cell;
      const z0 = originZ + iz * cell;
      const z1 = z0 + cell;
      const y00 = terrain.heights[iz * nx + ix];
      const y10 = terrain.heights[iz * nx + ix + 1];
      const y01 = terrain.heights[(iz + 1) * nx + ix];
      const y11 = terrain.heights[(iz + 1) * nx + ix + 1];
      const n = normalAt(ix, iz);
      // 两个三角形
      pushTri(v, [x0, y00, z0], [x1, y10, z0], [x1, y11, z1], n, COLORS.terrain);
      pushTri(v, [x0, y00, z0], [x1, y11, z1], [x0, y01, z1], n, COLORS.terrain);
    }
  }
  return Float32Array.from(v);
}

/** 地形格网线（LINES），帮助判断走向 */
export function buildTerrainGridLines(terrain: TerrainGrid): Float32Array {
  const v: number[] = [];
  const { nx, nz, cell, originX, originZ } = terrain;
  const c = COLORS.terrainGrid;
  for (let iz = 0; iz < nz; iz += 2) {
    for (let ix = 0; ix < nx - 1; ix++) {
      const x0 = originX + ix * cell;
      const x1 = x0 + cell;
      const z = originZ + iz * cell;
      pushVertex(v, x0, terrainHeightAt(terrain, x0, z) + 0.3, z, 0, 1, 0, c);
      pushVertex(v, x1, terrainHeightAt(terrain, x1, z) + 0.3, z, 0, 1, 0, c);
    }
  }
  for (let ix = 0; ix < nx; ix += 2) {
    for (let iz = 0; iz < nz - 1; iz++) {
      const x = originX + ix * cell;
      const z0 = originZ + iz * cell;
      const z1 = z0 + cell;
      pushVertex(v, x, terrainHeightAt(terrain, x, z0) + 0.3, z0, 0, 1, 0, c);
      pushVertex(v, x, terrainHeightAt(terrain, x, z1) + 0.3, z1, 0, 1, 0, c);
    }
  }
  return Float32Array.from(v);
}

/** 塔：四条主材腿 + 横担 + 横隔面（LINES 线框，视觉足够且极轻量） */
export function buildTowerLines(input: ProjectInput): Float32Array {
  const v: number[] = [];
  for (const t of input.towers) {
    const c = t.isStrain ? COLORS.towerStrain : COLORS.tower;
    const topH = Math.max(...t.attachmentHeights) + 4;
    const baseHalf = 4;
    const topHalf = 1.2;
    // 基础四角与塔顶四角
    const base = [
      [t.x - baseHalf, t.groundY, t.z - baseHalf],
      [t.x + baseHalf, t.groundY, t.z - baseHalf],
      [t.x + baseHalf, t.groundY, t.z + baseHalf],
      [t.x - baseHalf, t.groundY, t.z + baseHalf],
    ];
    const top = [
      [t.x - topHalf, t.groundY + topH, t.z - topHalf],
      [t.x + topHalf, t.groundY + topH, t.z - topHalf],
      [t.x + topHalf, t.groundY + topH, t.z + topHalf],
      [t.x - topHalf, t.groundY + topH, t.z + topHalf],
    ];
    const line = (a: number[], b: number[]) => {
      pushVertex(v, ...(a as [number, number, number]), 0, 1, 0, c);
      pushVertex(v, ...(b as [number, number, number]), 0, 1, 0, c);
    };
    // 主材
    for (let i = 0; i < 4; i++) line(base[i], top[i]);
    // 横隔面（3 层）
    for (const frac of [0.35, 0.65, 0.9]) {
      const pts = base.map((b, i) => {
        const y = b[1] + (top[i][1] - b[1]) * frac;
        return [b[0] + (top[i][0] - b[0]) * frac, y, b[2] + (top[i][2] - b[2]) * frac];
      });
      for (let i = 0; i < 4; i++) line(pts[i], pts[(i + 1) % 4]);
    }
    // 横担（沿 Z 向，覆盖三相挂点偏移范围）
    const offMax = Math.max(...t.attachmentOffsets.map(Math.abs)) + 3;
    const armY = t.groundY + t.attachmentHeights[1];
    line([t.x, armY, t.z - offMax], [t.x, armY, t.z + offMax]);
    line([t.x - 2, armY + 1.5, t.z - offMax * 0.7], [t.x + 2, armY + 1.5, t.z + offMax * 0.7]);
  }
  return Float32Array.from(v);
}

/** 导线折线（LINES），按工况着色 */
export function buildWireLines(curves: SpanCurve[], color: RGB): Float32Array {
  const v: number[] = [];
  for (const curve of curves) {
    for (let i = 0; i < curve.points.length - 1; i++) {
      const a = curve.points[i];
      const b = curve.points[i + 1];
      pushVertex(v, a.x, a.y, a.z, 0, 1, 0, color);
      pushVertex(v, b.x, b.y, b.z, 0, 1, 0, color);
    }
  }
  return Float32Array.from(v);
}

function cylinderVertices(
  cx: number,
  cz: number,
  y0: number,
  y1: number,
  r: number,
  segments: number,
  color: RGB,
): number[] {
  const v: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const p0 = [cx + r * Math.cos(a0), y0, cz + r * Math.sin(a0)];
    const p1 = [cx + r * Math.cos(a1), y0, cz + r * Math.sin(a1)];
    const p2 = [cx + r * Math.cos(a1), y1, cz + r * Math.sin(a1)];
    const p3 = [cx + r * Math.cos(a0), y1, cz + r * Math.sin(a0)];
    const n0 = { x: Math.cos(a0), y: 0, z: Math.sin(a0) };
    pushTri(v, p0, p1, p2, n0, color);
    pushTri(v, p0, p2, p3, n0, color);
  }
  return v;
}

function sphereVertices(cx: number, cy: number, cz: number, r: number, color: RGB, lat = 8, lon = 10): number[] {
  const v: number[] = [];
  for (let i = 0; i < lat; i++) {
    const t0 = (i / lat) * Math.PI;
    const t1 = ((i + 1) / lat) * Math.PI;
    for (let j = 0; j < lon; j++) {
      const p0 = (j / lon) * Math.PI * 2;
      const p1 = ((j + 1) / lon) * Math.PI * 2;
      const pt = (theta: number, phi: number): number[] => [
        cx + r * Math.sin(theta) * Math.cos(phi),
        cy + r * Math.cos(theta),
        cz + r * Math.sin(theta) * Math.sin(phi),
      ];
      const a = pt(t0, p0);
      const b = pt(t1, p0);
      const c = pt(t1, p1);
      const d = pt(t0, p1);
      const n = { x: a[0] - cx, y: a[1] - cy, z: a[2] - cz };
      const nl = Math.hypot(n.x, n.y, n.z);
      const nn = { x: n.x / nl, y: n.y / nl, z: n.z / nl };
      pushTri(v, a, b, c, nn, color);
      pushTri(v, a, c, d, nn, color);
    }
  }
  return v;
}

function boxVertices(h: HouseObstacle, color: RGB, roofColor: RGB): number[] {
  const cos = Math.cos(h.yaw);
  const sin = Math.sin(h.yaw);
  const toWorld = (lx: number, ly: number, lz: number): number[] => [
    h.x + cos * lx + sin * lz,
    h.baseY + ly,
    h.z - sin * lx + cos * lz,
  ];
  const corners = [
    toWorld(-h.halfX, 0, -h.halfZ),
    toWorld(h.halfX, 0, -h.halfZ),
    toWorld(h.halfX, 0, h.halfZ),
    toWorld(-h.halfX, 0, h.halfZ),
    toWorld(-h.halfX, h.height, -h.halfZ),
    toWorld(h.halfX, h.height, -h.halfZ),
    toWorld(h.halfX, h.height, h.halfZ),
    toWorld(-h.halfX, h.height, h.halfZ),
  ];
  const faces: Array<[number, number, number, Vec3]> = [
    [0, 1, 2, { x: 0, y: -1, z: 0 }],
    [0, 2, 3, { x: 0, y: -1, z: 0 }],
    [4, 6, 5, { x: 0, y: 1, z: 0 }],
    [4, 7, 6, { x: 0, y: 1, z: 0 }],
    [0, 4, 5, { x: 0, y: 0, z: -1 }],
    [0, 5, 1, { x: 0, y: 0, z: -1 }],
    [1, 5, 6, { x: 1, y: 0, z: 0 }],
    [1, 6, 2, { x: 1, y: 0, z: 0 }],
    [2, 6, 7, { x: 0, y: 0, z: 1 }],
    [2, 7, 3, { x: 0, y: 0, z: 1 }],
    [3, 7, 4, { x: -1, y: 0, z: 0 }],
    [3, 4, 0, { x: -1, y: 0, z: 0 }],
  ];
  const v: number[] = [];
  for (const [ai, bi, ci, n] of faces) {
    pushTri(v, corners[ai], corners[bi], corners[ci], n, n.y > 0 ? roofColor : color);
  }
  return v;
}

/** 全部障碍（树=树干圆柱+树冠球；房=长方体） */
export function buildObstacleMeshes(obstacles: Obstacle[]): Float32Array {
  const v: number[] = [];
  for (const ob of obstacles) {
    if (ob.type === 'tree' && ob.tree) {
      const t: TreeObstacle = ob.tree;
      const trunkTop = t.baseY + t.height - t.crownRadius;
      v.push(...cylinderVertices(t.x, t.z, t.baseY, trunkTop, t.trunkRadius, 7, COLORS.trunk));
      v.push(...sphereVertices(t.x, trunkTop, t.z, t.crownRadius, COLORS.crown));
    } else if (ob.type === 'house' && ob.house) {
      v.push(...boxVertices(ob.house, COLORS.house, COLORS.roof));
    }
  }
  return Float32Array.from(v);
}

/** 违规标记：红色球（导线侧）+ 黄色连线到目标点，地面违规再加竖直虚线段 */
export function buildViolationMarkers(violations: Violation[]): { triangles: Float32Array; lines: Float32Array } {
  const tri: number[] = [];
  const lines: number[] = [];
  const seen = new Set<string>();
  for (const vio of violations) {
    const key = `${vio.wirePoint.x.toFixed(1)},${vio.wirePoint.y.toFixed(1)},${vio.wirePoint.z.toFixed(1)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const r = 1.6;
    tri.push(...sphereVertices(vio.wirePoint.x, vio.wirePoint.y, vio.wirePoint.z, r, COLORS.violation, 7, 9));
    const a = vio.wirePoint;
    const b = vio.targetPoint;
    pushVertex(lines, a.x, a.y, a.z, 0, 1, 0, COLORS.markerLine);
    pushVertex(lines, b.x, b.y, b.z, 0, 1, 0, COLORS.markerLine);
  }
  return { triangles: Float32Array.from(tri), lines: Float32Array.from(lines) };
}
