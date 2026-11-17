/**
 * 应用主控：连接解算引擎、渲染器与界面控件。
 */
import { solveProject, type SolveOptions } from '../core/engine';
import { checkClearances } from '../core/clearance';
import { parseProjectJson, parseTerrainCsv, parseTowersCsv, ImportError } from '../core/importer';
import type { ProjectInput, ProjectResult, Violation } from '../core/types';
import { SceneRenderer, type LayerVisibility } from '../render/SceneRenderer';
import { buildSampleProject } from '../sample/sampleProject';

interface AppState {
  input: ProjectInput | null;
  result: ProjectResult | null;
  activeCaseId: string | null;
  solver: SolveOptions['solver'];
}

const state: AppState = {
  input: null,
  result: null,
  activeCaseId: null,
  solver: 'handbook',
};

let renderer: SceneRenderer | null = null;

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少 DOM 元素 #${id}`);
  return el;
}

function toast(message: string, isError = true): void {
  const existing = document.querySelector('.toast');
  existing?.remove();
  const div = document.createElement('div');
  div.className = 'toast';
  div.textContent = message;
  if (!isError) div.style.borderColor = 'var(--ok)';
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 5000);
}

function fmt(n: number, digits = 2): string {
  return n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function runAnalysis(): void {
  if (!state.input) return;
  const t0 = performance.now();
  const result = solveProject(state.input, { solver: state.solver, tessTolerance: 0.005 });
  const violations = checkClearances(state.input, result);
  const elapsed = performance.now() - t0;
  state.result = result;

  const totalCurves = result.cases.reduce((s, c) => s + c.curves.length, 0);
  $('perfStats').innerHTML = `
    <div class="stat"><div class="label">解算+校核耗时</div><div class="value">${fmt(elapsed, 0)} ms</div></div>
    <div class="stat"><div class="label">曲线总数</div><div class="value">${totalCurves}</div></div>
    <div class="stat"><div class="label">塔位 / 档数</div><div class="value">${state.input.towers.length} / ${state.input.towers.length - 1}</div></div>
    <div class="stat"><div class="label">违规点</div><div class="value" style="color:${violations.length ? 'var(--danger)' : 'var(--ok)'}">${violations.length}</div></div>
  `;

  renderCaseButtons();
  if (!state.activeCaseId && result.cases[0]) {
    state.activeCaseId = result.cases[0].caseId;
  }
  renderer?.setActiveCase(state.activeCaseId);
  renderer?.setScene(state.input, result);
  renderViolationList();
  renderProjectMeta();
}

function renderProjectMeta(): void {
  if (!state.input) return;
  $('projectMeta').innerHTML = `
    <div class="stat-grid">
      <div class="stat"><div class="label">工程名称</div><div class="value" style="font-size:12px">${state.input.name}</div></div>
      <div class="stat"><div class="label">电压等级</div><div class="value" style="font-size:12px">${state.input.voltageKv} kV</div></div>
      <div class="stat"><div class="label">导线型号</div><div class="value" style="font-size:12px">${state.input.phaseConductorIds[0]}</div></div>
      <div class="stat"><div class="label">地形点 / 障碍</div><div class="value" style="font-size:12px">${state.input.terrain ? state.input.terrain.nx * state.input.terrain.nz : 0} / ${state.input.obstacles.length}</div></div>
    </div>
  `;
}

function renderCaseButtons(): void {
  if (!state.input || !state.result) return;
  const box = $('caseButtons');
  box.innerHTML = '';
  for (const cr of state.result.cases) {
    const wc = state.input.weatherCases.find((w) => w.id === cr.caseId)!;
    const btn = document.createElement('button');
    btn.className = 'btn case-btn' + (cr.caseId === state.activeCaseId ? ' active' : '');
    const vioCount = cr.violations.length;
    btn.innerHTML = `
      <span>${wc.name} ${vioCount ? `<span class="badge danger">${vioCount}</span>` : '<span class="badge ok">通过</span>'}</span>
      <span class="sub">${fmt(wc.temperature, 0)}℃ · 冰 ${wc.ice}mm · 风 ${wc.windSpeed}m/s</span>
    `;
    btn.onclick = () => {
      state.activeCaseId = cr.caseId;
      renderer?.setActiveCase(cr.caseId);
      renderCaseButtons();
      renderViolationList();
    };
    box.appendChild(btn);
  }
}

function kindLabel(k: Violation['kind']): string {
  return k === 'ground' ? '对地距离不足' : k === 'tree' ? '对树距离不足' : '对房屋距离不足';
}

function renderViolationList(): void {
  const box = $('violationList');
  if (!state.result || !state.activeCaseId) {
    box.innerHTML = '<div class="empty">暂无数据</div>';
    return;
  }
  const cr = state.result.cases.find((c) => c.caseId === state.activeCaseId);
  if (!cr || cr.violations.length === 0) {
    box.innerHTML = '<div class="empty">该工况下所有净空距离均满足规定限值。</div>';
    return;
  }
  box.innerHTML = '';
  for (const v of cr.violations.slice(0, 200)) {
    const item = document.createElement('div');
    item.className = 'violation-item';
    item.innerHTML = `
      <div class="kind">${kindLabel(v.kind)} <span class="excess">超标 ${fmt(v.excess, 2)} m</span></div>
      <div class="detail">
        第 ${v.spanIndex + 1} 档 · 第 ${v.phaseIndex + 1} 相${v.obstacleId ? ` · ${v.obstacleId}` : ''}<br/>
        实际距离 ${fmt(v.distance, 2)} m ／ 限值 ${fmt(v.limit, 2)} m<br/>
        坐标 (${fmt(v.wirePoint.x, 1)}, ${fmt(v.wirePoint.y, 1)}, ${fmt(v.wirePoint.z, 1)})
      </div>
    `;
    box.appendChild(item);
  }
  if (cr.violations.length > 200) {
    const more = document.createElement('div');
    more.className = 'empty';
    more.textContent = `仅显示前 200 条，共 ${cr.violations.length} 条违规`;
    box.appendChild(more);
  }
}

function loadProject(input: ProjectInput): void {
  state.input = input;
  state.activeCaseId = null;
  runAnalysis();
  toast('工程载入并校核完成', false);
}

async function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function bindFileInputs(): void {
  const projectInput = $('fileProject') as HTMLInputElement;
  projectInput.addEventListener('change', async () => {
    const file = projectInput.files?.[0];
    if (!file || !state.input) return;
    try {
      const text = await readFileText(file);
      const parsed = parseProjectJson(JSON.parse(text));
      loadProject(parsed);
    } catch (e) {
      toast(e instanceof ImportError ? e.message : `工程解析失败：${(e as Error).message}`);
    } finally {
      projectInput.value = '';
    }
  });

  const terrainInput = $('fileTerrain') as HTMLInputElement;
  terrainInput.addEventListener('change', async () => {
    const file = terrainInput.files?.[0];
    if (!file) return;
    if (!state.input) {
      toast('请先载入工程（塔位/导线）再导入地形');
      terrainInput.value = '';
      return;
    }
    try {
      const terrain = parseTerrainCsv(await readFileText(file));
      state.input.terrain = terrain;
      runAnalysis();
      toast(`地形载入：${terrain.nx}×${terrain.nz} 格网`, false);
    } catch (e) {
      toast(e instanceof ImportError ? e.message : `地形解析失败：${(e as Error).message}`);
    } finally {
      terrainInput.value = '';
    }
  });

  const towerInput = $('fileTowers') as HTMLInputElement;
  towerInput.addEventListener('change', async () => {
    const file = towerInput.files?.[0];
    if (!file) return;
    if (!state.input) {
      toast('请先载入工程文件');
      towerInput.value = '';
      return;
    }
    try {
      state.input.towers = parseTowersCsv(await readFileText(file));
      runAnalysis();
      toast(`塔位载入：${state.input.towers.length} 基`, false);
    } catch (e) {
      toast(e instanceof ImportError ? e.message : `塔位解析失败：${(e as Error).message}`);
    } finally {
      towerInput.value = '';
    }
  });
}

function bindLayerToggles(): void {
  const ids: Array<[keyof LayerVisibility, string]> = [
    ['terrain', 'layerTerrain'],
    ['towers', 'layerTowers'],
    ['wires', 'layerWires'],
    ['obstacles', 'layerObstacles'],
    ['violations', 'layerViolations'],
  ];
  for (const [key, id] of ids) {
    $(id).addEventListener('change', (e) => {
      if (!renderer) return;
      renderer.visibility[key] = (e.target as HTMLInputElement).checked;
      renderer.invalidate();
    });
  }
}

function bindSolverToggle(): void {
  $('solverSelect').addEventListener('change', (e) => {
    state.solver = (e.target as HTMLSelectElement).value as SolveOptions['solver'];
    runAnalysis();
  });
}

export function startApp(): void {
  const canvas = $('glCanvas') as HTMLCanvasElement;
  renderer = new SceneRenderer(canvas);
  bindFileInputs();
  bindLayerToggles();
  bindSolverToggle();

  $('btnSample').addEventListener('click', () => loadProject(buildSampleProject()));
  $('btnFileProject').addEventListener('click', () => $('fileProject').click());
  $('btnFileTerrain').addEventListener('click', () => $('fileTerrain').click());
  $('btnFileTowers').addEventListener('click', () => $('fileTowers').click());

  // 首屏自动载入示例，便于直接看到三工况与违规标记效果
  loadProject(buildSampleProject());
}
