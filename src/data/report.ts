// 对比报告：汇总两次复诊的指标对照表、常模偏差、3D 截图、曲线图，
// 渲染为可打印区域，并支持导出独立 HTML 与 CSV 数据表。
import type { GaitMetrics } from '../core/types';
import type { LoadedSession } from '../ui/store';
import { NORM } from '../bvh/gait';

export interface ReportImages {
  view3d: string;     // PNG dataURL
  curves: string;     // PNG dataURL
  heatmap?: string;
}

function fmt(n: number, digits = 1): string {
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

function metricRow(name: string, a: number, b: number | null, unit: string, norm?: number) {
  const delta = b === null ? null : b - a;
  const normCell = norm === undefined ? '—' : `${fmt(norm)}${unit}`;
  return `<tr>
    <td>${name}</td>
    <td>${fmt(a)}${unit}</td>
    <td>${b === null ? '—' : `${fmt(b)}${unit}`}</td>
    <td class="${delta !== null && Math.abs(delta) >= 5 ? 'warn' : ''}">${
      delta === null ? '—' : `${delta >= 0 ? '+' : ''}${fmt(delta)}${unit}`
    }</td>
    <td>${normCell}</td>
  </tr>`;
}

function romBlock(title: string, m: GaitMetrics, side: 'L' | 'R') {
  const rom = side === 'L' ? m.avgRoML : m.avgRoMR;
  return `<div class="rom-sub">${title}
    髋 ${fmt(rom.hip)}° / 膝 ${fmt(rom.knee)}° / 踝 ${fmt(rom.ankle)}°</div>`;
}

export function buildReportHtml(
  primary: LoadedSession,
  compare: LoadedSession | null,
  patientName: string,
  images: ReportImages,
): string {
  const m1 = primary.analysis.metrics;
  const m2 = compare?.analysis.metrics ?? null;
  const now = new Date().toLocaleString('zh-CN');

  const symWarn = m1.symmetryIndex > m1.normSymmetry;
  const stanceDev = Math.abs(m1.stancePctL - m1.normStancePct);

  return `<div class="report-doc">
  <div class="report-head">
    <h2>步态分析对比报告</h2>
    <div class="report-meta">
      <div>患者：<b>${patientName}</b></div>
      <div>年龄段：${m1.ageGroup} 岁组</div>
      <div>初诊：${primary.session.label}（${primary.session.capturedAt.slice(0, 10)}）</div>
      <div>${compare ? `复诊：${compare.session.label}（${compare.session.capturedAt.slice(0, 10)}）` : '复诊：未选择'}</div>
      <div>生成时间：${now}</div>
    </div>
  </div>

  <section>
    <h3>一、核心指标对照</h3>
    <table class="report-table">
      <thead><tr><th>指标</th><th>初诊</th><th>复诊</th><th>变化</th><th>同龄常模</th></tr></thead>
      <tbody>
        ${metricRow('左右步态对称指数', m1.symmetryIndex, m2?.symmetryIndex ?? null, '%', m1.normSymmetry)}
        ${metricRow('左侧支撑相占比', m1.stancePctL, m2?.stancePctL ?? null, '%', m1.normStancePct)}
        ${metricRow('右侧支撑相占比', m1.stancePctR, m2?.stancePctR ?? null, '%', m1.normStancePct)}
        ${metricRow('步频', m1.cadence, m2?.cadence ?? null, ' 步/分', NORM.cadence[m1.ageGroup])}
        ${metricRow('左步态周期时长', m1.cycleDurationL, m2?.cycleDurationL ?? null, ' s')}
        ${metricRow('右步态周期时长', m1.cycleDurationR, m2?.cycleDurationR ?? null, ' s')}
      </tbody>
    </table>
    <div class="rom-box">
      <b>关节活动范围（ROM）</b>
      ${romBlock('初诊 左：', m1, 'L')}
      ${romBlock('初诊 右：', m1, 'R')}
      ${m2 ? romBlock('复诊 左：', m2, 'L') : ''}
      ${m2 ? romBlock('复诊 右：', m2, 'R') : ''}
    </div>
  </section>

  <section>
    <h3>二、临床解读</h3>
    <ul class="clinical">
      <li class="${symWarn ? 'warn' : 'ok'}">对称指数 ${fmt(m1.symmetryIndex)}%，
        ${symWarn ? `高于同龄常模 ${fmt(m1.normSymmetry)}%，提示双侧步态不对称，需关注患侧负重与摆腿。` : '处于同龄正常范围，双侧对称性良好。'}</li>
      <li class="${stanceDev > 6 ? 'warn' : 'ok'}">支撑相占比 左 ${fmt(m1.stancePctL)}% / 右 ${fmt(m1.stancePctR)}%，
        常模约 ${fmt(m1.normStancePct)}%；偏差 ${fmt(stanceDev)} 个百分点。</li>
      <li>步频 ${fmt(m1.cadence)} 步/分，常模参考 ${NORM.cadence[m1.ageGroup]} 步/分。</li>
      ${compare ? `<li class="ok">复诊对比：对称指数变化 ${fmt(m2!.symmetryIndex - m1.symmetryIndex)} 个百分点，
        支撑相左 ${fmt(m2!.stancePctL - m1.stancePctL)} / 右 ${fmt(m2!.stancePctR - m1.stancePctR)} 个百分点。</li>` : ''}
    </ul>
  </section>

  <section>
    <h3>三、三维姿态截图</h3>
    <img class="report-img" src="${images.view3d}" alt="3D 姿态" />
  </section>

  <section>
    <h3>四、关节角度曲线</h3>
    <img class="report-img" src="${images.curves}" alt="关节曲线" />
  </section>

  ${images.heatmap ? `<section><h3>五、周期偏差热力图</h3>
    <img class="report-img" src="${images.heatmap}" alt="热力图" /></section>` : ''}

  <footer>本报告由 GaitLab 自动生成，角度经静止站立帧重新标零，热力偏差基于标准步态曲线常模。仅供临床参考，最终诊断以医师判断为准。</footer>
</div>`;
}

/** 导出指标为 CSV（带 BOM，Excel 可直接打开） */
export function buildMetricsCsv(primary: LoadedSession, compare: LoadedSession | null): string {
  const m1 = primary.analysis.metrics;
  const m2 = compare?.analysis.metrics ?? null;
  const rows: [string, string, string, string][] = [
    ['指标', '初诊', '复诊', '常模'],
    ['对称指数(%)', fmt(m1.symmetryIndex, 2), m2 ? fmt(m2.symmetryIndex, 2) : '', fmt(m1.normSymmetry)],
    ['左支撑相(%)', fmt(m1.stancePctL), m2 ? fmt(m2.stancePctL) : '', fmt(m1.normStancePct)],
    ['右支撑相(%)', fmt(m1.stancePctR), m2 ? fmt(m2.stancePctR) : '', fmt(m1.normStancePct)],
    ['步频(步/分)', fmt(m1.cadence), m2 ? fmt(m2.cadence) : '', fmt(NORM.cadence[m1.ageGroup])],
    ['左周期(s)', fmt(m1.cycleDurationL, 3), m2 ? fmt(m2.cycleDurationL, 3) : '', ''],
    ['右周期(s)', fmt(m1.cycleDurationR, 3), m2 ? fmt(m2.cycleDurationR, 3) : '', ''],
    ['左髋ROM(°)', fmt(m1.avgRoML.hip), m2 ? fmt(m2.avgRoML.hip) : '', ''],
    ['左膝ROM(°)', fmt(m1.avgRoML.knee), m2 ? fmt(m2.avgRoML.knee) : '', ''],
    ['左踝ROM(°)', fmt(m1.avgRoML.ankle), m2 ? fmt(m2.avgRoML.ankle) : '', ''],
    ['右髋ROM(°)', fmt(m1.avgRoMR.hip), m2 ? fmt(m2.avgRoMR.hip) : '', ''],
    ['右膝ROM(°)', fmt(m1.avgRoMR.knee), m2 ? fmt(m2.avgRoMR.knee) : '', ''],
    ['右踝ROM(°)', fmt(m1.avgRoMR.ankle), m2 ? fmt(m2.avgRoMR.ankle) : '', ''],
  ];
  return '﻿' + rows.map((r) => r.join(',')).join('\n');
}
