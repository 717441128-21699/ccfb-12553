// 关节曲线页：髋膝踝角度曲线（与动画时间轴同步）、EMG 包络同轴叠加、
// 步态周期百分比偏差热力条、步态事件标记。
import { store } from './store';
import { TimeChart, type SeriesSpec } from '../charts/TimeChart';
import { createHeatBar, heatLegend, type HeatBarHandle } from '../charts/HeatBar';
import {
  resampleCycle, averageCycles, type JointKey,
} from '../data/normative';

const COLORS = {
  hipL: '#5999e0', hipR: '#e07266',
  kneeL: '#65d6ad', kneeR: '#e8c468',
  ankleL: '#b48ce0', ankleR: '#7fd4e8',
  emg: 'rgba(255,150,80,0.9)',
  norm: '#9aa5b1',
};

export function renderCurvesView(root: HTMLElement): () => void {
  root.innerHTML = `
  <div class="view">
    <div id="cvEmpty" class="empty card"><div class="ico">📉</div>请先在“动捕载入”页设置主会话</div>
    <div id="cvBody" class="hidden">
      <div class="card">
        <h3>矢状面关节角度（与 3D 动画时间轴同步，可在曲线上拖动定位）</h3>
        <div id="angleCharts"></div>
      </div>
      <div class="card">
        <h3>肌电包络 × 关节角度（同一时间轴，观察肌肉发力时序）</h3>
        <div id="emgCharts"></div>
      </div>
      <div class="card">
        <h3>相对标准步态曲线的周期偏差热力条（按步态周期 %）</h3>
        <div id="heatBars"></div>
      </div>
    </div>
  </div>`;

  const empty = root.querySelector('#cvEmpty') as HTMLElement;
  const body = root.querySelector('#cvBody') as HTMLElement;
  let charts: TimeChart[] = [];
  let heatbars: HeatBarHandle[] = [];
  let raf = 0;
  let disposed = false;

  function build() {
    const loaded = store.state.primary;
    if (!loaded) return;
    const bvh = loaded.session.bvh;
    const frames = loaded.angles.frames;
    const events = loaded.analysis.events;
    const markers = events.map((e) => ({
      frame: e.frame,
      color: e.type === 'HS' ? 'rgba(101,214,173,0.8)' : 'rgba(232,196,104,0.8)',
      label: (e.side === 'L' ? '左' : '右') + (e.type === 'HS' ? '着地' : '离地'),
    }));

    const angleHost = root.querySelector('#angleCharts')!;
    angleHost.innerHTML = '';
    charts = [];

    const mk = (title: string, series: SeriesSpec[], yLabel: string) => {
      const wrap = document.createElement('div');
      wrap.className = 'chart-wrap';
      wrap.innerHTML = `<div class="chart-title">${title}</div>`;
      const cv = document.createElement('canvas');
      cv.style.height = '190px';
      wrap.appendChild(cv);
      angleHost.appendChild(wrap);
      const chart = new TimeChart(cv, {
        frameTime: bvh.frameTime, series, cursor: store.state.playTime / bvh.frameTime,
        markers, yLabel,
        onSeek: (frame) => {
          store.set({ playTime: frame * bvh.frameTime, playing: false });
        },
      });
      charts.push(chart);
    };

    const n = frames.length;
    const arr = (k: keyof typeof frames[number]) =>
      Float32Array.from(frames.map((f) => f[k]));

    mk('髋关节屈曲角（°）', [
      { label: '左髋', color: COLORS.hipL, values: arr('hipFlexL') },
      { label: '右髋', color: COLORS.hipR, values: arr('hipFlexR') },
    ], '屈曲 °');
    mk('膝关节屈曲角（°）', [
      { label: '左膝', color: COLORS.kneeL, values: arr('kneeFlexL') },
      { label: '右膝', color: COLORS.kneeR, values: arr('kneeFlexR') },
    ], '屈曲 °');
    mk('踝关节背屈角（°，正=背屈）', [
      { label: '左踝', color: COLORS.ankleL, values: arr('ankleDorsiL') },
      { label: '右踝', color: COLORS.ankleR, values: arr('ankleDorsiR') },
    ], '背屈 °');

    // EMG 同轴：每块肌肉一条，归一化包络与同侧关节角共用时间轴
    const emgHost = root.querySelector<HTMLElement>('#emgCharts')!;
    emgHost.innerHTML = '';
    if (loaded.session.emg.length === 0) {
      emgHost.innerHTML = '<div class="empty">本次会话未载入 EMG 数据</div>';
    } else {
      for (const ch of loaded.session.emg) {
        const wrap = document.createElement('div');
        wrap.className = 'chart-wrap';
        const sideJoint: SeriesSpec[] = ch.side === 'R'
          ? [{ label: '右膝角', color: COLORS.kneeR, values: arr('kneeFlexR'), dashed: true }]
          : [{ label: '左膝角', color: COLORS.kneeL, values: arr('kneeFlexL'), dashed: true }];
        wrap.innerHTML = `<div class="chart-title">${ch.label} 肌电包络（橙，归一化 0~1）× 膝关节角（虚线，°）</div>`;
        const cv = document.createElement('canvas');
        cv.style.height = '170px';
        wrap.appendChild(cv);
        emgHost.appendChild(wrap);
        const chart = new TimeChart(cv, {
          frameTime: bvh.frameTime,
          series: [
            { label: 'EMG 包络', color: COLORS.emg, values: ch.envelope, range: [0, 1], fill: true },
            ...sideJoint,
          ],
          cursor: store.state.playTime / bvh.frameTime,
          markers, yLabel: 'EMG / 角度',
          onSeek: (frame) => store.set({ playTime: frame * bvh.frameTime, playing: false }),
        });
        charts.push(chart);
      }
    }

    // 热力条：取左侧各周期平均曲线（双侧对称评估时以患侧/左侧为主）
    const heatHost = root.querySelector<HTMLElement>('#heatBars')!;
    heatHost.innerHTML = '';
    heatLegend(heatHost);
    heatbars = [];
    const cycles = loaded.analysis.cycles.filter((c) => c.side === 'L');
    const keyMap: { key: JointKey; field: keyof typeof frames[number] }[] = [
      { key: 'hip', field: 'hipFlexL' },
      { key: 'knee', field: 'kneeFlexL' },
      { key: 'ankle', field: 'ankleDorsiL' },
    ];
    for (const { key, field } of keyMap) {
      const values = Float32Array.from(frames.map((f) => f[field]));
      const cycleCurves = cycles.length
        ? cycles.map((c) => resampleCycle(values, c.startFrame, c.endFrame))
        : [resampleCycle(values, 0, n - 1)];
      const avg = averageCycles(cycleCurves);
      heatbars.push(createHeatBar(heatHost, key, avg));
    }
    const hint = document.createElement('div');
    hint.className = 'small-text';
    hint.textContent = cycles.length
      ? `基于左侧 ${cycles.length} 个完整步态周期的平均曲线；悬停色格查看逐百分比实测/常模/偏差。`
      : '未检出完整步态周期，热力条基于整段时间归一化。';
    heatHost.appendChild(hint);
  }

  function tick() {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    const loaded = store.state.primary;
    if (!loaded) return;
    const cursor = store.state.playTime / loaded.session.bvh.frameTime;
    for (const c of charts) c.update({ cursor });
  }

  function activate() {
    const has = !!store.state.primary;
    empty.classList.toggle('hidden', has);
    body.classList.toggle('hidden', !has);
    if (has) {
      build();
      if (!raf) raf = requestAnimationFrame(tick);
    }
  }

  const unsub = store.subscribe(activate);
  activate();
  return () => { disposed = true; unsub(); cancelAnimationFrame(raf); };
}
