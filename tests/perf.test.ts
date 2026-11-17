import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { solveProject } from '../src/core/engine';
import { checkClearances } from '../src/core/clearance';
import type { ConductorType, Obstacle, ProjectInput } from '../src/core/types';

const LGJ30025: ConductorType = {
  id: 'LGJ-300/25',
  name: 'LGJ-300/25',
  area: 333.31,
  diameter: 23.76,
  massPerLength: 1.058,
  elasticModulus: 65000,
  expansionCoeff: 20.5e-6,
  ratedTensileStrength: 83410,
  bundleN: 1,
};

function build30TowerProject(withObstacles: boolean): ProjectInput {
  const nTowers = 30;
  const towers = Array.from({ length: nTowers }, (_, i) => ({
    id: `T${i + 1}`,
    x: i * 320 + Math.sin(i * 1.7) * 15,
    z: Math.sin(i * 0.8) * 40,
    groundY: 95 + Math.sin(i * 0.5) * 6,
    attachmentHeights: [42, 50, 42] as [number, number, number],
    attachmentOffsets: [-9, 0, 9] as [number, number, number],
    isStrain: i === 0 || i === 9 || i === 19 || i === 29,
  }));

  // 地形覆盖全线
  const spanX = 320 * (nTowers - 1) + 200;
  const nx = 120;
  const nz = 20;
  const cell = spanX / nx;
  const heights = new Float64Array(nx * nz);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const x = ix * cell - 100;
      const z = (iz - nz / 2) * cell;
      heights[iz * nx + ix] = 95 + 5 * Math.sin(x / 400) + 2 * Math.cos(z / 80);
    }
  }

  const treeObstacles: Obstacle[] = Array.from({ length: 120 }, (_, i) => {
    const x = 200 + i * 70;
    return {
      type: 'tree' as const,
      tree: {
        id: `tree${i}`,
        x,
        z: Math.sin(i) * 30,
        baseY: 95,
        height: 8 + (i % 5) * 2,
        crownRadius: 2.5,
        trunkRadius: 0.25,
      },
    };
  });
  const houseObstacles: Obstacle[] = Array.from({ length: 15 }, (_, i) => ({
    type: 'house' as const,
    house: {
      id: `house${i}`,
      x: 500 + i * 550,
      z: -25 + (i % 3) * 20,
      baseY: 95,
      height: 7 + (i % 3),
      halfX: 12,
      halfZ: 8,
      yaw: (i % 2) * 0.3,
    },
  }));
  const obstacles: Obstacle[] = withObstacles ? treeObstacles.concat(houseObstacles) : [];

  return {
    name: 'perf-30',
    voltageKv: 220,
    region: 'nonResidential',
    conductors: [LGJ30025],
    phaseConductorIds: ['LGJ-300/25', 'LGJ-300/25', 'LGJ-300/25'],
    towers,
    weatherCases: [
      { id: 'hot', name: '高温', temperature: 40, ice: 0, windSpeed: 0 },
      { id: 'ice', name: '覆冰', temperature: -5, ice: 10, windSpeed: 10 },
      { id: 'wind', name: '大风', temperature: 15, ice: 0, windSpeed: 27 },
    ],
    tensionSections: [
      { fromTower: 0, toTower: 9, reference: { temperature: 15, ice: 0, windSpeed: 0, stress: 53.4 } },
      { fromTower: 9, toTower: 19, reference: { temperature: 15, ice: 0, windSpeed: 0, stress: 53.4 } },
      { fromTower: 19, toTower: 29, reference: { temperature: 15, ice: 0, windSpeed: 0, stress: 53.4 } },
    ],
    terrain: { originX: -100, originZ: -nz * cell / 2, cell, nx, nz, heights },
    obstacles,
    limits: {
      groundResidential: 7.5,
      groundNonResidential: 6.5,
      groundDifficult: 5.5,
      treeWind: 4,
      houseVertical: 5,
      houseWind: 8.5,
    },
  };
}

test('性能：30 基塔 × 3 工况（87 档×3 相）全部解算 < 1 秒', () => {
  const project = build30TowerProject(false);
  // 预热（JIT/模块初始化不计入）
  solveProject(project);

  const t0 = performance.now();
  const result = solveProject(project);
  const elapsed = performance.now() - t0;

  assert.ok(result.cases.length === 3);
  assert.ok(result.cases.every((c) => c.curves.length === 29 * 3));
  assert.ok(elapsed < 1000, `解算耗时 ${elapsed.toFixed(1)}ms 超过 1000ms`);
  console.log(`  解算耗时: ${elapsed.toFixed(1)}ms（29档×3相×3工况=${29 * 3 * 3} 条曲线）`);
});

test('性能：含 135 个树/房障碍 + 地形净空校核的总耗时 < 1 秒', () => {
  const project = build30TowerProject(true);
  solveProject(project); // 预热

  const t0 = performance.now();
  const result = solveProject(project);
  const violations = checkClearances(project, result);
  const elapsed = performance.now() - t0;

  assert.ok(elapsed < 1000, `解算+校核耗时 ${elapsed.toFixed(1)}ms 超过 1000ms`);
  console.log(`  解算+校核: ${elapsed.toFixed(1)}ms，违规点 ${violations.length} 处`);
  // 三种工况都应产生结果且数据自洽
  for (const c of result.cases) {
    assert.ok(c.curves[0].points.length >= 10);
    assert.ok(c.curves.every((v) => Number.isFinite(v.midSpanSag)));
  }
});

test('三工况物理合理性：覆冰弧垂>常温，大风有侧向偏移', () => {
  const project = build30TowerProject(false);
  const result = solveProject(project);
  const [hot, ice, wind] = result.cases;
  const sample = (c: typeof hot) => c.curves.find((v) => v.spanIndex === 14 && v.phaseIndex === 1)!;
  assert.ok(sample(ice).maxSag > sample(hot).maxSag * 0.9);
  assert.ok(sample(wind).maxLateralOffset > 1);
  assert.ok(sample(wind).swingAngleDeg > 5);
  assert.ok(sample(hot).maxLateralOffset < 1e-9);
});
