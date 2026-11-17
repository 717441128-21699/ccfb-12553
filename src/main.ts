// 应用入口：页签路由、视图生命周期、顶部上下文
import './styles.css';
import { store } from './ui/store';
import { renderPatientView } from './ui/patientView';
import { renderCaptureView } from './ui/captureView';
import { renderPlaybackView } from './ui/playbackView';
import { renderCurvesView } from './ui/curvesView';
import { renderReportView } from './ui/reportView';

const views = document.querySelector('#views')!;
const tabs = document.querySelectorAll<HTMLButtonElement>('.tab');
const ctxInfo = document.querySelector('#ctxInfo')!;

type TabId = 'patient' | 'capture' | 'playback' | 'curves' | 'report';
const renderers: Record<TabId, (root: HTMLElement) => () => void> = {
  patient: renderPatientView,
  capture: renderCaptureView,
  playback: renderPlaybackView,
  curves: renderCurvesView,
  report: renderReportView,
};

let cleanup: (() => void) | null = null;

function switchTab(tab: TabId) {
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  if (cleanup) cleanup();
  views.innerHTML = `<div id="viewRoot"></div>`;
  const root = views.querySelector('#viewRoot') as HTMLElement;
  cleanup = renderers[tab](root);
}

tabs.forEach((t) => {
  t.addEventListener('click', () => switchTab(t.dataset.tab as TabId));
});

function updateCtx() {
  const p = store.state.currentPatient;
  if (!p) {
    ctxInfo.textContent = '未选择患者';
    return;
  }
  const parts = [`患者：<b>${p.name}</b>`];
  if (store.state.primary) parts.push(`主会话：${store.state.primary.session.label}`);
  if (store.state.compare) parts.push(`对比：${store.state.compare.session.label}`);
  ctxInfo.innerHTML = parts.join(' ｜ ');
}

store.subscribe(updateCtx);
updateCtx();
switchTab('patient');
