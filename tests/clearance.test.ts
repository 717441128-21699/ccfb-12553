import { test } from 'node:test';
import assert from 'node:assert/strict';
import { terrainHeightAt, checkClearances } from '../src/core/clearance';
import type { ProjectInput, ProjectResult, TerrainGrid } from '../src/core/types';

function flatTerrain(y: number, nx = 5, nz = 5, cell = 100): TerrainGrid {
  return { originX: -200, originZ: -200, cell, nx, nz, heights: new Float64Array(nx * nz).fill(y) };
}

test('地形双线性插值：格点精确、格内线性、格网外钳制', () => {
  const t: TerrainGrid = {
    originX: 0,
    originZ: 0,
    cell: 10,
    nx: 3,
    nz: 3,
    heights: Float64Array.from([0, 10, 20, 0, 10, 20, 0, 10, 20]),
  };
  assert.ok(Math.abs(terrainHeightAt(t, 0, 0) - 0) < 1e-12);
  assert.ok(Math.abs(terrainHeightAt(t, 10, 0) - 10) < 1e-12);
  assert.ok(Math.abs(terrainHeightAt(t, 5, 0) - 5) < 1e-12);
  assert.ok(Math.abs(terrainHeightAt(t, 5, 5) - 5) < 1e-12);
  // 钳制
  assert.ok(Math.abs(terrainHeightAt(t, -100, -100) - 0) < 1e-12);
  assert.ok(terrainHeightAt(t, 999, 999) === 20);
});

function baseProject(extra: Partial<ProjectInput>): ProjectInput {
  return {
    name: 't',
    voltageKv: 110,
    region: 'residential',
    conductors: [],
    phaseConductorIds: ['c', 'c', 'c'],
    towers: [],
    weatherCases: [],
    tensionSections: [],
    obstacles: [],
    limits: {
      groundResidential: 7,
      groundNonResidential: 6,
      groundDifficult: 5,
      treeWind: 4,
      houseVertical: 5,
      houseWind: 8.5,
    },
    ...extra,
  };
}

function wireResult(points: Array<[number, number, number]>, caseId = 'c1'): ProjectResult {
  return {
    totalElapsedMs: 0,
    cases: [
      {
        caseId,
        elapsedMs: 0,
        violations: [],
        curves: [
          {
            spanIndex: 0,
            phaseIndex: 0,
            caseId,
            start: { x: points[0][0], y: points[0][1], z: points[0][2] },
            end: { x: points.at(-1)![0], y: points.at(-1)![1], z: points.at(-1)![2] },
            horizontalSpan: 200,
            heightDifference: 0,
            horizontalStress: 50,
            horizontalTension: 15000,
            midSpanSag: 5,
            maxSag: 5,
            maxSagX: 100,
            length: 201,
            swingAngleDeg: 0,
            maxLateralOffset: 0,
            points: points.map(([x, y, z], i) => ({ x, y, z, s: i, tension: 16000 })),
          },
        ],
      },
    ],
  };
}

test('地面净空：最低点低于限值时报告 ground 违规，距离=导线高-地面高', () => {
  const project = baseProject({
    terrain: flatTerrain(100),
    weatherCases: [{ id: 'c1', name: '高温', temperature: 40, ice: 0, windSpeed: 0 }],
  });
  // 导线高 108~105，地面 100 → 最小垂直距离 5 < 7
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i <= 20; i++) pts.push([i * 10, 108 - 3 * Math.sin((i / 20) * Math.PI), 0]);
  const result = wireResult(pts);
  const violations = checkClearances(project, result);
  assert.ok(violations.some((v) => v.kind === 'ground'));
  const worst = violations.filter((v) => v.kind === 'ground').sort((a, b) => b.excess - a.excess)[0];
  assert.ok(Math.abs(worst.distance - 5) < 1e-9);
  assert.ok(Math.abs(worst.limit - 7) < 1e-12);
  assert.ok(Math.abs(worst.excess - 2) < 1e-9);
});

test('树木净空：导线穿入树冠包络时违规，离开后不报', () => {
  const project = baseProject({
    terrain: flatTerrain(100),
    weatherCases: [{ id: 'c1', name: '大风', temperature: 15, ice: 0, windSpeed: 27 }],
    obstacles: [
      {
        type: 'tree',
        tree: {
          id: 'tree1',
          x: 100,
          z: 0,
          baseY: 100,
          height: 12,
          crownRadius: 3,
          trunkRadius: 0.3,
        },
      },
    ],
  });
  // 树冠顶 100+12=112，球心 109、半径 3；导线 y=110 水平穿过 → 净距 0（相交）
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i <= 20; i++) pts.push([i * 10, 110, 0]);
  const result = wireResult(pts);
  const violations = checkClearances(project, result);
  assert.ok(violations.some((v) => v.kind === 'tree' && v.obstacleId === 'tree1'));
  assert.ok(violations[0].distance <= 0.01);

  // 抬高到 120 → 净距 ≈ 120-112=8 > 4，不违规
  const ptsHigh = pts.map(([x, , z]) => [x, 120, z] as [number, number, number]);
  const resultHigh = wireResult(ptsHigh);
  const v2 = checkClearances(project, resultHigh);
  assert.ok(!v2.some((v) => v.kind === 'tree'));
});

test('房屋净空：风工况用 houseWind 限值，无风用 houseVertical', () => {
  const mkProject = (wind: boolean) =>
    baseProject({
      terrain: flatTerrain(100),
      weatherCases: [{ id: 'c1', name: wind ? '大风' : '高温', temperature: 15, ice: 0, windSpeed: wind ? 27 : 0 }],
      obstacles: [
        {
          type: 'house',
          house: {
            id: 'h1',
            x: 100,
            z: 0,
            baseY: 100,
            height: 6,
            halfX: 15,
            halfZ: 8,
            yaw: 0,
          },
        },
      ],
    });
  // 屋顶 106，导线 110 → 垂直距离 4
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i <= 20; i++) pts.push([i * 10, 110, 0]);

  const calm = checkClearances(mkProject(false), wireResult(pts));
  // 4 < houseVertical=5 → 违规
  assert.ok(calm.some((v) => v.kind === 'house' && v.limit === 5));

  const windy = checkClearances(mkProject(true), wireResult(pts));
  // 4 < houseWind=8.5 → 违规，限值取 8.5
  assert.ok(windy.some((v) => v.kind === 'house' && v.limit === 8.5));
});

test('空间哈希粗判：远离线路的障碍不产生开销与误报', () => {
  const project = baseProject({
    terrain: flatTerrain(100),
    weatherCases: [{ id: 'c1', name: '大风', temperature: 15, ice: 0, windSpeed: 27 }],
    obstacles: Array.from({ length: 200 }, (_, i) => ({
      type: 'tree' as const,
      tree: {
        id: `far${i}`,
        x: 9000 + i,
        z: 9000,
        baseY: 100,
        height: 10,
        crownRadius: 2,
        trunkRadius: 0.2,
      },
    })),
  });
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i <= 20; i++) pts.push([i * 10, 108, 0]);
  const violations = checkClearances(project, wireResult(pts));
  assert.ok(violations.length === 0);
});
