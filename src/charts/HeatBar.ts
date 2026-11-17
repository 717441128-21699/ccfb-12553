// 步态周期偏差热力条：一行 101 个色格，每格代表周期 1%，
// 颜色编码实测角度相对标准步态曲线的 |偏差|，悬停显示数值。
import { cycleDeviation, deviationColor, type JointKey } from '../data/normative';

export interface HeatBarHandle {
  destroy(): void;
  setCycle(curve: Float32Array): void;
}

export function createHeatBar(
  container: HTMLElement,
  key: JointKey,
  initialCurve: Float32Array,
): HeatBarHandle {
  const wrap = document.createElement('div');
  wrap.className = 'heatbar';
  const title = document.createElement('div');
  title.className = 'heatbar-title';
  const nameMap = { hip: '髋关节屈曲', knee: '膝关节屈曲', ankle: '踝关节背屈' };
  title.textContent = nameMap[key];
  const bar = document.createElement('div');
  bar.className = 'heatbar-cells';
  const tip = document.createElement('div');
  tip.className = 'heatbar-tip';
  const phases = document.createElement('div');
  phases.className = 'heatbar-phases';
  phases.innerHTML =
    '<span>0% 跟着地</span><span>~10% 负荷反应</span><span>~50% 对侧跟着地</span><span>60% 趾离地</span><span>100%</span>';
  wrap.append(title, bar, phases, tip);
  container.appendChild(wrap);

  let cells: HTMLDivElement[] = [];
  const setCycle = (curve: Float32Array) => {
    bar.innerHTML = '';
    cells = [];
    const dev = cycleDeviation(key, curve);
    for (const cell of dev) {
      const d = document.createElement('div');
      d.className = 'heat-cell';
      d.style.background = deviationColor(cell.absDev);
      d.addEventListener('pointerenter', () => {
        tip.textContent =
          `周期 ${cell.pct}% ｜ 实测 ${cell.measured.toFixed(1)}° ` +
          `常模 ${cell.normative.toFixed(1)}° ｜ 偏差 ${cell.deviation >= 0 ? '+' : ''}${cell.deviation.toFixed(1)}°`;
      });
      bar.appendChild(d);
      cells.push(d);
    }
  };
  setCycle(initialCurve);

  return {
    destroy() { wrap.remove(); },
    setCycle,
  };
}

/** 图例（绿->红的偏差量级），供报告复用 */
export function heatLegend(container: HTMLElement) {
  const el = document.createElement('div');
  el.className = 'heat-legend';
  el.innerHTML =
    '<span>偏差 0°</span>' +
    '<div style="background:linear-gradient(90deg,hsl(120,80%,45%),hsl(50,80%,45%),hsl(0,80%,45%));height:10px;flex:1;border-radius:5px"></div>' +
    '<span>≥15°</span>';
  container.appendChild(el);
}
