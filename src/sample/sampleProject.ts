/**
 * 示例工程构造（纯数据，浏览器与 Node 共用）。
 * 30 基塔山区线路，含地形、树、房、三工况。
 */
import type { ConductorType, ProjectInput, TerrainGrid } from '../core/types';
import { terrainHeightAt } from '../core/clearance';

export const LGJ30025: ConductorType = {
  id: 'LGJ-300/25',
  name: 'LGJ-300/25 钢芯铝绞线',
  area: 333.31,
  diameter: 23.76,
  massPerLength: 1.058,
  elasticModulus: 65000,
  expansionCoeff: 20.5e-6,
  ratedTensileStrength: 83410,
  bundleN: 1,
};

export function buildSampleProject(): ProjectInput {
  const nTowers = 30;
  const towerXZ = Array.from({ length: nTowers }, (_, i) => {
    const x = i * 320;
    const z = Math.sin(i * 0.45) * 60 + Math.cos(i * 0.17) * 25;
    return { x, z };
  });

  const minX = -150;
  const maxX = (nTowers - 1) * 320 + 150;
  const minZ = -250;
  const maxZ = 250;
  const cell = 25;
  const nx = Math.ceil((maxX - minX) / cell) + 1;
  const nz = Math.ceil((maxZ - minZ) / cell) + 1;
  const heights = new Float64Array(nx * nz);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const x = minX + ix * cell;
      const z = minZ + iz * cell;
      const h =
        120 +
        16 * Math.sin(x / 900) +
        10 * Math.cos(x / 350 + 1.2) * Math.exp(-(z * z) / 40000) +
        7 * Math.sin(z / 120 + x / 600) +
        3 * Math.cos(x / 90 + z / 70);
      heights[iz * nx + ix] = h;
    }
  }
  // 在第 15 档（塔 15~16）导线下方叠加一处山丘，制造对地净空不足
  {
    const hillX = 320 * 14 + 160;
    const hillZ = (towerXZ[14].z + towerXZ[15].z) / 2;
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const x = minX + ix * cell;
        const z = minZ + iz * cell;
        const d2 = (x - hillX) ** 2 + (z - hillZ) ** 2;
        heights[iz * nx + ix] += 30 * Math.exp(-d2 / (2 * 70 * 70));
      }
    }
  }
  const terrain: TerrainGrid = { originX: minX, originZ: minZ, cell, nx, nz, heights };

  // 塔基高程严格取 DEM 插值，保证塔立在地形表面
  const towers = towerXZ.map((p, i) => ({
    id: `T${String(i + 1).padStart(2, '0')}`,
    label: `${i + 1}号塔`,
    x: p.x,
    z: p.z,
    groundY: terrainHeightAt(terrain, p.x, p.z),
    attachmentHeights: [36, 44, 36] as [number, number, number],
    attachmentOffsets: [-9, 0, 9] as [number, number, number],
    isStrain: i === 0 || i === 9 || i === 19 || i === 29,
  }));

  const obstacles: ProjectInput['obstacles'] = [];
  for (let i = 0; i < 90; i++) {
    const x = 180 + i * 95 + (i % 3) * 20;
    const nearLine = i % 4 === 0;
    const z = nearLine ? Math.sin(x / 320) * 12 + (i % 2 ? 6 : -6) : 80 + Math.sin(i) * 100;
    obstacles.push({
      type: 'tree',
      tree: {
        id: `TR${String(i + 1).padStart(3, '0')}`,
        x,
        z,
        baseY: terrainHeightAt(terrain, x, z),
        height: 9 + (i % 6) * 1.5,
        crownRadius: 2.5 + (i % 3) * 0.5,
        trunkRadius: 0.25,
      },
    });
  }
  // 刻意布置的超高树（对准导线正下方，高温工况触发对树净空违规）
  // 位置取对应档中点的实际导线平面坐标
  const hotSpans: Array<[number, number]> = [
    [4, 320 * 4 + 150],
    [11, 320 * 11 + 160],
    [20, 320 * 20 + 140],
  ];
  hotSpans.forEach(([spanIdx, x], i) => {
    const a = towers[spanIdx];
    const b = towers[spanIdx + 1];
    const frac = (x - a.x) / (b.x - a.x);
    const z = a.z + (b.z - a.z) * frac + 2; // 略偏 2m，仍在树冠包络内
    obstacles.push({
      type: 'tree',
      tree: {
        id: `TR-HIGH-${i + 1}`,
        x,
        z,
        baseY: terrainHeightAt(terrain, x, z),
        height: 34,
        crownRadius: 4,
        trunkRadius: 0.4,
      },
    });
  });
  // 刻意布置的靠线房屋（横线路侧 10m，大风风偏时触发对房屋净空违规）
  const windSpans: Array<[number, number]> = [
    [7, 320 * 7 + 170],
    [16, 320 * 16 + 150],
  ];
  windSpans.forEach(([spanIdx, x], i) => {
    const a = towers[spanIdx];
    const b = towers[spanIdx + 1];
    const frac = (x - a.x) / (b.x - a.x);
    const z = a.z + (b.z - a.z) * frac - 4;
    obstacles.push({
      type: 'house',
      house: {
        id: `HS-NEAR-${i + 1}`,
        x,
        z,
        baseY: terrainHeightAt(terrain, x, z),
        height: 22,
        halfX: 14,
        halfZ: 9,
        yaw: 0.15,
      },
    });
  });
  for (let i = 0; i < 12; i++) {
    const x = 600 + i * 720;
    const z = -55 + (i % 2) * 110;
    obstacles.push({
      type: 'house',
      house: {
        id: `HS${String(i + 1).padStart(2, '0')}`,
        x,
        z,
        baseY: terrainHeightAt(terrain, x, z),
        height: 6 + (i % 3) * 2,
        halfX: 14,
        halfZ: 9,
        yaw: (i % 2) * 0.25,
      },
    });
  }

  return {
    name: '山区 110kV 示例线路（30 基塔）',
    voltageKv: 110,
    region: 'nonResidential',
    conductors: [LGJ30025],
    phaseConductorIds: ['LGJ-300/25', 'LGJ-300/25', 'LGJ-300/25'] as [string, string, string],
    towers,
    weatherCases: [
      { id: 'high-temp', name: '高温（+40℃ 无风）', temperature: 40, ice: 0, windSpeed: 0 },
      { id: 'ice', name: '覆冰（-5℃ 10mm 10m/s）', temperature: -5, ice: 10, windSpeed: 10 },
      { id: 'gale', name: '大风（15℃ 27m/s）', temperature: 15, ice: 0, windSpeed: 27 },
    ],
    tensionSections: [
      { fromTower: 0, toTower: 9, reference: { temperature: 15, ice: 0, windSpeed: 0, stress: 53.4 } },
      { fromTower: 9, toTower: 19, reference: { temperature: 15, ice: 0, windSpeed: 0, stress: 53.4 } },
      { fromTower: 19, toTower: 29, reference: { temperature: 15, ice: 0, windSpeed: 0, stress: 53.4 } },
    ],
    terrain,
    obstacles,
    limits: {
      groundResidential: 7.0,
      groundNonResidential: 6.0,
      groundDifficult: 5.0,
      treeWind: 4.0,
      houseVertical: 5.0,
      houseWind: 8.5,
    },
  };
}
