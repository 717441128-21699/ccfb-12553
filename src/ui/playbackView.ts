// 动画回放页：WebGL2 蒙皮渲染、播放控制、双会话半透明叠加、骨盆跟随镜头
import { store } from './store';
import { GaitRenderer } from '../render/renderer';
import { interpolatedPose, evaluatePose } from '../bvh/skeleton';
import type { Pose } from '../core/types';

export function renderPlaybackView(root: HTMLElement): () => void {
  root.innerHTML = `
  <div class="view">
    <div id="pbEmpty" class="empty card"><div class="ico">🎬</div>请先在“动捕载入”页载入并设置主会话</div>
    <div id="pbBody" class="hidden">
      <div class="stage">
        <canvas id="glCanvas"></canvas>
        <div class="stage-hint">拖拽旋转 ｜ 滚轮缩放 ｜ 镜头自动跟随骨盆 ｜ 地面网格为参照</div>
      </div>

      <div class="transport">
        <button class="btn small" id="playBtn">▶ 播放</button>
        <span class="time-readout" id="timeReadout">0.00 / 0.00 s</span>
        <input type="range" id="scrub" min="0" max="1000" value="0">
        <div class="toggle-group">
          <label class="switch">速度
            <select id="rate" style="width:auto">
              <option value="0.25">0.25×</option><option value="0.5">0.5×</option>
              <option value="1" selected>1×</option><option value="1.5">1.5×</option>
              <option value="2">2×</option>
            </select>
          </label>
        </div>
      </div>

      <div class="card">
        <div class="flex-between">
          <h3 style="margin:0">显示与对比</h3>
          <span id="compareTag" class="small-text"></span>
        </div>
        <div class="row" style="margin-top:10px">
          <label class="switch col" style="flex:0 0 auto">
            <input type="checkbox" id="follow" checked> 镜头跟随骨盆
          </label>
          <label class="switch col" style="flex:0 0 auto">
            <input type="checkbox" id="showRig"> 显示关节球
          </label>
          <label class="switch col" style="flex:0 0 auto">
            <input type="checkbox" id="overlay" checked> 复诊半透明叠加
          </label>
          <label class="switch col" style="flex:1;min-width:260px">
            叠加不透明度 <input type="range" id="alpha" min="10" max="100" value="45">
          </label>
          <label class="switch col" style="flex:0 0 auto">对齐方式
            <select id="align" style="width:auto">
              <option value="cycle" selected>步态周期百分比对齐</option>
              <option value="time">绝对时间对齐</option>
            </select>
          </label>
        </div>
        <div class="small-text" id="overlayInfo" style="margin-top:8px"></div>
      </div>
    </div>
  </div>`;

  const empty = root.querySelector('#pbEmpty') as HTMLElement;
  const body = root.querySelector('#pbBody') as HTMLElement;
  const canvas = root.querySelector<HTMLCanvasElement>('#glCanvas')!;
  let renderer: GaitRenderer | null = null;
  let raf = 0;
  let lastTs = 0;
  let disposed = false;
  const actorIds: number[] = [];

  function ensureRenderer() {
    if (!renderer) renderer = new GaitRenderer(canvas);
    return renderer;
  }

  function buildActors() {
    if (!renderer) return;
    renderer.clearActors();
    actorIds.length = 0;
    const primary = store.state.primary;
    if (!primary) return;
    const rest = evaluatePose(primary.session.bvh, primary.angles.referenceFrame);
    actorIds.push(renderer.addActor(primary.session.bvh, rest, {
      alpha: 1, showRig: false,
    }));
    if (store.state.compare) {
      const restC = evaluatePose(store.state.compare.session.bvh,
        store.state.compare.angles.referenceFrame);
      actorIds.push(renderer.addActor(store.state.compare.session.bvh, restC, {
        alpha: store.state.overlayAlpha, showRig: false,
      }));
    }
  }

  /** 求某会话在指定播放时间处的步态周期相位 0..1（基于同侧连续 HS 事件） */
  function cyclePhase(loaded: NonNullable<typeof store.state.primary>, time: number): number {
    const hs = loaded.analysis.events
      .filter((e) => e.type === 'HS' && e.side === 'L')
      .map((e) => e.time)
      .sort((a, b) => a - b);
    if (hs.length >= 2) {
      // 定位 time 所在的周期区间
      let i = 0;
      while (i < hs.length - 2 && time >= hs[i + 1]) i++;
      const start = hs[i];
      const end = hs[i + 1];
      if (time <= start) return 0;
      if (time >= end) return 1;
      return (time - start) / (end - start);
    }
    // 无完整事件：回退到整段时长比例
    const dur = loaded.session.bvh.frameCount * loaded.session.bvh.frameTime;
    return dur > 0 ? Math.max(0, Math.min(1, time / dur)) : 0;
  }

  /** 根据当前播放时间求两个演员各自的姿势（周期对齐时把复诊映射到同相位） */
  function currentPoses(): Pose[] {
    const primary = store.state.primary!;
    const bvh = primary.session.bvh;
    const t = store.state.playTime;
    const poses: Pose[] = [interpolatedPose(bvh, Math.min(t, store.duration))];

    const cmp = store.state.compare;
    if (cmp && root.querySelector<HTMLInputElement>('#overlay')!.checked) {
      const cbvh = cmp.session.bvh;
      const cDur = cbvh.frameCount * cbvh.frameTime;
      if (store.state.overlayAlign === 'time') {
        const ct = Math.min(t, cDur);
        poses.push(interpolatedPose(cbvh, ct));
      } else {
        // 步态周期百分比对齐：主会话当前相位 -> 复诊同相位时间
        const phase = cyclePhase(primary, t);
        const cHs = cmp.analysis.events
          .filter((e) => e.type === 'HS' && e.side === 'L')
          .map((e) => e.time).sort((a, b) => a - b);
        let ct: number;
        if (cHs.length >= 2) {
          ct = cHs[0] + phase * (cHs[1] - cHs[0]);
        } else {
          ct = cDur * phase;
        }
        poses.push(interpolatedPose(cbvh, Math.min(ct, cDur)));
      }
    }
    return poses;
  }

  function frame(ts: number) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const primary = store.state.primary;
    if (!primary || !renderer) return;
    const dt = lastTs ? (ts - lastTs) / 1000 : 0;
    lastTs = ts;

    if (store.state.playing) {
      const bvh = primary.session.bvh;
      let nt = store.state.playTime + dt * store.state.playbackRate;
      const dur = bvh.frameCount * bvh.frameTime;
      if (nt >= dur) nt = 0; // 循环播放
      store.set({ playTime: nt });
    }

    renderer.render(currentPoses());
    syncControls();
  }

  const playBtn = root.querySelector<HTMLButtonElement>('#playBtn')!;
  const scrub = root.querySelector<HTMLInputElement>('#scrub')!;
  const timeReadout = root.querySelector('#timeReadout')!;

  function syncControls() {
    const dur = store.duration;
    const t = store.state.playTime;
    timeReadout.textContent = `${t.toFixed(2)} / ${dur.toFixed(2)} s`;
    scrub.value = String(Math.round((t / (dur || 1)) * 1000));
    playBtn.textContent = store.state.playing ? '⏸ 暂停' : '▶ 播放';
  }

  playBtn.addEventListener('click', () => store.set({ playing: !store.state.playing }));
  scrub.addEventListener('input', () => {
    store.set({ playTime: (Number(scrub.value) / 1000) * store.duration, playing: false });
  });
  root.querySelector<HTMLSelectElement>('#rate')!.addEventListener('change', (e) => {
    store.set({ playbackRate: Number((e.target as HTMLSelectElement).value) });
  });
  root.querySelector<HTMLInputElement>('#follow')!.addEventListener('change', (e) => {
    renderer?.setFollow((e.target as HTMLInputElement).checked);
  });
  root.querySelector<HTMLInputElement>('#showRig')!.addEventListener('change', (e) => {
    actorIds.forEach((id) => renderer?.setActorRig(id, (e.target as HTMLInputElement).checked));
  });
  root.querySelector<HTMLInputElement>('#overlay')!.addEventListener('change', () => updateOverlay());
  root.querySelector<HTMLInputElement>('#alpha')!.addEventListener('input', (e) => {
    store.set({ overlayAlpha: Number((e.target as HTMLInputElement).value) / 100 });
    updateOverlay();
  });
  root.querySelector<HTMLSelectElement>('#align')!.addEventListener('change', (e) => {
    store.set({ overlayAlign: (e.target as HTMLSelectElement).value as 'time' | 'cycle' });
  });

  function updateOverlay() {
    const on = root.querySelector<HTMLInputElement>('#overlay')!.checked;
    if (renderer && actorIds[1] !== undefined) {
      renderer.setActorAlpha(actorIds[1], on ? store.state.overlayAlpha : 0);
    }
    const cmp = store.state.compare;
    root.querySelector('#overlayInfo')!.textContent = cmp
      ? `主会话：${store.state.primary!.session.label} ｜ 叠加：${cmp.session.label}（${on ? '半透明显示' : '已隐藏'}）`
      : '尚未设置对比会话，仅显示当前主会话';
    root.querySelector('#compareTag')!.textContent = cmp ? '双骨骼对比模式' : '单骨骼模式';
  }

  function activate() {
    const has = !!store.state.primary;
    empty.classList.toggle('hidden', has);
    body.classList.toggle('hidden', !has);
    if (!has) {
      store.set({ playing: false });
      return;
    }
    ensureRenderer();
    buildActors();
    updateOverlay();
    syncControls();
    if (!raf) raf = requestAnimationFrame((ts) => { lastTs = ts; frame(ts); });
  }

  const unsub = store.subscribe(activate);
  activate();

  return () => {
    disposed = true;
    unsub();
    cancelAnimationFrame(raf);
    raf = 0;
  };
}
