/**
 * 工程数据导入与校验
 *
 * 支持：
 *  - 完整工程 JSON（schema 见 ProjectInput）；
 *  - 地形 XYZ CSV（每行 x,z,y，空格/逗号/制表符分隔，自动推断格网）；
 *  - 塔位 CSV（id,x,z,groundY,h0,h1,h2,off0,off1,off2,isStrain）。
 * 导入时做结构与数值范围校验，错误以中文异常信息抛出并定位字段。
 */
import type { ProjectInput, TerrainGrid, Tower } from './types';

export class ImportError extends Error {
  constructor(
    message: string,
    readonly path?: string,
  ) {
    super(path ? `${message}（${path}）` : message);
    this.name = 'ImportError';
  }
}

function requireNumber(obj: Record<string, unknown>, key: string, path: string): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ImportError(`字段 "${key}" 必须是有限数值，收到 ${JSON.stringify(v)}`, path);
  }
  return v;
}

function requireString(obj: Record<string, unknown>, key: string, path: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new ImportError(`字段 "${key}" 必须是非空字符串`, path);
  }
  return v;
}

function asTriple(v: unknown, key: string, path: string): [number, number, number] {
  if (!Array.isArray(v) || v.length !== 3 || v.some((x) => typeof x !== 'number' || !Number.isFinite(x))) {
    throw new ImportError(`字段 "${key}" 必须是 3 个数值的数组`, path);
  }
  return [v[0], v[1], v[2]];
}

function asStringTriple(v: unknown, key: string, path: string): [string, string, string] {
  if (!Array.isArray(v) || v.length !== 3 || v.some((x) => typeof x !== 'string' || !x)) {
    throw new ImportError(`字段 "${key}" 必须是 3 个非空字符串的数组`, path);
  }
  return [v[0], v[1], v[2]];
}

/** 校验并规范化完整工程 JSON */
export function parseProjectJson(raw: unknown): ProjectInput {
  if (typeof raw !== 'object' || raw === null) throw new ImportError('工程文件根节点必须是对象');
  const o = raw as Record<string, unknown>;
  const path = 'project';

  const conductors = (o.conductors as ProjectInput['conductors']) ?? [];
  if (!Array.isArray(conductors) || conductors.length === 0) {
    throw new ImportError('conductors 至少包含一种导线型号', path);
  }
  const conductorIds = new Set<string>();
  for (const [i, c] of conductors.entries()) {
    const co = c as unknown as Record<string, unknown>;
    requireString(co, 'id', `${path}.conductors[${i}]`);
    requireString(co, 'name', `${path}.conductors[${i}]`);
    for (const k of ['area', 'diameter', 'massPerLength', 'elasticModulus', 'expansionCoeff', 'ratedTensileStrength']) {
      const num = requireNumber(co, k, `${path}.conductors[${i}]`);
      if (num <= 0) throw new ImportError(`${k} 必须为正数`, `${path}.conductors[${i}]`);
    }
    if (typeof co.bundleN !== 'number' || co.bundleN < 1) {
      throw new ImportError('bundleN 必须是 ≥1 的整数', `${path}.conductors[${i}]`);
    }
    conductorIds.add(co.id as string);
  }

  const phaseIds = asStringTriple(o.phaseConductorIds, 'phaseConductorIds', path);
  for (const id of phaseIds) {
    if (!conductorIds.has(id)) throw new ImportError(`phaseConductorIds 引用了未定义的导线型号 ${id}`, path);
  }

  const towers = o.towers as Tower[] | undefined;
  if (!Array.isArray(towers) || towers.length < 2) {
    throw new ImportError('towers 至少需要 2 基塔', path);
  }
  for (const [i, t] of towers.entries()) {
    const to = t as unknown as Record<string, unknown>;
    requireString(to, 'id', `${path}.towers[${i}]`);
    requireNumber(to, 'x', `${path}.towers[${i}]`);
    requireNumber(to, 'z', `${path}.towers[${i}]`);
    requireNumber(to, 'groundY', `${path}.towers[${i}]`);
    asTriple(to.attachmentHeights, 'attachmentHeights', `${path}.towers[${i}]`);
    asTriple(to.attachmentOffsets, 'attachmentOffsets', `${path}.towers[${i}]`);
  }

  const weatherCases = o.weatherCases as ProjectInput['weatherCases'] | undefined;
  if (!Array.isArray(weatherCases) || weatherCases.length === 0) {
    throw new ImportError('weatherCases 至少包含一个工况', path);
  }
  const caseIds = new Set<string>();
  for (const [i, w] of weatherCases.entries()) {
    const wo = w as unknown as Record<string, unknown>;
    const id = requireString(wo, 'id', `${path}.weatherCases[${i}]`);
    if (caseIds.has(id)) throw new ImportError(`工况 id 重复：${id}`, `${path}.weatherCases[${i}]`);
    caseIds.add(id);
    requireNumber(wo, 'temperature', `${path}.weatherCases[${i}]`);
    const ice = requireNumber(wo, 'ice', `${path}.weatherCases[${i}]`);
    const wind = requireNumber(wo, 'windSpeed', `${path}.weatherCases[${i}]`);
    if (ice < 0 || wind < 0) throw new ImportError('ice 与 windSpeed 不能为负', `${path}.weatherCases[${i}]`);
  }

  const limits = o.limits as ProjectInput['limits'] | undefined;
  if (!limits) throw new ImportError('缺少 limits 净空限值定义', path);
  for (const k of [
    'groundResidential',
    'groundNonResidential',
    'groundDifficult',
    'treeWind',
    'houseVertical',
    'houseWind',
  ] as const) {
    const v = limits[k];
    if (typeof v !== 'number' || v <= 0) throw new ImportError(`limits.${k} 必须为正数`, path);
  }

  // 地形/障碍为可选，存在则校验 Float64Array（JSON 导入后是普通数组，转换之）
  let terrain = o.terrain as ProjectInput['terrain'];
  if (terrain) {
    const t = terrain as unknown as Record<string, unknown>;
    requireNumber(t, 'originX', `${path}.terrain`);
    requireNumber(t, 'originZ', `${path}.terrain`);
    const cell = requireNumber(t, 'cell', `${path}.terrain`);
    const nx = requireNumber(t, 'nx', `${path}.terrain`);
    const nz = requireNumber(t, 'nz', `${path}.terrain`);
    if (!(cell > 0) || nx < 2 || nz < 2) throw new ImportError('地形 cell/nx/nz 非法', `${path}.terrain`);
    const arr = t.heights;
    if (!Array.isArray(arr) || arr.length !== nx * nz) {
      throw new ImportError(`地形 heights 长度应为 ${nx * nz}`, `${path}.terrain`);
    }
    terrain = { ...(terrain as TerrainGrid), heights: Float64Array.from(arr as number[]) };
  }

  return {
    name: typeof o.name === 'string' ? o.name : '未命名工程',
    voltageKv: typeof o.voltageKv === 'number' ? o.voltageKv : 110,
    region: o.region === 'residential' || o.region === 'difficult' ? o.region : 'nonResidential',
    conductors,
    phaseConductorIds: phaseIds,
    towers,
    weatherCases,
    tensionSections: (o.tensionSections as ProjectInput['tensionSections']) ?? [],
    terrain,
    obstacles: (o.obstacles as ProjectInput['obstacles']) ?? [],
    limits,
  };
}

/** 解析 XYZ 地形文本（支持逗号/空格/Tab 分隔，# 开头注释） */
export function parseTerrainCsv(text: string): TerrainGrid {
  const rows: Array<[number, number, number]> = [];
  const lines = text.split(/\r?\n/);
  for (const [lineNo, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/[,\s]+/).filter(Boolean);
    if (parts.length < 3) {
      throw new ImportError(`第 ${lineNo + 1} 行需要 x,z,y 三列`);
    }
    const nums = parts.slice(0, 3).map(Number);
    if (nums.some((n) => !Number.isFinite(n))) {
      throw new ImportError(`第 ${lineNo + 1} 行含非数值`, 'terrain-csv');
    }
    rows.push([nums[0], nums[1], nums[2]]);
  }
  if (rows.length < 4) throw new ImportError('地形数据至少 4 个点');

  const xs = [...new Set(rows.map((r) => r[0]))].sort((a, b) => a - b);
  const zs = [...new Set(rows.map((r) => r[1]))].sort((a, b) => a - b);
  const dxs = xs.slice(1).map((x, i) => x - xs[i]);
  const dzs = zs.slice(1).map((z, i) => z - zs[i]);
  const cell = dxs[0];
  if (dxs.some((d) => Math.abs(d - cell) > 1e-6) || dzs.some((d) => Math.abs(d - cell) > 1e-6)) {
    throw new ImportError('XYZ 点必须构成等间距规则格网（dx=dz）');
  }
  const nx = xs.length;
  const nz = zs.length;
  const heights = new Float64Array(nx * nz);
  const ixOf = new Map(xs.map((x, i) => [x, i]));
  const izOf = new Map(zs.map((z, i) => [z, i]));
  for (const [x, z, y] of rows) {
    heights[izOf.get(z)! * nx + ixOf.get(x)!] = y;
  }
  return { originX: xs[0], originZ: zs[0], cell, nx, nz, heights };
}

/** 解析塔位 CSV */
export function parseTowersCsv(text: string): Tower[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (lines.length < 2) throw new ImportError('塔位 CSV 需要表头加至少一行数据');
  const header = lines[0].split(/[,\s]+/).map((s) => s.trim());
  const required = ['id', 'x', 'z', 'groundY', 'h0', 'h1', 'h2', 'off0', 'off1', 'off2'];
  for (const k of required) {
    if (!header.includes(k)) throw new ImportError(`塔位 CSV 缺少列 ${k}`);
  }
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  return lines.slice(1).map((line, rowIdx): Tower => {
    const c = line.split(/[,\s]+/);
    const num = (k: string): number => {
      const v = Number(c[idx[k]]);
      if (!Number.isFinite(v)) throw new ImportError(`塔位第 ${rowIdx + 2} 行列 ${k} 非数值`);
      return v;
    };
    return {
      id: c[idx.id],
      x: num('x'),
      z: num('z'),
      groundY: num('groundY'),
      attachmentHeights: [num('h0'), num('h1'), num('h2')],
      attachmentOffsets: [num('off0'), num('off1'), num('off2')],
      isStrain: (c[idx.isStrain] ?? '').trim().toLowerCase() === 'true',
    };
  });
}
