// 对比报告页：指标卡对照、3D 姿态截图、曲线截图、可打印报告、HTML/CSV 导出
import { store } from './store';
import { buildReportHtml, buildMetricsCsv } from '../data/report';
import { GaitRenderer } from '../render/renderer';
import { evaluatePose } from '../bvh/skeleton';
import { NORM } from '../bvh/gait';

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 离屏渲染一帧 3D 姿态为 PNG dataURL */
function render3dSnapshot(loaded: NonNullable<ReturnType<typeof snapshotReady>>): string {
  const canvas = document.createElement('canvas');
  canvas.width = 900; canvas.height = 560;
  const renderer = new GaitRenderer(canvas);
  const rest = evaluatePose(loaded.session.bvh, loaded.angles.referenceFrame);
  renderer.addActor(loaded.session.bvh, rest, { alpha: 1, showRig: true });
  // 取步态中段一帧（更具代表性）
  const mid = Math.floor(loaded.session.bvh.frameCount * 0.4);
  const pose = evaluatePose(loaded.session.bvh, mid);
  renderer.render([pose]);
  const url = renderer.snapshot();
  return url;
}

function snapshotReady() {
  return store.state.primary;
}

/** 把角度曲线绘制到离屏 canvas 生成报告插图 */
function renderCurvesSnapshot(): string {
  const loaded = store.state.primary!;
  const frames = loaded.angles.frames;
  const canvas = document.createElement('canvas');
  const W = 1200, H = 520;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  const padL = 60, padR = 20, padT = 40, padB = 40;
  const plotW = W - padL - padR;
  const plotH = (H - padT - padB) / 3;
  const n = frames.length;

  const groups = [
    { title: '髋屈曲 (°)', l: 'hipFlexL', r: 'hipFlexR', cl: '#2b6cb0', cr: '#c53030' },
    { title: '膝屈曲 (°)', l: 'kneeFlexL', r: 'kneeFlexR', cl: '#2f855a', cr: '#b7791f' },
    { title: '踝背屈 (°)', l: 'ankleDorsiL', r: 'ankleDorsiR', cl: '#6b46c1', cr: '#0e7490' },
  ] as const;

  groups.forEach((g, gi) => {
    const top = padT + gi * plotH;
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = top + (plotH * i) / 5;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    }
    ctx.fillStyle = '#1a202c';
    ctx.font = '14px sans-serif';
    ctx.fillText(g.title, padL, top - 12);

    const valsL = frames.map((f) => f[g.l]);
    const valsR = frames.map((f) => f[g.r]);
    const all = [...valsL, ...valsR];
    let lo = Math.min(...all), hi = Math.max(...all);
    if (hi - lo < 1) { hi += 1; lo -= 1; }
    const yOf = (v: number) => top + plotH - ((v - lo) / (hi - lo)) * (plotH - 10) - 5;
    const xOf = (i: number) => padL + (i / (n - 1)) * plotW;

    const drawLine = (vals: number[], color: string) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1.6;
      ctx.beginPath();
      vals.forEach((v, i) => {
        const x = xOf(i), y = yOf(v);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };
    drawLine(valsL, g.cl);
    drawLine(valsR, g.cr);
    ctx.fillStyle = g.cl; ctx.fillText('— 左', W - 120, top - 12);
    ctx.fillStyle = g.cr; ctx.fillText('— 右', W - 80, top - 12);
  });

  ctx.fillStyle = '#718096';
  ctx.font = '12px sans-serif';
  ctx.fillText('步态时间 →', W - 100, H - 14);
  return canvas.toDataURL('image/png');
}

export function renderReportView(root: HTMLElement): () => void {
  root.innerHTML = `
  <div class="view">
    <div id="rpEmpty" class="empty card"><div class="ico">📋</div>请先设置主会话以生成报告</div>
    <div id="rpBody" class="hidden">
      <div class="card">
        <h3>核心指标速览（初诊 vs 同龄常模）</h3>
        <div class="metric-grid" id="metricGrid"></div>
      </div>
      <div class="report-actions">
        <button class="btn" id="genBtn">生成对比报告</button>
        <button class="btn ghost" id="printBtn">打印 / 存 PDF</button>
        <button class="btn ghost" id="htmlBtn">导出报告 HTML</button>
        <button class="btn ghost" id="csvBtn">导出数据表 CSV</button>
      </div>
      <div id="reportOutlet"></div>
    </div>
  </div>`;

  const empty = root.querySelector('#rpEmpty') as HTMLElement;
  const body = root.querySelector('#rpBody') as HTMLElement;
  const outlet = root.querySelector('#reportOutlet') as HTMLElement;

  function drawMetrics() {
    const loaded = store.state.primary;
    if (!loaded) return;
    const m = loaded.analysis.metrics;
    const grid = root.querySelector('#metricGrid')!;
    const symWarn = m.symmetryIndex > m.normSymmetry;
    const stanceWarn = Math.abs(m.stancePctL - m.normStancePct) > 6;
    const card = (k: string, v: string, norm: string, warn = false) =>
      `<div class="metric ${warn ? 'warn' : ''}"><div class="v">${v}</div><div class="k">${k}</div><div class="n">常模 ${norm}</div></div>`;
    grid.innerHTML = [
      card('对称指数', m.symmetryIndex.toFixed(1) + '%', '≤' + m.normSymmetry + '%', symWarn),
      card('左支撑相', m.stancePctL.toFixed(1) + '%', m.normStancePct + '%', stanceWarn),
      card('右支撑相', m.stancePctR.toFixed(1) + '%', m.normStancePct + '%', stanceWarn),
      card('步频', m.cadence.toFixed(0) + ' 步/分', NORM.cadence[m.ageGroup] + ' 步/分'),
      card('左周期', m.cycleDurationL.toFixed(2) + 's', '—'),
      card('右周期', m.cycleDurationR.toFixed(2) + 's', '—'),
    ].join('');
  }

  function generate() {
    const primary = store.state.primary!;
    const compare = store.state.compare;
    const patientName = store.state.currentPatient?.name ?? '未命名患者';
    const view3d = render3dSnapshot(primary);
    const curves = renderCurvesSnapshot();
    outlet.innerHTML = buildReportHtml(primary, compare, patientName, { view3d, curves });
    outlet.querySelector('.report-doc')?.classList.add('printable');
  }

  root.querySelector('#genBtn')!.addEventListener('click', generate);
  root.querySelector('#printBtn')!.addEventListener('click', () => {
    if (!outlet.querySelector('.report-doc')) generate();
    setTimeout(() => window.print(), 100);
  });
  root.querySelector('#htmlBtn')!.addEventListener('click', () => {
    const primary = store.state.primary!;
    const doc = outlet.querySelector('.report-doc')?.outerHTML;
    if (!doc) { toast2('请先生成报告'); return; }
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>步态报告</title>
      <style>body{font-family:sans-serif;max-width:980px;margin:20px auto;color:#1a1d21}
      table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e0;padding:8px;text-align:center}
      th{background:#edf2f7}.report-img{width:100%;border:1px solid #e2e8f0;border-radius:8px}
      h3{border-left:4px solid #2b6cb0;padding-left:10px}</style></head><body>${doc}</body></html>`;
    download(`${primary.session.label}_步态报告.html`, html, 'text/html');
  });
  root.querySelector('#csvBtn')!.addEventListener('click', () => {
    const primary = store.state.primary!;
    download(`${primary.session.label}_指标.csv`,
      buildMetricsCsv(primary, store.state.compare), 'text/csv');
  });

  function toast2(msg: string) {
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  function activate() {
    const has = !!store.state.primary;
    empty.classList.toggle('hidden', has);
    body.classList.toggle('hidden', !has);
    if (has) drawMetrics();
  }
  const unsub = store.subscribe(activate);
  activate();
  return unsub;
}
